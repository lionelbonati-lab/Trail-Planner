// Debrief d'une sortie : passages relevés (montre, mode course) figés dans le parcours, comparés au
// plan d'alors. Un debrief par départ : refaire un parcours en ajoute un nouveau.
import { isFreeStart } from './plan'
import { SHARE_SILENT_MS } from './share'
import { formatDuration, zonedToUtc } from './time'
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

/** Départs relevés de la sortie (montre, mode course), sans les corrections. */
function sourceStarts(d: Debrief): number[] {
  return [d.watch ? d.watch.s * 1000 : NaN, d.live ? Date.parse(d.live.startedAt) : NaN].filter(Number.isFinite)
}

/** Départ de la sortie (ms) : corrigé à la main, sinon celui de la montre, sinon du mode course. */
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

export type TimeSource = 'watch' | 'live' | 'edit'

export interface DebriefTimes {
  start: number
  /** Arrivées et départs (ms) par point. */
  arr: Map<string, number>
  dep: Map<string, number>
  /** Origine de l'heure d'arrivée. */
  source: Map<string, TimeSource>
}

/** Heures retenues : corrections, sinon montre, sinon mode course (comme la page assistance). */
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
    }
    const ed = d.edits?.departures?.[p.id]
    const left = ed !== undefined ? (ed ? Date.parse(ed) : NaN) : d.watch?.departures[p.id] !== undefined ? d.watch.departures[p.id] * 1000 : d.live?.departures?.[p.id] ? Date.parse(d.live.departures[p.id]) : NaN
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
