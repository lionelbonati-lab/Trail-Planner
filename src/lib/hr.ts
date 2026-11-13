// Zones cardiaques saisies en % : Grappe (échelle ESIE, % de la FC max), Karvonen (% de la FC de
// réserve = FC max − FC repos) ou perso. Les zones en bpm en sont déduites.
import type { Athlete, HrMethod, HrZone } from './types'

/** Échelle ESIE de F. Grappe : i1 à i5 en % de FC max (i6-i7 : la FC n'est plus significative). */
export const GRAPPE_PCT: HrZone[] = [
  { name: 'i1 Légère', low: 0.5, high: 0.75 },
  { name: 'i2 Moyenne', low: 0.75, high: 0.85 },
  { name: 'i3 Soutenue', low: 0.85, high: 0.92 },
  { name: 'i4 Seuil', low: 0.92, high: 0.96 },
  { name: 'i5 Sur-critique', low: 0.96, high: 1 },
]

/** Karvonen : 5 zones de 10 % de la FC de réserve, de 50 à 100 %. */
export const KARVONEN_PCT: HrZone[] = [0.5, 0.6, 0.7, 0.8, 0.9].map((low, i) => ({ name: `Zone ${i + 1}`, low, high: low + 0.1 }))

/** Point de départ de la méthode perso : zones Garmin en % de FC max. */
export const GARMIN_PCT: HrZone[] = [0.5, 0.6, 0.7, 0.8, 0.9].map((low, i) => ({ name: `Zone ${i + 1}`, low, high: low + 0.1 }))

export const HR_METHODS: { key: HrMethod; label: string; title: string }[] = [
  { key: 'grappe', label: 'Grappe', title: 'Échelle ESIE (F. Grappe) : i1 à i5 en % de la FC max' },
  { key: 'karvonen', label: 'Karvonen', title: '% de la FC de réserve (FC max − FC repos), ajoutés à la FC repos' },
  { key: 'custom', label: 'Perso', title: 'Tes propres zones, en % de la FC max ou de la FC de réserve' },
]

/** Zones en % et leur base pour la méthode choisie. */
export function hrPctOf(a: Pick<Athlete, 'hrMethod' | 'hrPct' | 'hrBase'>): { pct: HrZone[]; base: 'max' | 'reserve' } {
  if (a.hrMethod === 'grappe') return { pct: GRAPPE_PCT, base: 'max' }
  if (a.hrMethod === 'karvonen') return { pct: KARVONEN_PCT, base: 'reserve' }
  return { pct: a.hrPct.length ? a.hrPct : GARMIN_PCT, base: a.hrBase }
}

/** FC (bpm) correspondant à une fraction de la FC max ou de la FC de réserve. */
export function bpmAt(f: number, hrMax: number, hrRest: number, base: 'max' | 'reserve'): number {
  return Math.round(base === 'reserve' ? hrRest + f * (hrMax - hrRest) : f * hrMax)
}

/** Zones en bpm d'après la méthode, la FC max et la FC repos. */
export function hrZonesOf(a: Pick<Athlete, 'hrMethod' | 'hrPct' | 'hrBase' | 'hrMax' | 'hrRest'>): HrZone[] {
  const { pct, base } = hrPctOf(a)
  return pct.map((z) => ({ name: z.name, low: bpmAt(z.low, a.hrMax, a.hrRest, base), high: bpmAt(z.high, a.hrMax, a.hrRest, base) }))
}

/** Athlète avec ses zones en bpm recalculées. */
export function withHrZones<T extends Athlete>(a: T): T {
  return { ...a, hrZones: hrZonesOf(a) }
}
