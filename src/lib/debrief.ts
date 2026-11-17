// Debrief d'une sortie : passages relevés (montre, mode course) figés dans le parcours, comparés au
// plan d'alors. Un debrief par départ : refaire un parcours en ajoute un nouveau.
import { isFreeStart } from './plan'
import { SHARE_SILENT_MS } from './share'
import type { Activity } from './activity'
import { haversine } from './gpx'
import { formatClock, formatDuration, formatPace, zonedToUtc } from './time'
import { PASS_AHEAD_M, parseDepartures, parsePasses, type WatchReport } from './watchLive'
import type { Debrief, DebriefPoint, LiveState, Race, SimResult } from './types'

/** Deux départs à moins de 30 min l'un de l'autre : la même sortie (montre et mode course). */
export const SAME_RUN_MS = 30 * 60000

/** Points du plan figés pour le debrief : distance, D+ / D- du tronçon, heures et arrêts prévus, barrière. */
export function debriefPoints(race: Race, sim: SimResult): DebriefPoint[] {
  const fixed = !isFreeStart(race)
  return sim.splits.map((s) => ({
    id: s.cp.id,
    name: s.cp.name,
    kind: s.cp.kind,
    dist: Math.round(s.to),
    up: Math.round(s.dPlus),
    down: Math.round(s.dMinus),
    planned: Math.round(s.arrival),
    stop: Math.round(s.departure - s.arrival),
    cutoff: fixed && s.cp.cutoff ? zonedToUtc(s.cp.cutoff, race.env.timeZone).toISOString() : null,
  }))
}

/** Départs relevés de la sortie (montre, mode course, fichier importé), sans les corrections. */
export function sourceStarts(d: Debrief): number[] {
  return [d.watch ? d.watch.s * 1000 : NaN, d.live ? Date.parse(d.live.startedAt) : NaN, d.file ? d.file.start : NaN].filter(Number.isFinite)
}

/** Départ de la sortie (ms) : corrigé à la main, sinon celui de la montre, du mode course, du fichier. */
export function debriefStart(d: Debrief): number {
  if (d.edits?.start) return Date.parse(d.edits.start)
  return sourceStarts(d)[0] ?? Date.parse(d.createdAt)
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Mode course : passages copiés dans le debrief de la sortie (créé au premier passage). Même sortie :
 * départ à moins de 30 min, ou un passage identique (départ corrigé de plus de 30 min). Null : rien
 * à changer.
 */
export function upsertLive(list: Debrief[], live: LiveState, points: () => DebriefPoint[], now = new Date()): Debrief[] | null {
  if (!Object.keys(live.passages).length) return null
  const s = Date.parse(live.startedAt)
  const i = list.findIndex(
    (d) =>
      sourceStarts(d).some((x) => Math.abs(x - s) < SAME_RUN_MS) ||
      (!!d.live && Object.entries(d.live.passages).some(([k, v]) => live.passages[k] === v)),
  )
  if (i >= 0) {
    if (sameJson(list[i].live, live)) return null
    return list.map((d, j) => (j === i ? { ...d, live } : d))
  }
  return [...list, { id: crypto.randomUUID(), createdAt: now.toISOString(), points: points(), live }]
}

/**
 * Relevé de la montre : passages (indices du plan envoyé) et départs des ravitos copiés dans le
 * debrief de la sortie, créé au premier relevé. Un passage noté loin devant la position n'est pas
 * crédible (comme sur la page assistance). Null : rien à changer.
 */
export function upsertWatch(list: Debrief[], report: WatchReport, points: () => DebriefPoint[], now = new Date()): Debrief[] | null {
  if (!(report.s > 0)) return null
  const i = list.findIndex((d) => sourceStarts(d).some((x) => Math.abs(x - report.s * 1000) < SAME_RUN_MS))
  const pts = i >= 0 ? list[i].points : points()
  const byIndex = (m: Map<number, number>) => {
    const out: Record<string, number> = {}
    for (const [k, t] of m) if (pts[k] && pts[k].dist <= report.d + PASS_AHEAD_M) out[pts[k].id] = t
    return out
  }
  const passes = byIndex(parsePasses(report.p))
  const departures = Object.fromEntries(Object.entries(byIndex(parseDepartures(report.p))).filter(([id, t]) => passes[id] !== undefined && t >= passes[id]))
  const watch = { s: report.s, t: report.t, d: Math.round(report.d), passes, departures }
  if (i >= 0) {
    // Relevé plus ancien que celui déjà retenu (abonnement rouvert) : ignoré.
    const old = list[i].watch
    if (old && (old.t > watch.t || sameJson(old, watch))) return null
    return list.map((d, j) => (j === i ? { ...d, watch } : d))
  }
  return [...list, { id: crypto.randomUUID(), createdAt: now.toISOString(), points: pts, watch }]
}

export type TimeSource = 'watch' | 'live' | 'file' | 'edit'

export interface DebriefTimes {
  start: number
  /** Arrivées et départs (ms) par point. */
  arr: Map<string, number>
  dep: Map<string, number>
  /** Origine de l'heure d'arrivée. */
  source: Map<string, TimeSource>
}

/** Heures retenues : corrections, sinon montre, mode course (comme la page assistance), puis fichier importé. */
export function debriefTimes(d: Debrief): DebriefTimes {
  const arr = new Map<string, number>()
  const dep = new Map<string, number>()
  const source = new Map<string, TimeSource>()
  for (const p of d.points) {
    const e = d.edits?.passages?.[p.id]
    if (e !== undefined) {
      if (e) {
        arr.set(p.id, Date.parse(e))
        source.set(p.id, 'edit')
      }
    } else if (d.watch?.passes[p.id] !== undefined) {
      arr.set(p.id, d.watch.passes[p.id] * 1000)
      source.set(p.id, 'watch')
    } else if (d.live?.passages[p.id]) {
      arr.set(p.id, Date.parse(d.live.passages[p.id]))
      source.set(p.id, 'live')
    } else if (d.file?.passes[p.id] !== undefined) {
      arr.set(p.id, d.file.passes[p.id])
      source.set(p.id, 'file')
    }
    const ed = d.edits?.departures?.[p.id]
    const left =
      ed !== undefined
        ? ed
          ? Date.parse(ed)
          : NaN
        : d.watch?.departures[p.id] !== undefined
          ? d.watch.departures[p.id] * 1000
          : d.live?.departures?.[p.id]
            ? Date.parse(d.live.departures[p.id])
            : (d.file?.departures[p.id] ?? NaN)
    if (Number.isFinite(left) && arr.has(p.id) && left >= arr.get(p.id)!) dep.set(p.id, left)
  }
  return { start: debriefStart(d), arr, dep, source }
}

/** Dernières nouvelles de la sortie (ms) : relevé de la montre, passage ou départ noté. */
function lastNews(d: Debrief, t: DebriefTimes): number {
  return Math.max(t.start, d.watch ? d.watch.t * 1000 : 0, ...t.arr.values(), ...t.dep.values())
}

/** Sortie terminée : arrivée connue, ou plus de nouvelles depuis 3 h. */
export function debriefEnded(d: Debrief, nowMs = Date.now()): boolean {
  const t = debriefTimes(d)
  const fin = d.points[d.points.length - 1]
  return (!!fin && t.arr.has(fin.id)) || nowMs - lastNews(d, t) > SHARE_SILENT_MS
}

export interface DebriefRow {
  point: DebriefPoint
  /** Heure prévue (ms), recalée sur le départ réel. */
  planned: number
  actual: number | null
  left: number | null
  source: TimeSource | null
  /** Écart au plan (s, positif : en retard). */
  delta: number | null
  /** Marge sur la barrière horaire (s, négative : hors délai). */
  margin: number | null
}

export interface DebriefLeg {
  /** Point d'arrivée du tronçon. */
  id: string
  from: string
  to: string
  km: number
  up: number
  down: number
  /** Temps prévu et réel (s) ; arrêt au point de départ compris si son départ n'est pas noté. */
  planned: number
  actual: number | null
  withStop: boolean
}

export interface DebriefStop {
  point: DebriefPoint
  planned: number
  actual: number | null
}

export interface DebriefReport {
  start: number
  finish: number | null
  /** Temps total réel et prévu (s). */
  total: number | null
  plannedTotal: number
  rows: DebriefRow[]
  legs: DebriefLeg[]
  stops: DebriefStop[]
}

/** Tableau du debrief : passages, tronçons et arrêts, prévus et réels. */
export function debriefReport(d: Debrief): DebriefReport {
  const t = debriefTimes(d)
  const rows: DebriefRow[] = d.points.map((p) => {
    const actual = t.arr.get(p.id) ?? null
    const planned = t.start + p.planned * 1000
    return {
      point: p,
      planned,
      actual,
      left: t.dep.get(p.id) ?? null,
      source: t.source.get(p.id) ?? null,
      delta: actual !== null ? Math.round((actual - planned) / 1000) : null,
      margin: actual !== null && p.cutoff ? Math.round((Date.parse(p.cutoff) - actual) / 1000) : null,
    }
  })
  const legs: DebriefLeg[] = d.points.map((p, i) => {
    const prev = i > 0 ? rows[i - 1] : null
    const prevPlan = prev ? prev.point.planned : 0
    const prevStop = prev ? prev.point.stop : 0
    const fromArr = prev ? prev.actual : t.start
    const fromDep = prev ? prev.left : t.start
    const arr = t.arr.get(p.id) ?? null
    // Départ du point précédent noté : temps en mouvement ; sinon arrêt prévu compris.
    const moving = fromDep !== null
    return {
      id: p.id,
      from: prev ? prev.point.name : 'Départ',
      to: p.name,
      km: (p.dist - (prev ? prev.point.dist : 0)) / 1000,
      up: p.up,
      down: p.down,
      planned: p.planned - prevPlan - (moving ? prevStop : 0),
      actual: arr === null ? null : moving ? Math.round((arr - fromDep!) / 1000) : fromArr !== null ? Math.round((arr - fromArr) / 1000) : null,
      withStop: !moving && prevStop > 0,
    }
  })
  const stops: DebriefStop[] = rows
    .filter((r) => r.point.stop > 0 || r.left !== null)
    .filter((r) => r !== rows[rows.length - 1])
    .map((r) => ({ point: r.point, planned: r.point.stop, actual: r.actual !== null && r.left !== null ? Math.round((r.left - r.actual) / 1000) : null }))
  const fin = rows[rows.length - 1]
  const finish = fin?.actual ?? null
  return {
    start: t.start,
    finish,
    total: finish !== null ? Math.round((finish - t.start) / 1000) : null,
    plannedTotal: fin?.point.planned ?? 0,
    rows,
    legs,
    stops,
  }
}

/**
 * Temps à donner à l'estimation du niveau (s) : temps d'arrivée, arrêts réels remplacés par les arrêts
 * prévus là où le départ du ravito est connu (le modèle compte les arrêts prévus du plan).
 */
export function levelTarget(r: DebriefReport): number | null {
  if (r.total === null) return null
  return r.stops.reduce((a, s) => (s.actual !== null ? a - s.actual + s.planned : a), r.total)
}

/** Heure réelle (ms) à la distance d, interpolée entre les passages relevés ; null au-delà du dernier. */
export function realTimeAt(r: DebriefReport, dist: number): number | null {
  // Nœuds : arrivée et départ (arrêt compris) à chaque point passé.
  const nodes = [{ dist: 0, arr: r.start, dep: r.start }, ...r.rows.filter((x) => x.actual !== null).map((x) => ({ dist: x.point.dist, arr: x.actual!, dep: x.left ?? x.actual! }))]
  if (dist <= 0) return r.start
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]
    const b = nodes[i]
    if (dist <= b.dist) return b.dist > a.dist ? a.dep + ((dist - a.dist) / (b.dist - a.dist)) * (b.arr - a.dep) : b.arr
  }
  return null
}

/**
 * Heure « hh:mm » saisie pour une sortie passée : le jour retenu est celui qui la rapproche le plus
 * de l'heure de référence (heure prévue au point), y compris la veille ou le lendemain.
 */
export function clockNear(txt: string, tz: string, refMs: number): number | null {
  const m = /^(\d{1,2})[:h](\d{2})$/.exec(txt.trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const at = (dayMs: number) => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(dayMs))
    return zonedToUtc(`${day}T${m[1].padStart(2, '0')}:${m[2]}`, tz).getTime()
  }
  return [-86400000, 0, 86400000].map((o) => at(refMs + o)).reduce((a, b) => (Math.abs(b - refMs) < Math.abs(a - refMs) ? b : a))
}

/** Débriefs du parcours, du plus récent au plus ancien. */
export function sortedDebriefs(race: Pick<Race, 'debriefs'>): Debrief[] {
  return [...(race.debriefs ?? [])].sort((a, b) => debriefStart(b) - debriefStart(a))
}

/** Écart au plan : « +7 min », « −1h05 », « à l'heure ». */
export function signedGap(sec: number): string {
  const m = Math.round(sec / 60)
  if (m === 0) return "à l'heure"
  const abs = Math.abs(m) >= 60 ? formatDuration(Math.abs(m) * 60) : `${Math.abs(m)} min`
  return `${m > 0 ? '+' : '−'}${abs}`
}

// --- Comparaison de deux sorties ------------------------------------------------------

export interface RunGap {
  /** Temps écoulé depuis le départ (s) dans l'autre sortie, et écart (s, positif : plus lent). */
  other: number
  diff: number
}

/**
 * Sortie comparée à une autre (même parcours) : temps écoulé à chaque point et temps de chaque
 * tronçon. Points appariés par identifiant, sinon par distance (à 200 m près).
 */
export function compareReports(a: DebriefReport, b: DebriefReport): { points: Map<string, RunGap>; legs: Map<string, RunGap>; total: RunGap | null } {
  const twin = <T extends { point: DebriefPoint }>(list: T[], p: DebriefPoint) =>
    list.find((x) => x.point.id === p.id) ?? list.find((x) => Math.abs(x.point.dist - p.dist) <= 200)
  const points = new Map<string, RunGap>()
  const legs = new Map<string, RunGap>()
  for (const row of a.rows) {
    const o = twin(b.rows, row.point)
    if (row.actual !== null && o?.actual != null) {
      const other = Math.round((o.actual - b.start) / 1000)
      points.set(row.point.id, { other, diff: Math.round((row.actual - a.start) / 1000) - other })
    }
  }
  a.legs.forEach((l, i) => {
    const o = b.legs.find((x) => x.id === l.id) ?? b.legs[b.rows.findIndex((x) => Math.abs(x.point.dist - a.rows[i].point.dist) <= 200)]
    if (l.actual !== null && o?.actual != null && !l.withStop && !o.withStop) legs.set(l.id, { other: o.actual, diff: l.actual - o.actual })
  })
  const total = a.total !== null && b.total !== null ? { other: b.total, diff: a.total - b.total } : null
  return { points, legs, total }
}

// --- Import de l'enregistrement de l'activité (FIT / GPX) ----------------------------

/** Point à retrouver dans l'enregistrement : position, ravito (arrêt à détecter) et rayon du ravito (m). */
export interface PassTarget {
  id: string
  lat: number
  lon: number
  stop: boolean
  radius: number
}

/** À moins de 150 m du point : passage. */
const MATCH_M = 150
/** Arrêt au ravito retenu au-delà d'une minute immobile près du point. */
const STOP_MIN_S = 60

/**
 * Passages dans l'enregistrement d'une activité : pour chaque point, dans l'ordre, l'endroit où la
 * trace passe au plus près (premier passage, pour les allers-retours), heure à cet endroit. Aux
 * ravitos, arrivée et départ d'après l'arrêt enregistré (immobile plus d'une minute dans le rayon).
 */
export function activityPasses(act: Activity, targets: PassTarget[]): { passes: Record<string, number>; departures: Record<string, number> } {
  const tp = act.track.points
  const n = act.dist.length
  const passes: Record<string, number> = {}
  const departures: Record<string, number> = {}
  // Premier instant où la distance brute atteint d (ms).
  const firstAt = (d: number) => {
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (act.dist[mid] < d) lo = mid + 1
      else hi = mid
    }
    if (lo === 0) return act.start
    const a = lo - 1
    const span = act.dist[lo] - act.dist[a]
    const f = span > 0 ? Math.max(0, Math.min(1, (d - act.dist[a]) / span)) : 1
    return act.start + (act.elapsed[a] + f * (act.elapsed[lo] - act.elapsed[a])) * 1000
  }
  let k0 = 0
  for (const g of targets) {
    let best = -1
    let bestD = Infinity
    for (let k = k0; k < tp.length; k++) {
      const dd = haversine(tp[k].lat, tp[k].lon, g.lat, g.lon)
      if (dd < bestD) {
        bestD = dd
        best = k
      }
      // Premier passage : on s'arrête une fois ressorti des environs du point.
      if (bestD <= MATCH_M && dd > 2 * MATCH_M) break
    }
    if (best < 0 || bestD > MATCH_M) continue
    k0 = best
    const at = tp[best].dist
    passes[g.id] = Math.round(firstAt(at))
    if (!g.stop) continue
    // Arrêt au ravito : points bruts dans le rayon, instants sans mouvement.
    let first = -1
    let last = -1
    let still = 0
    for (let i = 1; i < n; i++) {
      if (act.dist[i] < at - g.radius) continue
      if (act.dist[i] > at + g.radius) break
      if (act.moving[i] === act.moving[i - 1] && act.elapsed[i] > act.elapsed[i - 1]) {
        if (first < 0) first = i - 1
        last = i
        still += act.elapsed[i] - act.elapsed[i - 1]
      }
    }
    if (still >= STOP_MIN_S) {
      passes[g.id] = Math.round(act.start + act.elapsed[first] * 1000)
      departures[g.id] = Math.round(act.start + act.elapsed[last] * 1000)
    }
  }
  return { passes, departures }
}

/**
 * Fichier importé : complète la sortie choisie (ou celle du même départ, à 30 min près), sans
 * écraser montre, mode course ni corrections ; sinon nouvelle sortie.
 */
export function upsertFile(list: Debrief[], file: NonNullable<Debrief['file']>, points: DebriefPoint[], targetId?: string, now = new Date()): { list: Debrief[]; id: string } {
  const i = targetId ? list.findIndex((d) => d.id === targetId) : list.findIndex((d) => sourceStarts(d).some((x) => Math.abs(x - file.start) < SAME_RUN_MS))
  if (i >= 0) return { list: list.map((d, j) => (j === i ? { ...d, file } : d)), id: list[i].id }
  const id = crypto.randomUUID()
  return { list: [...list, { id, createdAt: now.toISOString(), points, file }], id }
}

// --- Exports ---------------------------------------------------------------------------

const minutes = (sec: number | null) => (sec === null ? '' : `${sec > 0 ? '+' : ''}${Math.round(sec / 60)}`)

/** Tableur (CSV, séparateur « ; », virgule décimale : Excel en français) : passages, tronçons, arrêts, notes. */
export function debriefCsv(raceName: string, d: Debrief, tz: string): string {
  const r = debriefReport(d)
  const clock = (ms: number | null) => (ms === null ? '' : formatClock(new Date(ms), tz, true))
  const dur = (sec: number | null) => (sec === null ? '' : formatDuration(sec, true))
  const num = (x: number, digits = 1) => x.toFixed(digits).replace('.', ',')
  const cell = (v: string | number) => {
    const t = String(v)
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const line = (cells: (string | number)[]) => cells.map(cell).join(';')
  const notes = d.notes ?? {}
  const src: Record<TimeSource, string> = { watch: 'montre', live: 'mode course', file: 'fichier', edit: 'corrigé' }
  const out = [
    line(['Debrief', raceName, 'Départ', clock(r.start)]),
    line(['Arrivée', clock(r.finish), 'Temps', dur(r.total), 'Prévu', dur(r.plannedTotal), 'Écart (min)', minutes(r.total !== null ? r.total - r.plannedTotal : null)]),
    '',
    line(['Point', 'km', 'Prévu', 'Réel', 'Écart (min)', 'Reparti', 'Marge barrière (min)', 'Source', 'Note']),
    ...r.rows.map((x) =>
      line([
        x.point.name,
        num(x.point.dist / 1000),
        clock(x.planned),
        clock(x.actual),
        minutes(x.delta),
        clock(x.left),
        x.margin === null ? '' : String(Math.round(x.margin / 60)),
        x.source ? src[x.source] : '',
        notes[x.point.id] ?? '',
      ]),
    ),
    '',
    line(['Tronçon', 'km', 'D+ (m)', 'D- (m)', 'Prévu', 'Réel', 'Écart (min)', 'Allure réelle (min/km)', 'Allure prévue (min/km)', 'Arrêt compris']),
    ...r.legs.map((l) =>
      line([
        `${l.from} → ${l.to}`,
        num(l.km),
        l.up,
        l.down,
        dur(l.planned),
        dur(l.actual),
        minutes(l.actual !== null ? l.actual - l.planned : null),
        l.actual !== null && l.km > 0 ? formatPace(l.actual / l.km) : '',
        l.km > 0 ? formatPace(l.planned / l.km) : '',
        l.withStop ? 'oui' : '',
      ]),
    ),
  ]
  if (r.stops.length) out.push('', line(['Ravito', 'Arrêt prévu', 'Arrêt réel', 'Écart (min)']), ...r.stops.map((x) => line([x.point.name, dur(x.planned), dur(x.actual), minutes(x.actual !== null ? x.actual - x.planned : null)])))
  if (d.note) out.push('', line(['Bilan', d.note]))
  // BOM : accents lus correctement par Excel.
  return '\ufeff' + out.join('\r\n') + '\r\n'
}

/** Résumé texte à coller dans un message : temps, écarts, passages avec notes, bilan. */
export function debriefText(raceName: string, d: Debrief, tz: string): string {
  const r = debriefReport(d)
  const long = r.plannedTotal > 20 * 3600
  const clock = (ms: number) => formatClock(new Date(ms), tz, long)
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(r.start))
  const notes = d.notes ?? {}
  const lines = [`Debrief · ${raceName} — ${day}, départ ${formatClock(new Date(r.start), tz)}`]
  lines.push(
    r.total !== null
      ? `Arrivée ${clock(r.finish!)} en ${formatDuration(r.total)} (prévu ${formatDuration(r.plannedTotal)}, ${signedGap(r.total - r.plannedTotal)})`
      : `Arrivée non relevée (prévu ${formatDuration(r.plannedTotal)})`,
  )
  const known = r.stops.filter((x) => x.actual !== null)
  if (known.length) lines.push(`Arrêts aux ravitos : ${formatDuration(known.reduce((a, x) => a + x.actual!, 0))} (prévu ${formatDuration(known.reduce((a, x) => a + x.planned, 0))})`)
  lines.push('', 'Passages :')
  for (const x of r.rows) {
    const parts = [x.actual !== null ? `${clock(x.actual)}, ${signedGap(x.delta!)}` : 'non relevé']
    if (x.left !== null && x.actual !== null) parts.push(`reparti ${clock(x.left)} (${formatDuration((x.left - x.actual) / 1000)} d'arrêt)`)
    if (x.margin !== null) parts.push(x.margin >= 0 ? `marge ${formatDuration(x.margin)} sur la barrière` : `hors délai de ${formatDuration(-x.margin)}`)
    const note = notes[x.point.id]?.trim()
    lines.push(`• ${x.point.name} (km ${(x.point.dist / 1000).toFixed(1).replace('.', ',')}) : ${parts.join(', ')}${note ? ` — ${note}` : ''}`)
  }
  if (d.note?.trim()) lines.push('', `Bilan : ${d.note.trim()}`)
  return lines.join('\n')
}

// --- Annonce des sorties terminées -----------------------------------------------------

/** Sortie récente (7 jours) terminée et pas encore ouverte : proposée en haut de l'appli. */
export const ANNOUNCE_DAYS = 7

/** Sorties terminées à proposer (la plus récente d'abord). */
export function debriefsToAnnounce(races: Pick<Race, 'id' | 'debriefs'>[], nowMs = Date.now()): { raceId: string; debrief: Debrief }[] {
  return races
    .flatMap((race) => (race.debriefs ?? []).map((debrief) => ({ raceId: race.id, debrief })))
    .filter(({ debrief }) => !debrief.seen && nowMs - debriefStart(debrief) < ANNOUNCE_DAYS * 86400000 && debriefEnded(debrief, nowMs))
    .sort((a, b) => debriefStart(b.debrief) - debriefStart(a.debrief))
}

/** Arrivée relevée depuis moins de 12 h, debrief pas encore ouvert : à notifier (une fois). */
export function debriefsToNotify(races: Pick<Race, 'id' | 'debriefs'>[], already: string[], nowMs = Date.now()): { raceId: string; debrief: Debrief; report: DebriefReport }[] {
  return races.flatMap((race) =>
    (race.debriefs ?? []).flatMap((debrief) => {
      if (debrief.seen || already.includes(debrief.id)) return []
      const report = debriefReport(debrief)
      return report.finish !== null && nowMs - report.finish < 12 * 3600000 && report.finish <= nowMs ? [{ raceId: race.id, debrief, report }] : []
    }),
  )
}
