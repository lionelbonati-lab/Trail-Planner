// Lien public pour l'assistance : un instantané du plan (et du suivi en direct),
// lisible sans compte, mis à jour par le propriétaire.
import { deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { liveStatus } from './live'
import { db } from './storage'
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
}

export interface ShareSnapshot {
  owner: string
  updatedAt: string
  raceName: string
  athleteName: string
  timeZone: string
  start: string
  totalDist: number
  dPlus: number
  /** Profil simplifié : [distance (m), altitude (m)]. */
  profile: [number, number][]
  live: { startedAt: string; lastUpdate: string | null } | null
  rows: ShareRow[]
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
    totalDist: track.totalDist,
    dPlus: track.dPlus,
    profile: track.points.filter((_, i) => i % stride === 0).map((p) => [Math.round(p.dist), Math.round(p.ele)]),
    live: race.live ? { startedAt: race.live.startedAt, lastUpdate: passages[passages.length - 1] ?? null } : null,
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
      }
    }),
  }
}

/** Firestore refuse les valeurs undefined : on nettoie par sérialisation. */
const clean = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

export async function publishShare(shareId: string, snap: ShareSnapshot) {
  if (!db) throw new Error('Partage indisponible : Firebase non configuré.')
  await setDoc(doc(db, 'shares', shareId), clean(snap))
}

export async function deleteShare(shareId: string) {
  if (!db) return
  await deleteDoc(doc(db, 'shares', shareId))
}

export function subscribeShare(shareId: string, cb: (s: ShareSnapshot | null) => void, onError: (e: Error) => void) {
  if (!db) {
    onError(new Error('Partage indisponible.'))
    return () => {}
  }
  return onSnapshot(
    doc(db, 'shares', shareId),
    (d) => cb(d.exists() ? (d.data() as ShareSnapshot) : null),
    (e) => onError(e),
  )
}

export function shareUrl(shareId: string): string {
  return `${window.location.origin}${window.location.pathname}#/share/${shareId}`
}
