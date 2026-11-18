// Message de l'assistance vers la montre : écrit par la page assistance (sans compte) dans
// msg/{code montre}, lu par le champ de données toutes les 5 minutes (tâche de fond Garmin), affiché
// en plein écran ; la montre note « reçu » (got) puis « lu » (read, tour Lap) dans le même document.

/** Longueur maximale d'un message (écran de montre). */
export const MESSAGE_MAX = 60

/** Délai minimal entre deux messages (s), aussi imposé par les règles Firestore. */
export const MESSAGE_GAP_S = 60

/** Au-delà, la montre ignore un message (vieux message retrouvé au démarrage d'une activité) (s). */
export const MESSAGE_STALE_S = 3600

/** Messages tout prêts, lisibles d'un coup d'œil. */
export const QUICK_MESSAGES = ['On est au ravito', 'Bien joué !']

export interface WatchMessage {
  id: string
  text: string
  /** Envoi (s Unix). */
  t: number
  /** Reçu par la montre (s Unix). */
  got?: number
  /** Lu sur la montre, fermé d'un tour Lap (s Unix). */
  read?: number
}

/**
 * Texte envoyable à la montre : une seule ligne, sans emoji ni caractères que les polices Garmin
 * n'affichent pas (latin étendu gardé : accents, ç, œ…), 60 caractères au plus.
 */
export function cleanMessage(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\u017f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_MAX)
    .trim()
}

/** Identifiant aléatoire d'un message (la montre ne l'affiche qu'une fois). */
export function newMessageId(): string {
  const a = crypto.getRandomValues(new Uint32Array(2))
  return a[0].toString(36) + a[1].toString(36)
}

/**
 * Dernier message parmi les documents des codes montre (long et court), avec les accusés de la montre
 * pour ce message (la montre n'écrit que dans le document de son code).
 */
export function latestMessage(docs: (WatchMessage | null)[]): WatchMessage | null {
  const all = docs.filter((d): d is WatchMessage => !!d && typeof d.id === 'string' && typeof d.t === 'number')
  if (!all.length) return null
  const last = all.reduce((a, b) => (b.t > a.t ? b : a))
  const same = all.filter((d) => d.id === last.id)
  const got = same.map((d) => d.got).filter((x): x is number => typeof x === 'number' && x > 0)
  const read = same.map((d) => d.read).filter((x): x is number => typeof x === 'number' && x > 0)
  return { id: last.id, text: last.text, t: last.t, ...(got.length ? { got: Math.min(...got) } : {}), ...(read.length ? { read: Math.min(...read) } : {}) }
}

/** Secondes à attendre avant de pouvoir envoyer un nouveau message (0 : possible maintenant). */
export function messageWait(last: WatchMessage | null, nowSec: number): number {
  return last ? Math.max(0, Math.ceil(last.t + MESSAGE_GAP_S - nowSec)) : 0
}
