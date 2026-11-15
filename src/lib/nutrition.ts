// Plan de nutrition par tronçon entre ravitos : eau, glucides, sodium et
// nombre de produits à emporter.
import { isRavitoKind } from './splits'
import type { Product, Race, SimResult } from './types'

export interface Leg {
  /** Point de départ du tronçon (« Départ » ou nom du ravito). */
  from: string
  /** Id du point de départ (null = départ). */
  fromId: string | null
  to: string
  /** Id du point d'arrivée du tronçon (ravito suivant ou arrivée). */
  toId: string
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
  const stops = sim.splits.filter((s) => isRavitoKind(s.cp.kind) || s.cp.id === '__finish' || s === sim.splits[sim.splits.length - 1])
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
      toId: s.cp.id,
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

/** Sodium à ajouter en sel (mg) : manque laissé par les produits, s'il dépasse 150 mg, sinon 0. */
export function extraSodium(leg: Leg): number {
  const missing = leg.sodium - leg.sodiumFromProducts
  return missing > 150 ? Math.round(missing) : 0
}

/** Contenu du sac à prendre au départ d'un tronçon, en une ligne. */
export function bagText(leg: Leg): string {
  const items = leg.products.map((x) => `${x.count} × ${x.product.name}`)
  const salt = extraSodium(leg)
  if (salt) items.push(`+${salt} mg de sodium (sel)`)
  return [`${leg.water} L d'eau`, ...items].join(', ')
}

/**
 * Ordre de prise des produits d'un tronçon : chaque produit réparti sur tout le tronçon
 * (3 gels et 2 barres → gel, barre, gel, barre, gel).
 */
export function intakeOrder<T>(items: { product: T; count: number }[]): T[] {
  return items
    .flatMap((x, i) => Array.from({ length: x.count }, (_, j) => ({ product: x.product, at: (j + 0.5) / x.count, i })))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map((x) => x.product)
}

/** Contenu d'un dropbag : de quoi tenir de ce point jusqu'au dropbag suivant (ou l'arrivée). */
export interface DropbagPlan {
  id: string
  name: string
  /** Point jusqu'où il sert (dropbag suivant ou arrivée). */
  until: string
  /** Durée couverte (s), hors arrêts aux ravitos intermédiaires. */
  duration: number
  carbs: number
  /** Sodium à ajouter en sel (mg), au-delà de celui des produits. */
  salt: number
  products: { product: Product; count: number }[]
}

/**
 * Dropbags prévus par l'organisation (points cochés « dropbag », ravitos ou bases de vie) : pour chacun,
 * les produits du plan nutrition de ce point jusqu'au dropbag suivant ou à l'arrivée, tronçons cumulés.
 */
export function dropbagPlan(legs: Leg[], checkpoints: { id: string; name: string; dropbag?: boolean }[]): DropbagPlan[] {
  const bags = checkpoints.filter((c) => c.dropbag)
  const out: DropbagPlan[] = []
  for (const bag of bags) {
    const start = legs.findIndex((l) => l.fromId === bag.id)
    if (start < 0) continue
    const next = legs.findIndex((l, i) => i > start && bags.some((b) => b.id === l.fromId))
    const span = legs.slice(start, next < 0 ? legs.length : next)
    const byId = new Map<string, { product: Product; count: number }>()
    for (const l of span) for (const x of l.products) byId.set(x.product.id, { product: x.product, count: (byId.get(x.product.id)?.count ?? 0) + x.count })
    out.push({
      id: bag.id,
      name: bag.name,
      until: span[span.length - 1].to,
      duration: span.reduce((a, l) => a + l.duration, 0),
      carbs: span.reduce((a, l) => a + l.carbs, 0),
      salt: span.reduce((a, l) => a + extraSodium(l), 0),
      products: [...byId.values()].filter((x) => x.count > 0),
    })
  }
  return out
}

/** Contenu d'un dropbag, en une ligne. */
export function dropbagText(b: DropbagPlan): string {
  const items = b.products.map((x) => `${x.count} × ${x.product.name}`)
  if (b.salt) items.push(`+${b.salt} mg de sodium (sel)`)
  return items.join(', ') || 'rien de ton plan (ravitos seulement)'
}
