import { existsSync, readFileSync } from 'node:fs'
import FitParser from 'fit-file-parser'
import { describe, expect, it } from 'vitest'
import { activityFromRaw, analyzeActivity, calibrateFromActivities, calibrateOnActivity, readActivity } from '../activity'
import { DEFAULT_ATHLETE, DEFAULT_ENV, DEFAULT_KME, newRace } from '../defaults'
import { buildCourseFit } from '../fit'
import { decodeFit, decodeFitRecords } from '../fitDecode'
import { parseGpx, type RawPoint } from '../gpx'
import { simulate, withFinish } from '../model'
import { formatDuration } from '../time'

function synthGpx(): string {
  const pts: string[] = []
  for (let i = 0; i <= 1500; i++) {
    const d = (i / 1500) * 15000
    const ele = d < 5000 ? 500 : d < 10000 ? 500 + ((d - 5000) / 5000) * 500 : 1000 - ((d - 10000) / 5000) * 500
    pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${ele}</ele></trkpt>`)
  }
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('décodeur FIT', () => {
  it('relit les records écrits par l’encodeur (même résultat qu’un décodeur indépendant)', async () => {
    const xml = synthGpx()
    const race = newRace('T', xml)
    const track = parseGpx(xml)
    const sim = simulate(track, DEFAULT_ATHLETE, { mode: 'physio', kme: DEFAULT_KME, env: race.env, checkpoints: withFinish(race, track), techOverrides: [] })
    const fit = buildCourseFit(race, track, sim)
    const mine = decodeFitRecords(fit)
    const ref: any = await new Promise((res, rej) => new FitParser({ mode: 'list' }).parse(fit.buffer as ArrayBuffer, (e: any, d: any) => (e ? rej(e) : res(d))))
    expect(mine.length).toBe(ref.records.length)
    // Tour unique du parcours : distance totale.
    const { laps } = decodeFit(fit)
    expect(laps).toHaveLength(1)
    expect(laps[0].distance).toBeCloseTo(track.totalDist, -1)
    expect(laps[0].timer).toBeCloseTo(sim.totalTime, 0)
    for (const i of [0, 100, mine.length - 1]) {
      expect(mine[i].lat).toBeCloseTo(ref.records[i].position_lat, 6)
      expect(mine[i].ele).toBeCloseTo(ref.records[i].altitude, 0)
      expect(mine[i].time).toBe(new Date(ref.records[i].timestamp).getTime())
    }
  })
})

describe('calibration', () => {
  it('retrouve une VAM et une durabilité connues sur une activité simulée', () => {
    // Activité synthétique : coureur « modèle » avec VAM 900 m/h à 20 % et durabilité connue.
    const athlete = { ...DEFAULT_ATHLETE, vam: [{ grade: 20, vam: 900 }], walkThreshold: 15, durability: { ...DEFAULT_ATHLETE.durability, pct1h: 0.9, k: 0.06 } }
    const pts: string[] = []
    let ele = 500
    // 40 km : alternance de 4 km de plat et 1 km à 20 %, puis 1 km à −15 %.
    for (let d = 0; d <= 60000; d += 10) {
      const m = d % 6000
      if (m > 4000 && m <= 5000) ele += 2
      else if (m > 5000) ele -= 2
      pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${ele}</ele></trkpt>`)
    }
    const track = parseGpx(`<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`, 0)
    const env = { ...DEFAULT_ENV, start: '2026-06-06T08:00', timeZone: 'UTC', night: { ...DEFAULT_ENV.night, enabled: false }, heat: { ...DEFAULT_ENV.heat, enabled: false } }
    const sim = simulate(track, athlete, { mode: 'physio', kme: DEFAULT_KME, env, checkpoints: [], techOverrides: [] })
    const t0 = Date.parse('2026-06-06T08:00:00Z')
    const raw: RawPoint[] = track.points.map((p, i) => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: t0 + sim.points[i].t * 1000 }))
    const act = activityFromRaw('synth', raw)
    const an = analyzeActivity(act, DEFAULT_ATHLETE, env)
    const cal = calibrateFromActivities(DEFAULT_ATHLETE, [an.record])
    const d = cal.athlete.durability
    expect(d.pct1h).toBeGreaterThan(0.85)
    expect(d.pct1h).toBeLessThan(0.95)
    expect(d.k).toBeGreaterThan(0.03)
    expect(d.k).toBeLessThan(0.09)
    const v20 = cal.athlete.vam.find((v) => v.grade > 17 && v.grade < 23)!
    expect(v20.vam).toBeGreaterThan(800)
    expect(v20.vam).toBeLessThan(1000)
  })

  const f = process.env.TP_ACT
  it.skipIf(!f || !existsSync(f))('activité réelle', () => {
    const act = readActivity(f!.split('/').pop()!, new Uint8Array(readFileSync(f!)))
    const athlete = { ...DEFAULT_ATHLETE, cs: 1000 / 247 }
    const an = analyzeActivity(act, athlete, DEFAULT_ENV)
    const r = an.record
    console.log(`${r.name} ${(r.dist / 1000).toFixed(1)} km écoulé ${formatDuration(r.elapsed, true)} mouvement ${formatDuration(r.moving, true)} prédit ${formatDuration(r.predicted, true)}`)
    console.log('intensité', r.intensity.map(([h, i]) => `${h.toFixed(2)}h:${Math.round(i * 100)}`).join(' '))
    console.log('pentes', r.grades.map((g) => `[${g.lo},${g.hi}] ${(g.dist / 1000).toFixed(1)}km ${g.normalized.toFixed(2)}`).join(' | '))
    const cal = calibrateOnActivity(athlete, [r], act, r, DEFAULT_ENV)
    cal.changes.forEach((c) => console.log(' -', c))
    const after = analyzeActivity(act, cal.athlete, DEFAULT_ENV)
    console.log(`prédit après calibration ${formatDuration(after.record.predicted, true)}`)
    expect(Math.abs(after.record.predicted - r.moving)).toBeLessThan(30)
  })
})
