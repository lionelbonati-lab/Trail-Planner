import { GARMIN_PCT, GRAPPE_PCT, hrZonesOf, withHrZones } from './hr'
import type { Athlete, EnvSettings, HrZone, KmeSettings, Product, PushSettings, Race, TrainingZone } from './types'

/** Zones de vitesse critique (bilan Ibex Outdoor du 07/11/2026), en fraction de VC. */
export const DEFAULT_ZONES: TrainingZone[] = [
  { name: 'Zone 1', low: 0.6, high: 0.7, use: 'Récupération / très facile', sustain: '2 h à 8 h et plus' },
  { name: 'Zone 2', low: 0.7, high: 0.8, use: 'Endurance facile', sustain: '1 h 30 à 6 h et plus' },
  { name: 'Zone 3', low: 0.8, high: 0.88, use: 'Endurance soutenue', sustain: '45 min à 3 h et plus' },
  { name: 'Zone 4', low: 0.88, high: 0.96, use: 'Tempo / proche seuil', sustain: '20 à 100 min' },
  { name: 'Zone 5', low: 0.96, high: 1.05, use: 'Voisinage de VC', sustain: '8 à 60 min et plus' },
  { name: 'Zone 6', low: 1.05, high: 1.15, use: 'Supra-VC / intermittent', sustain: '2 à 15 min' },
  { name: 'Zone 7', low: 1.15, high: 1.5, use: 'Haute intensité / court', sustain: '20 s à 4 min' },
]

/** Zones cardiaques par défaut de Garmin (% de FC max : 50-60-70-80-90-100). */
export function hrZonesFromMax(hrMax: number): HrZone[] {
  const p = [0.5, 0.6, 0.7, 0.8, 0.9, 1]
  return [1, 2, 3, 4, 5].map((k) => ({ name: `Zone ${k}`, low: Math.round(hrMax * p[k - 1]), high: Math.round(hrMax * p[k]) }))
}

/** Anciennes zones par défaut (5 zones, Z3 et Z4 estimées) : remplacées par celles du bilan. */
function isOldDefaultZones(z: TrainingZone[] | undefined): boolean {
  const old = [[0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 0.96], [0.96, 1.05]]
  return !!z && z.length === 5 && z.every((x, i) => Math.abs(x.low - old[i][0]) < 1e-6 && Math.abs(x.high - old[i][1]) < 1e-6)
}

export const DEFAULT_ATHLETE: Athlete = {
  name: 'Moi',
  cs: 1000 / 255, // 4'15/km
  dPrime: 200,
  walkThreshold: 15,
  // VAM tenue à l'intensité VC ; elle est ensuite multipliée par le %VC du moment.
  vam: [
    { grade: 10, vam: 950 },
    { grade: 20, vam: 1100 },
    { grade: 30, vam: 1100 },
    { grade: 45, vam: 950 },
  ],
  descent: [
    { grade: -5, factor: 1.07 },
    { grade: -10, factor: 1.12 },
    { grade: -15, factor: 1.08 },
    { grade: -20, factor: 1.0 },
    { grade: -25, factor: 0.88 },
    { grade: -30, factor: 0.75 },
    { grade: -40, factor: 0.55 },
  ],
  durability: {
    mode: 'log',
    pct1h: 0.95,
    k: 0.08,
    basePct: 0.85,
    onsetH: 2,
    lossPerH: 0.015,
    minPct: 0.45,
  },
  history: [],
  activities: [],
  products: [] as Product[],
  zones: DEFAULT_ZONES,
  csTrials: [],
  weight: 70,
  hrZones: hrZonesOf({ hrMethod: 'grappe', hrPct: GRAPPE_PCT, hrBase: 'max', hrMax: 190, hrRest: 50 }),
  hrMax: 190,
  hrRest: 50,
  hrMethod: 'grappe',
  hrPct: GARMIN_PCT.map((z) => ({ ...z })),
  hrBase: 'max',
  workoutTarget: 'pace',
}

export const DEFAULT_ENV: EnvSettings = {
  start: '2026-06-06T06:00',
  timeZone: 'Europe/Paris',
  night: { enabled: true, penalty: 0.1, perTech: 0.03 },
  heat: { enabled: true, tMax: 22, tMin: 10, refAlt: 500, threshold: 18, perDeg: 0.01 },
  altitude: { enabled: true, threshold: 1500, per1000: 0.05 },
  tech: { enabled: true, factors: [1, 0.95, 0.88, 0.78, 0.65] },
  rain: { enabled: true, perMm: 0.02 },
  bag: { enabled: false, kg: 3, relative: false },
}

export const DEFAULT_PUSH: PushSettings = { enabled: false, climbPct: 1.05, budget: 0.6 }

/** Produits proposés à un nouveau profil (modifiables). */
export const DEFAULT_PRODUCTS: Product[] = [
  { id: 'gel', name: 'Gel', carbs: 25, sodium: 50, share: 0.5 },
  { id: 'boisson', name: 'Boisson (500 ml)', carbs: 30, sodium: 300, share: 0.3 },
  { id: 'barre', name: 'Barre', carbs: 30, sodium: 100, share: 0.2 },
]

export const DEFAULT_KME: KmeSettings = { upPer1km: 100, downPer1km: 0 }

export function newRace(name: string, gpxText: string): Race {
  return {
    id: crypto.randomUUID(),
    name,
    kind: 'race',
    tags: [],
    templateId: null,
    gpxText,
    smoothing: 2,
    env: structuredClone(DEFAULT_ENV),
    mode: 'physio',
    kme: { ...DEFAULT_KME },
    checkpoints: [],
    techOverrides: [],
    carbsPerH: 60,
    waterPerH: 0.5,
    sodiumPerH: 500,
    push: { ...DEFAULT_PUSH },
    osmTech: [],
    zones: [],
    weather: null,
    live: null,
    shareId: null,
    drawn: null,
    updatedAt: new Date().toISOString(),
  }
}

/** Complète un objet chargé (ancienne version) avec les valeurs par défaut. */
export function normalizeAthlete(a: Partial<Athlete> | null | undefined): Athlete {
  const hrMax = a?.hrMax ?? 190
  const legacy = !a?.hrMethod && !!a?.hrZones?.length
  return withHrZones({
    ...DEFAULT_ATHLETE,
    ...a,
    history: a?.history ?? [],
    activities: a?.activities ?? [],
    products: a?.products ?? DEFAULT_PRODUCTS.map((p) => ({ ...p })),
    zones: a?.zones?.length && !isOldDefaultZones(a.zones) ? a.zones : DEFAULT_ZONES.map((z) => ({ ...z })),
    hrMax,
    hrRest: a?.hrRest ?? 50,
    weight: a?.weight ?? 70,
    // Profil d'avant les zones en % : ses zones en bpm sont reprises en % de FC max (méthode perso).
    hrMethod: a?.hrMethod ?? (legacy ? 'custom' : 'grappe'),
    hrBase: a?.hrBase ?? 'max',
    hrPct: a?.hrPct?.length
      ? a.hrPct
      : legacy
        ? a!.hrZones!.map((z) => ({ name: z.name, low: Math.round((z.low / hrMax) * 1000) / 1000, high: Math.round((z.high / hrMax) * 1000) / 1000 }))
        : GARMIN_PCT.map((z) => ({ ...z })),
    workoutTarget: a?.workoutTarget ?? 'pace',
    csTrials: a?.csTrials ?? [],
    durability: { ...DEFAULT_ATHLETE.durability, ...(a?.durability ?? {}) },
  })
}

export function normalizeRace(r: Race): Race {
  return {
    ...newRace(r.name, r.gpxText),
    ...r,
    env: {
      ...DEFAULT_ENV,
      ...r.env,
      night: { ...DEFAULT_ENV.night, ...r.env?.night },
      heat: { ...DEFAULT_ENV.heat, ...r.env?.heat },
      altitude: { ...DEFAULT_ENV.altitude, ...r.env?.altitude },
      tech: { ...DEFAULT_ENV.tech, ...r.env?.tech },
      rain: { ...DEFAULT_ENV.rain, ...r.env?.rain },
      bag: { ...DEFAULT_ENV.bag!, ...r.env?.bag },
    },
    kme: { ...DEFAULT_KME, ...r.kme },
    push: { ...DEFAULT_PUSH, ...r.push },
    osmTech: r.osmTech ?? [],
    zones: r.zones ?? [],
    kind: r.kind ?? 'race',
    tags: r.tags ?? [],
    templateId: r.templateId ?? null,
    weather: r.weather ?? null,
    live: r.live ?? null,
    shareId: r.shareId ?? null,
  }
}
