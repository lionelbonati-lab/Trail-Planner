// Notifications push (Firebase Cloud Messaging), même appli et page fermées :
// - relevé de la montre (live/{code}) : passages aux points, retard sur le plan, barrière menacée ;
// - mode course du téléphone (shares/{id}) : passages notés dans l'appli ;
// - arrivée : « Debrief prêt » pour le coureur ;
// - abonnement (« Me prévenir ») : notification de confirmation, sur le téléphone qui s'abonne.
// Les règles (quoi notifier) sont dans src/lib/pushRules.ts, partagées avec l'appli et testées ;
// ici on lit Firestore, on applique, on envoie.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, type DocumentReference, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { setGlobalOptions } from 'firebase-functions/v2'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { decodeFromFirestore } from '../../src/lib/firestoreCodec'
import { appendTrack, isFreeRun, type TrackDoc } from '../../src/lib/freeRun'
import {
  confirmNotice,
  confirmWanted,
  liveNotices,
  pushTargets,
  runnerDoc,
  targetPath,
  tokenKey,
  watchNotices,
  type Notice,
  type PushState,
  type PushSub,
} from '../../src/lib/pushRules'
import type { ShareSnapshot } from '../../src/lib/share'
import type { WatchReport } from '../../src/lib/watchLive'

// Région : celle de la base Firestore (voir le déploiement, .github/workflows/firebase.yml).
setGlobalOptions({ region: process.env.TP_REGION || 'europe-west1', maxInstances: 5, memory: '256MiB' })

initializeApp()

/** Relevé trop ancien (montre restée sans réseau) : plus la peine de prévenir. */
const STALE_MS = 6 * 3600_000
/** Deux départs à moins de 30 min : la même sortie (debrief déjà annoncé). */
const SAME_RUN_S = 30 * 60

interface Sub {
  token: string
  /** Lien ouvert en touchant la notification, relatif à l'adresse du site (#/share/…). */
  path: string
  /** Document d'abonnement, supprimé si le jeton n'est plus valable. */
  ref: DocumentReference
}

const snapOf = (d: DocumentSnapshot): ShareSnapshot | null => (d.exists ? decodeFromFirestore<ShareSnapshot>(d.data()) : null)

/** Abonnés d'un document de lien (assistance, lien permanent du coureur). */
async function subscribers(db: Firestore, targets: string[]): Promise<Sub[]> {
  const q = await db.collection('push').where('target', 'in', targets).get()
  return q.docs.map((d) => {
    const { token, target } = d.data() as { token: string; target: string }
    return { token, path: targetPath(target), ref: d.ref }
  })
}

/** Téléphones du coureur (debrief prêt). */
async function ownerDevices(db: Firestore, owner: string, courseId: string | undefined): Promise<Sub[]> {
  const q = await db.collection('users').doc(owner).collection('push').get()
  return q.docs.map((d) => ({ token: (d.data() as { token: string }).token, path: `#/debrief/${courseId ?? ''}`, ref: d.ref }))
}

/** Envoi (données seules : le service worker de l'appli affiche la notification). */
async function send(items: Item[]) {
  // Un même téléphone abonné à deux liens de la course (assistance, lien permanent) : une seule notification.
  const seen = new Set<string>()
  const list = items.filter(({ sub, notice }) => {
    const k = `${sub.token}|${notice.tag}`
    if (!sub.token || seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (!list.length) return
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500)
    const res = await getMessaging().sendEach(
      chunk.map(({ sub, notice }) => ({
        token: sub.token,
        data: { title: notice.title, body: notice.body, tag: notice.tag, path: sub.path },
        webpush: { headers: { Urgency: 'high', TTL: '3600' } },
      })),
    )
    // Jeton expiré ou désinstallé : abonnement supprimé.
    await Promise.all(
      res.responses.map((r, j) => {
        const code = r.error?.code ?? ''
        return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token' || code === 'messaging/invalid-argument'
          ? chunk[j].sub.ref.delete().catch(() => undefined)
          : undefined
      }),
    )
  }
}

/**
 * Debrief prêt : une seule annonce par sortie, même si plusieurs liens de la même course voient l'arrivée
 * (lien assistance, lien permanent, mode course publié sur chacun).
 */
async function firstAnnounce(db: Firestore, owner: string, notice: Notice, s: number): Promise<boolean> {
  const ref = db.collection('push_state').doc(`o-${tokenKey(`${owner}|${notice.tag}`)}`)
  return db.runTransaction(async (tx) => {
    const prev = (await tx.get(ref)).data() as { s?: number } | undefined
    if (prev?.s !== undefined && Math.abs(prev.s - s) < SAME_RUN_S) return false
    tx.set(ref, { s })
    return true
  })
}

type Item = { sub: Sub; notice: Notice }

/**
 * Notifications d'un document de lien : calculées dans une transaction sur son état (ce qui a déjà été
 * notifié), à envoyer une fois l'état enregistré.
 */
async function notify(
  db: Firestore,
  shareId: string,
  snap: ShareSnapshot,
  runner: string | null,
  compute: (prev: PushState | null) => { notices: Notice[]; state: PushState } | null,
): Promise<Item[]> {
  const stateRef = db.collection('push_state').doc(shareId)
  const result = await db.runTransaction(async (tx) => {
    const prev = ((await tx.get(stateRef)).data() as PushState | undefined) ?? null
    const r = compute(prev)
    if (r) tx.set(stateRef, r.state)
    return r
  })
  if (!result?.notices.length) return []
  const forHelpers = result.notices.filter((n) => !n.owner)
  const forOwner = result.notices.filter((n) => n.owner)
  const items: Item[] = []
  if (forHelpers.length) {
    const subs = await subscribers(db, pushTargets(shareId, runner))
    for (const notice of forHelpers) for (const sub of subs) items.push({ sub, notice })
  }
  for (const notice of forOwner) {
    if (!snap.owner || !(await firstAnnounce(db, snap.owner, notice, result.state.s))) continue
    for (const sub of await ownerDevices(db, snap.owner, snap.courseId)) items.push({ sub, notice })
  }
  return items
}

/** Sortie libre : position du relevé ajoutée à la trace (live/{code}/track/current, lisible par le lien permanent). */
async function saveTrack(db: Firestore, code: string, report: WatchReport) {
  const ref = db.collection('live').doc(code).collection('track').doc('current')
  await db.runTransaction(async (tx) => {
    const next = appendTrack(((await tx.get(ref)).data() as TrackDoc | undefined) ?? null, report)
    if (next) tx.set(ref, next)
  })
}

/** Relevé de la montre : chaque lien qui suit ce code montre (code long ou court). */
export const onWatchReport = onDocumentWritten('live/{code}', async (event) => {
  const after = event.data?.after.data() as WatchReport | undefined
  if (!after || !(after.s > 0) || !(after.t > 0)) return
  const before = (event.data?.before.data() as WatchReport | undefined) ?? null
  if (before && before.t === after.t && before.p === after.p) return
  const now = Date.now()
  if (after.t * 1000 < now - STALE_MS) return
  const code = event.params.code
  const db = getFirestore()
  // Sortie libre (rien sur la montre) : trace seulement, pas de notification.
  if (isFreeRun(after)) {
    await saveTrack(db, code, after)
    return
  }
  const [long, short] = await Promise.all([
    db.collection('shares').where('liveRef', '==', code).get(),
    db.collection('shares').where('liveRefShort', '==', code).get(),
  ])
  const docs = new Map([...long.docs, ...short.docs].map((d) => [d.id, d]))
  // Lien permanent : le document qu'il montre pour ce relevé (code montre long).
  const shown = new Map<string, string | null>()
  const shownFor = async (watchCode: string) => {
    if (!shown.has(watchCode)) {
      const base = docs.get(watchCode) ?? (await db.collection('shares').doc(watchCode).get())
      shown.set(watchCode, runnerDoc(watchCode, snapOf(base), after, now))
    }
    return shown.get(watchCode)!
  }
  const items: Item[] = []
  for (const [id, d] of docs) {
    const snap = snapOf(d)
    if (!snap?.rows?.length || !snap.w) continue
    const runner = snap.liveRef && (await shownFor(snap.liveRef)) === id ? snap.liveRef : null
    items.push(...(await notify(db, id, snap, runner, (prev) => watchNotices(snap, after, before, prev, now))))
  }
  await send(items)
})

/** Mode course du téléphone : passages notés dans l'appli, publiés avec le lien. */
export const onShareUpdate = onDocumentWritten('shares/{id}', async (event) => {
  const after = event.data?.after
  if (!after?.exists) return
  const snap = snapOf(after)
  if (!snap?.live || !snap.rows?.length) return
  if (Date.parse(snap.live.lastUpdate ?? snap.live.startedAt) < Date.now() - STALE_MS) return
  const before = event.data?.before ? snapOf(event.data.before) : null
  const id = event.params.id
  const db = getFirestore()
  // Lien permanent : le document du code montre ou un document <code>-<id> qu'il montre en ce moment.
  let runner: string | null = null
  if (snap.liveRef && (id === snap.liveRef || id.startsWith(`${snap.liveRef}-`))) {
    const base = id === snap.liveRef ? after : await db.collection('shares').doc(snap.liveRef).get()
    const report = ((await db.collection('live').doc(snap.liveRef).get()).data() as WatchReport | undefined) ?? null
    runner = runnerDoc(snap.liveRef, snapOf(base), report, Date.now()) === id ? snap.liveRef : null
  }
  await send(await notify(db, id, snap, runner, (prev) => liveNotices(before, snap, prev)))
})

const subOf = (d: { data: () => unknown } | undefined): PushSub | null => (d?.data() as PushSub | undefined) ?? null

/** « Me prévenir » de la page assistance ou du lien permanent : confirmation sur ce téléphone. */
export const onPushSubscribe = onDocumentWritten('push/{id}', async (event) => {
  const after = subOf(event.data?.after)
  if (!after?.target || !confirmWanted(subOf(event.data?.before), after)) return
  const db = getFirestore()
  const base = await db.collection('shares').doc(after.target.slice(after.target.indexOf(':') + 1)).get()
  const sub = { token: after.token, path: targetPath(after.target), ref: db.collection('push').doc(event.params.id) }
  await send([{ sub, notice: confirmNotice(after.target, snapOf(base)) }])
})

/** « Me prévenir à l'arrivée » du coureur connecté : confirmation sur ce téléphone. */
export const onOwnerPushSubscribe = onDocumentWritten('users/{uid}/push/{id}', async (event) => {
  const after = subOf(event.data?.after)
  if (!after || !confirmWanted(subOf(event.data?.before), after)) return
  const ref = getFirestore().collection('users').doc(event.params.uid).collection('push').doc(event.params.id)
  await send([{ sub: { token: after.token, path: '', ref }, notice: confirmNotice(null, null) }])
})
