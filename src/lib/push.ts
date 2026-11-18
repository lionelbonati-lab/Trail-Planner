// Notifications push (Firebase Cloud Messaging) : envoyées par le serveur (functions/), même page ou
// appli fermée. Chaque téléphone abonné laisse son jeton dans Firestore : push/{…} pour un lien
// (assistance « share:<id> », lien permanent « suivi:<code> »), users/{uid}/push/{…} pour le coureur.
// Module chargé à la demande (Firebase Messaging).
import { deleteDoc, doc, setDoc } from 'firebase/firestore'
import { app, auth, db } from './cloud'
import { OWNER_PUSH, pushFlag, setPushFlag } from './notify'
import { tokenKey } from './pushRules'

const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined

/** Push proposé : clé Web Push configurée, appli publiée (service worker) et navigateur compatible. */
export function pushAvailable(): boolean {
  return (
    !!VAPID &&
    !!app &&
    !!db &&
    import.meta.env.PROD &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Jeton de ce téléphone (autorisation demandée si besoin). */
async function pushToken(ask: boolean): Promise<string> {
  if (!pushAvailable()) throw new Error('Notifications indisponibles sur ce navigateur.')
  if (Notification.permission !== 'granted') {
    if (!ask || (await Notification.requestPermission()) !== 'granted') throw new Error('Notifications refusées pour ce site.')
  }
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging')
  if (!(await isSupported())) throw new Error('Notifications indisponibles sur ce navigateur.')
  // Service worker de l'appli (installé au premier chargement) : sans lui, pas de notification page fermée.
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Appli pas encore installée sur ce téléphone : recharge la page puis réessaie.')), 10000)),
  ])
  try {
    return await getToken(getMessaging(app!), { vapidKey: VAPID, serviceWorkerRegistration: reg })
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    throw new Error(
      code === 'messaging/permission-blocked' || code === 'messaging/permission-default'
        ? 'Notifications bloquées pour ce site : autorise-les dans les réglages du navigateur.'
        : 'Abonnement impossible pour l’instant (réseau ?) : réessaie plus tard.',
    )
  }
}

const subId = (token: string, target: string) => `${tokenKey(token)}-${tokenKey(target)}`

/** Abonne ce téléphone aux notifications d'un lien (`target` : « share:<id> » ou « suivi:<code> »). */
export async function subscribePush(target: string): Promise<void> {
  const token = await pushToken(true)
  const ref = target.slice(target.indexOf(':') + 1)
  await setDoc(doc(db!, 'push', subId(token, target)), { token, target, ref, at: Date.now() })
  setPushFlag(target, token)
}

export async function unsubscribePush(target: string): Promise<void> {
  const token = pushFlag(target)
  setPushFlag(target, null)
  if (token && db) await deleteDoc(doc(db, 'push', subId(token, target))).catch(() => undefined)
}

/** Jeton renouvelé par le navigateur : abonnement déplacé sur le nouveau (sans rien demander). */
export async function refreshPush(target: string): Promise<void> {
  const old = pushFlag(target)
  if (!old || !pushAvailable() || Notification.permission !== 'granted') return
  const token = await pushToken(false)
  if (token === old) return
  await subscribePush(target)
  await deleteDoc(doc(db!, 'push', subId(old, target))).catch(() => undefined)
}

/** Coureur connecté : « Debrief prêt » envoyé sur ce téléphone par le serveur. */
export async function setOwnerPush(on: boolean): Promise<boolean> {
  const uid = auth?.currentUser?.uid
  const prev = pushFlag(OWNER_PUSH)
  const [prevUid, prevToken] = prev ? prev.split('|') : []
  const drop = () => (prev && db ? deleteDoc(doc(db, 'users', prevUid, 'push', tokenKey(prevToken))).catch(() => undefined) : undefined)
  if (on && uid && pushAvailable()) {
    const token = await pushToken(true)
    if (prevUid === uid && prevToken === token) return true
    await setDoc(doc(db!, 'users', uid, 'push', tokenKey(token)), { token, at: Date.now() })
    await drop()
    setPushFlag(OWNER_PUSH, `${uid}|${token}`)
    return true
  }
  await drop()
  setPushFlag(OWNER_PUSH, null)
  return false
}
