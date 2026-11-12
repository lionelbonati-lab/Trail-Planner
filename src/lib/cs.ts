// Calcul de la vitesse critique (VC) et du D' par régression distance-temps.
// Modèle : d = VC · t + D'. Avec 3 essais (ex. 3', 7', 12'), la régression
// linéaire donne VC (pente), D' (ordonnée à l'origine) et un R² de contrôle.

export interface Trial {
  /** Distance parcourue (m). */
  dist: number
  /** Durée (s). */
  time: number
}

export interface CsResult {
  /** Vitesse critique (m/s). */
  cs: number
  /** D' (m). */
  dPrime: number
  r2: number
  /** Erreur standard sur VC (m/s), si au moins 3 essais. */
  csSe: number | null
}

export function computeCs(trials: Trial[]): CsResult | null {
  const t = trials.filter((x) => x.dist > 0 && x.time > 0)
  if (t.length < 2) return null
  const n = t.length
  const mx = t.reduce((a, x) => a + x.time, 0) / n
  const my = t.reduce((a, x) => a + x.dist, 0) / n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const x of t) {
    sxx += (x.time - mx) ** 2
    sxy += (x.time - mx) * (x.dist - my)
    syy += (x.dist - my) ** 2
  }
  if (sxx === 0) return null
  const cs = sxy / sxx
  const dPrime = my - cs * mx
  const ssRes = t.reduce((a, x) => a + (x.dist - (cs * x.time + dPrime)) ** 2, 0)
  const r2 = syy > 0 ? 1 - ssRes / syy : 1
  const csSe = n > 2 ? Math.sqrt(ssRes / (n - 2) / sxx) : null
  return { cs, dPrime, r2, csSe }
}

/** Temps prédit (s) sur une distance (m), valable environ de 2 à 30 min d'effort. */
export function predictTime(cs: number, dPrime: number, dist: number): number {
  return dist > dPrime ? (dist - dPrime) / cs : NaN
}

export interface TestProtocol {
  id: string
  label: string
  description: string
  /** Essais par défaut, en durée fixe (s) ou distance fixe (m). */
  trials: { fixed: 'time' | 'dist'; value: number }[]
}

export const PROTOCOLS: TestProtocol[] = [
  {
    id: '3-7-12',
    label: "3 essais 3' / 7' / 12'",
    description:
      "Trois efforts maximaux à durée fixe, idéalement sur piste ou sur un plat roulant, avec au moins 30 min de récupération (ou des jours différents). Saisis la distance parcourue sur chacun.",
    trials: [
      { fixed: 'time', value: 180 },
      { fixed: 'time', value: 420 },
      { fixed: 'time', value: 720 },
    ],
  },
]
