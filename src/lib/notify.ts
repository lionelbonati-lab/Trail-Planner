// Notifications système de l'appli et de la page assistance.

/** Notification système (via le service worker si possible : seule voie sur Android). */
export async function showNotice(title: string, body: string, tag: string, url = location.href) {
  const opts = { body, tag, icon: './icon-192.png', badge: './icon-192.png', data: { url }, vibrate: [200, 100, 200] } as NotificationOptions
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, opts)
      return
    }
  } catch {
    /* repli ci-dessous */
  }
  try {
    new Notification(title, opts)
  } catch {
    /* notifications indisponibles */
  }
}

// --- Debrief prêt : notification à l'arrivée (réglage propre à cet appareil) ----------

const DEBRIEF_FLAG = 'tp-debrief-notify'
const NOTIFIED = 'tp-debrief-notified'

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* stockage indisponible */
  }
}

/** Notification « debrief prêt » activée sur cet appareil (et autorisée par le navigateur). */
export function debriefNotifyOn(): boolean {
  return notifySupported() && Notification.permission === 'granted' && read(DEBRIEF_FLAG) === '1'
}

export async function setDebriefNotify(on: boolean): Promise<boolean> {
  if (!on || !notifySupported()) {
    write(DEBRIEF_FLAG, null)
    return false
  }
  const p = await Notification.requestPermission()
  write(DEBRIEF_FLAG, p === 'granted' ? '1' : null)
  return p === 'granted'
}

/** Debriefs déjà annoncés par une notification sur cet appareil. */
export function notifiedDebriefs(): string[] {
  try {
    const v = JSON.parse(read(NOTIFIED) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function rememberNotified(ids: string[]) {
  write(NOTIFIED, JSON.stringify([...new Set([...notifiedDebriefs(), ...ids])].slice(-50)))
}

// --- Notifications push (serveur) : abonnements de cet appareil (voir push.ts) ------------

/** Abonnement du coureur (« uid|jeton ») : debrief prêt envoyé par le serveur. */
export const OWNER_PUSH = 'owner'

/** Après « Me prévenir » : durée du message « une notification de test arrive… » dans la page. */
export const TEST_NOTICE_MS = 60_000

/** Jeton de l'abonnement de cet appareil à une cible (« share:<id> », « suivi:<code> », OWNER_PUSH), ou null. */
export function pushFlag(target: string): string | null {
  return read(`tp-push-${target}`)
}

export function setPushFlag(target: string, value: string | null) {
  write(`tp-push-${target}`, value)
}

/** Debrief prêt envoyé par le serveur sur cet appareil : la notification locale de l'appli n'est plus utile. */
export function ownerPushOn(): boolean {
  return notifySupported() && Notification.permission === 'granted' && !!pushFlag(OWNER_PUSH)
}
