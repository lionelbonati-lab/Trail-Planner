import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, normalizeAthlete } from '../defaults'
import type { PaceZone } from '../types'
import { applyRange, colorForIndex, GARMIN_ZONE_COLORS, mergeInto, MODEL_TARGET, moveBoundary, partition, setTarget, splitAt, zone1Target, zoneColor } from '../zones'

const A = normalizeAthlete({ ...DEFAULT_ATHLETE, cs: 4 })
const T = 10000
const tempo = { kind: 'intensity' as const, value: 0.85, label: 'Zone 3' }
const shape = (z: PaceZone[]) => z.map((x) => [x.from, x.to, x.kind === 'model' ? 'M' : x.label])

describe('découpage du parcours en zones', () => {
  it('première zone : l’avant et l’après deviennent des zones (zone 1)', () => {
    const z = applyRange([], T, 2000, 5000, tempo, zone1Target(A))
    expect(shape(z)).toEqual([[0, 2000, 'Zone 1'], [2000, 5000, 'Zone 3'], [5000, 10000, 'Zone 1']])
  })
  it('nouvelle zone sur des portions existantes : coupe et remplace', () => {
    let z = applyRange([], T, 2000, 5000, tempo, zone1Target(A))
    z = applyRange(z, T, 4000, 7000, { kind: 'intensity', value: 1, label: 'Zone 5' }, zone1Target(A))
    expect(shape(z)).toEqual([[0, 2000, 'Zone 1'], [2000, 4000, 'Zone 3'], [4000, 7000, 'Zone 5'], [7000, 10000, 'Zone 1']])
  })
  it('fin de cycle : coupe une portion en deux, sans zone préalable = allure modèle', () => {
    expect(shape(splitAt([], T, 3000))).toEqual([[0, 3000, 'M'], [3000, 10000, 'M']])
    const z = splitAt(applyRange([], T, 2000, 5000, tempo, zone1Target(A)), T, 3500)
    expect(shape(z)).toEqual([[0, 2000, 'Zone 1'], [2000, 3500, 'Zone 3'], [3500, 5000, 'Zone 3'], [5000, 10000, 'Zone 1']])
    expect(new Set(z.map((x) => x.id)).size).toBe(4)
  })
  it('déplacer une limite (bornée par les voisines), fusionner, changer la cible', () => {
    let z = applyRange([], T, 2000, 5000, tempo, zone1Target(A))
    z = moveBoundary(z, 0, 2600)
    expect(shape(z)[0]).toEqual([0, 2600, 'Zone 1'])
    expect(shape(z)[1]).toEqual([2600, 5000, 'Zone 3'])
    expect(moveBoundary(z, 0, 9000)[0].to).toBe(4980)
    z = mergeInto(z, 1, -1)
    expect(shape(z)).toEqual([[0, 5000, 'Zone 1'], [5000, 10000, 'Zone 1']])
    z = setTarget(z, 1, MODEL_TARGET)
    expect(shape(z)[1]).toEqual([5000, 10000, 'M'])
  })
  it('anciennes zones avec trous et chevauchements : remises en partition', () => {
    const old: PaceZone[] = [
      { id: 'a', from: 1000, to: 3000, kind: 'intensity', value: 0.75, label: 'Zone 2' },
      { id: 'b', from: 2500, to: 4000, kind: 'intensity', value: 0.85, label: 'Zone 3' },
    ]
    expect(shape(partition(old, T))).toEqual([[0, 1000, 'M'], [1000, 2500, 'Zone 2'], [2500, 4000, 'Zone 3'], [4000, 10000, 'M']])
  })
  it('couleurs Garmin : zone 1 grise, 2 bleue, 3 verte, 4 orange, 5 rouge', () => {
    expect(GARMIN_ZONE_COLORS.slice(0, 5)).toEqual(['#9e9e9e', '#2b8ae0', '#43a047', '#f39c12', '#e53935'])
    const z = (value: number, label = ''): PaceZone => ({ id: '', from: 0, to: 1, kind: 'intensity', value, label })
    expect(zoneColor(z(0.65), A)).toBe(colorForIndex(0))
    expect(zoneColor(z(0.75), A)).toBe(colorForIndex(1))
    expect(zoneColor(z(0.85), A)).toBe(colorForIndex(2))
    expect(zoneColor(z(0.93), A)).toBe(colorForIndex(3))
    expect(zoneColor(z(1.0), A)).toBe(colorForIndex(4))
    expect(zoneColor(z(0.5, 'Zone 4'), A)).toBe(colorForIndex(3))
  })
})
