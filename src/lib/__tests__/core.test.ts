import { describe, expect, it } from 'vitest'
import { computeCs } from '../cs'
import { DEFAULT_ATHLETE, DEFAULT_ENV, DEFAULT_KME } from '../defaults'
import { parseGpx } from '../gpx'
import { averageIntensity, diurnalTemp, gapFactor, intensityAt, simulate } from '../model'
import { peaksAndValleys, slopeBreaks, everyDistance } from '../splits'
import { parseDuration, zonedToUtc } from '../time'

// Trace synthétique : 5 km de plat, montée de 500 m sur 5 km, descente de 500 m sur 5 km.
function synthGpx(): string {
  const pts: string[] = []
  const lat0 = 45
  const n = 1500
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * 15000
    const ele = d < 5000 ? 500 : d < 10000 ? 500 + ((d - 5000) / 5000) * 500 : 1000 - ((d - 10000) / 5000) * 500
    const lat = lat0 + d / 111195
    pts.push(`<trkpt lat="${lat}" lon="6"><ele>${ele}</ele></trkpt>`)
  }
  return `<gpx><trk><name>Test</name><trkseg>${pts.join('')}</trkseg></trk>
  <wpt lat="${lat0 + 10000 / 111195}" lon="6"><name>Sommet</name></wpt></gpx>`
}

describe('gpx', () => {
  it('lit distance, dénivelé et waypoints', () => {
    const t = parseGpx(synthGpx())
    expect(t.totalDist).toBeGreaterThan(14900)
    expect(t.totalDist).toBeLessThan(15100)
    expect(t.dPlus).toBeGreaterThan(470)
    expect(t.dPlus).toBeLessThan(510)
    expect(t.waypoints[0].dist).toBeGreaterThan(9900)
    expect(t.waypoints[0].dist).toBeLessThan(10100)
  })
})

describe('vitesse critique', () => {
  it('retrouve VC et D′ sur données exactes', () => {
    const cs = 4
    const dp = 200
    const r = computeCs([180, 420, 720].map((time) => ({ time, dist: cs * time + dp })))!
    expect(r.cs).toBeCloseTo(4, 6)
    expect(r.dPrime).toBeCloseTo(200, 6)
    expect(r.r2).toBeCloseTo(1, 6)
  })
})

describe('modèle', () => {
  it('GAP : 1 en plat, < 1 en montée', () => {
    expect(gapFactor(0)).toBeCloseTo(1)
    expect(gapFactor(10)).toBeLessThan(0.75)
    expect(gapFactor(-10)).toBeGreaterThan(1)
  })
  it('durabilité log : la moyenne de l’intensité instantanée retrouve la courbe', () => {
    const d = DEFAULT_ATHLETE.durability
    const T = 10
    let sum = 0
    const n = 10000
    for (let i = 0; i < n; i++) sum += intensityAt(((i + 0.5) / n) * T, d)
    expect(sum / n).toBeCloseTo(averageIntensity(T, d), 2)
  })
  it('température : min à 6 h, max à 15 h', () => {
    expect(diurnalTemp(6, 10, 20)).toBeCloseTo(10)
    expect(diurnalTemp(15, 10, 20)).toBeCloseTo(20)
    expect(diurnalTemp(3, 10, 20)).toBeGreaterThan(10)
  })
  it('simulation : temps cohérents et arrêts comptés', () => {
    const track = parseGpx(synthGpx())
    const env = { ...DEFAULT_ENV, night: { ...DEFAULT_ENV.night, enabled: false } }
    const base = { mode: 'physio' as const, kme: DEFAULT_KME, env, techOverrides: [] }
    const cp = { id: 'a', dist: 5000, name: 'Ravito', kind: 'ravito' as const, stopMin: 5, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }
    const r0 = simulate(track, DEFAULT_ATHLETE, { ...base, checkpoints: [] })
    const r1 = simulate(track, DEFAULT_ATHLETE, { ...base, checkpoints: [cp] })
    expect(r0.totalTime).toBeGreaterThan(3600)
    expect(r0.totalTime).toBeLessThan(3 * 3600)
    expect(r1.totalTime - r0.totalTime).toBeGreaterThan(290)
    expect(r1.splits[0].arrival).toBeGreaterThan(5000 / DEFAULT_ATHLETE.cs)
    expect(r1.points.length).toBe(track.points.length)
    for (const mode of ['kme', 'gap'] as const) {
      const r = simulate(track, DEFAULT_ATHLETE, { ...base, mode, checkpoints: [] })
      expect(r.totalTime).toBeGreaterThan(3600)
    }
  })
})

describe('découpage auto', () => {
  it('trouve le sommet et les ruptures', () => {
    const track = parseGpx(synthGpx())
    const peaks = peaksAndValleys(track, 80)
    expect(peaks.some((p) => Math.abs(p.dist - 10000) < 200)).toBe(true)
    const breaks = slopeBreaks(track, 20)
    expect(breaks.some((p) => Math.abs(p.dist - 5000) < 200)).toBe(true)
    expect(everyDistance(track, 5).length).toBe(2)
  })
})

describe('temps', () => {
  it('parse et fuseaux', () => {
    expect(parseDuration("4'05")).toBe(245)
    expect(parseDuration('1:02:30')).toBe(3750)
    expect(zonedToUtc('2026-06-06T06:00', 'Europe/Paris').toISOString()).toBe('2026-06-06T04:00:00.000Z')
  })
})

import { solarElevation } from '../sun'
describe('soleil', () => {
  it('jour à midi, nuit à minuit (Chamonix, juin)', () => {
    expect(solarElevation(Date.UTC(2026, 5, 21, 11, 30), 45.92, 6.87)).toBeGreaterThan(60)
    expect(solarElevation(Date.UTC(2026, 5, 21, 23, 0), 45.92, 6.87)).toBeLessThan(-10)
  })
})

import { buildCourseGpx } from '../exportGpx'
import { newRace } from '../defaults'
import { withFinish } from '../model'
describe('export Garmin', () => {
  it('produit un GPX relisible avec waypoints et horodatage', () => {
    const xml = synthGpx()
    const race = newRace('Test', xml)
    race.checkpoints = [{ id: 'r', dist: 7000, name: 'Ravito <A&B>', kind: 'ravito', stopMin: 2, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
    const track = parseGpx(xml)
    const sim = simulate(track, DEFAULT_ATHLETE, { mode: 'physio', kme: DEFAULT_KME, env: race.env, checkpoints: withFinish(race, track), techOverrides: [] })
    const out = buildCourseGpx(race, track, sim)
    const back = parseGpx(out)
    expect(back.totalDist).toBeCloseTo(track.totalDist, -1)
    expect(back.waypoints.length).toBe(2)
    expect(back.waypoints[0].name).toContain('Ravito <A&B>')
    expect(out).toMatch(/<time>2026-06-06T04:00:00.000Z<\/time>/)
  })
})
