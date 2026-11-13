import { indexAt } from './gpx'
import { isNightAt } from './sun'
import { tzOffsetMs, zonedToUtc } from './time'
import type {
  Athlete,
  CalcMode,
  Checkpoint,
  Durability,
  EnvSettings,
  KmeSettings,
  PaceZone,
  PushSettings,
  Race,
  SimPoint,
  SimResult,
  SplitRow,
  TechInterval,
  TechOverride,
  Track,
  WeatherSeries,
} from './types'

/** Interpolation linéaire dans une table triée par x, bornée aux extrémités. */
export function interp<T>(table: T[], x: number, getX: (t: T) => number, getY: (t: T) => number): number {
  const sorted = [...table].sort((a, b) => getX(a) - getX(b))
  if (sorted.length === 0) return 0
  if (x <= getX(sorted[0])) return getY(sorted[0])
  const last = sorted[sorted.length - 1]
  if (x >= getX(last)) return getY(last)
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    if (x <= getX(b)) {
      const f = (x - getX(a)) / (getX(b) - getX(a))
      return getY(a) + f * (getY(b) - getY(a))
    }
  }
  return getY(last)
}

/**
 * Coût énergétique de la course selon la pente (Minetti et al. 2002), en J/kg/m.
 * `g` est une fraction (0.10 = 10 %), bornée à ±45 % (domaine de validité).
 */
export function minettiCost(g: number): number {
  const x = Math.max(-0.45, Math.min(0.45, g))
  return 155.4 * x ** 5 - 30.4 * x ** 4 - 43.3 * x ** 3 + 46.3 * x ** 2 + 19.5 * x + 3.6
}

/** Facteur de vitesse sur pente par rapport au plat, à coût énergétique égal. */
export function gapFactor(gradePct: number): number {
  return minettiCost(0) / minettiCost(gradePct / 100)
}

/**
 * %VC tenu à l'instant `t` (h écoulées depuis le départ).
 *
 * Mode log : la moyenne tenable sur une durée T vaut pct1h − k·ln(T).
 * L'intensité instantanée qui donne cette moyenne est sa dérivée de t·%VC(t),
 * soit pct1h − k·(1 + ln t). On la plafonne à pct1h pour t < 1/e h (≈ 22 min).
 *
 * Mode linéaire : basePct, puis −lossPerH par heure après onsetH.
 */
export function intensityAt(t: number, d: Durability): number {
  let f: number
  if (d.mode === 'log') {
    f = t <= 1 / Math.E ? d.pct1h : d.pct1h - d.k * (1 + Math.log(t))
  } else {
    f = d.basePct - d.lossPerH * Math.max(0, t - d.onsetH)
  }
  return Math.max(d.minPct, f)
}

/** %VC moyen tenable sur une durée T (h), pour l'affichage de la courbe. */
export function averageIntensity(T: number, d: Durability): number {
  if (d.mode === 'log') return Math.max(d.minPct, d.pct1h - d.k * Math.log(Math.max(T, 1)))
  if (T <= d.onsetH) return d.basePct
  // Moyenne de la décroissance linéaire (sans le plancher).
  const after = T - d.onsetH
  const avg = (d.basePct * d.onsetH + (d.basePct - (d.lossPerH * after) / 2) * after) / T
  return Math.max(d.minPct, avg)
}

/** Technicité automatique (1 à 5), estimée à partir de la pente. */
export function autoTech(gradePct: number): 1 | 2 | 3 | 4 | 5 {
  if (gradePct < 0) {
    const g = -gradePct
    if (g > 35) return 5
    if (g > 25) return 4
    if (g > 18) return 3
    if (g > 10) return 2
    return 1
  }
  if (gradePct > 40) return 4
  if (gradePct > 30) return 3
  return 1
}

/** Technicité : tronçon manuel en priorité, sinon le plus élevé entre OSM et l'estimation par la pente. */
export function techAt(dist: number, gradePct: number, overrides: TechOverride[], osm = 0): number {
  for (let i = overrides.length - 1; i >= 0; i--) {
    const o = overrides[i]
    if (dist >= o.from && dist <= o.to) return o.level
  }
  return Math.max(osm, autoTech(gradePct))
}

/** Température (°C) à une heure locale donnée, sur un cycle min 6 h / max 15 h. */
export function diurnalTemp(localHour: number, tMin: number, tMax: number): number {
  const h = ((localHour % 24) + 24) % 24
  const mid = (tMin + tMax) / 2
  const amp = (tMax - tMin) / 2
  if (h >= 6 && h <= 15) return mid - amp * Math.cos((Math.PI * (h - 6)) / 9)
  const since = h > 15 ? h - 15 : h + 9 // 15 h → 6 h le lendemain = 15 h de descente
  return mid + amp * Math.cos((Math.PI * since) / 15)
}

/** Km-effort d'un pas de trace. */
export function kmeOf(dx: number, up: number, down: number, k: KmeSettings): number {
  return dx / 1000 + up / k.upPer1km + (k.downPer1km > 0 ? down / k.downPer1km : 0)
}

export interface SimOptions {
  mode: CalcMode
  kme: KmeSettings
  env: EnvSettings
  checkpoints: Checkpoint[]
  techOverrides: TechOverride[]
  /** Technicité OpenStreetMap (prise en compte si plus élevée que l'estimation par la pente). */
  osmTech?: TechInterval[]
  /** Météo heure par heure (remplace le cycle min/max quand elle couvre l'instant). */
  weather?: WeatherSeries | null
  /** Relances en montée avec le D′. */
  push?: PushSettings
  /** Zones d'allure imposées. */
  zones?: PaceZone[]
}

/** Zones d'entraînement (fraction de VC). */
export const TRAINING_ZONES: { label: string; value: number }[] = [
  { label: 'Récupération', value: 0.65 },
  { label: 'Endurance', value: 0.75 },
  { label: 'Tempo', value: 0.88 },
  { label: 'Seuil', value: 0.97 },
  { label: 'VC', value: 1.0 },
  { label: 'Au-dessus de la VC', value: 1.1 },
]

/**
 * Zone d'allure de chaque pas de trace : l'indice i désigne le pas qui arrive au point i,
 * rattaché à une zone par son milieu (la dernière zone définie l'emporte). −1 = aucune.
 */
export function zoneIndex(track: Track, zones: PaceZone[] | undefined): Int16Array {
  const pts = track.points
  const out = new Int16Array(pts.length).fill(-1)
  if (!zones?.length) return out
  for (let i = 1; i < pts.length; i++) {
    const mid = (pts[i - 1].dist + pts[i].dist) / 2
    for (let z = zones.length - 1; z >= 0; z--) {
      if (mid >= zones[z].from && mid <= zones[z].to) {
        out[i] = z
        break
      }
    }
  }
  return out
}

/** Niveau OSM par point de trace (0 = inconnu). */
export function osmLevels(track: Track, intervals: TechInterval[] | undefined): Uint8Array {
  const out = new Uint8Array(track.points.length)
  if (!intervals?.length) return out
  const sorted = [...intervals].sort((a, b) => a.from - b.from)
  let j = 0
  track.points.forEach((p, i) => {
    while (j < sorted.length && sorted[j].to < p.dist) j++
    for (let k = j; k < sorted.length && sorted[k].from <= p.dist; k++) {
      if (p.dist <= sorted[k].to) out[i] = Math.max(out[i], sorted[k].level)
    }
  })
  return out
}

/** Météo horaire interpolée en (distance, instant) : température ramenée à l'altitude `ele`. */
export function weatherAt(
  w: WeatherSeries | null | undefined,
  dist: number,
  ms: number,
  ele: number,
): { temp: number; precip: number } | null {
  if (!w || !w.points.length) return null
  const h = (ms - Date.parse(w.start)) / 3600000
  const n = w.points[0].temp.length
  if (!(h >= 0 && h <= n - 1)) return null
  const i0 = Math.floor(h)
  const i1 = Math.min(n - 1, i0 + 1)
  const fh = h - i0
  const at = (p: WeatherSeries['points'][number]) => ({
    temp: p.temp[i0] + fh * (p.temp[i1] - p.temp[i0]) - 0.0065 * (ele - p.elevation),
    precip: p.precip[i0] + fh * (p.precip[i1] - p.precip[i0]),
  })
  const pts = w.points
  const ok = (r: { temp: number; precip: number }) => (Number.isFinite(r.temp) ? r : null)
  if (dist <= pts[0].dist) return ok(at(pts[0]))
  for (let k = 1; k < pts.length; k++) {
    if (dist <= pts[k].dist) {
      const a = at(pts[k - 1])
      const b = at(pts[k])
      const f = (dist - pts[k - 1].dist) / (pts[k].dist - pts[k - 1].dist || 1)
      return ok({ temp: a.temp + f * (b.temp - a.temp), precip: a.precip + f * (b.precip - a.precip) })
    }
  }
  return ok(at(pts[pts.length - 1]))
}

export interface StepContext {
  ms: number
  lat: number
  lon: number
  dist: number
  ele: number
  tech: number
  offsetMs: number
}

/**
 * Conditions et multiplicateur de vitesse d'environnement pour un pas :
 * technicité, nuit, chaleur, pluie, altitude.
 */
/** Ralentissement dû au sac : 1 % par kg, ou au prorata du poids corporel (masse transportée). */
export function bagFactor(env: EnvSettings, bodyKg = 70): number {
  const b = env.bag
  if (!b?.enabled || !(b.kg > 0)) return 1
  return b.relative ? 1 + b.kg / Math.max(30, bodyKg) : 1 + 0.01 * b.kg
}

export function environment(env: EnvSettings, c: StepContext, weather?: WeatherSeries | null, bodyKg = 70) {
  const night = isNightAt(c.ms, c.lat, c.lon)
  const w = weatherAt(weather, c.dist, c.ms, c.ele)
  const temp =
    w?.temp ??
    diurnalTemp((c.ms + c.offsetMs) / 3600000, env.heat.tMin, env.heat.tMax) - 0.0065 * (c.ele - env.heat.refAlt)
  const precip = w?.precip ?? 0
  let mult = 1
  if (env.tech.enabled) mult *= env.tech.factors[c.tech - 1] ?? 1
  if (env.night.enabled && night) mult *= 1 - (env.night.penalty + env.night.perTech * (c.tech - 1))
  if (env.heat.enabled) mult *= 1 - env.heat.perDeg * Math.max(0, temp - env.heat.threshold)
  if (env.rain?.enabled && precip > 0) {
    mult *= 1 - Math.min(0.3, env.rain.perMm * precip * (c.tech >= 3 ? 1.5 : 1))
  }
  if (env.altitude.enabled) mult *= 1 - (env.altitude.per1000 * Math.max(0, c.ele - env.altitude.threshold)) / 1000
  mult /= bagFactor(env, bodyKg)
  return { mult: Math.max(0.2, mult), night, temp, precip }
}

/** Vitesse instantanée (m/s, horizontale) sur un pas de trace, hors facteurs d'environnement. */
export function baseSpeed(
  athlete: Athlete,
  mode: CalcMode,
  gradePct: number,
  intensity: number,
): number {
  const v0 = athlete.cs * intensity
  if (mode === 'gap') return v0 * gapFactor(gradePct)
  if (mode === 'kme') return v0 // le km-e est déjà intégré dans la distance à parcourir
  // Mode physiologique.
  if (gradePct >= athlete.walkThreshold) {
    const vam = interp(athlete.vam, gradePct, (p) => p.grade, (p) => p.vam) * intensity
    return vam / 3600 / (gradePct / 100)
  }
  if (gradePct >= 0) return v0 * gapFactor(gradePct)
  return v0 * interp(athlete.descent, gradePct, (p) => p.grade, (p) => p.factor)
}

/**
 * Simule la course pas à pas : vitesse selon le mode de calcul, intensité selon
 * le temps écoulé (durabilité), puis facteurs nuit, chaleur, altitude et technicité.
 * Les arrêts aux points de passage s'ajoutent au temps écoulé.
 */
export function simulate(track: Track, athlete: Athlete, opts: SimOptions): SimResult {
  const { env, mode, kme } = opts
  const pts = track.points
  const startDate = zonedToUtc(env.start, env.timeZone)
  const startMs = Number.isNaN(startDate.getTime()) ? Date.now() : startDate.getTime()
  const offsetMs = tzOffsetMs(new Date(startMs), env.timeZone)
  const osm = osmLevels(track, opts.osmTech)
  const zoneOf = zoneIndex(track, opts.zones)
  const push = opts.push?.enabled && mode !== 'kme' ? opts.push : null
  const dPrime = Math.max(1, athlete.dPrime)
  const wFloor = push ? dPrime * (1 - push.budget) : 0

  const cps = [...opts.checkpoints].sort((a, b) => a.dist - b.dist)
  const arrivals = new Map<string, number>()
  let cpIdx = 0

  const out: SimPoint[] = []
  let t = 0
  let totalKme = 0
  let wbal = dPrime
  let minWbal = dPrime

  const pushPoint = (i: number, tech: number) => {
    const p = pts[i]
    const e = environment(env, { ms: startMs + t * 1000, lat: p.lat, lon: p.lon, dist: p.dist, ele: p.ele, tech, offsetMs }, opts.weather, athlete.weight)
    out.push({ dist: p.dist, ele: p.ele, t, night: e.night, tech, temp: e.temp, precip: e.precip, wbal })
  }

  // Points de passage au départ.
  while (cpIdx < cps.length && cps[cpIdx].dist <= 0) {
    arrivals.set(cps[cpIdx].id, 0)
    t += cps[cpIdx].stopMin * 60
    cpIdx++
  }
  pushPoint(0, 1)

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.dist - a.dist
    if (dx <= 0) {
      pushPoint(i, 1)
      continue
    }
    const dz = b.ele - a.ele
    const grade = (dz / dx) * 100
    const tech = techAt((a.dist + b.dist) / 2, grade, opts.techOverrides, osm[i])

    // Distance « effective » à parcourir : km-e en mode km-effort.
    const stepKme = kmeOf(dx, Math.max(0, dz), Math.max(0, -dz), kme)
    totalKme += stepKme
    const effDist = mode === 'kme' ? stepKme * 1000 : dx

    const e = environment(env, { ms: startMs + t * 1000, lat: b.lat, lon: b.lon, dist: b.dist, ele: b.ele, tech, offsetMs }, opts.weather, athlete.weight)
    const base = intensityAt(t / 3600, athlete.durability)
    const stepTime = (intensity: number) => effDist / Math.max(baseSpeed(athlete, mode, grade, intensity) * e.mult, 0.05)

    // Intensité du pas : zone imposée, sinon relance en montée tant que le D′ le permet.
    const zoneRaw = zoneOf[i] >= 0 ? opts.zones![zoneOf[i]] : null
    const zone = zoneRaw && zoneRaw.kind !== 'model' ? zoneRaw : null
    let intensity = base
    let dt = stepTime(base)
    if (zone && zone.kind === 'pace') {
      // Allure imposée telle quelle (le terrain n'est pas pris en compte).
      dt = dx / (1000 / Math.max(60, zone.value))
      intensity = Math.min(1.5, 1000 / Math.max(60, zone.value) / athlete.cs)
    } else if (zone) {
      intensity = zone.kind === 'intensity' ? zone.value : 1000 / Math.max(60, zone.value) / athlete.cs
      dt = stepTime(intensity)
    } else if (push && grade >= 2 && push.climbPct > base) {
      const dtPush = stepTime(push.climbPct)
      const cost = athlete.cs * Math.max(0, push.climbPct - 1) * dtPush
      if (wbal - cost >= wFloor) {
        intensity = push.climbPct
        dt = dtPush
      }
    }
    // Bilan D′ (W′bal, forme différentielle) : dépense au-dessus de VC, recharge en dessous.
    if (intensity > 1) wbal -= athlete.cs * (intensity - 1) * dt
    else wbal += ((dPrime - wbal) * athlete.cs * (1 - intensity) * dt) / dPrime
    wbal = Math.min(dPrime, wbal)
    minWbal = Math.min(minWbal, wbal)

    // Points de passage franchis pendant ce pas : arrivée interpolée, puis arrêt.
    while (cpIdx < cps.length && cps[cpIdx].dist <= b.dist) {
      const cp = cps[cpIdx]
      const f = (cp.dist - a.dist) / dx
      arrivals.set(cp.id, t + Math.max(0, f) * dt)
      t += cp.stopMin * 60
      cpIdx++
    }
    t += dt
    pushPoint(i, tech)
  }
  // Points au-delà de la fin de trace.
  while (cpIdx < cps.length) {
    arrivals.set(cps[cpIdx].id, t)
    cpIdx++
  }

  const splits = buildSplits(track, out, cps, arrivals, startMs, kme, env.timeZone)
  return { points: out, splits, totalTime: t, totalKme, minWbal }
}

export type ScenarioKey = 'good' | 'plan' | 'hard'

export const SCENARIOS: Record<ScenarioKey, { label: string; cs: number; durability: number; stops: number }> = {
  good: { label: 'Bonne journée', cs: 1.03, durability: 0.8, stops: 0.8 },
  plan: { label: 'Prévu', cs: 1, durability: 1, stops: 1 },
  hard: { label: 'Journée difficile', cs: 0.95, durability: 1.3, stops: 1.5 },
}

/** Variante de l'athlète et des arrêts pour un scénario. */
export function scenarioInputs(athlete: Athlete, opts: SimOptions, key: ScenarioKey): [Athlete, SimOptions] {
  const sc = SCENARIOS[key]
  if (key === 'plan') return [athlete, opts]
  const d = athlete.durability
  return [
    {
      ...athlete,
      cs: athlete.cs * sc.cs,
      vam: athlete.vam.map((v) => ({ ...v, vam: v.vam * sc.cs })),
      durability: { ...d, k: d.k * sc.durability, lossPerH: d.lossPerH * sc.durability },
    },
    { ...opts, checkpoints: opts.checkpoints.map((c) => ({ ...c, stopMin: c.stopMin * sc.stops })) },
  ]
}

export function simulateScenarios(track: Track, athlete: Athlete, opts: SimOptions): Record<ScenarioKey, SimResult> {
  const run = (k: ScenarioKey) => simulate(track, ...scenarioInputs(athlete, opts, k))
  return { good: run('good'), plan: run('plan'), hard: run('hard') }
}

function buildSplits(
  track: Track,
  sim: SimPoint[],
  cps: Checkpoint[],
  arrivals: Map<string, number>,
  startMs: number,
  kme: KmeSettings,
  timeZone: string,
): SplitRow[] {
  const rows: SplitRow[] = []
  let prevDist = 0
  let prevDeparture = 0
  for (const cp of cps) {
    const arrival = arrivals.get(cp.id) ?? 0
    const departure = arrival + cp.stopMin * 60
    const from = prevDist
    const to = Math.min(cp.dist, track.totalDist)
    let dPlus = 0
    let dMinus = 0
    const i0 = indexAt(track.points, from)
    const i1 = indexAt(track.points, to)
    for (let i = i0 + 1; i <= i1; i++) {
      const d = track.points[i].ele - track.points[i - 1].ele
      if (d > 0) dPlus += d
      else dMinus -= d
    }
    const dist = to - from
    const moveTime = arrival - prevDeparture
    const cutMs = cp.cutoff ? cutoffMs(cp.cutoff, timeZone) : null
    const simIdx = Math.min(sim.length - 1, Math.max(0, i1))
    rows.push({
      cp,
      from,
      to,
      dist,
      dPlus,
      dMinus,
      kme: kmeOf(dist, dPlus, dMinus, kme),
      moveTime,
      arrival,
      departure,
      arrivalClock: new Date(startMs + arrival * 1000),
      cutoffMargin: cutMs === null ? null : (cutMs - (startMs + arrival * 1000)) / 1000,
      night: sim[simIdx]?.night ?? false,
      avgPace: dist > 0 ? moveTime / (dist / 1000) : 0,
    })
    prevDist = to
    prevDeparture = departure
  }
  return rows
}

/** Barrière horaire (heure locale de la course) → instant UTC en ms. */
function cutoffMs(cutoff: string, timeZone: string): number | null {
  const ms = zonedToUtc(cutoff, timeZone).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Liste des points de passage effectifs : ceux de la course + l'arrivée si absente. */
export function withFinish(race: Race, track: Track): Checkpoint[] {
  const cps = [...race.checkpoints].sort((a, b) => a.dist - b.dist)
  const hasFinish = cps.some((c) => c.dist >= track.totalDist - 50)
  if (!hasFinish) {
    cps.push({
      id: '__finish',
      dist: track.totalDist,
      name: 'Arrivée',
      kind: 'info',
      stopMin: 0,
      cutoff: '',
      water: 0,
      carbs: 0,
      notes: '',
      auto: false,
    })
  }
  return cps
}

/**
 * Calibration : ajuste le paramètre de durabilité (k en mode log, lossPerH en
 * mode linéaire) pour que la simulation retrouve un temps réalisé.
 * Renvoie la nouvelle durabilité, ou null si le temps visé est hors d'atteinte.
 */
export function calibrateDurability(
  track: Track,
  athlete: Athlete,
  opts: SimOptions,
  targetTime: number,
): Durability | null {
  const key = athlete.durability.mode === 'log' ? 'k' : 'lossPerH'
  const run = (val: number) =>
    simulate(track, { ...athlete, durability: { ...athlete.durability, [key]: val } }, opts).totalTime
  let lo = 0
  let hi = key === 'k' ? 0.3 : 0.1
  if (run(lo) > targetTime || run(hi) < targetTime) return null
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (run(mid) < targetTime) lo = mid
    else hi = mid
  }
  return { ...athlete.durability, [key]: (lo + hi) / 2 }
}
