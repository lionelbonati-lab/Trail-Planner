import { describe, expect, it } from 'vitest'
import { activityFromRaw } from '../activity'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import type { RawPoint } from '../gpx'
import { isDefaultLevel, levelFromActivity, levelFromTime, scaleLevel } from '../level'
import { simulate } from '../model'
import { computePlan } from '../plan'
import { wholeRoute, zoneTarget } from '../zones'

/** Boucle de 14 km : 4 km de plat, montée de 600 m à 15 %, descente, plat. */
function profile(d: number): number {
  if (d < 4000) return 500
  if (d < 8000) return 500 + (d - 4000) * 0.15
  if (d < 12000) return 1100 - (d - 8000) * 0.15
  return 500
}
function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 14000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${profile(d)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

const A = normalizeAthlete(DEFAULT_ATHLETE)

describe('niveau sans test VC', () => {
  it('profil par défaut repéré, plus après réglage', () => {
    expect(isDefaultLevel(A)).toBe(true)
    expect(isDefaultLevel(scaleLevel(A, 0.8))).toBe(false)
    expect(isDefaultLevel({ ...A, csTrials: [{ id: 't', date: '', seconds: 180, dist: 900, source: 'manual' }] })).toBe(false)
  })

  it('temps réalisé sur une course de l’app : niveau retrouvé (effort de course ou zone)', () => {
    const race = newRace('Boucle', gpx())
    const plan = computePlan(race, A)!
    // Coureur réel : 75 % du niveau par défaut.
    const target = simulate(plan.track, scaleLevel(A, 0.75), plan.opts).totalTime
    const est = levelFromTime(plan.track, A, plan.opts, target, { kind: 'race' })!
    expect(est.athlete.cs / A.cs).toBeCloseTo(0.75, 2)
    expect(Math.abs(est.predicted - target)).toBeLessThan(5)
    expect(est.changes[0]).toMatch(/^Vitesse critique : 4'15 → 5'\d\d \/km$/)
    // Même temps en zone 2 (endurance facile) : le niveau de course est plus haut.
    const z2 = levelFromTime(plan.track, A, plan.opts, target, { kind: 'zone', index: 1 })!
    expect(z2.athlete.cs).toBeGreaterThan(est.athlete.cs * 1.1)
    // Temps impossible : pas de résultat.
    expect(levelFromTime(plan.track, A, plan.opts, 60, { kind: 'race' })).toBeNull()
  })

  it('enregistrement d’une course : VC, VAM et descente mesurées, temps retrouvé', () => {
    const race = newRace('Boucle', gpx())
    const plan = computePlan(race, A)!
    // Coureur réel : VC à 80 %, montée plus lente (VAM à 70 %), enregistrement horodaté par le modèle.
    const real = { ...scaleLevel(A, 0.8), vam: scaleLevel(A, 0.7).vam }
    const opts = { mode: 'physio' as const, kme: { upPer1km: 100, downPer1km: 0 }, env: { ...race.env, heat: { ...race.env.heat, enabled: false } }, checkpoints: [], techOverrides: [] }
    const sim = simulate(plan.track, real, opts)
    const t0 = Date.parse('2026-06-01T06:00:00Z')
    const raw: RawPoint[] = sim.points.map((p) => {
      const tp = plan.track.points[Math.min(plan.track.points.length - 1, Math.round(p.dist / 20))]
      return { lat: tp.lat, lon: tp.lon, ele: tp.ele, time: t0 + p.t * 1000 }
    })
    const act = activityFromRaw('Boucle', raw)
    const est = levelFromActivity(act, A, race.env, { kind: 'race' })!
    expect(Math.abs(est.predicted - est.actual) / est.actual).toBeLessThan(0.01)
    expect(est.athlete.cs / real.cs).toBeGreaterThan(0.85)
    expect(est.athlete.cs / real.cs).toBeLessThan(1.15)
    expect(est.changes.some((c) => /^Vitesse ascensionnelle mesurée/.test(c))).toBe(true)
    // Entraînement en zone : niveau global seulement, temps retrouvé.
    const z = levelFromActivity(act, A, race.env, { kind: 'zone', index: 2 })!
    expect(Math.abs(z.predicted - z.actual) / z.actual).toBeLessThan(0.01)
    expect(z.changes).toHaveLength(2)
    expect(wholeRoute(zoneTarget(A, 2), 1000)[0].value).toBeCloseTo(0.84, 2)
  })
})
