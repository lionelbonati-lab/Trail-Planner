import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, signOut, type Auth, type User } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  clearIndexedDbPersistence,
  initializeFirestore,
  terminate,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import { normalizeAthlete, normalizeRace } from './defaults'
import type { Athlete, Race } from './types'

/**
 * Stockage : local (navigateur) par défaut ; Firebase (Firestore) dès que la
 * configuration VITE_FIREBASE_* est définie et que l'utilisateur est connecté.
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

// ---------------------------------------------------------------------------
// Firebase

const env = import.meta.env
// Configuration web publique du projet Firebase (pas un secret : l'accès aux
// données est protégé par les règles Firestore). Surchargeable via VITE_FIREBASE_*.
const firebaseConfig = {
  apiKey: (env.VITE_FIREBASE_API_KEY as string | undefined) || 'AIzaSyBMLeZ1honHPTemyPvqv4XWKQkJsBMb6AM',
  authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || 'trail-planner-814f6.firebaseapp.com',
  projectId: (env.VITE_FIREBASE_PROJECT_ID as string | undefined) || 'trail-planner-814f6',
  appId: (env.VITE_FIREBASE_APP_ID as string | undefined) || '1:923627677636:web:266ccd39d9ed69d2c1a691',
}

const app: FirebaseApp | null =
  firebaseConfig.apiKey && firebaseConfig.projectId ? initializeApp(firebaseConfig) : null

export const auth: Auth | null = app ? getAuth(app) : null
// Cache local persistant : les données synchronisées restent consultables hors ligne.
const db: Firestore | null = app
  ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
  : null

/** Taille max d'un morceau de GPX compressé (Firestore limite un document à 1 Mio). */
const CHUNK = 700_000

export async function gzipBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

export async function gunzipBase64(b64: string): Promise<string> {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

type RaceMeta = Omit<Race, 'gpxText'> & { gpxChunks: number }

/**
 * Organisation Firestore :
 *   users/{uid}                         → profil athlète
 *   users/{uid}/races/{raceId}          → course (sans le GPX)
 *   users/{uid}/races/{raceId}/gpx/{n}  → GPX compressé (gzip + base64), en morceaux
 */
export function cloudStore(user: User): Store {
  if (!db) throw new Error('Firebase non configuré')
  const fs = db
  const userDoc = doc(fs, 'users', user.uid)
  const racesCol = collection(fs, 'users', user.uid, 'races')
  const gpxCol = (raceId: string) => collection(fs, 'users', user.uid, 'races', raceId, 'gpx')
  // Évite de réécrire (et de relire) le GPX à chaque modification du plan.
  const savedGpx = new Map<string, string>()

  const loadRace = async (id: string, meta: RaceMeta): Promise<Race> => {
    let gpxText = savedGpx.get(id)
    if (gpxText === undefined) {
      const parts = await getDocs(gpxCol(id))
      const b64 = parts.docs
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map((p) => p.data().data as string)
        .join('')
      gpxText = b64 ? await gunzipBase64(b64) : ''
      savedGpx.set(id, gpxText)
    }
    const { gpxChunks: _ignored, ...rest } = meta
    return normalizeRace({ ...rest, gpxText })
  }

  return {
    kind: 'cloud',
    async loadAthlete() {
      const snap = await getDoc(userDoc)
      const d = snap.data()
      return normalizeAthlete(d ? { ...(d.athlete as Partial<Athlete>), updatedAt: d.updatedAt } : null)
    },
    async saveAthlete(a) {
      const batch = writeBatch(fs)
      batch.set(userDoc, { athlete: a, updatedAt: a.updatedAt ?? new Date().toISOString() }, { merge: true })
      await batch.commit()
    },
    async listRaces() {
      const snap = await getDocs(racesCol)
      const races = await Promise.all(snap.docs.map((d) => loadRace(d.id, d.data() as RaceMeta)))
      return races.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async isEmpty() {
      const [u, r] = await Promise.all([getDoc(userDoc), getDocs(racesCol)])
      return !u.exists() && r.empty
    },
    subscribe(h) {
      let usersPending = false
      let racesPending = false
      let fromCache = false
      const emit = () => h.status(usersPending || racesPending ? 'pending' : fromCache ? 'offline' : 'synced')
      const unUser = onSnapshot(
        userDoc,
        { includeMetadataChanges: true },
        (snap) => {
          usersPending = snap.metadata.hasPendingWrites
          emit()
          // Nos propres écritures en attente ne sont pas des changements distants.
          if (!snap.metadata.hasPendingWrites && snap.exists()) {
            const d = snap.data()
            h.athlete(normalizeAthlete({ ...(d.athlete as Partial<Athlete>), updatedAt: d.updatedAt }))
          }
        },
        (e) => h.error(e),
      )
      const unRaces = onSnapshot(
        racesCol,
        { includeMetadataChanges: true },
        (snap) => {
          racesPending = snap.metadata.hasPendingWrites
          fromCache = snap.metadata.fromCache
          emit()
          for (const ch of snap.docChanges()) {
            if (ch.type === 'removed') {
              savedGpx.delete(ch.doc.id)
              h.raceRemoved(ch.doc.id)
            } else if (!ch.doc.metadata.hasPendingWrites) {
              loadRace(ch.doc.id, ch.doc.data() as RaceMeta).then(h.raceUpsert, (e) => h.error(e))
            }
          }
        },
        (e) => h.error(e),
      )
      return () => {
        unUser()
        unRaces()
      }
    },
    async saveRace(r) {
      const { gpxText, ...rest } = r
      const batch = writeBatch(fs)
      const raceRef = doc(racesCol, r.id)
      if (savedGpx.get(r.id) !== gpxText) {
        const b64 = await gzipBase64(gpxText)
        const n = Math.max(1, Math.ceil(b64.length / CHUNK))
        const old = await getDocs(gpxCol(r.id))
        old.docs.forEach((d) => {
          if (Number(d.id) >= n) batch.delete(d.ref)
        })
        for (let i = 0; i < n; i++) {
          batch.set(doc(gpxCol(r.id), String(i)), { data: b64.slice(i * CHUNK, (i + 1) * CHUNK) })
        }
        batch.set(raceRef, { ...rest, gpxChunks: n })
        await batch.commit()
        savedGpx.set(r.id, gpxText)
      } else {
        batch.set(raceRef, rest, { merge: true })
        await batch.commit()
      }
    },
    async deleteRace(id) {
      const parts = await getDocs(gpxCol(id))
      const batch = writeBatch(fs)
      parts.docs.forEach((d) => batch.delete(d.ref))
      batch.delete(doc(racesCol, id))
      await batch.commit()
      savedGpx.delete(id)
    },
    async deleteAll() {
      const races = await getDocs(racesCol)
      for (const r of races.docs) await this.deleteRace(r.id)
      const batch = writeBatch(fs)
      batch.delete(userDoc)
      await batch.commit()
    },
  }
}

/**
 * Déconnexion « appareil partagé » : efface aussi le cache Firestore local,
 * pour que la personne suivante ne puisse pas voir les données du compte.
 */
export async function signOutAndClear() {
  if (auth) await signOut(auth)
  if (db) {
    await terminate(db)
    await clearIndexedDbPersistence(db).catch(() => undefined)
  }
  window.location.reload()
}

/** Sauvegarde complète en JSON (pour export / import manuel). */
export interface Backup {
  version: 1
  athlete: Athlete
  races: Race[]
}
