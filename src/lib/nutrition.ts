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
  /** Flasques à emporter : d'eau et d'isotonique (produit `isoId`, compté aussi dans `products`). */
  flasks: { water: number; iso: number; isoId: string | null }
}

/** Volume d'une flasque (L). */
export const FLASK_L = 0.5
/** Flasques portées au plus : au-delà, il faut remplir en route. */
export const MAX_FLASKS = 4

/** Boisson isotonique en flasque (par défaut : le produit « boisson » des profils). */
export const isFlask = (p: Product): boolean => p.flask ?? p.id === 'boisson'

/**
 * Flasques de 500 ml pour `water` litres : autant que de 500 ml commencés. Avec isotonique : une seule
 * flasque d'isotonique si 500 ml suffisent, sinon une d'eau et une d'isotonique, puis en alternant eau
 * puis isotonique : 0,4 L → 1 iso ; 0,8 L → 1 eau + 1 iso ; 1,1 L → 2 eau + 1 iso ; 1,6 L → 2 + 2.
 * Sans isotonique : eau seule. Pas d'eau prévue : aucune flasque.
 */
export function flaskSplit(water: number, iso: boolean): { water: number; iso: number } {
  if (!(water > 0)) return { water: 0, iso: 0 }
  const n = Math.max(1, Math.ceil(water / FLASK_L - 1e-6))
  if (!iso) return { water: n, iso: 0 }
  return n === 1 ? { water: 0, iso: 1 } : { water: Math.ceil(n / 2), iso: Math.floor(n / 2) }
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
  // Isotonique en flasque : nombre fixé par l'eau, glucides et sodium déduits ; les autres produits
  // (gels, barres…) complètent les glucides selon leurs parts.
  const iso = products.find((p) => isFlask(p)) ?? null
  const usable = products.filter((p) => p !== iso && p.carbs > 0 && p.share > 0)
  const totalShare = usable.reduce((a, p) => a + p.share, 0) || 1
  for (const s of stops) {
    const duration = Math.max(0, s.arrival - fromTime)
    const h = duration / 3600
    const seg = sim.points.filter((p) => p.dist >= fromDist && p.dist <= s.to)
    const temp = seg.length ? seg.reduce((a, p) => a + p.temp, 0) / seg.length : 15
    const carbs = Math.round(h * race.carbsPerH)
    const water = Math.round(h * race.waterPerH * (1 + WATER_PER_DEG * Math.max(0, temp - 15)) * 10) / 10
    const sodium = Math.round(h * race.sodiumPerH)
    const flasks = flaskSplit(water, !!iso)
    const rest = Math.max(0, carbs - (iso ? flasks.iso * iso.carbs : 0))
    const counts = usable.map((p) => Math.round((rest * (p.share / totalShare)) / p.carbs))
    // Complète si l'arrondi laisse plus de 10 g de manque : produit le moins « servi » par rapport à sa part.
    const total = () => counts.reduce((a, c, i) => a + c * usable[i].carbs, 0)
    while (usable.length && total() < rest - 10) {
      let best = 0
      let bestGap = -Infinity
      usable.forEach((p, i) => {
        const gap = (rest * p.share) / totalShare - counts[i] * p.carbs
        if (gap > bestGap) {
          bestGap = gap
          best = i
        }
      })
      counts[best]++
    }
    const items = [
      ...(iso && flasks.iso ? [{ product: iso, count: flasks.iso }] : []),
      ...usable.map((p, i) => ({ product: p, count: counts[i] })).filter((x) => x.count > 0),
    ]
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
      flasks: { ...flasks, isoId: iso && flasks.iso ? iso.id : null },
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

const flaskWord = (n: number) => `${n} flasque${n > 1 ? 's' : ''}`

/** Flasques d'un tronçon : « 2 flasques d'eau + 1 flasque Isotonique » (vide sans eau). */
export function flaskText(leg: Leg): string {
  const { water, iso, isoId } = leg.flasks
  if (!water && !iso) return ''
  const isoName = leg.products.find((x) => x.product.id === isoId)?.product.name ?? 'isotonique'
  return [water ? `${flaskWord(water)} d'eau` : '', iso ? `${flaskWord(iso)} ${isoName}` : ''].filter(Boolean).join(' + ')
}

/** Plus de flasques que celles portées : alerte (remplir en route), sinon null. */
export function flaskWarning(leg: Leg): string | null {
  const n = leg.flasks.water + leg.flasks.iso
  return n > MAX_FLASKS ? `${n} flasques : plus que les ${MAX_FLASKS} portées, remplir en route` : null
}

/** Contenu du sac à prendre au départ d'un tronçon, en une ligne : eau réelle et flasques, produits, sel. */
export function bagText(leg: Leg): string {
  const items = leg.products.filter((x) => x.product.id !== leg.flasks.isoId).map((x) => `${x.count} × ${x.product.name}`)
  const salt = extraSodium(leg)
  if (salt) items.push(`+${salt} mg de sodium (sel)`)
  const flasks = flaskText(leg)
  const warn = flaskWarning(leg)
  const water = leg.water ? `${leg.water} L${flasks ? ` : ${flasks}` : ' d\'eau'}${warn ? ` (⚠ ${warn})` : ''}` : ''
  return [water, ...items].filter(Boolean).join(', ')
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
