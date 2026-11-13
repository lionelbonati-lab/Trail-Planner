// Plan de nutrition par tronçon entre ravitos : eau, glucides, sodium et
// nombre de produits à emporter.
import type { Product, Race, SimResult } from './types'

export interface Leg {
  /** Point de départ du tronçon (« Départ » ou nom du ravito). */
  from: string
  /** Id du point de départ (null = départ). */
  fromId: string | null
  to: string
  /** Durée du tronçon (s), du départ du point à l'arrivée au suivant. */
  duration: number
  /** Température moyenne prévue (°C). */
  temp: number
  water: number
  carbs: number
  sodium: number
  products: { product: Product; count: number }[]
  /** Sodium apporté par les produits (mg). */
  sodiumFromProducts: number
}

/** L'eau augmente de 4 % par °C au-dessus de 15 °C (repère courant, à ajuster). */
const WATER_PER_DEG = 0.04

export function nutritionPlan(race: Race, sim: SimResult, products: Product[]): Leg[] {
  const legs: Leg[] = []
  const stops = sim.splits.filter((s) => s.cp.kind === 'ravito' || s.cp.id === '__finish' || s === sim.splits[sim.splits.length - 1])
  let fromName = 'Départ'
  let fromId: string | null = null
  let fromTime = 0
  let fromDist = 0
  const totalShare = products.reduce((a, p) => a + Math.max(0, p.share), 0) || 1
  for (const s of stops) {
    const duration = Math.max(0, s.arrival - fromTime)
    const h = duration / 3600
    const seg = sim.points.filter((p) => p.dist >= fromDist && p.dist <= s.to)
    const temp = seg.length ? seg.reduce((a, p) => a + p.temp, 0) / seg.length : 15
    const carbs = Math.round(h * race.carbsPerH)
    const water = Math.round(h * race.waterPerH * (1 + WATER_PER_DEG * Math.max(0, temp - 15)) * 10) / 10
    const sodium = Math.round(h * race.sodiumPerH)
    const usable = products.filter((p) => p.carbs > 0 && p.share > 0)
    const counts = usable.map((p) => Math.round((carbs * (p.share / totalShare)) / p.carbs))
    // Complète si l'arrondi laisse plus de 10 g de manque : produit le moins « servi » par rapport à sa part.
    const total = () => counts.reduce((a, c, i) => a + c * usable[i].carbs, 0)
    while (usable.length && total() < carbs - 10) {
      let best = 0
      let bestGap = -Infinity
      usable.forEach((p, i) => {
        const gap = (carbs * p.share) / totalShare - counts[i] * p.carbs
        if (gap > bestGap) {
          bestGap = gap
          best = i
        }
      })
      counts[best]++
    }
    const items = usable.map((p, i) => ({ product: p, count: counts[i] })).filter((x) => x.count > 0)
    legs.push({
      from: fromName,
      fromId,
      to: s.cp.name,
      duration,
      temp,
      water,
      carbs,
      sodium,
      products: items,
      sodiumFromProducts: items.reduce((a, x) => a + x.count * x.product.sodium, 0),
    })
    fromName = s.cp.name
    fromId = s.cp.id
    fromTime = s.departure
    fromDist = s.to
  }
  return legs
}

/** Contenu du sac à prendre au départ d'un tronçon, en une ligne. */
export function bagText(leg: Leg): string {
  const items = leg.products.map((x) => `${x.count} × ${x.product.name}`)
  const missing = leg.sodium - leg.sodiumFromProducts
  if (missing > 150) items.push(`+${Math.round(missing)} mg de sodium (sel)`)
  return [`${leg.water} L d'eau`, ...items].join(', ')
}
