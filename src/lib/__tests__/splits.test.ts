import { describe, expect, it } from 'vitest'
import { commonStop, setStops } from '../splits'
import type { Checkpoint, CheckpointKind } from '../types'

const cp = (id: string, kind: CheckpointKind, stopMin: number): Checkpoint => ({
  id, dist: 1000, name: id, kind, stopMin, cutoff: '', water: 0, carbs: 0, notes: '', auto: false,
})

describe('temps d’arrêt à tous les ravitos', () => {
  const cps = [cp('a', 'ravito', 3), cp('b', 'info', 1), cp('c', 'ravito', 5), cp('d', 'ravito', 3), cp('e', 'cutoff', 0)]

  it('valeur proposée : le temps le plus fréquent parmi les ravitos', () => {
    expect(commonStop(cps)).toBe(3)
    expect(commonStop([cp('x', 'ravito', 2), cp('y', 'ravito', 6)])).toBe(6)
    expect(commonStop([cp('i', 'info', 10)])).toBe(3)
  })

  it('appliqué aux seuls ravitos, autres points inchangés', () => {
    const out = setStops(cps, 8)
    expect(out.map((c) => c.stopMin)).toEqual([8, 1, 8, 8, 0])
    expect(out[1]).toBe(cps[1])
    expect(setStops(cps, -2).filter((c) => c.kind === 'ravito').every((c) => c.stopMin === 0)).toBe(true)
  })

  it('parcours : tous les points (0 min proposé sans point)', () => {
    expect(commonStop([cp('i', 'info', 2), cp('s', 'split', 2), cp('j', 'info', 0)], null, 0)).toBe(2)
    expect(commonStop([], null, 0)).toBe(0)
    expect(setStops(cps, 4, null).map((c) => c.stopMin)).toEqual([4, 4, 4, 4, 4])
  })
})
