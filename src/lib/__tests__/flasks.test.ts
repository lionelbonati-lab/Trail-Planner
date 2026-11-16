import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, DEFAULT_PRODUCTS, newRace } from '../defaults'
import { bagText, flaskSplit, flaskWarning, isFlask, nutritionPlan } from '../nutrition'
import { computePlan } from '../plan'
import type { Product } from '../types'
import { watchPlan } from '../watch'

function gpx(km = 30): string {
  const pts: string[] = []
  for (let d = 0; d <= km * 1000; d += 50) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + Math.sin(d / 3000) * 300}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

/** Règle de la montre (Plan.mc, bag) à partir de l'eau en dL et de la ligne W. */
function watchFlasks(dl: number, flaskDl: number, iso: boolean) {
  if (!(flaskDl > 0 && dl > 0)) return { water: 0, iso: 0 }
  const n = Math.max(1, Math.floor((dl + flaskDl - 1) / flaskDl))
  if (!iso) return { water: n, iso: 0 }
  return n === 1 ? { water: 0, iso: 1 } : { water: Math.floor((n + 1) / 2), iso: Math.floor(n / 2) }
}

describe('flasques de 500 ml : eau et isotonique', () => {
  it('1 iso seule jusqu’à 500 ml, sinon 1 eau + 1 iso, puis une de plus par 500 ml commencés, en alternant', () => {
    expect(flaskSplit(0.4, true)).toEqual({ water: 0, iso: 1 })
    expect(flaskSplit(0.5, true)).toEqual({ water: 0, iso: 1 })
    expect(flaskSplit(0.6, true)).toEqual({ water: 1, iso: 1 })
    expect(flaskSplit(0.4, false)).toEqual({ water: 1, iso: 0 })
    expect(flaskSplit(1.0, true)).toEqual({ water: 1, iso: 1 })
    expect(flaskSplit(1.1, true)).toEqual({ water: 2, iso: 1 })
    expect(flaskSplit(1.5, true)).toEqual({ water: 2, iso: 1 })
    expect(flaskSplit(1.6, true)).toEqual({ water: 2, iso: 2 })
    expect(flaskSplit(2.2, true)).toEqual({ water: 3, iso: 2 })
    expect(flaskSplit(1.1, false)).toEqual({ water: 3, iso: 0 })
    expect(flaskSplit(0, true)).toEqual({ water: 0, iso: 0 })
    // La montre retrouve les mêmes flasques à partir de l'eau en dL.
    for (let dl = 0; dl <= 40; dl++) for (const iso of [true, false]) expect(watchFlasks(dl, 5, iso)).toEqual(flaskSplit(dl / 10, iso))
  })

  it('isotonique déduit des glucides ; gels et barres complètent ; alerte au-delà de 4 flasques', () => {
    const race = newRace('Long', gpx(40))
    race.checkpoints = [{ id: 'a', dist: 8000, name: 'A', kind: 'ravito', stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
    race.waterPerH = 0.8
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const legs = nutritionPlan(race, plan.sim, DEFAULT_PRODUCTS)
    for (const l of legs) {
      expect(l.flasks).toMatchObject(flaskSplit(l.water, true))
      const iso = l.products.find((x) => x.product.id === 'boisson')
      expect(iso?.count).toBe(l.flasks.iso)
      const others = l.products.filter((x) => x.product.id !== 'boisson').reduce((a, x) => a + x.count * x.product.carbs, 0)
      const rest = Math.max(0, l.carbs - l.flasks.iso * 30)
      expect(others).toBeGreaterThanOrEqual(rest - 10)
      expect(others).toBeLessThan(rest + 30)
    }
    const long = legs[1]
    expect(long.water).toBeGreaterThan(2)
    expect(flaskWarning(long)).toMatch(/flasques : plus que les 4 portées/)
    expect(bagText(long)).toContain(`${long.water} L : ${long.flasks.water} flasques d'eau + ${long.flasks.iso} flasques Isotonique`)
    expect(bagText(long)).toContain('⚠')
    expect(flaskWarning(legs[0])).toBeNull()
    // Plan montre : ligne W (500 ml, indice de l'isotonique dans P).
    const athlete = { ...DEFAULT_ATHLETE, products: DEFAULT_PRODUCTS }
    const lines = watchPlan(race, athlete, plan.track, plan.sim).split('\n')
    const P = lines.find((l) => l.startsWith('P|'))!.split('|').slice(1)
    const W = lines.find((l) => l.startsWith('W|'))!.split('|')
    expect(W[1]).toBe('5')
    expect(P[Number(W[2])]).toBe('Isotonique')
  })

  it('anciens profils : le produit « boisson » est la flasque ; sans isotonique, eau seule', () => {
    const old: Product = { id: 'boisson', name: 'Boisson (500 ml)', carbs: 30, sodium: 300, share: 0.3 }
    expect(isFlask(old)).toBe(true)
    expect(isFlask({ ...old, flask: false })).toBe(false)
    expect(isFlask({ ...old, id: 'x' })).toBe(false)
    const race = newRace('Court', gpx(15))
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const gels = DEFAULT_PRODUCTS.filter((p) => p.id === 'gel')
    const [leg] = nutritionPlan(race, plan.sim, gels)
    expect(leg.flasks).toEqual({ ...flaskSplit(leg.water, false), isoId: null, waterId: null, mix: 0 })
    expect(bagText(leg)).toMatch(/^[\d.]+ L : \d flasques? d'eau, \d+ × Gel/)
  })
})

describe('produits retenus pour une course', () => {
  it('tous par défaut, sinon ceux choisis ; marques triées sans doublon', async () => {
    const { raceProducts, brandsOf } = await import('../nutrition')
    const ps: Product[] = [
      { id: 'a', name: 'Gel', carbs: 25, sodium: 50, share: 0.5, brand: 'Overstim' },
      { id: 'b', name: 'Barre', carbs: 30, sodium: 100, share: 0.5, brand: ' Maurten ' },
      { id: 'c', name: 'Isotonique', carbs: 30, sodium: 300, share: 0, flask: true, brand: 'Overstim' },
    ]
    expect(raceProducts({}, ps)).toBe(ps)
    expect(raceProducts({ productIds: ['c', 'a'] }, ps).map((p) => p.id)).toEqual(['a', 'c'])
    expect(brandsOf(ps)).toEqual(['Maurten', 'Overstim'])
    // Plan montre : seuls les produits retenus.
    const race = { ...newRace('Choix', gpx(20)), productIds: ['a'] }
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const P = watchPlan(race, { ...DEFAULT_ATHLETE, products: ps }, plan.track, plan.sim).split('\n').find((l) => l.startsWith('P|'))
    expect(P).toBe('P|Gel')
  })
})

import { foodLines, watchWaterText } from '../watch'

describe('eau minérale salée (St-Yorre)', () => {
  it('remplit les flasques d’eau ; son sodium est déduit du sel', () => {
    const race = newRace('Sel', gpx(30))
    race.waterPerH = 0.8
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const styorre: Product = { id: 'sy', name: 'St-Yorre', carbs: 0, sodium: 850, share: 0, type: 'liquid' }
    const [sans] = nutritionPlan(race, plan.sim, DEFAULT_PRODUCTS)
    const [avec] = nutritionPlan(race, plan.sim, [...DEFAULT_PRODUCTS, styorre])
    expect(avec.flasks.waterId).toBe('sy')
    expect(avec.products.find((x) => x.product.id === 'sy')?.count).toBe(avec.flasks.water)
    // Mélange : juste assez de St-Yorre pour le sodium visé, jamais plus.
    const mix = avec.flasks.mix!
    expect(mix).toBeGreaterThan(0)
    expect(mix).toBeLessThanOrEqual(1)
    expect(avec.sodiumFromProducts).toBeLessThanOrEqual(Math.max(avec.sodium, sans.sodiumFromProducts))
    expect(avec.sodiumFromProducts - sans.sodiumFromProducts).toBe(Math.round(850 * avec.flasks.water * mix))
    expect(bagText(avec)).toMatch(new RegExp(`${avec.flasks.water} flasques St-Yorre`))
    if (mix < 1) expect(bagText(avec)).toMatch(/St-Yorre \+ eau \(\d+ ml \+ \d+ ml\)/)
    expect(bagText(avec)).not.toContain('× St-Yorre')
    // Montre : le St-Yorre n'est pas un produit à prendre (pas de rappel « 1 St-Yorre ») ; le sac donne
    // le mélange comme le plan.
    const F = foodLines([avec], plan.sim.splits).find((l) => l.startsWith('F|'))!.split('|')
    const P = foodLines([avec], plan.sim.splits).find((l) => l.startsWith('P|'))!.split('|').slice(1)
    expect(F[5].split(',').filter(Boolean).map((i) => P[Number(i)])).not.toContain('St-Yorre')
    expect(P).not.toContain('St-Yorre')
    const text = watchWaterText(avec)
    expect(F[6]).toBe(text)
    expect(text).toMatch(new RegExp(`^${avec.water.toFixed(1)} L : ${avec.flasks.water} St-Yorre`))
    if (mix < 1) expect(text).toMatch(/St-Yorre\+eau.*;St-Yorre \d+ \+ eau \d+ ml$/)
    expect(watchWaterText(sans)).toMatch(/^\d+\.\d L : \d+ (eau|iso)/)
    // Sodium déjà couvert : pas de St-Yorre.
    const [rien] = nutritionPlan({ ...race, sodiumPerH: 0 }, plan.sim, [...DEFAULT_PRODUCTS, styorre])
    expect(rien.flasks.waterId).toBeNull()
  })
})

describe('eau minérale décochée (case Flasque)', () => {
  it('ignorée : pas de mélange ni de sodium', () => {
    const race = newRace('Sel', gpx(30))
    race.waterPerH = 0.8
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const off: Product = { id: 'sy', name: 'St-Yorre', carbs: 0, sodium: 850, share: 0, type: 'liquid', flask: false }
    const [sans] = nutritionPlan(race, plan.sim, DEFAULT_PRODUCTS)
    const [leg] = nutritionPlan(race, plan.sim, [...DEFAULT_PRODUCTS, off])
    expect(leg.flasks.waterId).toBeNull()
    expect(leg.sodiumFromProducts).toBe(sans.sodiumFromProducts)
  })
})

describe('quantités prévues à côté des requises', () => {
  it('eau des flasques, glucides des produits, sodium des produits et du sel', async () => {
    const { legSupply, shortOf, extraSodium } = await import('../nutrition')
    const race = newRace('Prévu', gpx(30))
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const [leg] = nutritionPlan(race, plan.sim, DEFAULT_PRODUCTS)
    const sup = legSupply(leg)
    expect(sup.water).toBe((leg.flasks.water + leg.flasks.iso) * 0.5)
    expect(sup.water).toBeGreaterThanOrEqual(leg.water)
    expect(sup.carbs).toBe(Math.round(leg.products.reduce((a, x) => a + x.count * x.product.carbs, 0)))
    expect(sup.carbs).toBeGreaterThanOrEqual(leg.carbs - 10)
    expect(sup.sodium).toBe(Math.round(leg.sodiumFromProducts + extraSodium(leg)))
    expect(shortOf(50, 78)).toBe(true)
    expect(shortOf(75, 78)).toBe(false)
  })
})

describe('produits « sur ravito »', () => {
  it('pas au départ, mangés au ravito : hors du sac, des dropbags et des rappels montre', async () => {
    const { isAtRavito, ravitoText, dropbagPlan } = await import('../nutrition')
    const race = newRace('Ravito', gpx(40))
    race.checkpoints = [{ id: 'a', dist: 15000, name: 'A', kind: 'ravito', stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false, dropbag: true }]
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const banane: Product = { id: 'ban', name: 'Banane', type: 'solid', carbs: 13, sodium: 1, share: 0.5, atRavito: true }
    const products = [...DEFAULT_PRODUCTS, banane]
    expect(isAtRavito(banane)).toBe(true)
    const legs = nutritionPlan(race, plan.sim, products)
    expect(legs[0].products.some((x) => x.product.id === 'ban')).toBe(false)
    expect(legs[1].products.some((x) => x.product.id === 'ban')).toBe(true)
    expect(bagText(legs[1])).toMatch(/ ; sur ravito : \d+ × Banane$/)
    expect(bagText(legs[1], false)).not.toContain('Banane')
    expect(ravitoText(legs[1])).toMatch(/Banane/)
    const [bag] = dropbagPlan(legs, race.checkpoints)
    expect(bag.products.some((x) => x.product.id === 'ban')).toBe(false)
    const lines = watchPlan(race, { ...DEFAULT_ATHLETE, products }, plan.track, plan.sim).split('\n')
    expect(lines.find((l) => l.startsWith('P|')) ?? '').not.toContain('Banane')
  })
})
