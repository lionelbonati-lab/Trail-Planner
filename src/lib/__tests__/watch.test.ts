import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace } from '../defaults'
import { computePlan } from '../plan'
import { climbLine, fuelInterval, routeLine, WATCH_PLAN_MAX, watchPlan, watchUrl } from '../watch'

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
    const [, start, total, fuel, kind, up, down] = lines[2].split('|')
    expect(Number(start)).toBe(Date.parse('2026-06-06T04:00:00Z') / 1000)
    expect(Number(total)).toBeCloseTo(plan.track.totalDist, -1)
    expect(Number(fuel)).toBe(25)
    expect(kind).toBe('c')
    expect(Number(up)).toBe(Math.round(plan.track.dPlus))
    expect(Number(down)).toBe(Math.round(plan.track.dMinus))
    const K = lines[3].slice(2).split(',').map((x) => x.split(':').map(Number))
    expect(K[0]).toEqual([0, 0])
    expect(K[K.length - 1]).toEqual([Math.round(plan.track.totalDist), Math.round(plan.sim.totalTime - 180)])
    expect(K.every(([d, t], i) => i === 0 || (d > K[i - 1][0] && t >= K[i - 1][1]))).toBe(true)
    expect(K.length).toBeLessThan(40)
    const c = lines[4].split('|')
    expect(c).toEqual(['C', '10000', String(Math.round(plan.sim.splits[0].arrival)), String(Date.parse('2026-06-06T07:00:00Z') / 1000), 'r', 'Col du Bonhomme', '180'])
    const C = lines.filter((l) => l.startsWith('C|'))
    expect(C[C.length - 1]).toMatch(/^C\|\d+\|\d+\|0\|i\|Arrivée\|0$/)
    expect(lines[lines.length - 2]).toMatch(/^E\|/)
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

describe('dénivelé sur la montre (ligne E)', () => {
  const race = newRace('Bosses', bumps())
  race.checkpoints = [
    { id: 'a', dist: 3333, name: 'A', kind: 'ravito', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
    { id: 'b', dist: 7210, name: 'B', kind: 'info', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
  ]
  const plan = computePlan(race, DEFAULT_ATHLETE)!
  const w = watchPlan(race, DEFAULT_ATHLETE, plan.track, plan.sim)
  const e = decodeClimb(w.split('\n').find((l) => l.startsWith('E|'))!)
  const cps = w.split('\n').filter((l) => l.startsWith('C|')).map((l) => Number(l.split('|')[1]))

  it("D+ et D− d'un point au suivant identiques au tableau du plan, totaux identiques au parcours", () => {
    expect(cps.length).toBe(3)
    let prev = 0
    plan.sim.splits.forEach((s, i) => {
      const [u0, n0] = climbAt(e, prev)
      const [u1, n1] = climbAt(e, cps[i])
      expect(Math.abs(u1 - u0 - s.dPlus)).toBeLessThanOrEqual(1)
      expect(Math.abs(n1 - n0 - s.dMinus)).toBeLessThanOrEqual(1)
      prev = cps[i]
    })
    const last = e[e.length - 1]
    expect(last.d).toBe(Math.round(plan.track.totalDist))
    expect(last.u).toBe(Math.round(plan.track.dPlus))
    expect(last.n).toBe(Math.round(plan.track.dMinus))
  })

  it('cumuls fidèles entre deux points (à la tolérance près), distances croissantes', () => {
    expect(e[0]).toEqual({ d: 0, u: 0, n: 0 })
    expect(e.every((v, i) => i === 0 || (v.d >= e[i - 1].d && v.u >= e[i - 1].u && v.n >= e[i - 1].n))).toBe(true)
    // Cumuls exacts aux points du tracé.
    let u = 0
    let n = 0
    plan.track.points.forEach((p, i) => {
      if (i > 0) {
        const d = p.ele - plan.track.points[i - 1].ele
        u += Math.max(0, d)
        n += Math.max(0, -d)
      }
      const [eu, en] = climbAt(e, p.dist)
      expect(Math.abs(eu - u)).toBeLessThanOrEqual(8)
      expect(Math.abs(en - n)).toBeLessThanOrEqual(8)
    })
    // Bien moins de sommets que de points du tracé.
    expect(e.length).toBeLessThan(plan.track.points.length / 4)
  })

  it('peu de place : tolérance relevée, puis seuls départ, points et arrivée ; trop peu : absente', () => {
    const marks = plan.sim.splits.map((s) => s.to)
    const full = climbLine(plan.track.points, marks, 100000)!
    // Plus petite place où elle tient : seuls les sommets imposés restent.
    let budget = 20
    while (!climbLine(plan.track.points, marks, budget)) budget++
    const fixedOnly = climbLine(plan.track.points, marks, budget)!
    expect(decodeClimb(fixedOnly).map((v) => v.d)).toEqual([0, ...cps])
    expect(fixedOnly.length).toBe(budget)
    expect(fixedOnly.length).toBeLessThan(full.length)
    // Entre les deux : tolérance relevée, sommets en plus des points.
    const mid = climbLine(plan.track.points, marks, Math.floor((budget + full.length) / 2))!
    expect(decodeClimb(mid).length).toBeGreaterThan(cps.length + 1)
    expect(decodeClimb(mid).length).toBeLessThan(decodeClimb(full).length)
    expect(climbLine(plan.track.points, marks, 10)).toBeNull()
  })

  it('parcours d\'entraînement : type p sur la ligne S', () => {
    const route = { ...race, kind: 'route' as const }
    const p2 = computePlan(route, DEFAULT_ATHLETE)!
    expect(watchPlan(route, DEFAULT_ATHLETE, p2.track, p2.sim).split('\n')[2].split('|')[4]).toBe('p')
  })
})

/** Ligne E décodée comme sur la montre : distance, D+ et D− cumulés (m) à chaque sommet. */
function decodeClimb(line: string): { d: number; u: number; n: number }[] {
  const v = line.slice(2).split(',').map(Number)
  const out: { d: number; u: number; n: number }[] = []
  let [d, u, n] = [0, 0, 0]
  for (let i = 0; i + 2 < v.length; i += 3) {
    d += v[i]
    u += v[i + 1]
    n += v[i + 2]
    out.push({ d, u, n })
  }
  return out
}

/** D+ et D− cumulés à la distance d, interpolés entre deux sommets (comme Plan.climbAt). */
function climbAt(e: { d: number; u: number; n: number }[], d: number): [number, number] {
  if (d <= e[0].d) return [e[0].u, e[0].n]
  const last = e[e.length - 1]
  if (d >= last.d) return [last.u, last.n]
  let i = 1
  while (e[i].d <= d) i++
  const a = e[i - 1]
  const b = e[i]
  const f = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0
  return [a.u + f * (b.u - a.u), a.n + f * (b.n - a.n)]
}

/** 10 km de bosses : montées et descentes de hauteurs variées. */
function bumps(): string {
  const pts: string[] = []
  for (let d = 0; d <= 10000; d += 20) {
    const ele = 800 + 150 * Math.sin(d / 900) + 40 * Math.sin(d / 170) + (d > 6000 ? (d - 6000) / 10 : 0)
    pts.push(`<trkpt lat="${45 + d / 111195}" lon="${6 + 0.001 * Math.sin(d / 500)}"><ele>${ele.toFixed(1)}</ele></trkpt>`)
  }
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

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
