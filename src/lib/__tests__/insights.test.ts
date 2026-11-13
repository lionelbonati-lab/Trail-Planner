import { describe, expect, it } from 'vitest'
import { activityFromRaw } from '../activity'
import { DEFAULT_ATHLETE, normalizeAthlete } from '../defaults'
import type { RawPoint } from '../gpx'
import { analyzeSession } from '../insights'

const A = normalizeAthlete({ ...DEFAULT_ATHLETE, cs: 4, dPrime: 200 })

/** Activité plate : segments [durée s, vitesse m/s] ; tours = segments. */
function flat(segments: [number, number][]) {
  const raw: RawPoint[] = []
  const t0 = Date.parse('2026-11-10T17:00:00Z')
  let t = t0
  let x = 0
  raw.push({ lat: 45, lon: 6, ele: 400, time: t })
  const laps = []
  for (const [dur, v] of segments) {
    laps.push({ start: t, elapsed: dur, timer: dur, distance: v * dur })
    for (let s = 0; s < dur; s += 2) {
      x += v * 2
      t += 2000
      raw.push({ lat: 45 + x / 111195, lon: 6, ele: 400, time: t })
    }
  }
  return activityFromRaw('séance', raw, laps)
}

describe('analyse d’une séance quelconque', () => {
  it('temps par zone, tours, meilleurs efforts', () => {
    // 20′ Z1 (65 %), 10′ Z2 (75 %), 7′ à fond (au-dessus du modèle actuel), 10′ Z1.
    const v7 = (A.cs + 0.15) + A.dPrime / 420
    const ins = analyzeSession(flat([[1200, 2.6], [600, 3.0], [420, v7], [600, 2.6]]), A)
    const byZone = Object.fromEntries(ins.zoneTimes.map((z) => [z.name, Math.round(z.seconds / 60)]))
    expect(byZone['Zone 1']).toBeGreaterThanOrEqual(29)
    expect(byZone['Zone 1']).toBeLessThanOrEqual(31)
    expect(byZone['Zone 2']).toBeGreaterThanOrEqual(9)
    expect(byZone['Zone 7']).toBeGreaterThanOrEqual(6) // 116 % VC : zone 7 du bilan
    expect(ins.laps).toHaveLength(4)
    expect(ins.laps[2].zone).toBe(6)
    expect(ins.laps[1].intensity).toBeCloseTo(0.75, 1)
    const b7 = ins.best.find((b) => b.seconds === 420)!
    expect(b7.ratio).toBeGreaterThan(1.02)
    expect(ins.csFloor!.cs).toBeGreaterThan(A.cs + 0.1)
    expect(ins.tests).toHaveLength(1)
    expect(ins.tests[0]).toMatchObject({ seconds: 420, source: 'lap' })
    expect(ins.tests[0].dist).toBeCloseTo(v7 * 420, -1)
  })
  it('séance facile : aucune suggestion', () => {
    const ins = analyzeSession(flat([[2400, 2.8]]), A)
    expect(ins.csFloor).toBeNull()
    expect(ins.tests).toHaveLength(0)
  })
})
