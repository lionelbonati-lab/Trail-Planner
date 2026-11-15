// Tracé compact pour la page d'assistance : [distance (m), lat, lon], simplifié (Douglas-Peucker
// en mètres) pour rester léger dans le document partagé, et position à une distance donnée.

export type RoutePoint = [number, number, number]

/** Écart (m) d'un point à un segment, en projection locale. */
function offset(p: { lat: number; lon: number }, a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const k = Math.cos((a.lat * Math.PI) / 180) * 111320
  const ax = a.lon * k
  const ay = a.lat * 110540
  const bx = b.lon * k - ax
  const by = b.lat * 110540 - ay
  const px = p.lon * k - ax
  const py = p.lat * 110540 - ay
  const len = bx * bx + by * by
  const t = len > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len)) : 0
  return Math.hypot(px - t * bx, py - t * by)
}

/**
 * Tracé simplifié : on garde les points qui s'écartent de plus de `tol` m de la ligne
 * simplifiée ; la tolérance est relevée tant qu'il reste plus de `max` points.
 */
export function simplifyRoute(points: { dist: number; lat: number; lon: number }[], tol = 8, max = 900): RoutePoint[] {
  if (points.length <= 2) return points.map((p) => [Math.round(p.dist), round5(p.lat), round5(p.lon)])
  let keep: boolean[] = []
  for (let t = tol; ; t *= 1.5) {
    keep = points.map(() => false)
    keep[0] = keep[points.length - 1] = true
    const stack: [number, number][] = [[0, points.length - 1]]
    while (stack.length) {
      const [i, j] = stack.pop()!
      let best = -1
      let bestD = t
      for (let k = i + 1; k < j; k++) {
        const d = offset(points[k], points[i], points[j])
        if (d > bestD) {
          bestD = d
          best = k
        }
      }
      if (best >= 0) {
        keep[best] = true
        stack.push([i, best], [best, j])
      }
    }
    if (keep.filter(Boolean).length <= max) break
  }
  return points.filter((_, i) => keep[i]).map((p) => [Math.round(p.dist), round5(p.lat), round5(p.lon)])
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5

/** Position sur le tracé à la distance `d` (m), interpolée entre deux points. */
export function routePointAt(route: RoutePoint[], d: number): { lat: number; lon: number } {
  if (d <= route[0][0]) return { lat: route[0][1], lon: route[0][2] }
  const last = route[route.length - 1]
  if (d >= last[0]) return { lat: last[1], lon: last[2] }
  let lo = 0
  let hi = route.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (route[mid][0] <= d) lo = mid
    else hi = mid
  }
  const [d0, a0, o0] = route[lo]
  const [d1, a1, o1] = route[hi]
  const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0
  return { lat: a0 + (a1 - a0) * f, lon: o0 + (o1 - o0) * f }
}

/** Partie du tracé avant (`done`) et après (`todo`) la distance `d`, le point de coupure inclus des deux côtés. */
export function splitRouteAt(route: RoutePoint[], d: number): { done: [number, number][]; todo: [number, number][] } {
  const cut = routePointAt(route, d)
  const done: [number, number][] = route.filter((p) => p[0] < d).map((p) => [p[1], p[2]])
  const todo: [number, number][] = route.filter((p) => p[0] > d).map((p) => [p[1], p[2]])
  return { done: [...done, [cut.lat, cut.lon]], todo: [[cut.lat, cut.lon], ...todo] }
}
