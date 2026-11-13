import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, normalizeAthlete } from '../defaults'
import { progressSeries } from '../progress'
import { describeSteps, SESSIONS_BY_KEY } from '../sessions'
import type { CsTrial } from '../types'

const A = normalizeAthlete({ ...DEFAULT_ATHLETE, cs: 4, dPrime: 200 })
const trial = (date: string, seconds: number, dist: number, source: CsTrial['source'] = 'manual'): CsTrial => ({
  id: `${date}-${seconds}`,
  date: `${date}T12:00:00.000Z`,
  seconds,
  dist,
  source,
})
/** Distance d'un effort à fond de `s` secondes pour une VC `cs` et un D′ de 200 m. */
const dist = (cs: number, s: number) => Math.round(cs * s + 200)

describe('évolution de la VC', () => {
  it('calculée à partir des tests 3′/7′/12′, même non appliqués au profil', () => {
    const a = {
      ...A,
      csTrials: [
        trial('2026-09-01', 180, dist(4, 180)),
        trial('2026-09-05', 420, dist(4, 420)),
        trial('2026-09-09', 720, dist(4, 720)),
        // Nouveau 3′ deux mois plus tard, puis 7′ : seconde mesure, plus rapide.
        trial('2026-11-02', 180, dist(4.2, 180)),
        trial('2026-11-06', 420, dist(4.2, 420)),
      ],
    }
    const cs = progressSeries(a).find((s) => s.key === 'cs')!.points
    // Pas de VC après le seul 3′, ni après le 3′ isolé de novembre (les autres ont plus de 6 semaines).
    expect(cs.map((p) => new Date(p.t).toISOString().slice(0, 10))).toEqual(['2026-09-05', '2026-09-09', '2026-11-06'])
    expect(cs[1].value).toBeCloseTo(4 * 3.6, 1)
    expect(cs[2].value).toBeCloseTo(4.2 * 3.6, 1)
    expect(cs[2].source).toContain('Tests')
  })

  it('tests importés : pas de point en double avec la séance enregistrée', () => {
    const a = {
      ...A,
      csTrials: [trial('2026-09-01', 180, dist(4, 180), 'lap'), trial('2026-09-05', 420, dist(4, 420), 'lap')],
      activities: [{ id: 'x', name: 'Test 7′', date: '2026-09-05T12:00:00.000Z', session: 'csTest', metrics: { cs: 4, dPrime: 200 } } as never],
    }
    expect(progressSeries(a).find((s) => s.key === 'cs')!.points).toHaveLength(1)
  })
})

describe('déroulé du test VC', () => {
  it('affiché pour les trois tests : effort de 3, 7 ou 12 min selon le test', () => {
    const def = SESSIONS_BY_KEY.csTest
    const lines = describeSteps(def.steps(A), A)
    const effort = lines.find((l) => l.includes('à fond'))!
    expect(effort).toContain('3, 7 ou 12 min selon le test')
    expect(lines.some((l) => l.startsWith("3' à fond"))).toBe(false)
    // L'entraînement envoyé à la montre garde la durée du test choisi.
    expect(describeSteps(def.steps(A, def.variants![1]), A).some((l) => l.startsWith("7' à fond : 7 min"))).toBe(true)
  })
})
