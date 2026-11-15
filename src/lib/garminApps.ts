// Applications montre Garmin (Connect IQ) liées à Trail Planner. Le contenu affiché vient de
// public/montre/applications.md ; la liste ci-dessous n'est qu'un secours (fichier injoignable).

export interface WatchApp {
  name: string
  kind: string
  what: string
  storeUrl: string | null
  /** Guide d'installation (par câble tant qu'elle n'est pas sur le Store). */
  guideUrl: string
}

export const REPO_URL = 'https://github.com/lionelbonati-lab/Trail-Planner'

/**
 * Textes, liens du Store et captures d'écran du cadre « Applications Garmin » : fichier Markdown du
 * dépôt, modifiable directement sur GitHub (voir son en-tête). WATCH_APPS ne sert qu'en secours.
 */
export const APPS_DOC_PATH = 'montre/applications.md'
export const APPS_DOC_EDIT_URL = `${REPO_URL}/edit/main/public/${APPS_DOC_PATH}`

export const WATCH_APPS: WatchApp[] = [
  {
    name: 'Trail Planner',
    kind: 'Champ de données',
    what:
      'Écart au plan à l’endroit où tu es, prochain point (heure prévue et estimée), barrières horaires, rappels nutrition ; bouton Lap = passage ; passages et position envoyés à ton assistance.',
    storeUrl: null,
    guideUrl: `${REPO_URL}/blob/main/garmin/README.md`,
  },
  {
    name: 'EndurancePro',
    kind: 'Champ de données',
    what:
      'Allure cible colorée avec alarme (allure, zone ou % de VC), vitesse ascensionnelle par zone, équivalences montée et descente ; reprend ta VC, tes zones et la zone de la séance envoyée.',
    storeUrl: null,
    guideUrl: `${REPO_URL}/blob/main/garmin/README.md`,
  },
]
