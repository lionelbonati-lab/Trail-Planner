import { describe, expect, it } from 'vitest'
import { assistAllowed, FINISH_ID, navUrl, tripLegs } from '../assist'
import type { Checkpoint } from '../types'

const cp = (patch: Partial<Checkpoint>): Checkpoint => ({
  id: 'x', dist: 1000, name: 'P', kind: 'split', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false, ...patch,
})
const pt = (k: number) => ({ lat: 45 + k / 100, lon: 6 })

describe('assistance : points autorisés et liens Google Maps', () => {
  it('ravitos et arrivée autorisés par défaut, réglage du point prioritaire', () => {
    expect(assistAllowed(cp({ kind: 'ravito' }))).toBe(true)
    expect(assistAllowed(cp({ kind: 'split' }))).toBe(false)
    expect(assistAllowed(cp({ id: FINISH_ID, kind: 'info' }))).toBe(true)
    expect(assistAllowed(cp({ kind: 'ravito', assist: false }))).toBe(false)
    expect(assistAllowed(cp({ kind: 'split', assist: true }))).toBe(true)
  })

  it('lien vers un point : itinéraire en voiture depuis la position du téléphone', () => {
    expect(navUrl({ lat: 45.123456, lon: 6.5 })).toBe('https://www.google.com/maps/dir/?api=1&destination=45.12346,6.50000&travelmode=driving')
  })

  it('trajet : 3 étapes + destination par lien, les suivants repartent du dernier point', () => {
    expect(tripLegs([])).toEqual([])
    const one = tripLegs([pt(1)])
    expect(one).toHaveLength(1)
    expect(one[0].url).toBe('https://www.google.com/maps/dir/?api=1&destination=45.01000,6.00000&travelmode=driving')
    const four = tripLegs([pt(1), pt(2), pt(3), pt(4)])
    expect(four).toHaveLength(1)
    expect(four[0].url).toContain('destination=45.04000,6.00000')
    expect(four[0].url).toContain('waypoints=45.01000,6.00000%7C45.02000,6.00000%7C45.03000,6.00000')
    expect(four[0].url).not.toContain('origin=')
    const six = tripLegs([1, 2, 3, 4, 5, 6].map(pt))
    expect(six.map((l) => [l.from, l.to])).toEqual([[0, 3], [4, 5]])
    expect(six[1].url).toContain('origin=45.04000,6.00000')
    expect(six[1].url).toContain('destination=45.06000,6.00000')
    expect(six[1].url).toContain('waypoints=45.05000,6.00000&')
  })
})
