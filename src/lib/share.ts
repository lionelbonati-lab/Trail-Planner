// Lien public pour l'assistance : un instantané du plan (et du suivi en direct),
// lisible sans compte, mis à jour par le propriétaire.
import { assistAllowed, FINISH_ID } from './assist'
import { elevationGain, indexAt } from './gpx'
import { liveStatus } from './live'
import { isFreeStart } from './plan'
import { simplifyRoute, type RoutePoint } from './routeGeo'
import { watchPlan } from './watch'
import { zonedToUtc } from './time'
import type { Athlete, Race, SimResult, Track } from './types'

export interface ShareRow {
  id: string
  name: string
  kind: string
  dist: number
  stopMin: number
  notes: string
  /** Heures ISO (UTC). */
  planned: string
  early: string | null
  late: string | null
  cutoff: string | null
  actual: string | null
  eta: string
  /** Destination du lien GPS : accès assistance s'il est placé, sinon point du parcours. */
  lat?: number
  lon?: number
  /** La destination est un accès assistance placé par le coureur. */
  access?: boolean
  /** Assistance autorisée à ce point. */
  assist?: boolean
  /** Dropbag prévu par l'organisation à ce point. */
  dropbag?: boolean
  /** D+ cumulé depuis le départ jusqu'à ce point (m), absent des anciens partages. */
  up?: number
}

export interface ShareSnapshot {
  owner: string
  updatedAt: string
  raceName: string
  athleteName: string
  timeZone: string
  start: string
  /** Départ officiel (ISO), base des barrières horaires (absent des anciens partages). */
  plannedStart?: string
  totalDist: number
  dPlus: number
  /** Profil simplifié : [distance (m), altitude (m)]. */
  profile: [number, number][]
  /** Tracé simplifié pour la carte : [distance (m), lat, lon] (absent des anciens partages). */
  route?: RoutePoint[]
  live: { startedAt: string; lastUpdate: string | null } | null
  rows: ShareRow[]
  /** Plan compact pour le champ de données Garmin (voir watch.ts). */
  w: string
  /** Code montre si cette course est sur la montre : suivi envoyé par la montre (live/{code}). */
  liveRef: string | null
  /** Code montre court (8 chiffres), s'il existe : la montre peut aussi envoyer son suivi avec lui. */
  liveRefShort?: string | null
  /** Réglages du datafield EndurancePro (document du code montre seulement, voir endurancepro.ts). */
  ep?: string
  /** Envoi de cette course à la montre (ISO) : un relevé antérieur vient d'une autre activité. */
  watchSince?: string
  /** Départ libre : la page assistance recale les heures sur le départ réel (ou sur maintenant). */
  freeStart?: boolean
}

export function buildSnapshot(
  owner: string,
  race: Race,
  athlete: Athlete,
  track: Track,
  sim: SimResult,
  windowOf: (cpId: string) => { early: number; late: number } | null,
): ShareSnapshot {
  const plannedStart = zonedToUtc(race.env.start, race.env.timeZone).getTime()
  const start = race.live ? Date.parse(race.live.startedAt) : plannedStart
  const iso = (s: number) => new Date(start + s * 1000).toISOString()
  const cutoff = (c: string) => (c ? zonedToUtc(c, race.env.timeZone).toISOString() : null)
  const status = race.live
    ? liveStatus(race.live, sim, Date.now(), (s) => (s.cp.cutoff ? zonedToUtc(s.cp.cutoff, race.env.timeZone).getTime() : null))
    : null
  const stride = Math.max(1, Math.floor(track.points.length / 300))
  const passages = Object.values(race.live?.passages ?? {}).sort()
  return {
    owner,
    updatedAt: new Date().toISOString(),
    raceName: race.name,
    athleteName: athlete.name,
    timeZone: race.env.timeZone,
    start: new Date(start).toISOString(),
    plannedStart: new Date(plannedStart).toISOString(),
    totalDist: track.totalDist,
    dPlus: track.dPlus,
    profile: track.points.filter((_, i) => i % stride === 0).map((p) => [Math.round(p.dist), Math.round(p.ele)]),
    route: simplifyRoute(track.points),
    live: race.live ? { startedAt: race.live.startedAt, lastUpdate: passages[passages.length - 1] ?? null } : null,
    w: watchPlan(race, athlete, track, sim),
    ...(isFreeStart(race) ? { freeStart: true } : {}),
    liveRef: athlete.watchId && athlete.watchRaceId === race.id ? athlete.watchId : null,
    liveRefShort: athlete.epCode && athlete.watchRaceId === race.id ? athlete.epCode : null,
    ...(athlete.watchRaceId === race.id && athlete.watchRaceAt ? { watchSince: athlete.watchRaceAt } : {}),
    rows: sim.splits.map((s, i) => {
      const w = windowOf(s.cp.id)
      const row = status?.rows[i]
      return {
        id: s.cp.id,
        name: s.cp.name,
        kind: s.cp.kind,
        dist: s.to,
        stopMin: s.cp.stopMin,
        notes: s.cp.notes,
        planned: iso(s.arrival),
        early: w ? iso(w.early) : null,
        late: w ? iso(w.late) : null,
        cutoff: cutoff(s.cp.cutoff),
        actual: race.live?.passages[s.cp.id] ?? null,
        eta: iso(row?.eta ?? s.arrival),
        ...navTarget(s.cp.access ?? (s.cp.id === FINISH_ID ? race.finishAccess : undefined), track, s.to),
        assist: assistAllowed(s.cp),
        ...(s.cp.dropbag ? { dropbag: true } : {}),
        up: Math.round(elevationGain(track.points, 0, s.to).dPlus),
      }
    }),
  }
}

/** Destination du lien GPS d'un point : son accès assistance, sinon le point du parcours. */
function navTarget(access: { lat: number; lon: number } | undefined, track: Track, dist: number) {
  const r5 = (x: number) => Math.round(x * 1e5) / 1e5
  if (access) return { lat: r5(access.lat), lon: r5(access.lon), access: true }
  const p = track.points[indexAt(track.points, dist)]
  return { lat: r5(p.lat), lon: r5(p.lon), access: false }
}

export function shareUrl(shareId: string): string {
  return `${window.location.origin}${window.location.pathname}#/share/${shareId}`
}

/**
 * Heure de passage (ms) à une distance quelconque du parcours, pour la page assistance : entre les
 * deux points qui l'encadrent (départ compris), au prorata du temps prévu (courbe du plan si on l'a,
 * sinon de la distance), appliqué aux heures réelles ou estimées de ces deux points.
 */
export function timeAtDist(
  rows: Pick<ShareRow, 'dist' | 'planned' | 'actual' | 'eta'>[],
  plannedStart: string,
  realStart: number,
  d: number,
  plannedAt?: (d: number) => number,
): number {
  const p0 = Date.parse(plannedStart)
  const nodes = [{ dist: 0, plan: p0, real: realStart }, ...rows.map((r) => ({ dist: r.dist, plan: Date.parse(r.planned), real: Date.parse(r.actual ?? r.eta) }))]
  let i = 0
  while (i < nodes.length - 2 && nodes[i + 1].dist < d) i++
  const a = nodes[i]
  const b = nodes[Math.min(i + 1, nodes.length - 1)]
  if (b === a || b.dist <= a.dist) return a.real
  const raw = plannedAt && b.plan > a.plan ? (p0 + plannedAt(d) * 1000 - a.plan) / (b.plan - a.plan) : (d - a.dist) / (b.dist - a.dist)
  const f = Math.max(0, Math.min(1, raw))
  return a.real + f * (b.real - a.real)
}
