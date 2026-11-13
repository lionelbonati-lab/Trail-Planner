import { normalizeAthlete, normalizeRace } from './defaults'
import type { Athlete, Race } from './types'

/**
 * Stockage : local (navigateur) par défaut ; Firebase (module cloud.ts, chargé
 * en arrière-plan) dès que l'utilisateur est connecté.
 */
export interface Store {
  kind: 'local' | 'cloud'
  loadAthlete(): Promise<Athlete>
  saveAthlete(a: Athlete): Promise<void>
  listRaces(): Promise<Race[]>
  saveRace(r: Race): Promise<void>
  deleteRace(id: string): Promise<void>
  /** Cloud : supprime toutes les données du compte. */
  deleteAll?(): Promise<void>
  /** Cloud : aucune donnée encore enregistrée pour ce compte. */
  isEmpty?(): Promise<boolean>
  /** Cloud : écoute en temps réel des changements faits sur d'autres appareils. */
  subscribe?(h: SyncHandlers): () => void
}

export type SyncStatus = 'synced' | 'pending' | 'offline'

export interface SyncHandlers {
  athlete(a: Athlete): void
  raceUpsert(r: Race): void
  raceRemoved(id: string): void
  status(s: SyncStatus): void
  error(e: Error): void
}

const LS_ATHLETE = 'tp.athlete'
const LS_RACES = 'tp.races'

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.warn('Stockage local indisponible', e)
  }
}

/** Un profil athlète a-t-il déjà été enregistré dans ce navigateur ? */
export function hasLocalAthlete(): boolean {
  try {
    return localStorage.getItem(LS_ATHLETE) !== null
  } catch {
    return false
  }
}

/** Nombre de courses enregistrées dans ce navigateur hors compte. */
export function localRaceCount(): number {
  return lsGet<Race[]>(LS_RACES, []).length
}

/** Efface les données hors compte de ce navigateur. */
export function clearLocalData() {
  try {
    localStorage.removeItem(LS_ATHLETE)
    localStorage.removeItem(LS_RACES)
  } catch {
    /* stockage indisponible */
  }
}

export const localStore: Store = {
  kind: 'local',
  async loadAthlete() {
    return normalizeAthlete(lsGet<Partial<Athlete> | null>(LS_ATHLETE, null))
  },
  async saveAthlete(a) {
    lsSet(LS_ATHLETE, a)
  },
  async listRaces() {
    return lsGet<Race[]>(LS_RACES, []).map(normalizeRace)
  },
  async saveRace(r) {
    const all = lsGet<Race[]>(LS_RACES, [])
    const i = all.findIndex((x) => x.id === r.id)
    if (i >= 0) all[i] = r
    else all.push(r)
    lsSet(LS_RACES, all)
  },
  async deleteRace(id) {
    lsSet(
      LS_RACES,
      lsGet<Race[]>(LS_RACES, []).filter((x) => x.id !== id),
    )
  },
}

/** Sauvegarde complète en JSON (pour export / import manuel). */
export interface Backup {
  version: 1
  athlete: Athlete
  races: Race[]
}
