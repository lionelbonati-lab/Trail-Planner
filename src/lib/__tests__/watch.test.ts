import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace } from '../defaults'
import { computePlan } from '../plan'
import { fuelInterval, routeLine, WATCH_PLAN_MAX, watchPlan, watchUrl } from '../watch'

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
    const C = lines.filter((l) => l.startsWith('C|'))
    expect(C[C.length - 1]).toMatch(/^C\|\d+\|\d+\|0\|i\|Arrivée\|0$/)
    expect(lines[lines.length - 1]).toMatch(/^G\|/)
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
    // Le tracé remplit la place restante, sans dépasser la limite de la tâche de fond.
    expect(new TextEncoder().encode(w).length).toBeLessThanOrEqual(WATCH_PLAN_MAX)
    const g = w.split('\n').find((l) => l.startsWith('G|'))!
    const r = decodeRoute(g)
    expect(Number(g.split('|')[1])).toBeLessThanOrEqual(150)
    expect(r.length).toBeGreaterThan(150)
    expect(r[r.length - 1].d).toBe(Math.round(plan.track.totalDist))
  })

  it('tracé (ligne G) : sommets sur le parcours à leur distance, plus fins si la place le permet', () => {
    const race = newRace('Lacets', zigzag())
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const w = watchPlan(race, DEFAULT_ATHLETE, plan.track, plan.sim)
    const g = w.split('\n').find((l) => l.startsWith('G|'))!
    const tol = Number(g.split('|')[1])
    expect(tol).toBe(8)
    const r = decodeRoute(g)
    expect(r[0].d).toBe(0)
    expect(r[r.length - 1].d).toBe(Math.round(plan.track.totalDist))
    // Chaque sommet est le point du parcours à sa distance (à l'arrondi près).
    for (const v of r) {
      const p = plan.track.points.reduce((a, b) => (Math.abs(b.dist - v.d) < Math.abs(a.dist - v.d) ? b : a))
      expect(Math.abs(p.lat - v.lat) * 111000).toBeLessThan(3)
      expect(Math.abs(p.lon - v.lon) * 78000).toBeLessThan(3)
    }
    // Moins de place : tolérance relevée ; trop peu : pas de tracé.
    const small = routeLine(plan.track.points, g.length - 1)
    expect(small === null || Number(small.split('|')[1]) > 8).toBe(true)
    expect(routeLine(plan.track.points, 50)).toBeNull()
    expect(routeLine(plan.track.points, g.length)).toBe(g)
  })
})

/** Ligne G décodée comme sur la montre : distance (m) et position (degrés) de chaque sommet. */
function decodeRoute(g: string): { d: number; lat: number; lon: number }[] {
  const [, , origin, data] = g.split('|')
  let [d, lat, lon] = origin.split(':').map(Number)
  const out = [{ d, lat: lat / 1e5, lon: lon / 1e5 }]
  const v = data.split(',').map(Number)
  for (let i = 0; i + 2 < v.length; i += 3) {
    d += v[i]
    lat += v[i + 1]
    lon += v[i + 2]
    out.push({ d, lat: lat / 1e5, lon: lon / 1e5 })
  }
  return out
}

/** Montée en lacets (8 virages de 200 m) puis ligne droite. */
function zigzag(): string {
  const pts: string[] = []
  let lat = 45
  let lon = 6
  for (let leg = 0; leg < 8; leg++) {
    for (let k = 0; k < 10; k++) {
      lon += ((leg % 2 ? -1 : 1) * 20) / 78600
      lat += 2 / 111195
      pts.push(`<trkpt lat="${lat}" lon="${lon}"><ele>${500 + pts.length * 2}</ele></trkpt>`)
    }
  }
  for (let k = 0; k < 100; k++) {
    lat += 20 / 111195
    pts.push(`<trkpt lat="${lat}" lon="${lon}"><ele>${660}</ele></trkpt>`)
  }
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}
