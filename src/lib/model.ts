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
  Race,
  SimPoint,
  SimResult,
  SplitRow,
  TechOverride,
  Track,
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

export function techAt(dist: number, gradePct: number, overrides: TechOverride[]): number {
  for (let i = overrides.length - 1; i >= 0; i--) {
    const o = overrides[i]
    if (dist >= o.from && dist <= o.to) return o.level
  }
  return autoTech(gradePct)
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

  const cps = [...opts.checkpoints].sort((a, b) => a.dist - b.dist)
  const arrivals = new Map<string, number>()
  let cpIdx = 0

  const out: SimPoint[] = []
  let t = 0
  let totalKme = 0

  const pushPoint = (i: number, tech: number) => {
    const ms = startMs + t * 1000
    const localHour = (ms + offsetMs) / 3600000
    const temp =
      diurnalTemp(localHour, env.heat.tMin, env.heat.tMax) - 0.0065 * (pts[i].ele - env.heat.refAlt)
    out.push({ dist: pts[i].dist, ele: pts[i].ele, t, night: isNightAt(ms, pts[i].lat, pts[i].lon), tech, temp })
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
    const tech = techAt((a.dist + b.dist) / 2, grade, opts.techOverrides)

    const intensity = intensityAt(t / 3600, athlete.durability)
    let v = baseSpeed(athlete, mode, grade, intensity)

    // Distance « effective » à parcourir : km-e en mode km-effort.
    let effDist = dx
    const stepKme = kmeOf(dx, Math.max(0, dz), Math.max(0, -dz), kme)
    totalKme += stepKme
    if (mode === 'kme') effDist = stepKme * 1000

    // Facteurs d'environnement (multiplicatifs).
    const ms = startMs + t * 1000
    let mult = 1
    if (env.tech.enabled) mult *= env.tech.factors[tech - 1] ?? 1
    if (env.night.enabled && isNightAt(ms, b.lat, b.lon)) {
      mult *= 1 - (env.night.penalty + env.night.perTech * (tech - 1))
    }
    if (env.heat.enabled) {
      const localHour = (ms + offsetMs) / 3600000
      const temp =
        diurnalTemp(localHour, env.heat.tMin, env.heat.tMax) - 0.0065 * (b.ele - env.heat.refAlt)
      mult *= 1 - env.heat.perDeg * Math.max(0, temp - env.heat.threshold)
    }
    if (env.altitude.enabled) {
      mult *= 1 - (env.altitude.per1000 * Math.max(0, b.ele - env.altitude.threshold)) / 1000
    }
    v *= Math.max(0.2, mult)

    const dt = effDist / Math.max(v, 0.05)

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
  return { points: out, splits, totalTime: t, totalKme }
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
