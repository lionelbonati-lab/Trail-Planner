import { describe, expect, it } from 'vitest'
import { routePointAt, simplifyRoute, splitRouteAt } from '../routeGeo'

/** Points tous les 20 m le long d'une suite de directions (degrés vers le nord). */
function path(legs: [number, number][]) {
  const pts = [{ dist: 0, lat: 45, lon: 6 }]
  for (const [bearing, meters] of legs) {
    for (let m = 20; m <= meters; m += 20) {
      const last = pts[pts.length - 1]
      const t = (bearing * Math.PI) / 180
      pts.push({
        dist: last.dist + 20,
        lat: last.lat + (20 * Math.cos(t)) / 110540,
        lon: last.lon + (20 * Math.sin(t)) / (111320 * Math.cos((45 * Math.PI) / 180)),
      })
    }
  }
  return pts
}

describe('tracé de la page assistance', () => {
  it('ligne droite : deux points ; virages gardés', () => {
    expect(simplifyRoute(path([[0, 2000]]))).toHaveLength(2)
    const zig = simplifyRoute(path([[0, 400], [90, 400], [0, 400], [270, 400]]))
    expect(zig).toHaveLength(5)
    expect(zig.map((p) => p[0])).toEqual([0, 400, 800, 1200, 1600])
  })

  it('nombre de points plafonné (tolérance relevée)', () => {
    const wiggly = path(Array.from({ length: 600 }, (_, i): [number, number] => [i % 2 ? 60 : 300, 100]))
    const r = simplifyRoute(wiggly, 8, 200)
    expect(r.length).toBeLessThanOrEqual(200)
    expect(r[r.length - 1][0]).toBe(wiggly[wiggly.length - 1].dist)
  })

  it('position à une distance et partage en parcouru / à faire', () => {
    const r = simplifyRoute(path([[0, 1000], [90, 1000]]))
    const mid = routePointAt(r, 500)
    expect(mid.lat).toBeCloseTo(45 + 500 / 110540, 5)
    expect(mid.lon).toBeCloseTo(6, 5)
    const { done, todo } = splitRouteAt(r, 1500)
    expect(done[done.length - 1]).toEqual(todo[0])
    expect(done).toHaveLength(3)
    expect(todo).toHaveLength(2)
    expect(routePointAt(r, -5)).toEqual({ lat: r[0][1], lon: r[0][2] })
  })
})
