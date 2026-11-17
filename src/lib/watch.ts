// Plan compact pour le champ de données Garmin (Connect IQ).
// Texte ligne par ligne, quelques Ko, lisible par la montre sans JSON imbriqué :
//
//   TP1
//   N|<nom de la course>
//   S|<départ prévu, s Unix>|<distance totale, m>|<rappel nutrition, min>|<c = course, p = parcours>|<D+ m>|<D− m>|<départ de référence>
//                          départ de référence : départ prévu (s Unix) même en départ libre ; la montre y
//                          rapporte les barrières quand l'activité part un autre jour (entraînement, simulateur)
//   K|<d>:<t>,<d>:<t>,…    courbe distance (m) → temps de déplacement prévu (s, arrêts exclus),
//                          simplifiée à ±45 s près (points là où l'allure change)
//   C|<dist m>|<prévu s>|<barrière s Unix ou 0>|<type r/s/c/i>|<nom>|<arrêt s>|<note>   (un par point)
//   P|<produit>|<produit>|…   noms des produits du plan nutrition (gels, barres…)
//   F|<point de départ>|<point d'arrivée>|<eau dL>|<sel mg>|<p>,<p>,…[|<eau du sac, avec eau minérale>[|<sur ravito>]]
//                          sur ravito : produits à manger ou boire au ravito de départ, « 1 Banane;1 Bouillon »
//                          un par tronçon entre ravitos (indices des lignes C, −1 = départ) : sac
//                          « À emporter » au départ du tronçon (eau, sodium à ajouter en sel, produits) et
//                          produits dans l'ordre où les prendre (indices dans P). La montre répartit ces
//                          rappels sur le tronçon (au milieu de la part de chacun, en temps prévu).
//   W|<volume d'une flasque, dL>|<isotonique : indice dans P, −1 sans>
//                          flasques de chaque tronçon tirées de son eau (voir flaskSplit) : autant que de
//                          volumes commencés ; avec isotonique, une seule d'isotonique si une suffit,
//                          sinon en alternant eau puis isotonique.
//   E|<dd>,<du>,<dn>,<dd>,<du>,<dn>,…
//                          D+ et D− cumulés depuis le départ (m) le long du parcours, en écarts d'un
//                          sommet au suivant à partir de 0,0,0 : la montre en tire le D+ / D− restant
//                          jusqu'au point suivant et jusqu'à l'arrivée. Absente si elle ne tient pas.
//   G|<tolérance m>|<d0>:<lat0>:<lon0>|<dd>,<dlat>,<dlon>,<dd>,<dlat>,<dlon>,…
//                          tracé simplifié pour caler la position GPS sur le parcours : premier point
//                          (lat / lon en 1e-5 degré), puis écarts de distance (m) et de position
//                          d'un point au suivant. Absent si le plan dépasserait WATCH_PLAN_MAX.
// Temps prévu à une distance d = K interpolé + somme des arrêts des points situés avant d.
// Les champs ajoutés en fin de ligne S et les lignes E, P et F sont ignorés par les versions plus anciennes
// du champ.
import { indexAt } from './gpx'
import { extraSodium, FLASK_L, intakeOrder, isAtRavito, type Leg, nutritionPlan, raceProducts } from './nutrition'
import { isFreeStart } from './plan'
import { simplifyRoute } from './routeGeo'
import { zonedToUtc } from './time'
import type { Athlete, Race, SimResult, SplitRow, Track, TrackPoint } from './types'

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

// Base de vie : « r » comme un ravito (la montre la traite comme un ravito).
const KIND: Record<string, string> = { ravito: 'r', base: 'r', split: 's', chrono: 's', cutoff: 'c', info: 'i' }

/** Nom sans séparateurs, tronqué pour l'écran de la montre. */
function clean(name: string, max: number): string {
  return name.replace(/[|\n\r]/g, ' ').trim().slice(0, max)
}

/** Libellés longs abrégés pour la montre (16 caractères) : « Base de vie km 20.0 » → « BV km 20.0 ». */
function pointName(name: string): string {
  return clean(name.trim().replace(/^Base de vie\b/i, 'BV').replace(/^Point inter\b/i, 'Pt inter'), 16)
}

/** Intervalle des rappels nutrition (min) : un gel de ~25 g au rythme de glucides visé. */
export function fuelInterval(race: Race, athlete: Athlete): number {
  const gel = athlete.products.find((p) => /gel/i.test(p.name))?.carbs ?? 25
  if (race.carbsPerH <= 0) return 0
  return Math.max(10, Math.min(60, Math.round((60 * gel) / race.carbsPerH)))
}

export function watchPlan(race: Race, athlete: Athlete, track: Track, sim: SimResult): string {
  // Départ libre : 0 (la montre affiche « Départ libre » ; l'écart au plan part du vrai départ).
  const planned = Math.round(zonedToUtc(race.env.start, race.env.timeZone).getTime() / 1000)
  const ref = Number.isFinite(planned) ? planned : 0
  const start = isFreeStart(race) ? 0 : ref
  // Arrêts cumulés avant une distance (un point situé exactement à d n'est pas compté).
  const stops = sim.splits.map((s) => ({ dist: s.to, stop: s.cp.stopMin * 60 }))
  const stopsBefore = (d: number) => stops.reduce((a, s) => a + (s.dist < d ? s.stop : 0), 0)
  // Courbe distance → temps de déplacement (arrêts exclus), simplifiée à ±TOL s.
  const curve = sim.points.map((p) => [p.dist, p.t - stopsBefore(p.dist + 1e-6)] as [number, number])
  const keep = simplify(curve, TOL)
  const K = keep.map(([d, t]) => `${Math.round(d)}:${Math.round(t)}`).join(',')
  const kind = race.kind === 'route' ? 'p' : 'c'
  const lines = [
    'TP1',
    `N|${clean(race.name, 24)}`,
    `S|${start}|${Math.round(track.totalDist)}|${fuelInterval(race, athlete)}|${kind}|${Math.round(track.dPlus)}|${Math.round(track.dMinus)}|${ref}`,
    `K|${K}`,
    ...sim.splits.map((s) => {
      const cut = s.cp.cutoff ? Math.round(zonedToUtc(s.cp.cutoff, race.env.timeZone).getTime() / 1000) : 0
      return `C|${Math.round(s.to)}|${Math.round(s.arrival)}|${Number.isFinite(cut) ? cut : 0}|${KIND[s.cp.kind] ?? 'i'}|${pointName(s.cp.name)}|${Math.round(s.cp.stopMin * 60)}|${clean((s.cp.notes ?? '').replace(/[|\s]+/g, ' '), 40)}${s.cp.kind === 'base' ? '|b' : ''}`
    }),
    ...foodLines(nutritionPlan(race, sim, raceProducts(race, athlete.products)), sim.splits),
  ]
  const base = lines.join('\n')
  // Taille en octets (accents des noms sur 2 octets) ; les lignes E et G n'ont que des caractères ASCII.
  const free = WATCH_PLAN_MAX - new TextEncoder().encode(base).length - 1
  // Le tracé, qui cale la position GPS, passe en premier : le plus fin qui tient en laissant au dénivelé
  // sa version minimale (cumuls aux seuls points de passage) ; le dénivelé prend ce qui reste. Si même
  // ainsi le tracé ne tient pas, il prend toute la place et la ligne E n'est envoyée que si elle tient encore.
  const marks = sim.splits.map((s) => s.to)
  const minClimb = climbLine(track.points, marks, CLIMB_MAX, [Infinity])
  const route = (minClimb && routeLine(track.points, free - minClimb.length - 1)) || routeLine(track.points, free)
  const climb = climbLine(track.points, marks, Math.min(CLIMB_MAX, free - (route ? route.length + 1 : 0)))
  return [base, climb, route].filter(Boolean).join('\n')
}

/**
 * Lignes P et F : produits du plan nutrition, tronçon par tronçon (départ ou ravito → ravito suivant ou
 * arrivée), avec le sac « À emporter » de chaque tronçon. Tronçon sans eau, sel ni produit : pas de ligne.
 */
export function foodLines(legs: Leg[], splits: SplitRow[]): string[] {
  const ids: string[] = []
  const names: string[] = []
  const index = (cpId: string | null) => (cpId === null ? -1 : splits.findIndex((s) => s.cp.id === cpId))
  const out: string[] = []
  for (const leg of legs) {
    // L'eau minérale mélangée à l'eau des flasques n'est pas un produit à prendre : elle est dans le texte
    // de l'eau (sinon la montre rappelait « 1 St-Yorre » au lieu du mélange).
    // Produits « sur ravito » : mangés au ravito, pas emportés ni rappelés pendant le tronçon.
    const taken = leg.products.filter((x) => x.product.id !== leg.flasks.waterId && !isAtRavito(x.product))
    const order = intakeOrder(taken.map((x) => ({ product: x.product, count: x.count }))).map((p) => {
      if (!ids.includes(p.id)) {
        ids.push(p.id)
        names.push(clean(p.name.replace(/,/g, ' '), 16))
      }
      return ids.indexOf(p.id)
    })
    const water = Math.round(leg.water * 10)
    const salt = extraSodium(leg)
    // Texte de l'eau seulement avec un mélange d'eau minérale : sinon la montre calcule les flasques
    // elle-même (ligne W), ce qui laisse la place au tracé GPS sur les longs ultras.
    const waterText = leg.flasks.waterId ? watchWaterText(leg) : ''
    // À manger ou boire au ravito de départ du tronçon (produits « sur ravito ») : « 1 Banane;1 Bouillon ».
    const site = leg.fromId === null ? '' : leg.products.filter((x) => isAtRavito(x.product)).map((x) => `${x.count} ${clean(x.product.name.replace(/[;,]/g, ' '), 16)}`).join(';')
    if (!order.length && !water && !salt && !site) continue
    const extra = site ? `|${waterText}|${site}` : waterText ? `|${waterText}` : ''
    out.push(`F|${index(leg.fromId)}|${index(leg.toId)}|${water}|${salt}|${order.join(',')}${extra}`)
  }
  // Flasques : volume (dL) et isotonique (indice dans P, −1 sans) ; la montre en tire les flasques de
  // chaque tronçon d'après son eau, comme flaskSplit.
  const isoId = legs.find((l) => l.flasks.isoId)?.flasks.isoId
  const iso = isoId ? ids.indexOf(isoId) : -1
  if (out.length && legs.some((l) => l.flasks.water > 0)) out.push(`W|${Math.round(FLASK_L * 10)}|${iso}`)
  return names.length ? [`P|${names.join('|')}`, ...out] : out
}

/**
 * Eau du sac pour la montre, comme le plan : « 1.2 L : 2 eau + 1 iso » ; avec un mélange d'eau minérale,
 * « 1.2 L : 2 St-Yorre+eau + 1 iso;St-Yorre 200 + eau 300 ml » (« ; » : ligne suivante sur la montre).
 * Eau minérale aussi dans l'isotonique : « 0.5 L : 1 iso+St-Yorre;iso : St-Yorre 250 + eau 250 ml ».
 */
export function watchWaterText(leg: Leg): string {
  if (!(leg.water > 0)) return ''
  const { water, iso, waterId } = leg.flasks
  const mix = leg.flasks.mix ?? 0
  const mineral = waterId ? leg.products.find((x) => x.product.id === waterId)?.product.name : undefined
  const name = mineral ? clean(mineral.replace(/[;,]/g, ' '), 12) : ''
  const isoMix = leg.flasks.isoMix ?? 0
  const kind = !mineral || !(mix > 0) ? 'eau' : mix >= 1 ? name : `${name}+eau`
  const parts = [water ? `${water} ${kind}` : '', iso ? `${iso} iso${mineral && isoMix > 0 ? `+${name}` : ''}` : ''].filter(Boolean)
  const head = `${leg.water.toFixed(1)} L${parts.length ? ` : ${parts.join(' + ')}` : " d'eau"}`
  if (!mineral) return head
  const ml = (f: number) => Math.round((f * FLASK_L * 1000) / 50) * 50
  const detail = [
    water && mix > 0 && mix < 1 ? `${name} ${ml(mix)} + eau ${FLASK_L * 1000 - ml(mix)} ml` : '',
    iso && isoMix > 0 && isoMix < 1 ? `iso : ${name} ${ml(isoMix)} + eau ${FLASK_L * 1000 - ml(isoMix)} ml` : '',
  ].filter(Boolean)
  return [head, ...detail].join(';')
}

/** Place maximale de la ligne E (caractères). */
const CLIMB_MAX = 1500

/**
 * Tolérances essayées pour le dénivelé cumulé (m) : la plus fine qui tient dans sa place. En dernier
 * recours (Infinity), seuls le départ, les points de passage et l'arrivée sont gardés.
 */
const CLIMB_TOLS = [5, 8, 12, 20, 30, 50, 80, 120, Infinity]

/**
 * Ligne E : D+ et D− cumulés depuis le départ (m), sommets gardés là où la pente change (cumuls à
 * ± tol m près entre deux sommets) et à chaque point de passage (`marks`, distances en m), avec le
 * cumul du tableau du plan : la montre retrouve exactement le D+ / D− d'un point au suivant.
 * null si elle ne tient pas dans `budget` caractères (tolérances `tols` essayées dans l'ordre).
 */
export function climbLine(points: TrackPoint[], marks: number[], budget: number, tols: number[] = CLIMB_TOLS): string | null {
  if (points.length < 2 || budget < 20) return null
  const up = [0]
  const dn = [0]
  for (let i = 1; i < points.length; i++) {
    const d = points[i].ele - points[i - 1].ele
    up.push(up[i - 1] + Math.max(0, d))
    dn.push(dn[i - 1] + Math.max(0, -d))
  }
  // Échantillons : points du tracé et points de passage (cumul au point du tracé le plus proche, comme
  // le D+ / D− des tronçons du plan), dans l'ordre ; deux échantillons à moins de 1 m n'en font qu'un.
  type Sample = { d: number; u: number; n: number; fixed: boolean }
  const total = points[points.length - 1].dist
  const ms = marks.map((m) => Math.max(0, Math.min(total, m))).sort((a, b) => a - b)
  const samples: Sample[] = []
  const add = (s: Sample) => {
    const last = samples[samples.length - 1]
    if (!last || s.d - last.d >= 1) samples.push(s)
    else if (s.fixed && !last.fixed) samples[samples.length - 1] = s
  }
  let k = 0
  points.forEach((p, i) => {
    while (k < ms.length && ms[k] < p.dist) {
      const j = indexAt(points, ms[k])
      add({ d: ms[k++], u: up[j], n: dn[j], fixed: true })
    }
    add({ d: p.dist, u: up[i], n: dn[i], fixed: i === 0 || i === points.length - 1 })
  })
  while (k < ms.length) add({ d: ms[k++], u: up[up.length - 1], n: dn[dn.length - 1], fixed: true })
  samples[samples.length - 1].fixed = true

  for (const tol of tols) {
    // Douglas-Peucker entre deux sommets imposés, sur les deux cumuls à la fois.
    const keep = samples.map((s) => s.fixed)
    const fixed = keep.flatMap((f, i) => (f ? [i] : []))
    const stack: [number, number][] = fixed.slice(1).map((b, i) => [fixed[i], b])
    while (stack.length) {
      const [a, b] = stack.pop()!
      const A = samples[a]
      const B = samples[b]
      let worst = tol
      let idx = -1
      for (let i = a + 1; i < b; i++) {
        const S = samples[i]
        const f = (S.d - A.d) / (B.d - A.d || 1)
        const e = Math.max(Math.abs(S.u - (A.u + f * (B.u - A.u))), Math.abs(S.n - (A.n + f * (B.n - A.n))))
        if (e > worst) {
          worst = e
          idx = i
        }
      }
      if (idx >= 0) {
        keep[idx] = true
        stack.push([a, idx], [idx, b])
      }
    }
    // Cumuls arrondis, puis écarts : la somme des écarts retombe sur les cumuls arrondis.
    const parts: number[] = []
    let [d0, u0, n0] = [0, 0, 0]
    samples.forEach((s, i) => {
      if (!keep[i]) return
      const [d, u, n] = [Math.round(s.d), Math.round(s.u), Math.round(s.n)]
      parts.push(d - d0, u - u0, n - n0)
      ;[d0, u0, n0] = [d, u, n]
    })
    const line = `E|${parts.join(',')}`
    if (line.length <= budget) return line
  }
  return null
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
const ROUTE_TOLS = [8, 12, 18, 25, 35, 50, 70, 85, 100, 115, 130, 150, 200]

/** Ligne G : tracé simplifié, écarts d'un point au suivant ; null s'il ne tient pas dans `budget` caractères. */
export function routeLine(points: { dist: number; lat: number; lon: number }[], budget: number): string | null {
  return encodeRoute(points, budget, ROUTE_TOLS, 'G')
}

/**
 * Tracé `<tag>|<tolérance m>|<d0>:<lat0>:<lon0>|<dd>,<dlat>,<dlon>,…` (lat / lon en 1e-5 degré, puis
 * écarts d'un point au suivant), à la plus fine des tolérances `tols` qui tient dans `budget` caractères.
 */
function encodeRoute(points: { dist: number; lat: number; lon: number }[], budget: number, tols: number[], tag: string): string | null {
  if (points.length < 2 || budget < 100) return null
  const e5 = (x: number) => Math.round(x * 1e5)
  for (const tol of tols) {
    const r = simplifyRoute(points, tol, Infinity)
    let [d0, la, lo] = [r[0][0], e5(r[0][1]), e5(r[0][2])]
    const head = `${tag}|${tol}|${d0}:${la}:${lo}|`
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

/**
 * Place maximale du tracé de la carte de l'appli montre (caractères, champ `wr`), lu au premier plan
 * dans une requête à part (réponses de taille raisonnable pour la montre).
 */
export const MAP_ROUTE_MAX = 10000

/** Tolérances essayées pour le tracé de la carte (m) : la plus fine qui tient dans sa place. */
const MAP_ROUTE_TOLS = [3, 5, 8, 12, 18, 25, 35, 50, 70, 100]

/**
 * Tracé pour l'écran Carte de l'appli montre Trail Planner Companion (champ `wr` du document du code
 * montre) : même codage que la ligne G du plan (`TPR1|<tolérance>|<d0>:<lat0>:<lon0>|<dd>,<dlat>,<dlon>,…`),
 * mais à part et plus fin (3 m sur une course normale) : sur un ultra, la ligne G, faite pour caler le
 * GPS dans 8 Ko, coupe les lacets. null si même la plus grosse tolérance ne tient pas.
 */
export function watchRoute(points: { dist: number; lat: number; lon: number }[], budget = MAP_ROUTE_MAX): string | null {
  return encodeRoute(points, budget, MAP_ROUTE_TOLS, 'TPR1')
}

/**
 * Place maximale du profil de l'appli montre (caractères, champ `wp`). L'appli lit le document au
 * premier plan, sans la limite de 8 Ko de la tâche de fond du champ de données.
 */
export const PROFILE_MAX = 6000

/** Tolérances essayées pour simplifier le profil (m) : la plus fine qui tient dans sa place. */
const PROFILE_TOLS = [2, 3, 5, 8, 12, 20, 30, 50, 80]

/**
 * Profil pour l'appli montre Trail Planner Companion (champ `wp` du document du code montre) :
 *
 *   TPP1|<tolérance m>|<d0>:<alt0>|<dd>,<dz>,<dd>,<dz>,…
 *
 * altitude (m) le long du parcours, simplifiée à ± tolérance près (la plus fine qui tient dans `budget`
 * caractères) : premier point (distance m : altitude m), puis écarts de distance et d'altitude d'un
 * point au suivant. À part du plan `w`, où le dénivelé (ligne E) laisse la place au tracé GPS sur les
 * ultras : le profil zoomable de l'appli garde ainsi ses bosses. null si même la plus grosse
 * tolérance ne tient pas.
 */
export function watchProfile(points: { dist: number; ele: number }[], budget = PROFILE_MAX): string | null {
  if (points.length < 2) return null
  const curve = points.map((p) => [p.dist, p.ele] as [number, number])
  for (const tol of PROFILE_TOLS) {
    const keep = simplify(curve, tol)
    let d0 = Math.round(keep[0][0])
    let a0 = Math.round(keep[0][1])
    const head = `TPP1|${tol}|${d0}:${a0}|`
    const parts: number[] = []
    for (const [d, a] of keep.slice(1)) {
      const dd = Math.round(d)
      const aa = Math.round(a)
      parts.push(dd - d0, aa - a0)
      d0 = dd
      a0 = aa
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

/** Parcours proposés par l'écran de démarrage de l'appli montre (Trail Planner Companion). */
export interface AppCourse {
  id: string
  kind: 'race' | 'route'
  name: string
  /** Départ prévu (s Unix), 0 pour un parcours d'entraînement ou un départ inconnu. */
  start: number
  /** Distance (m) et D+ (m) du parcours. */
  dist: number
  dPlus: number
}

/**
 * Courses et parcours à proposer sur l'appli montre : courses à venir (départ aujourd'hui ou plus tard,
 * `today` au format AAAA-MM-JJ), par date, puis parcours de la bibliothèque, par nom.
 */
export function appCourses(races: Race[], today: string): Race[] {
  const upcoming = races.filter((r) => r.kind === 'race' && r.env.start.slice(0, 10) >= today).sort((a, b) => a.env.start.localeCompare(b.env.start))
  const routes = races.filter((r) => r.kind === 'route').sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  return [...upcoming, ...routes]
}

/**
 * Champ `wl` du document du code montre : liste des parcours de l'appli montre, une ligne par parcours
 * après l'en-tête, dans l'ordre de l'écran de démarrage :
 *
 *   TPL1
 *   <id>|<c course, p parcours>|<nom>|<départ s Unix ou 0>|<distance m>|<D+ m>[|*]
 *
 * « * » : parcours envoyé à la montre (touche ⌚), proposé en premier. Le plan de chaque parcours
 * (champs w, wp, wr) est dans le document `<code>-<id>` (appDocId).
 */
export function watchList(courses: AppCourse[], onWatchId?: string): string {
  return [
    'TPL1',
    ...courses.map((c) =>
      [c.id, c.kind === 'race' ? 'c' : 'p', clean(c.name, 24), Math.round(c.start), Math.round(c.dist), Math.round(c.dPlus), ...(c.id === onWatchId ? ['*'] : [])].join('|'),
    ),
  ].join('\n')
}

/** Document du plan d'un parcours de l'appli montre, pour un code montre. */
export function appDocId(code: string, raceId: string): string {
  return `${code}-${raceId}`
}

