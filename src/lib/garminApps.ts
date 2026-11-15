// Applications montre Garmin (Connect IQ) liées à Trail Planner. Lien du Connect IQ Store : null tant
// que l'application n'y est pas publiée (installation par câble, voir garmin/README.md).

export interface WatchApp {
  name: string
  kind: string
  what: string
  storeUrl: string | null
  /** Guide d'installation (par câble tant qu'elle n'est pas sur le Store). */
  guideUrl: string
}

export const REPO_URL = 'https://github.com/lionelbonati-lab/Trail-Planner'

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
