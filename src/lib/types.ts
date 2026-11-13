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
  /** Code montre (identifiant du document partagé lu par le champ de données Garmin). */
  watchId?: string
  /** Course actuellement envoyée à la montre. */
  watchRaceId?: string
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

export interface Race {
  id: string
  name: string
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
  weather: WeatherSeries | null
  live: LiveState | null
  /** Identifiant du lien public pour l'assistance. */
  shareId: string | null
  updatedAt: string
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
