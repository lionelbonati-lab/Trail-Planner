// Plan de nutrition par tronçon entre ravitos : eau, glucides, sodium et
// nombre de produits à emporter.
import { isRavitoKind } from './splits'
import type { Product, ProductType, Race, SimResult, SodiumSource } from './types'

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
  /**
   * Flasques à emporter : d'eau et d'isotonique (produit `isoId`, compté aussi dans `products`) ; les
   * flasques d'eau sont remplies d'eau minérale salée (`waterId`, ex. St-Yorre) si la course en retient une.
   */
  /**
   * Eau minérale salée (`waterId`) : part dans les flasques d'eau (`mix`) puis, si elles ne suffisent pas
   * ou s'il n'y en a pas, dans les flasques d'isotonique (`isoMix`), par dixièmes.
   */
  flasks: { water: number; iso: number; isoId: string | null; waterId?: string | null; mix?: number; isoMix?: number }
}

/** Produits retenus pour une course (tous si aucun choix n'a été fait). */
export function raceProducts(race: Pick<Race, 'productIds'>, products: Product[]): Product[] {
  return race.productIds ? products.filter((p) => race.productIds!.includes(p.id)) : products
}

/** Marques des produits, triées. */
export function brandsOf(products: Product[]): string[] {
  return [...new Set(products.map((p) => p.brand?.trim()).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b))
}

/** Volume d'une flasque (L). */
export const FLASK_L = 0.5
/** Flasques portées au plus : au-delà, il faut remplir en route. */
export const MAX_FLASKS = 4

export const PRODUCT_TYPES: Record<ProductType, string> = { solid: 'Solide', liquid: 'Liquide', gel: 'Gel' }

/**
 * Type d'un produit ; anciens produits : déduit de la case flasque et du nom. L'ancien type « Eau » est
 * un liquide (sans glucides).
 */
export function productType(p: Product): ProductType {
  if ((p.type as string) === 'water') return 'liquid'
  if (p.type) return p.type
  if (p.flask ?? p.id === 'boisson') return 'liquid'
  if (/gel/i.test(p.name)) return 'gel'
  if (/^eau\b|water|yorre/i.test(p.name)) return 'liquid'
  return 'solid'
}

/**
 * Boisson en flasque (poudre pour 500 ml d'eau) : case « Flasque » du produit ; par défaut, un produit
 * liquide (le produit « boisson » des anciens profils). Un liquide sans flasque (bouillon, coca) se compte
 * comme un gel ou un solide.
 */
export const isFlask = (p: Product): boolean => productType(p) === 'liquid' && (p.flask ?? true) && p.carbs > 0

/**
 * Eau en flasque : liquide sans glucides (eau plate, eau minérale salée) avec la case « Flasque »
 * (cochée par défaut) ; décochée, elle est ignorée.
 */
export const isFlaskWater = (p: Product): boolean => productType(p) === 'liquid' && (p.flask ?? true) && !(p.carbs > 0)

/**
 * Sur ravito : mangé ou bu au ravitaillement, pas emporté (pas au départ, ni dans le sac ou les
 * dropbags). Une boisson en flasque reste emportée.
 */
export const isAtRavito = (p: Product): boolean => !!p.atRavito && !isFlask(p) && !isFlaskWater(p)

/** Moins de glucides que ceci par portion (g) : produit compté pour son sodium, pas pour les glucides. */
export const SODIUM_CARBS_MAX = 5

/**
 * Produit salé (bouillon, saucisson, salt caps…) : presque pas de glucides mais du sodium. Prévu pour
 * couvrir le sodium manquant du tronçon, pas les glucides. Une eau (liquide sans glucides) hors flasque
 * et pas servie au ravito reste ignorée (case Flasque décochée).
 */
export const isSodiumProduct = (p: Product): boolean =>
  !isFlask(p) && !isFlaskWater(p) && p.carbs < SODIUM_CARBS_MAX && p.sodium >= 50 && !(productType(p) === 'liquid' && !(p.carbs > 0) && !p.atRavito)

/** Ordre par défaut : produits salés du ravito, puis emportés, puis eau minérale salée ; le sel en dernier. */
export const DEFAULT_SODIUM_ORDER: SodiumSource[] = ['ravito', 'carried', 'mineral']

export const SODIUM_SOURCES: Record<SodiumSource, string> = {
  ravito: 'Produits salés du ravito (bouillon, saucisson…)',
  carried: 'Produits salés emportés (salt caps…)',
  mineral: 'Eau minérale salée dans les flasques (St-Yorre…)',
}

/** Ordre complet et valide (les sources manquantes ajoutées dans l'ordre par défaut). */
export function sodiumOrder(order: SodiumSource[] | undefined): SodiumSource[] {
  const valid = (order ?? []).filter((x, i, a) => DEFAULT_SODIUM_ORDER.includes(x) && a.indexOf(x) === i)
  return [...valid, ...DEFAULT_SODIUM_ORDER.filter((x) => !valid.includes(x))]
}

/** Portions au plus d'un même produit salé pris au ravito (un ou deux gobelets de bouillon). */
const RAVITO_SALTY_MAX = 2

/** Poids d'une portion par défaut (g) : produits saisis avant les valeurs au 100 g. */
const DEFAULT_WEIGHT: Record<ProductType, number> = { gel: 40, solid: 50, liquid: 40 }

/** Valeurs au 100 g et poids d'une portion ; anciens produits : déduits des valeurs par portion. */
export function per100(p: Product): { carbs: number; sodium: number; weight: number } {
  // Eau (liquide sans glucides) : une flasque de 500 ml.
  const weight = p.weight && p.weight > 0 ? p.weight : productType(p) === 'liquid' && !(p.carbs > 0) ? 500 : DEFAULT_WEIGHT[productType(p)]
  return {
    carbs: p.per100Carbs ?? Math.round((p.carbs * 1000) / weight) / 10,
    sodium: p.per100Sodium ?? Math.round((p.sodium * 100) / weight),
    weight,
  }
}

/** Produit aux valeurs au 100 g : glucides et sodium d'une portion recalculés. */
export function withPer100(p: Product, v: { carbs: number; sodium: number; weight: number }): Product {
  return {
    ...p,
    per100Carbs: v.carbs,
    per100Sodium: v.sodium,
    weight: v.weight,
    carbs: Math.round((v.carbs * v.weight) / 10) / 10,
    sodium: Math.round((v.sodium * v.weight) / 100),
  }
}

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

export function nutritionPlan(race: Race, sim: SimResult, products: Product[], order: SodiumSource[] = DEFAULT_SODIUM_ORDER): Leg[] {
  const sources = sodiumOrder(order)
  const legs: Leg[] = []
  const stops = sim.splits.filter((s) => isRavitoKind(s.cp.kind) || s.cp.id === '__finish' || s === sim.splits[sim.splits.length - 1])
  let fromName = 'Départ'
  let fromId: string | null = null
  let fromTime = 0
  let fromDist = 0
  // Isotonique en flasque : nombre fixé par l'eau, glucides et sodium déduits ; les autres produits
  // (gels, barres…) complètent les glucides selon leurs parts.
  const iso = products.find((p) => isFlask(p)) ?? null
  // Eau minérale salée (type « Eau » avec du sodium, par flasque de 500 ml) : remplit les flasques d'eau.
  const mineral = products.find((p) => isFlaskWater(p) && p.sodium > 0) ?? null
  // Glucides : gels, solides, liquides hors flasque qui en apportent vraiment (pas les produits salés).
  const usableAll = products.filter((p) => p !== iso && !isFlaskWater(p) && p.carbs >= SODIUM_CARBS_MAX && p.share > 0)
  const salty = products.filter(isSodiumProduct)
  for (const s of stops) {
    // Au départ, pas de ravito : les produits « sur ravito » n'y sont pas proposés.
    const usable = fromId === null ? usableAll.filter((p) => !isAtRavito(p)) : usableAll
    const totalShare = usable.reduce((a, p) => a + p.share, 0) || 1
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
    const base = [
      ...(iso && flasks.iso ? [{ product: iso, count: flasks.iso }] : []),
      ...usable.map((p, i) => ({ product: p, count: counts[i] })).filter((x) => x.count > 0),
    ]
    // Sodium manquant après gels, barres et isotonique : sources dans l'ordre choisi (produits salés du
    // ravito de départ, produits salés emportés, eau minérale salée des flasques), le sel complète.
    let short = sodium - base.reduce((a, x) => a + x.count * x.product.sodium, 0)
    const saltyItems: { product: Product; count: number }[] = []
    let mix = 0
    let isoMix = 0
    for (const src of sources) {
      if (short <= 0) break
      if (src === 'mineral') {
        if (!mineral || !(mineral.sodium > 0)) continue
        // Juste assez, jamais plus (dixièmes arrondis vers le bas) : flasques d'eau d'abord, puis
        // l'isotonique s'il n'y a pas de flasque d'eau ou si elles ne suffisent pas.
        const tenth = (x: number) => Math.max(0, Math.min(1, Math.floor(x * 10 + 1e-9) / 10))
        if (flasks.water) mix = tenth(short / (flasks.water * mineral.sodium))
        const left = short - mix * flasks.water * mineral.sodium
        if (flasks.iso && (!flasks.water || mix >= 1)) isoMix = tenth(left / (flasks.iso * mineral.sodium))
        short -= (mix * flasks.water + isoMix * flasks.iso) * mineral.sodium
        continue
      }
      // Produits salés : au ravito de départ (pas au départ de la course), ou emportés.
      const atRavito = src === 'ravito'
      if (atRavito && fromId === null) continue
      for (const p of salty.filter((x) => isAtRavito(x) === atRavito)) {
        if (short <= 0) break
        const n = Math.min(atRavito ? RAVITO_SALTY_MAX : Infinity, Math.round(short / p.sodium))
        if (n > 0) {
          saltyItems.push({ product: p, count: n })
          short -= n * p.sodium
        }
      }
    }
    const otherSodium = [...base, ...saltyItems].reduce((a, x) => a + x.count * x.product.sodium, 0)
    const flaskCount = (mix > 0 ? flasks.water : 0) + (isoMix > 0 ? flasks.iso : 0)
    const items = [...base, ...saltyItems, ...(mineral && flaskCount > 0 ? [{ product: mineral, count: flaskCount }] : [])]
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
      sodiumFromProducts: Math.round(otherSodium + (mineral ? (mix * flasks.water + isoMix * flasks.iso) * mineral.sodium : 0)),
      flasks: { ...flasks, isoId: iso && flasks.iso ? iso.id : null, waterId: mineral && flaskCount > 0 ? mineral.id : null, mix, ...(isoMix > 0 ? { isoMix } : {}) },
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

/**
 * Quantités prévues d'un tronçon, à comparer aux quantités requises : eau des flasques emportées
 * (500 ml chacune ; eau requise sans flasque), glucides des produits, sodium des produits et du sel à
 * ajouter.
 */
export function legSupply(leg: Leg): { water: number; carbs: number; sodium: number } {
  const flasks = leg.flasks.water + leg.flasks.iso
  return {
    water: flasks ? Math.round(flasks * FLASK_L * 10) / 10 : leg.water,
    carbs: Math.round(leg.products.reduce((a, x) => a + x.count * x.product.carbs, 0)),
    sodium: Math.round(leg.sodiumFromProducts + extraSodium(leg)),
  }
}

/** Prévu nettement en dessous du requis (plus de 10 % de manque) : à signaler. */
export const shortOf = (planned: number, required: number) => required > 0 && planned < required * 0.9

const flaskWord = (n: number) => `${n} flasque${n > 1 ? 's' : ''}`

/** Flasques d'un tronçon : « 2 flasques d'eau + 1 flasque Isotonique » (vide sans eau). */
export function flaskText(leg: Leg): string {
  const { water, iso, isoId, waterId } = leg.flasks
  if (!water && !iso) return ''
  const isoName = leg.products.find((x) => x.product.id === isoId)?.product.name ?? 'isotonique'
  const waterName = leg.products.find((x) => x.product.id === waterId)?.product.name
  // Mélange : part d'eau minérale par flasque (en ml), le reste d'eau plate.
  const mix = leg.flasks.mix ?? 0
  const ml = Math.round((mix * FLASK_L * 1000) / 50) * 50
  const waterText = !waterName || !(mix > 0) ? `${flaskWord(water)} d'eau` : mix >= 1 ? `${flaskWord(water)} ${waterName}` : `${flaskWord(water)} ${waterName} + eau (${ml} ml + ${FLASK_L * 1000 - ml} ml)`
  // Isotonique dissous dans un mélange d'eau minérale salée et d'eau plate (ou dans l'eau minérale seule).
  const isoMix = leg.flasks.isoMix ?? 0
  const isoMl = Math.round((isoMix * FLASK_L * 1000) / 50) * 50
  const isoText = !waterName || !(isoMix > 0) ? `${flaskWord(iso)} ${isoName}` : isoMix >= 1 ? `${flaskWord(iso)} ${isoName} dans ${waterName}` : `${flaskWord(iso)} ${isoName} dans ${waterName} + eau (${isoMl} ml + ${FLASK_L * 1000 - isoMl} ml)`
  return [water ? waterText : '', iso ? isoText : ''].filter(Boolean).join(' + ')
}

/** Plus de flasques que celles portées : alerte (remplir en route), sinon null. */
export function flaskWarning(leg: Leg): string | null {
  const n = leg.flasks.water + leg.flasks.iso
  return n > MAX_FLASKS ? `${n} flasques : plus que les ${MAX_FLASKS} portées, remplir en route` : null
}

/** Contenu du sac à prendre au départ d'un tronçon, en une ligne : eau réelle et flasques, produits, sel. */
export function bagText(leg: Leg, withRavito = true): string {
  const items = leg.products
    .filter((x) => x.product.id !== leg.flasks.isoId && x.product.id !== leg.flasks.waterId && !isAtRavito(x.product))
    .map((x) => `${x.count} × ${x.product.name}`)
  const salt = extraSodium(leg)
  if (salt) items.push(`+${salt} mg de sodium (sel)`)
  const flasks = flaskText(leg)
  const warn = flaskWarning(leg)
  const water = leg.water ? `${leg.water} L${flasks ? ` : ${flasks}` : ' d\'eau'}${warn ? ` (⚠ ${warn})` : ''}` : ''
  const onSite = withRavito ? ravitoText(leg) : ''
  return [water, ...items].filter(Boolean).join(', ') + (onSite ? ` ; sur ravito : ${onSite}` : '')
}

/** Produits « sur ravito » d'un tronçon (mangés ou bus au ravito de départ), en une ligne, ou ''. */
export function ravitoText(leg: Leg): string {
  return leg.products
    .filter((x) => isAtRavito(x.product))
    .map((x) => `${x.count} × ${x.product.name}`)
    .join(', ')
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
    for (const l of span) for (const x of l.products.filter((y) => !isAtRavito(y.product))) byId.set(x.product.id, { product: x.product, count: (byId.get(x.product.id)?.count ?? 0) + x.count })
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
