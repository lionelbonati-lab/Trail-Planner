import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, DEFAULT_PRODUCTS, newRace } from '../defaults'
import { bagText, flaskText, isSodiumProduct, nutritionPlan, ravitoText } from '../nutrition'
import { dropIndex, moveItem } from '../order'
import { computePlan } from '../plan'
import { libraryProduct, PRODUCT_LIBRARY } from '../productLibrary'
import type { Product } from '../types'
import { foodLines, watchWaterText } from '../watch'

function gpx(km = 30): string {
  const pts: string[] = []
  for (let d = 0; d <= km * 1000; d += 50) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + Math.sin(d / 3000) * 300}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

const lib = (id: string) => ({ ...libraryProduct(PRODUCT_LIBRARY.find((x) => x.id === id)!), id })

describe('sodium : produits salés, ordre des sources, St-Yorre dans l’isotonique', () => {
  const race = newRace('Sel', gpx(30))
  race.checkpoints = [{ id: 'r1', dist: 15000, name: 'R1', kind: 'ravito', stopMin: 5, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
  race.sodiumPerH = 700
  const plan = computePlan(race, DEFAULT_ATHLETE)!
  const bouillon = lib('rv-bouillon')
  const caps = lib('sponser-salt-caps')
  const styorre = lib('rv-st-yorre')

  it('bibliothèque Sponser : sachets 35 g et 25 g, Salt Caps à 200 mg, produits salés sans part de glucides', () => {
    expect([lib('sponser-le-sachet'), lib('sponser-le-salty'), lib('sponser-le-ultra')].map((p) => [p.carbs, p.sodium])).toEqual([
      [24.2, 123],
      [20, 155],
      [11, 140],
    ])
    expect(caps).toMatchObject({ carbs: 0, sodium: 200, share: 0, type: 'solid' })
    expect(isSodiumProduct(caps)).toBe(true)
    expect(isSodiumProduct(bouillon)).toBe(true)
    expect(bouillon).toMatchObject({ atRavito: true, share: 0 })
    expect(isSodiumProduct(lib('sponser-le-salty'))).toBe(false)
    // Saucisson (0,4 g de glucides) : plus jamais compté pour les glucides.
    expect(libraryProduct(PRODUCT_LIBRARY.find((x) => x.id === 'rv-saucisson')!).share).toBe(0)
  })

  it('bouillon au ravito selon le sodium manquant (deux gobelets au plus), jamais au départ', () => {
    const legs = nutritionPlan(race, plan.sim, [...DEFAULT_PRODUCTS, bouillon])
    expect(legs[0].products.some((x) => x.product.id === bouillon.id)).toBe(false)
    const n = legs[1].products.find((x) => x.product.id === bouillon.id)!.count
    expect(n).toBeGreaterThanOrEqual(1)
    expect(n).toBeLessThanOrEqual(2)
    expect(ravitoText(legs[1])).toBe(`${n} × Bouillon`)
    // Assez de sodium ailleurs : pas de bouillon.
    const none = nutritionPlan({ ...race, sodiumPerH: 0 }, plan.sim, [...DEFAULT_PRODUCTS, bouillon])
    expect(none[1].products.some((x) => x.product.id === bouillon.id)).toBe(false)
  })

  it('sources de sodium dans l’ordre de la liste : bouillon puis caps, ou caps d’abord ; le sel complète', () => {
    const [, a] = nutritionPlan(race, plan.sim, [...DEFAULT_PRODUCTS, bouillon, caps])
    const [, b] = nutritionPlan(race, plan.sim, [...DEFAULT_PRODUCTS, caps, bouillon])
    const count = (leg: typeof a, id: string) => leg.products.find((x) => x.product.id === id)?.count ?? 0
    expect(count(a, bouillon.id)).toBeGreaterThan(0)
    expect(count(b, caps.id)).toBeGreaterThan(count(a, caps.id))
    expect(count(b, bouillon.id)).toBe(0)
    // Caps emportées : dans le sac et rappelées par la montre.
    expect(bagText(b)).toContain(`${count(b, caps.id)} × Salt Caps (capsule)`)
    expect(foodLines([b], plan.sim.splits).find((l) => l.startsWith('P|'))).toContain('Salt Caps')
  })

  it('glucides : parts gardées, le premier produit de la liste complète et reprend la part d’un produit absent', () => {
    const gel: Product = { id: 'g', name: 'Gel', carbs: 25, sodium: 50, share: 0.5, type: 'gel' }
    const barre: Product = { id: 'b', name: 'Barre', carbs: 30, sodium: 100, share: 0.3, type: 'solid' }
    const banane: Product = { id: 'ban', name: 'Banane', carbs: 20, sodium: 0, share: 0.2, type: 'solid', atRavito: true }
    const c = (leg: { products: { product: Product; count: number }[] }, id: string) => leg.products.find((x) => x.product.id === id)?.count ?? 0
    // Au départ, pas de banane : sa part revient au premier produit de la liste.
    const hungry = { ...race, carbsPerH: 90 }
    const [g1] = nutritionPlan(hungry, plan.sim, [gel, barre, banane])
    const [b1] = nutritionPlan(hungry, plan.sim, [barre, gel, banane])
    expect(c(g1, 'g') * 25).toBeGreaterThan(c(b1, 'g') * 25)
    expect(c(b1, 'b') * 30).toBeGreaterThan(c(g1, 'b') * 30)
    // Ordre d'affichage (et de prise) : celui de la liste.
    expect(b1.products.map((x) => x.product.id)).toEqual(['b', 'g'])
  })

  it('tri par glisser-déposer : place d’arrivée et liste réordonnée', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    // Lignes de 40 px : milieux à 20, 60, 100, 140 ; la première glissée de 70 px (centre à 90).
    expect(dropIndex([20, 60, 100, 140], 0, 90)).toBe(1)
    expect(dropIndex([20, 60, 100, 140], 0, 150)).toBe(3)
    expect(dropIndex([20, 60, 100, 140], 3, 10)).toBe(0)
  })

  it('St-Yorre : flasques d’eau d’abord, isotonique s’il n’y a pas de flasque d’eau', () => {
    // Peu d'eau : une seule flasque, d'isotonique ; le St-Yorre y est mélangé.
    const dry = { ...race, checkpoints: [], waterPerH: 0.15, sodiumPerH: 400 }
    const p2 = computePlan(dry, DEFAULT_ATHLETE)!
    const [leg] = nutritionPlan(dry, p2.sim, [...DEFAULT_PRODUCTS, styorre])
    expect(leg.flasks).toMatchObject({ water: 0, iso: 1, waterId: styorre.id })
    expect(leg.flasks.isoMix).toBeGreaterThan(0)
    expect(flaskText(leg)).toMatch(/1 flasque Isotonique dans Eau gazeuse salée \(St-Yorre\)( \+ eau \(\d+ ml \+ \d+ ml\))?$/)
    expect(watchWaterText(leg)).toMatch(/1 iso\+/)
    // Assez de flasques d'eau : l'isotonique reste sans St-Yorre.
    const wet = { ...race, checkpoints: [], waterPerH: 0.8 }
    const p3 = computePlan(wet, DEFAULT_ATHLETE)!
    const [l2] = nutritionPlan(wet, p3.sim, [...DEFAULT_PRODUCTS, styorre])
    expect(l2.flasks.water).toBeGreaterThan(0)
    if ((l2.flasks.mix ?? 0) < 1) expect(l2.flasks.isoMix).toBeUndefined()
  })

  it('eau minérale décochée : ni flasque ni produit salé', () => {
    const off: Product = { ...styorre, flask: false }
    expect(isSodiumProduct(off)).toBe(false)
  })
})
