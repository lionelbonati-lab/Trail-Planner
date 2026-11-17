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
