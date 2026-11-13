import { describe, expect, it } from 'vitest'
import { activityFromRaw, analyzeActivity, defaultLapKeep, lapKeepWithoutEnds, lapPortions, type Activity } from '../activity'
import { DEFAULT_ATHLETE, DEFAULT_ENV, normalizeAthlete } from '../defaults'
import { FIT_EPOCH, FitWriter } from '../fit'
import { decodeFit, type FitLap } from '../fitDecode'
import type { RawPoint } from '../gpx'
import { analyzeSession, cardiacDrift } from '../insights'

const A = normalizeAthlete({ ...DEFAULT_ATHLETE, cs: 4, dPrime: 200 })

/**
 * Séance à plat en trois tours : échauffement lent (2,4 m/s, FC 120), corps de séance
 * (3,2 m/s, FC 150 qui dérive de +6 bpm/h), retour au calme (2,2 m/s, FC 115).
 */
function session(marked: boolean): Activity {
  const parts: [number, number, (m: number) => number, FitLap['intensity']][] = [
    [20 * 60, 2.4, () => 120, 'warmup'],
    [100 * 60, 3.2, (m) => 150 + (m / 60) * 6, 'active'],
    [15 * 60, 2.2, () => 115, 'cooldown'],
  ]
  const raw: RawPoint[] = []
  const laps: FitLap[] = []
  let t = Date.parse('2026-11-10T07:00:00Z')
  let x = 0
  raw.push({ lat: 45, lon: 6, ele: 400, time: t, hr: 120 })
  for (const [dur, v, hr, intensity] of parts) {
    laps.push({ start: t, elapsed: dur, timer: dur, distance: v * dur, ...(marked ? { intensity } : {}) })
    for (let s = 2; s <= dur; s += 2) {
      x += v * 2
      t += 2000
      raw.push({ lat: 45 + x / 111195, lon: 6, ele: 400, time: t, hr: hr(s / 60) })
    }
  }
  return activityFromRaw('séance', raw, laps)
}

describe('tours retenus pour les analyses', () => {
  it('type de tour lu dans le FIT (échauffement, retour au calme)', () => {
    const w = new FitWriter()
    const fields = [
      { num: 2, type: 'uint32' as const },
      { num: 7, type: 'uint32' as const },
      { num: 8, type: 'uint32' as const },
      { num: 9, type: 'uint32' as const },
      { num: 23, type: 'enum' as const },
    ]
    const t0 = Date.parse('2026-11-10T07:00:00Z') / 1000 - FIT_EPOCH
    w.message(19, fields, [t0, 600000, 600000, 150000, 2])
    w.message(19, fields, [t0 + 600, 1200000, 1200000, 400000, 0])
    w.message(19, fields, [t0 + 1800, 300000, 300000, 60000, 3])
    const { laps } = decodeFit(w.finish())
    expect(laps.map((l) => l.intensity)).toEqual(['warmup', 'active', 'cooldown'])
    expect(laps[1].distance).toBe(4000)
  })

  it('échauffement et retour au calme exclus d’office s’ils sont marqués, sinon premier et dernier tours au choix', () => {
    const marked = session(true)
    expect(defaultLapKeep(marked)).toEqual([false, true, false])
    expect(lapPortions(marked, defaultLapKeep(marked))).toEqual([[20 * 60, 120 * 60]])
    const plain = session(false)
    expect(defaultLapKeep(plain)).toEqual([true, true, true])
    expect(lapPortions(plain, defaultLapKeep(plain))).toBeNull()
    expect(lapKeepWithoutEnds(plain)).toEqual([false, true, false])
  })

  it('zones, intensité et découplage calculés sur les seuls tours retenus', () => {
    const act = session(true)
    const portions = lapPortions(act, defaultLapKeep(act))
    const all = analyzeSession(act, A)
    const body = analyzeSession(act, A, portions)
    const total = (z: { seconds: number }[]) => z.reduce((s, x) => s + x.seconds, 0)
    // Toute la séance : 135 min ; corps de séance seul : 100 min.
    expect(total(all.zoneTimes) / 60).toBeCloseTo(135, -1)
    expect(total(body.zoneTimes) / 60).toBeGreaterThan(95)
    expect(total(body.zoneTimes) / 60).toBeLessThan(102)
    expect(total(body.hrZoneTimes!) / 60).toBeLessThan(102)
    expect(body.laps.map((l) => l.kept)).toEqual([false, true, false])
    // Intensité : plus de points lents d'échauffement (2,4 m/s = 60 % de VC).
    const an = analyzeActivity(act, A, DEFAULT_ENV, portions)
    expect(Math.min(...an.intensity.map((p) => p[1]))).toBeGreaterThan(0.7)
    // Découplage : référence prise au début du corps de séance (et non pendant l'échauffement).
    const d = cardiacDrift(act, portions)!
    expect(d.baseFrom).toBeGreaterThanOrEqual(20 * 60)
    expect(d.baseline).toBeCloseTo(151 / (3.2 * 3.6), 0)
    expect(d.decoupling).toBeGreaterThan(0.03)
    // Sans sélection, le retour au calme lent fausse la fin.
    expect(cardiacDrift(act)!.decoupling).not.toBeCloseTo(d.decoupling, 2)
  })
})
