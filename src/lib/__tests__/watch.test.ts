import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace } from '../defaults'
import { computePlan } from '../plan'
import { fuelInterval, watchPlan, watchUrl } from '../watch'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20500; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : Math.max(0, (20000 - d) / 20))}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('plan montre', () => {
  it('format compact lisible ligne par ligne', () => {
    const race = newRace('Trail | test\nlong nom de course très long', gpx())
    race.checkpoints = [{ id: 'a', dist: 10000, name: 'Col|du Bonhomme', kind: 'ravito', stopMin: 3, cutoff: '2026-06-06T09:00', water: 0, carbs: 0, notes: '', auto: false }]
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const w = watchPlan(race, DEFAULT_ATHLETE, plan.track, plan.sim)
    const lines = w.split('\n')
    expect(lines[0]).toBe('TP1')
    expect(lines[1]).toBe('N|Trail   test long nom de')
    const [, start, total, fuel] = lines[2].split('|')
    expect(Number(start)).toBe(Date.parse('2026-06-06T04:00:00Z') / 1000)
    expect(Number(total)).toBeCloseTo(plan.track.totalDist, -1)
    expect(Number(fuel)).toBe(25)
    const K = lines[3].slice(2).split(',').map((x) => x.split(':').map(Number))
    expect(K[0]).toEqual([0, 0])
    expect(K[K.length - 1]).toEqual([Math.round(plan.track.totalDist), Math.round(plan.sim.totalTime - 180)])
    expect(K.every(([d, t], i) => i === 0 || (d > K[i - 1][0] && t >= K[i - 1][1]))).toBe(true)
    expect(K.length).toBeLessThan(40)
    const c = lines[4].split('|')
    expect(c).toEqual(['C', '10000', String(Math.round(plan.sim.splits[0].arrival)), String(Date.parse('2026-06-06T07:00:00Z') / 1000), 'r', 'Col du Bonhomme', '180'])
    expect(lines[lines.length - 1]).toMatch(/^C\|\d+\|\d+\|0\|i\|Arrivée\|0$/)
    expect(fuelInterval({ ...race, carbsPerH: 90 }, DEFAULT_ATHLETE)).toBe(17)
    expect(watchUrl('p', 's')).toBe('https://firestore.googleapis.com/v1/projects/p/databases/%28default%29/documents/shares/s?mask.fieldPaths=w')
  })

  const f = '/root/.claude/uploads/e8ccee4e-b8b1-5e4d-8887-2d7e83733916/55ecc249-utmb_174km_universal.gpx'
  it.skipIf(!existsSync(f))('taille sur un ultra (UTMB) avec 30 points', () => {
    const race = newRace('UTMB', readFileSync(f, 'utf8'))
    const plan0 = computePlan(race, DEFAULT_ATHLETE)!
    race.checkpoints = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, dist: ((i + 1) * plan0.track.totalDist) / 31, name: `Ravito numéro ${i + 1}`, kind: 'ravito' as const, stopMin: 5, cutoff: '2026-06-07T12:00', water: 0, carbs: 0, notes: '', auto: false }))
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const w = watchPlan(race, DEFAULT_ATHLETE, plan.track, plan.sim)
    console.log('taille plan montre UTMB :', w.length, 'caractères')
    expect(w.length).toBeLessThan(4500)
  })
})
