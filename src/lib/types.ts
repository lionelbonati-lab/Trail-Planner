// Types partagés de Trail Planner.

/** Point de la trace GPX, rééchantillonné et lissé. */
export interface TrackPoint {
  lat: number
  lon: number
  /** Altitude lissée (m). */
  ele: number
  /** Distance cumulée depuis le départ (m). */
  dist: number
}

export interface GpxWaypoint {
  name: string
  lat: number
  lon: number
  /** Distance projetée sur la trace (m). */
  dist: number
}

export interface Track {
  name: string
  points: TrackPoint[]
  waypoints: GpxWaypoint[]
  totalDist: number
  dPlus: number
  dMinus: number
}

/** Vitesse ascensionnelle (m/h) pour une pente donnée (%). */
export interface VamPoint {
  grade: number
  vam: number
}

/** Coefficient de vitesse en descente par rapport au plat, pour une pente donnée (%). */
export interface DescentPoint {
  grade: number
  factor: number
}

export type DurabilityMode = 'log' | 'linear'

export interface Durability {
  mode: DurabilityMode
  /** Mode log : % de VC tenable sur 1 h (ex. 0.95). */
  pct1h: number
  /** Mode log : pente de la courbe, perte de %VC par unité de ln(t). */
  k: number
  /** Mode linéaire : % de VC de départ (ex. 0.80). */
  basePct: number
  /** Mode linéaire : heure à partir de laquelle la perte commence. */
  onsetH: number
  /** Mode linéaire : perte de %VC par heure (ex. 0.015). */
  lossPerH: number
  /** Plancher de %VC (on ne descend jamais en dessous). */
  minPct: number
}

export interface Athlete {
  name: string
  /** Vitesse critique (m/s). */
  cs: number
  /** D' (m). */
  dPrime: number
  /** Pente (%) au-delà de laquelle on passe en marche/VAM. */
  walkThreshold: number
  vam: VamPoint[]
  descent: DescentPoint[]
  durability: Durability
  /** Historique des tests de VC. */
  history: CsTestRecord[]
  /** Activités analysées (courses passées, prévu vs réalisé). */
  activities: ActivityRecord[]
  /** Produits de nutrition habituels. */
  products: Product[]
  /** Zones d'entraînement en fraction de VC (comme celles de ton entraîneur). */
  zones: TrainingZone[]
  /** Résultats des tests VC (3′, 7′, 12′…), faits des jours différents. */
  csTrials: CsTrial[]
  /** Poids corporel (kg), pour le poids du sac au prorata. */
  weight: number
  /** Zones cardiaques (bpm, calculées d'après la méthode et les %), FC max et FC de repos. */
  hrZones: HrZone[]
  hrMax: number
  hrRest: number
  /** Méthode des zones cardiaques : Grappe (% FC max), Karvonen (% FC de réserve) ou perso. */
  hrMethod: HrMethod
  /** Zones en % (fractions) pour la méthode perso, et leur base. */
  hrPct: HrZone[]
  hrBase: 'max' | 'reserve'
  /**
   * Zones de vitesse ascensionnelle : en % de la VAM tenue à VC (mêmes % que les zones de VC)
   * ou saisies en m/h (`vamZones`, utilisées seulement en mode perso).
   */
  vamZoneMode: 'cs' | 'custom'
  vamZones: VamZone[]
  /** Cible des entraînements exportés vers la montre : allure ou fréquence cardiaque. */
  workoutTarget: 'pace' | 'hr'
  /** Code montre (identifiant du document partagé lu par le champ de données Garmin). */
  watchId?: string
  /** Course actuellement envoyée à la montre. */
  watchRaceId?: string
  /** Synchroniser le datafield EndurancePro (VC, zones…) via le code montre. */
  epSync?: boolean
  /** Code court (8 chiffres) à saisir sur la montre dans EndurancePro : document réservé à ses réglages. */
  epCode?: string
  /** Dernière modification (ISO), pour départager les appareils. */
  updatedAt?: string
}

/** Statistiques observées sur une tranche de pente. */
export interface GradeStat {
  /** Borne basse de la tranche (%). */
  lo: number
  /** Borne haute de la tranche (%). */
  hi: number
  /** Distance cumulée (m). */
  dist: number
  /** Dénivelé cumulé (m, signé). */
  dz: number
  /** Temps cumulé (s). */
  time: number
  /** Vitesse « à intensité VC » estimée : VAM (m/h) en montée marchée, coefficient sinon. */
  normalized: number
}

export interface ActivityRecord {
  id: string
  name: string
  /** Date et heure de départ (ISO UTC). */
  date: string
  dist: number
  dPlus: number
  /** Temps total réel (s). */
  elapsed: number
  /** Temps en mouvement (s). */
  moving: number
  /** Temps prédit par le modèle au moment de l'analyse (s, en mouvement). */
  predicted: number
  /** Intensité (%VC) estimée au fil du temps : [heure, %VC]. */
  intensity: [number, number][]
  grades: GradeStat[]
  /** Prise en compte dans la calibration. */
  useForCalibration: boolean
  /** Course planifiée associée, le cas échéant. */
  raceId?: string
  /** Séance d'étalonnage dont il s'agit, le cas échéant. */
  session?: string
  /** Valeurs mesurées par la séance (pour le suivi de l'évolution). */
  metrics?: SessionMetrics
}

/** Mesures issues d'une séance d'étalonnage. */
export interface SessionMetrics {
  /** VC (m/s). */
  cs?: number
  /** D′ (m). */
  dPrime?: number
  /** Vitesse ascensionnelle ramenée à l'intensité VC. */
  vam?: { grade: number; vam: number }
  /** Durabilité (mode log). */
  k?: number
  pct1h?: number
  /** Durabilité (mode linéaire). */
  lossPerH?: number
  descent?: { grade: number; factor: number }
  /** Découplage cardiaque (fraction), début de la dérive (h) et durée analysée (h). */
  decoupling?: number
  driftOnsetH?: number | null
  driftHours?: number
}

export interface Product {
  id: string
  name: string
  /** Glucides par unité (g). */
  carbs: number
  /** Sodium par unité (mg). */
  sodium: number
  /** Part des glucides apportée par ce produit (0–1). */
  share: number
}

export interface TrainingZone {
  name: string
  /** Bornes en fraction de VC (ex. 0.6 – 0.7). */
  low: number
  high: number
  /** Utilisation indicative (ex. « Endurance facile »). */
  use?: string
  /** Durée de soutien indicative (ex. « 1 h 30 à 6 h et plus »). */
  sustain?: string
  /** Couleur d'affichage (par défaut : couleurs Garmin). */
  color?: string
}

/** Zone de vitesse ascensionnelle (m/h). */
export type VamZone = HrZone

/** Zone de fréquence cardiaque (bpm). */
export type HrMethod = 'grappe' | 'karvonen' | 'custom'

export interface HrZone {
  name: string
  low: number
  high: number
}

export interface CsTrial {
  id: string
  /** Date du test (ISO). */
  date: string
  /** Durée de l'effort (s). */
  seconds: number
  /** Distance parcourue (m). */
  dist: number
  /** Origine de la distance : tour de la montre, meilleure fenêtre GPS ou saisie. */
  source: 'lap' | 'gps' | 'manual'
}

export interface CsTestRecord {
  id: string
  date: string
  protocol: string
  trials: { dist: number; time: number }[]
  cs: number
  dPrime: number
  r2: number
}

export interface EnvSettings {
  /** Départ : date et heure locales, format ISO "YYYY-MM-DDTHH:mm". */
  start: string
  /** Fuseau horaire IANA de la course. */
  timeZone: string
  night: {
    enabled: boolean
    /** Pénalité de base la nuit (ex. 0.08 = −8 %). */
    penalty: number
    /** Pénalité supplémentaire par niveau de technicité au-dessus de 1. */
    perTech: number
  }
  heat: {
    enabled: boolean
    /** Température max prévue en journée (°C), à l'altitude de référence. */
    tMax: number
    /** Température min la nuit (°C), à l'altitude de référence. */
    tMin: number
    /** Altitude de référence de la prévision (m). */
    refAlt: number
    /** Seuil au-delà duquel la chaleur pénalise (°C). */
    threshold: number
    /** Pénalité par °C au-dessus du seuil (ex. 0.01). */
    perDeg: number
    /** Origine des températures (ex. « Prévision du 12/11… »), vide si saisie manuelle. */
    note?: string
  }
  altitude: {
    enabled: boolean
    /** Altitude à partir de laquelle on pénalise (m). */
    threshold: number
    /** Pénalité par 1000 m au-dessus du seuil (ex. 0.05). */
    per1000: number
  }
  tech: {
    enabled: boolean
    /** Multiplicateur de vitesse par niveau de technicité 1 à 5. */
    factors: [number, number, number, number, number]
  }
  rain: {
    enabled: boolean
    /** Pénalité par mm/h de pluie (ex. 0.02), majorée de moitié en terrain technique. */
    perMm: number
  }
  /** Poids du sac : temps allongé de 1 % par kg, ou au prorata du poids corporel. */
  bag?: {
    enabled: boolean
    kg: number
    relative: boolean
  }
}

/** Relances en montée en puisant dans le D′ (modèle W′bal). */
export interface PushSettings {
  enabled: boolean
  /** Intensité visée en montée (fraction de VC, ex. 1.05). */
  climbPct: number
  /** Part maximale du D′ que l'on s'autorise à dépenser (0–1). */
  budget: number
}

/** Météo heure par heure en quelques points du parcours (Open-Meteo). */
export interface WeatherSeries {
  fetchedAt: string
  /** Première heure de la série (ISO UTC), pas d'une heure. */
  start: string
  points: {
    dist: number
    /** Altitude du point de grille météo (m). */
    elevation: number
    temp: number[]
    precip: number[]
    wind: number[]
  }[]
}

/** Technicité issue d'OpenStreetMap sur un intervalle [from, to] (m). */
export interface TechInterval {
  from: number
  to: number
  level: 1 | 2 | 3 | 4 | 5
  /** Description OSM (ex. « sentier T3 »). */
  label: string
}

/**
 * Zone d'allure imposée sur une portion du parcours (entraînement ou stratégie) :
 * - `intensity` : fraction de VC (zones d'entraînement ou valeur libre), adaptée au terrain ;
 * - `flatPace` : allure plat équivalente (s/km), adaptée au terrain ;
 * - `pace` : allure imposée telle quelle (s/km), sans tenir compte du terrain.
 */
export interface PaceZone {
  id: string
  from: number
  to: number
  /** `model` = allure de course du modèle (aucune cible). */
  kind: 'intensity' | 'flatPace' | 'pace' | 'model'
  value: number
  /** Nom de la zone (Endurance, Tempo…) ou vide si valeur libre. */
  label: string
}

/** Suivi en direct de la course. */
export interface LiveState {
  /** Départ réel (ISO UTC). */
  startedAt: string
  /** Passages réels : id du point → instant ISO UTC. */
  passages: Record<string, string>
}

export type CalcMode = 'physio' | 'kme' | 'gap'

export interface KmeSettings {
  /** m de D+ équivalant à 1 km (100 par défaut). */
  upPer1km: number
  /** m de D− équivalant à 1 km (0 = D− ignoré). */
  downPer1km: number
}

export type CheckpointKind = 'ravito' | 'split' | 'cutoff' | 'info'

export interface Checkpoint {
  id: string
  /** Distance depuis le départ (m). */
  dist: number
  name: string
  kind: CheckpointKind
  /** Temps d'arrêt prévu (min). */
  stopMin: number
  /** Barrière horaire : date et heure locales ISO, ou vide. */
  cutoff: string
  /** Eau à emporter jusqu'au point suivant (L). */
  water: number
  /** Glucides à emporter jusqu'au point suivant (g). */
  carbs: number
  notes: string
  /** Point créé par le découpage automatique (remplacé à chaque régénération). */
  auto: boolean
}

/** Technicité manuelle sur un intervalle [from, to] (m). */
export interface TechOverride {
  id: string
  from: number
  to: number
  level: 1 | 2 | 3 | 4 | 5
}

/** race = compétition ; route = parcours modèle de la bibliothèque ; session = séance datée créée depuis un parcours. */
export type RaceKind = 'race' | 'route' | 'session'

export interface Race {
  id: string
  name: string
  kind: RaceKind
  /** Étiquettes libres (côte, plat, piste…), surtout pour la bibliothèque. */
  tags: string[]
  /** Parcours modèle d'origine d'une séance planifiée. */
  templateId: string | null
  gpxText: string
  /** Lissage de l'altitude (±n points de 20 m). */
  smoothing: number
  env: EnvSettings
  mode: CalcMode
  kme: KmeSettings
  checkpoints: Checkpoint[]
  techOverrides: TechOverride[]
  /** Glucides par heure visés (g/h), pour les suggestions. */
  carbsPerH: number
  /** Eau par heure (L/h), pour les suggestions. */
  waterPerH: number
  /** Sodium par heure (mg/h). */
  sodiumPerH: number
  push: PushSettings
  osmTech: TechInterval[]
  /** Zones d'allure imposées sur des portions du parcours. */
  zones: PaceZone[]
  weather: WeatherSeries | null
  live: LiveState | null
  /** Identifiant du lien public pour l'assistance. */
  shareId: string | null
  /** Tracé dessiné sur la carte (points cliqués), pour pouvoir le modifier. */
  drawn: DrawnRoute | null
  updatedAt: string
}

/** Mode de tracé d'un segment : sentiers, chemin le plus court, ligne droite (hors sentier). */
export type SegMode = 'trail' | 'shortest' | 'line'

export interface Waypoint {
  lat: number
  lon: number
  /** Mode du segment qui arrive à ce point (sans objet pour le départ). */
  mode: SegMode
  /** Point de repère (affiché dans la liste, devient un point de passage de la course). */
  mark?: boolean
  /** Nom donné au point (départ, arrivée ou repère). */
  name?: string
}

/**
 * Tracé enregistré avec la course : points cliqués et indice de chacun dans les points du
 * GPX (le segment k va du point i[k] au point i[k+1]).
 */
export interface DrawnRoute {
  waypoints: (Waypoint & { i: number })[]
}

/** Résultat de simulation pour chaque point de la trace. */
export interface SimPoint {
  dist: number
  ele: number
  /** Temps écoulé depuis le départ (s), arrêts compris. */
  t: number
  night: boolean
  tech: number
  temp: number
  /** Pluie (mm/h), si météo horaire. */
  precip: number
  /** D′ restant (m). */
  wbal: number
}

export interface SplitRow {
  cp: Checkpoint
  from: number
  to: number
  dist: number
  dPlus: number
  dMinus: number
  kme: number
  /** Temps de déplacement sur le tronçon (s). */
  moveTime: number
  /** Temps écoulé à l'arrivée au point (s). */
  arrival: number
  /** Temps écoulé au départ du point, arrêt compris (s). */
  departure: number
  arrivalClock: Date
  /** Marge sur la barrière horaire (s), ou null s'il n'y en a pas. */
  cutoffMargin: number | null
  night: boolean
  avgPace: number
}

export interface SimResult {
  points: SimPoint[]
  splits: SplitRow[]
  totalTime: number
  totalKme: number
  /** D′ restant minimal sur la course (m). */
  minWbal: number
}
