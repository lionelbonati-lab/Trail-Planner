// Sortie libre : activité faite sans course sur la montre (champ Trail Planner sans plan). La montre
// envoie quand même ses relevés (live/{code}, `v` = 2) : distance de l'activité, D+ (« a=… » dans `p`),
// position (masquée près du départ si le coureur l'a demandé) et batterie. Le serveur garde la trace
// (live/{code}/track/current) ; le lien permanent du coureur montre carte, trace et chiffres.
import type { RoutePoint } from './routeGeo'
import { RUNNER_RECENT_MS } from './share'
import type { WatchReport } from './watchLive'

/** Version d'un relevé de sortie libre. */
export const FREE_RUN_V = 2
/** Rayon autour du départ où la position n'est pas envoyée (m), réglage par défaut. */
export const FREE_HIDE_M = 500
/** Relevé de moins de 20 min : sortie en cours. */
export const FREE_LIVE_S = 20 * 60
/** Deux départs à moins de 30 min : la même sortie (trace continuée). */
const SAME_RUN_S = 30 * 60
/** Points gardés au plus dans la trace (un relevé toutes les 5 min : plus de 160 h). */
const TRACK_MAX = 2000

export function isFreeRun(r: WatchReport | null | undefined): r is WatchReport {
  return !!r && r.v === FREE_RUN_V
}

/** Sortie libre montrée par le lien permanent : en cours ou finie depuis moins de 12 h. */
export function freeRunShown(r: WatchReport | null, nowMs: number): r is WatchReport {
  return isFreeRun(r) && r.s > 0 && r.t * 1000 > nowMs - RUNNER_RECENT_MS
}

/** D+ de l'activité (m), « a=123 » dans `p`. */
export function freeAscent(r: WatchReport): number | null {
  const m = /(?:^|,)a=(\d+)/.exec(r.p ?? '')
  return m ? Number(m[1]) : null
}

export interface FreeStats {
  /** Temps écoulé au dernier relevé (s). */
  elapsed: number
  dist: number
  ascent: number | null
  /** Allure moyenne (s/km), si assez de distance. */
  pace: number | null
  bat: number | null
  /** Ancienneté du relevé (s). */
  age: number
  live: boolean
}

export function freeStats(r: WatchReport, nowMs: number): FreeStats {
  const elapsed = Math.max(0, r.t - r.s)
  const age = Math.max(0, Math.round(nowMs / 1000 - r.t))
  return {
    elapsed,
    dist: r.d,
    ascent: freeAscent(r),
    pace: r.d >= 200 ? (elapsed / r.d) * 1000 : null,
    bat: typeof r.bat === 'number' ? r.bat : null,
    age,
    live: age < FREE_LIVE_S,
  }
}

/** Allure « 5:42 /km ». */
export function paceText(secPerKm: number): string {
  const s = Math.round(secPerKm)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`
}

export interface TrackPoint {
  t: number
  lat: number
  lon: number
  /** Distance de l'activité à ce relevé (m). */
  d: number
}

export interface TrackDoc {
  /** Départ de la sortie (s Unix). */
  s: number
  pts: TrackPoint[]
}

/**
 * Trace d'une sortie libre après un relevé (serveur) : point ajouté s'il a une position, trace
 * recommencée pour une nouvelle sortie. Null : rien à écrire.
 */
export function appendTrack(cur: TrackDoc | null, r: WatchReport): TrackDoc | null {
  if (!isFreeRun(r) || typeof r.lat !== 'number' || typeof r.lon !== 'number' || !(r.s > 0)) return null
  const same = !!cur && Math.abs(cur.s - r.s) < SAME_RUN_S
  const pts = same ? (cur!.pts ?? []) : []
  if (pts.some((p) => p.t === r.t)) return null
  const next = [...pts, { t: r.t, lat: r.lat, lon: r.lon, d: r.d }].sort((a, b) => a.t - b.t).slice(-TRACK_MAX)
  return { s: same ? cur!.s : r.s, pts: next }
}

/**
 * Trace à dessiner : celle de cette sortie (départ à moins de 30 min) et la dernière position si elle
 * est plus récente, au format du tracé des cartes ([distance, lat, lon]).
 */
export function trackRoute(tracks: (TrackDoc | null)[], r: WatchReport): RoutePoint[] {
  const pts = new Map<number, TrackPoint>()
  for (const tr of tracks) {
    if (!tr || Math.abs(tr.s - r.s) >= SAME_RUN_S) continue
    for (const p of tr.pts ?? []) pts.set(p.t, p)
  }
  if (typeof r.lat === 'number' && typeof r.lon === 'number') pts.set(r.t, { t: r.t, lat: r.lat, lon: r.lon, d: r.d })
  return [...pts.values()].sort((a, b) => a.t - b.t).map((p) => [p.d, p.lat, p.lon])
}
