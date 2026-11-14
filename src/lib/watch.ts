// Plan compact pour le champ de données Garmin (Connect IQ).
// Texte ligne par ligne, quelques Ko, lisible par la montre sans JSON imbriqué :
//
//   TP1
//   N|<nom de la course>
//   S|<départ prévu, s Unix>|<distance totale, m>|<rappel nutrition, min>
//   K|<d>:<t>,<d>:<t>,…    courbe distance (m) → temps de déplacement prévu (s, arrêts exclus),
//                          simplifiée à ±45 s près (points là où l'allure change)
//   C|<dist m>|<prévu s>|<barrière s Unix ou 0>|<type r/s/c/i>|<nom>|<arrêt s>   (un par point)
//   G|<tolérance m>|<d0>:<lat0>:<lon0>|<dd>,<dlat>,<dlon>,<dd>,<dlat>,<dlon>,…
//                          tracé simplifié pour caler la position GPS sur le parcours : premier point
//                          (lat / lon en 1e-5 degré), puis écarts de distance (m) et de position
//                          d'un point au suivant. Absent si le plan dépasserait WATCH_PLAN_MAX.
// Temps prévu à une distance d = K interpolé + somme des arrêts des points situés avant d.
import { simplifyRoute } from './routeGeo'
import { zonedToUtc } from './time'
import type { Athlete, Race, SimResult, Track } from './types'

/** Tolérance de simplification de la courbe des temps (s). */
const TOL = 45

/** Douglas-Peucker sur une courbe (x, y) : garde les points qui s'écartent de plus de `tol` en y. */
export function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const f = (pts[i][0] - pts[a][0]) / (pts[b][0] - pts[a][0] || 1)
      const e = Math.abs(pts[i][1] - (pts[a][1] + f * (pts[b][1] - pts[a][1])))
      if (e > worst) {
        worst = e
        idx = i
      }
    }
    if (idx >= 0 && worst > tol) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

const KIND: Record<string, string> = { ravito: 'r', split: 's', cutoff: 'c', info: 'i' }

/** Nom sans séparateurs, tronqué pour l'écran de la montre. */
function clean(name: string, max: number): string {
  return name.replace(/[|\n\r]/g, ' ').trim().slice(0, max)
}

/** Intervalle des rappels nutrition (min) : un gel de ~25 g au rythme de glucides visé. */
export function fuelInterval(race: Race, athlete: Athlete): number {
  const gel = athlete.products.find((p) => /gel/i.test(p.name))?.carbs ?? 25
  if (race.carbsPerH <= 0) return 0
  return Math.max(10, Math.min(60, Math.round((60 * gel) / race.carbsPerH)))
}

export function watchPlan(race: Race, athlete: Athlete, track: Track, sim: SimResult): string {
  // Départ libre : 0 (la montre affiche « Départ libre » ; l'écart au plan part du vrai départ).
  const start = race.freeStart ? 0 : Math.round(zonedToUtc(race.env.start, race.env.timeZone).getTime() / 1000)
  // Arrêts cumulés avant une distance (un point situé exactement à d n'est pas compté).
  const stops = sim.splits.map((s) => ({ dist: s.to, stop: s.cp.stopMin * 60 }))
  const stopsBefore = (d: number) => stops.reduce((a, s) => a + (s.dist < d ? s.stop : 0), 0)
  // Courbe distance → temps de déplacement (arrêts exclus), simplifiée à ±TOL s.
  const curve = sim.points.map((p) => [p.dist, p.t - stopsBefore(p.dist + 1e-6)] as [number, number])
  const keep = simplify(curve, TOL)
  const K = keep.map(([d, t]) => `${Math.round(d)}:${Math.round(t)}`).join(',')
  const lines = [
    'TP1',
    `N|${clean(race.name, 24)}`,
    `S|${start}|${Math.round(track.totalDist)}|${fuelInterval(race, athlete)}`,
    `K|${K}`,
    ...sim.splits.map((s) => {
      const cut = s.cp.cutoff ? Math.round(zonedToUtc(s.cp.cutoff, race.env.timeZone).getTime() / 1000) : 0
      return `C|${Math.round(s.to)}|${Math.round(s.arrival)}|${Number.isFinite(cut) ? cut : 0}|${KIND[s.cp.kind] ?? 'i'}|${clean(s.cp.name, 16)}|${Math.round(s.cp.stopMin * 60)}`
    }),
  ]
  const base = lines.join('\n')
  // Taille en octets (accents des noms sur 2 octets) ; la ligne G n'a que des caractères ASCII.
  const route = routeLine(track.points, WATCH_PLAN_MAX - new TextEncoder().encode(base).length - 1)
  return route ? `${base}\n${route}` : base
}

/**
 * Taille maximale du plan (octets) : la tâche de fond de la montre transmet au plus 8 Ko
 * (Background.exit) ; marge gardée pour la mémoire de la tâche de fond.
 */
export const WATCH_PLAN_MAX = 7000

/**
 * Tolérances essayées pour simplifier le tracé (m) : la plus fine qui tient dans la place restante.
 * Grosse tolérance (ultra avec beaucoup de points) : la montre borne alors la distance au segment
 * où elle se trouve et compte la distance montre à l'intérieur (lacets simplifiés).
 */
const ROUTE_TOLS = [8, 12, 18, 25, 35, 50, 70, 100, 150, 200]

/** Ligne G : tracé simplifié, écarts d'un point au suivant ; null s'il ne tient pas dans `budget` caractères. */
export function routeLine(points: { dist: number; lat: number; lon: number }[], budget: number): string | null {
  if (points.length < 2 || budget < 100) return null
  const e5 = (x: number) => Math.round(x * 1e5)
  for (const tol of ROUTE_TOLS) {
    const r = simplifyRoute(points, tol, Infinity)
    let [d0, la, lo] = [r[0][0], e5(r[0][1]), e5(r[0][2])]
    const head = `G|${tol}|${d0}:${la}:${lo}|`
    const parts: number[] = []
    for (const [d, lat, lon] of r.slice(1)) {
      const a = e5(lat)
      const o = e5(lon)
      parts.push(d - d0, a - la, o - lo)
      d0 = d
      la = a
      lo = o
    }
    const line = head + parts.join(',')
    if (line.length <= budget) return line
  }
  return null
}

/** URL lue par la montre : seul le champ `w` du lien assistance (réponse de quelques Ko). */
export function watchUrl(projectId: string, shareId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/%28default%29/documents/shares/${shareId}?mask.fieldPaths=w`
}
