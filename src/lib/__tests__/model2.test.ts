import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, DEFAULT_ENV, DEFAULT_KME, DEFAULT_PUSH } from '../defaults'
import { parseGpx } from '../gpx'
import { osmLevels, simulate, simulateScenarios, weatherAt, type SimOptions } from '../model'
import type { WeatherSeries } from '../types'

// 3 km de plat, 1 km à 8 %, 3 km de plat, 2 km à 8 %.
function gpx(): string {
  const pts: string[] = []
  let ele = 500
  for (let d = 0; d <= 9000; d += 10) {
    if ((d > 3000 && d <= 4000) || (d > 7000 && d <= 9000)) ele += 0.8
    pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${ele}</ele></trkpt>`)
  }
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

const env = { ...DEFAULT_ENV, night: { ...DEFAULT_ENV.night, enabled: false }, heat: { ...DEFAULT_ENV.heat, enabled: false } }
const base: SimOptions = { mode: 'physio', kme: DEFAULT_KME, env, checkpoints: [], techOverrides: [] }

describe('D′ et relances', () => {
  const track = parseGpx(gpx(), 0)
  it('sans relance, le D′ reste plein', () => {
    const r = simulate(track, DEFAULT_ATHLETE, base)
    expect(r.minWbal).toBeCloseTo(DEFAULT_ATHLETE.dPrime)
  })
  it('avec relance : plus rapide, D′ entamé sans dépasser le budget, puis rechargé', () => {
    const r0 = simulate(track, DEFAULT_ATHLETE, base)
    const r1 = simulate(track, DEFAULT_ATHLETE, { ...base, push: { ...DEFAULT_PUSH, enabled: true } })
    expect(r1.totalTime).toBeLessThan(r0.totalTime)
    expect(r1.minWbal).toBeLessThan(DEFAULT_ATHLETE.dPrime * 0.9)
    expect(r1.minWbal).toBeGreaterThanOrEqual(DEFAULT_ATHLETE.dPrime * (1 - DEFAULT_PUSH.budget) - 1)
    const at6km = r1.points.find((p) => p.dist >= 6900)!
    expect(at6km.wbal).toBeGreaterThan(r1.minWbal)
  })
})

describe('météo horaire', () => {
  const w: WeatherSeries = {
    fetchedAt: '',
    start: '2026-06-06T00:00:00Z',
    points: [
      { dist: 0, elevation: 500, temp: [10, 20, 30], precip: [0, 2, 4], wind: [0, 0, 0] },
      { dist: 10000, elevation: 1500, temp: [0, 10, 20], precip: [0, 0, 0], wind: [0, 0, 0] },
    ],
  }
  it('interpole dans le temps, la distance et corrige l’altitude', () => {
    const ms = Date.parse('2026-06-06T01:30:00Z')
    expect(weatherAt(w, 0, ms, 500)!.temp).toBeCloseTo(25)
    expect(weatherAt(w, 0, ms, 500)!.precip).toBeCloseTo(3)
    expect(weatherAt(w, 5000, ms, 1000)!.temp).toBeCloseTo(20)
    expect(weatherAt(w, 0, Date.parse('2026-06-07T00:00:00Z'), 500)).toBeNull()
  })
})

describe('technicité OSM et scénarios', () => {
  const track = parseGpx(gpx(), 0)
  it('niveaux OSM par point', () => {
    const lv = osmLevels(track, [{ from: 1000, to: 2000, level: 4, label: 'T4' }])
    expect(lv[0]).toBe(0)
    expect(lv[75]).toBe(4)
    const slow = simulate(track, DEFAULT_ATHLETE, { ...base, osmTech: [{ from: 1000, to: 2000, level: 4, label: 'T4' }] })
    expect(slow.totalTime).toBeGreaterThan(simulate(track, DEFAULT_ATHLETE, base).totalTime + 30)
  })
  it('bonne journée < prévu < journée difficile', () => {
    const s = simulateScenarios(track, DEFAULT_ATHLETE, base)
    expect(s.good.totalTime).toBeLessThan(s.plan.totalTime)
    expect(s.plan.totalTime).toBeLessThan(s.hard.totalTime)
  })
})
