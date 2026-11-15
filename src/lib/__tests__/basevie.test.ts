import { describe, expect, it } from 'vitest'
import { assistAllowed } from '../assist'
import { DEFAULT_ATHLETE, DEFAULT_PRODUCTS, newRace, normalizeAthlete } from '../defaults'
import { dropbagPlan, dropbagText, nutritionPlan } from '../nutrition'
import { computePlan } from '../plan'
import { checkpointName, defaultStop, isRavitoKind, waypointKind } from '../splits'
import type { Checkpoint, CheckpointKind } from '../types'
import { watchPlan } from '../watch'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 40000; d += 40) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d % 10000) / 20}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}
const cp = (id: string, dist: number, kind: CheckpointKind, extra: Partial<Checkpoint> = {}): Checkpoint => ({
  id, dist, name: checkpointName(kind, dist), kind, stopMin: defaultStop(kind), cutoff: '', water: 0, carbs: 0, notes: '', auto: false, ...extra,
})

describe('base de vie et dropbag', () => {
  const A = normalizeAthlete({ ...DEFAULT_ATHLETE, products: DEFAULT_PRODUCTS.map((p) => ({ ...p })) })
  const race = newRace('Ultra', gpx())
  race.checkpoints = [
    cp('r1', 8000, 'ravito', { dropbag: true }),
    cp('r2', 16000, 'ravito'),
    cp('b', 20000, 'base', { dropbag: true }),
    cp('r3', 30000, 'ravito'),
    cp('s', 35000, 'split'),
  ]
  const plan = computePlan(race, A)!

  it('base de vie : comme un ravito (arrêt 20 min, assistance, montre, nutrition)', () => {
    expect(checkpointName('base', 20000)).toBe('Base de vie km 20.0')
    expect(defaultStop('base')).toBe(20)
    expect(isRavitoKind('base') && isRavitoKind('ravito') && !isRavitoKind('split')).toBe(true)
    expect(assistAllowed(race.checkpoints[2])).toBe(true)
    expect(watchPlan(race, A, plan.track, plan.sim).split('\n').find((l) => l.startsWith('C|20000'))).toMatch(/\|r\|BV km 20.0\|1200$/)
    const legs = nutritionPlan(race, plan.sim, A.products)
    expect(legs.map((l) => l.to)).toEqual(['Ravito km 8.0', 'Ravito km 16.0', 'Base de vie km 20.0', 'Ravito km 30.0', 'Arrivée'])
    expect(waypointKind({ name: 'Base de vie de Courmayeur' }, 'race')).toBe('base')
  })

  it('dropbags : produits de chaque dropbag jusqu’au suivant, ou l’arrivée', () => {
    const legs = nutritionPlan(race, plan.sim, A.products)
    const bags = dropbagPlan(legs, plan.sim.splits.map((s) => s.cp))
    expect(bags.map((b) => `${b.name} → ${b.until}`)).toEqual(['Ravito km 8.0 → Base de vie km 20.0', 'Base de vie km 20.0 → Arrivée'])
    // Premier dropbag : tronçons km 8 → 16 et km 16 → 20 cumulés.
    expect(bags[0].carbs).toBe(legs[1].carbs + legs[2].carbs)
    expect(bags[0].duration).toBeCloseTo(legs[1].duration + legs[2].duration, 6)
    const count = (b: (typeof bags)[number]) => b.products.reduce((a, x) => a + x.count, 0)
    const legCount = (i: number) => legs[i].products.reduce((a, x) => a + x.count, 0)
    expect(count(bags[0])).toBe(legCount(1) + legCount(2))
    expect(count(bags[1])).toBe(legCount(3) + legCount(4))
    expect(dropbagText(bags[1])).toMatch(/×/)
    // Aucun point coché : pas de dropbag.
    expect(dropbagPlan(legs, race.checkpoints.map((c) => ({ ...c, dropbag: false })))).toEqual([])
  })
})
