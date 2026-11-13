// Tout ce qui dépend de Firebase (authentification, Firestore, liens de partage).
// Ce module est chargé à la demande pour alléger le premier affichage.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  deleteUser,
  getAuth,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  reauthenticateWithPopup,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import {
  clearIndexedDbPersistence,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  terminate,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import { gunzipBase64, gzipBase64 } from './compress'
import { normalizeAthlete, normalizeRace } from './defaults'
import { decodeFromFirestore, encodeForFirestore } from './firestoreCodec'
import type { ShareSnapshot } from './share'
import type { WatchReport } from './watchLive'
import type { Store } from './storage'
import type { Athlete, Race } from './types'

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
export const db: Firestore | null = app
  ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
  : null

/** Taille max d'un morceau de GPX compressé (Firestore limite un document à 1 Mio). */
const CHUNK = 700_000

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
  const savedChunks = new Map<string, number>()

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
    savedChunks.set(id, meta.gpxChunks ?? 1)
    const { gpxChunks: _ignored, ...rest } = meta
    return normalizeRace({ ...rest, gpxText })
  }

  return {
    kind: 'cloud',
    async loadAthlete() {
      const snap = await getDoc(userDoc)
      const d = snap.data()
      return normalizeAthlete(d ? { ...decodeFromFirestore<Partial<Athlete>>(d.athlete), updatedAt: d.updatedAt } : null)
    },
    async saveAthlete(a) {
      const batch = writeBatch(fs)
      // Document entier (pas de fusion) : un élément supprimé l'est aussi en ligne.
      batch.set(userDoc, { athlete: encodeForFirestore(a), updatedAt: a.updatedAt ?? new Date().toISOString() })
      await batch.commit()
    },
    async listRaces() {
      const snap = await getDocs(racesCol)
      const races = await Promise.all(snap.docs.map((d) => loadRace(d.id, decodeFromFirestore<RaceMeta>(d.data()))))
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
            h.athlete(normalizeAthlete({ ...decodeFromFirestore<Partial<Athlete>>(d.athlete), updatedAt: d.updatedAt }))
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
              loadRace(ch.doc.id, decodeFromFirestore<RaceMeta>(ch.doc.data())).then(h.raceUpsert, (e) => h.error(e))
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
        batch.set(raceRef, encodeForFirestore({ ...rest, gpxChunks: n }) as Record<string, unknown>)
        savedChunks.set(r.id, n)
        await batch.commit()
        savedGpx.set(r.id, gpxText)
      } else {
        // Document entier (pas de fusion) : un passage effacé l'est aussi en ligne.
        batch.set(raceRef, encodeForFirestore({ ...rest, gpxChunks: savedChunks.get(r.id) ?? 1 }) as Record<string, unknown>)
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


// ---------------------------------------------------------------------------
// Authentification

const EMAIL_KEY = 'tp.emailForSignIn'

export function onUser(cb: (u: User | null) => void): () => void {
  if (!auth) {
    cb(null)
    return () => {}
  }
  return onAuthStateChanged(auth, cb)
}

/** Termine une connexion par lien e-mail si la page a été ouverte depuis ce lien. */
export async function completeEmailLink(): Promise<boolean> {
  if (!auth || !isSignInWithEmailLink(auth, window.location.href)) return false
  const email = localStorage.getItem(EMAIL_KEY) ?? prompt('Confirme ton e-mail') ?? ''
  await signInWithEmailLink(auth, email, window.location.href)
  localStorage.removeItem(EMAIL_KEY)
  window.history.replaceState(null, '', window.location.pathname + '#/races')
  return true
}

export async function signInGoogle() {
  if (auth) await signInWithPopup(auth, new GoogleAuthProvider())
}

export async function sendEmailLink(email: string) {
  if (!auth) return
  await sendSignInLinkToEmail(auth, email, { url: window.location.origin + window.location.pathname, handleCodeInApp: true })
  localStorage.setItem(EMAIL_KEY, email)
}

/** Supprime les données puis le compte (reconnexion Google si Firebase l'exige). */
export async function deleteAccount(user: User): Promise<'deleted' | 'data-only'> {
  await cloudStore(user).deleteAll?.()
  try {
    await deleteUser(user)
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/requires-recent-login') throw e
    if (!user.providerData.some((p) => p.providerId === 'google.com')) return 'data-only'
    await reauthenticateWithPopup(user, new GoogleAuthProvider())
    await deleteUser(user)
  }
  return 'deleted'
}

// ---------------------------------------------------------------------------
// Liens d'assistance

export async function publishShare(shareId: string, snap: ShareSnapshot) {
  if (!db) throw new Error('Partage indisponible : Firebase non configuré.')
  await setDoc(doc(db, 'shares', shareId), encodeForFirestore(snap) as Record<string, unknown>)
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
    (d) => cb(d.exists() ? decodeFromFirestore<ShareSnapshot>(d.data()) : null),
    (e) => onError(e),
  )
}

/** Suivi envoyé par la montre (document live/{code montre}). */
export function subscribeLive(code: string, cb: (r: WatchReport | null) => void) {
  if (!db) return () => {}
  return onSnapshot(
    doc(db, 'live', code),
    (d) => cb(d.exists() ? (d.data() as WatchReport) : null),
    () => cb(null),
  )
}
