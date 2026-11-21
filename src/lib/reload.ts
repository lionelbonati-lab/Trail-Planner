// Rechargement de la page quand un fichier de code a disparu (nouvelle version déployée).

const RELOAD_KEY = 'tp-reload-at'

/** Erreur de chargement d'un fichier de code découpé (nom changé par un nouveau déploiement). */
export function isChunkError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|preload/i.test(m)
}

/** Recharge la page, au plus une fois toutes les 20 s (pas de boucle si le fichier manque vraiment). */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 20000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // Stockage indisponible : on recharge quand même.
  }
  window.location.reload()
  return true
}
