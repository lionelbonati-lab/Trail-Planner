import type { Athlete, EnvSettings, KmeSettings, Product, PushSettings, Race } from './types'

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
}

export const DEFAULT_ENV: EnvSettings = {
  start: '2026-06-06T06:00',
  timeZone: 'Europe/Paris',
  night: { enabled: true, penalty: 0.1, perTech: 0.03 },
  heat: { enabled: true, tMax: 22, tMin: 10, refAlt: 500, threshold: 18, perDeg: 0.01 },
  altitude: { enabled: true, threshold: 1500, per1000: 0.05 },
  tech: { enabled: true, factors: [1, 0.95, 0.88, 0.78, 0.65] },
  rain: { enabled: true, perMm: 0.02 },
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
    weather: null,
    live: null,
    shareId: null,
    updatedAt: new Date().toISOString(),
  }
}

/** Complète un objet chargé (ancienne version) avec les valeurs par défaut. */
export function normalizeAthlete(a: Partial<Athlete> | null | undefined): Athlete {
  return {
    ...DEFAULT_ATHLETE,
    ...a,
    history: a?.history ?? [],
    activities: a?.activities ?? [],
    products: a?.products ?? DEFAULT_PRODUCTS.map((p) => ({ ...p })),
    durability: { ...DEFAULT_ATHLETE.durability, ...(a?.durability ?? {}) },
  }
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
    },
    kme: { ...DEFAULT_KME, ...r.kme },
    push: { ...DEFAULT_PUSH, ...r.push },
    osmTech: r.osmTech ?? [],
    weather: r.weather ?? null,
    live: r.live ?? null,
    shareId: r.shareId ?? null,
  }
}
