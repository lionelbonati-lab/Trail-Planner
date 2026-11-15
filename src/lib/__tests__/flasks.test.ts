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
    expect(leg.flasks).toEqual({ ...flaskSplit(leg.water, false), isoId: null })
    expect(bagText(leg)).toMatch(/^[\d.]+ L : \d flasques? d'eau, \d+ × Gel/)
  })
})
