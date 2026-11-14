import { describe, expect, it } from 'vitest'
import { commonRavitoStop, setRavitoStops } from '../splits'
import type { Checkpoint, CheckpointKind } from '../types'

const cp = (id: string, kind: CheckpointKind, stopMin: number): Checkpoint => ({
  id, dist: 1000, name: id, kind, stopMin, cutoff: '', water: 0, carbs: 0, notes: '', auto: false,
})

describe('temps d’arrêt à tous les ravitos', () => {
  const cps = [cp('a', 'ravito', 3), cp('b', 'info', 1), cp('c', 'ravito', 5), cp('d', 'ravito', 3), cp('e', 'cutoff', 0)]

  it('valeur proposée : le temps le plus fréquent parmi les ravitos', () => {
    expect(commonRavitoStop(cps)).toBe(3)
    expect(commonRavitoStop([cp('x', 'ravito', 2), cp('y', 'ravito', 6)])).toBe(6)
    expect(commonRavitoStop([cp('i', 'info', 10)])).toBe(3)
  })

  it('appliqué aux seuls ravitos, autres points inchangés', () => {
    const out = setRavitoStops(cps, 8)
    expect(out.map((c) => c.stopMin)).toEqual([8, 1, 8, 8, 0])
    expect(out[1]).toBe(cps[1])
    expect(setRavitoStops(cps, -2).filter((c) => c.kind === 'ravito').every((c) => c.stopMin === 0)).toBe(true)
  })
})
