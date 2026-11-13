// Analyse générale d'une séance quelconque : allure « plat équivalent » (correction
// de pente de Minetti), temps par zone, tours de la montre, meilleurs efforts comparés
// à la VC et au D′, détection d'un test VC, découplage cardiaque (durabilité).
import { timesAt, type Activity } from './activity'
import { gapFactor } from './model'
import type { Athlete, CsTrial } from './types'
import { VAM_MIN_GRADE, vamZoneIndex, vamZonesOf } from './vam'
import { zoneIndexOfIntensity } from './zones'

interface Series {
  d: number[]
  e: number[]
  /** Temps écoulé et en mouvement (s). */
  t: number[]
  m: number[]
  /** Distance plat équivalente cumulée (m). */
  eq: number[]
}

function series(act: Activity): Series {
  const pts = act.track.points
  const n = pts.length
  const d = pts.map((p) => p.dist)
  const e = pts.map((p) => p.ele)
  const times = pts.map((p) => timesAt(act, p.dist))
  const eq = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    // Pente lissée sur ±60 m pour limiter le bruit de l'altitude.
    const a = Math.max(0, i - 3)
    const b = Math.min(n - 1, i + 3)
    const grade = d[b] > d[a] ? ((e[b] - e[a]) / (d[b] - d[a])) * 100 : 0
    eq[i] = eq[i - 1] + (d[i] - d[i - 1]) / gapFactor(grade)
  }
  return { d, e, t: times.map((x) => x.elapsed), m: times.map((x) => x.moving), eq }
}

export interface ZoneTime {
  index: number
  name: string
  seconds: number
}

export interface LapInfo {
  index: number
  /** Début (s depuis le départ). */
  start: number
  duration: number
  distance: number
  dPlus: number
  /** Intensité plat équivalente (fraction de VC). */
  intensity: number
  zone: number
  /** Fréquence cardiaque moyenne (bpm), si enregistrée. */
  hr: number | null
}

export interface BestEffort {
  seconds: number
  /** Vitesse plat équivalente moyenne (m/s). */
  speed: number
  /** Vitesse maximale prévue par VC et D′ sur cette durée (m/s). */
  predicted: number
  ratio: number
}

export interface Insights {
  zoneTimes: ZoneTime[]
  /** Temps par zone cardiaque (si la FC est enregistrée). */
  hrZoneTimes: ZoneTime[] | null
  /** Temps par zone de vitesse ascensionnelle, dans les montées (null sans montée). */
  vamZoneTimes: ZoneTime[] | null
  laps: LapInfo[]
  best: BestEffort[]
  /** VC minimale qu'impliquent les meilleurs efforts (2 à 30 min), si supérieure à la VC actuelle. */
  csFloor: { cs: number; seconds: number } | null
  /** Tours qui ressemblent à un test VC (3′, 7′ ou 12′ à fond). */
  tests: CsTrial[]
}

export const EFFORT_DURATIONS = [60, 180, 300, 420, 720, 1200, 1800, 3600]

const SEG = 200

export function analyzeSession(act: Activity, a: Athlete): Insights {
  const s = series(act)
  const n = s.d.length
  const idxAt = (dist: number) => Math.min(n - 1, Math.max(0, Math.round(dist / 20)))

  // Temps par zone, par tronçons de 200 m (temps en mouvement).
  const zoneSec = a.zones.map(() => 0)
  for (let from = 0; from < act.track.totalDist; from += SEG) {
    const i = idxAt(from)
    const j = idxAt(Math.min(act.track.totalDist, from + SEG))
    const dt = s.m[j] - s.m[i]
    if (j <= i || dt <= 0) continue
    const intensity = (s.eq[j] - s.eq[i]) / dt / a.cs
    zoneSec[zoneIndexOfIntensity(intensity, a)] += dt
  }
  const zoneTimes = a.zones.map((z, index) => ({ index, name: z.name, seconds: zoneSec[index] }))

  // Temps par zone VAM : tronçons de 200 m dont la pente dépasse VAM_MIN_GRADE.
  const vamZones = vamZonesOf(a)
  let vamZoneTimes: ZoneTime[] | null = null
  if (vamZones.length) {
    const sec = vamZones.map(() => 0)
    for (let from = 0; from < act.track.totalDist; from += SEG) {
      const i = idxAt(from)
      const j = idxAt(Math.min(act.track.totalDist, from + SEG))
      const dt = s.m[j] - s.m[i]
      const dz = s.e[j] - s.e[i]
      const dx = s.d[j] - s.d[i]
      if (j <= i || dt <= 0 || dx <= 0 || (dz / dx) * 100 < VAM_MIN_GRADE) continue
      sec[vamZoneIndex((dz / dt) * 3600, vamZones)] += dt
    }
    if (sec.some((x) => x > 0)) vamZoneTimes = vamZones.map((z, index) => ({ index, name: z.name, seconds: sec[index] }))
  }

  // Tours de la montre : temps → distance le long de la trace.
  const rawTotal = act.dist[act.dist.length - 1] || 1
  const distAtElapsed = (sec: number) => {
    let lo = 0
    let hi = act.elapsed.length - 1
    if (sec <= 0) return 0
    if (sec >= act.elapsed[hi]) return act.track.totalDist
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (act.elapsed[mid] <= sec) lo = mid
      else hi = mid
    }
    const f = (sec - act.elapsed[lo]) / (act.elapsed[hi] - act.elapsed[lo] || 1)
    return ((act.dist[lo] + f * (act.dist[hi] - act.dist[lo])) / rawTotal) * act.track.totalDist
  }
  // Fréquence cardiaque : temps en mouvement par zone, et moyenne d'un intervalle de temps.
  const hasHr = act.hr.some((h) => Number.isFinite(h))
  let hrZoneTimes: ZoneTime[] | null = null
  if (hasHr && a.hrZones.length) {
    const sec = a.hrZones.map(() => 0)
    for (let k = 1; k < act.hr.length; k++) {
      const h = act.hr[k]
      const dt = act.moving[k] - act.moving[k - 1]
      if (!Number.isFinite(h) || dt <= 0 || dt > 30) continue
      let z = a.hrZones.findIndex((x) => h >= x.low && h < x.high)
      if (z < 0) z = h < a.hrZones[0].low ? 0 : a.hrZones.length - 1
      sec[z] += dt
    }
    hrZoneTimes = a.hrZones.map((z, index) => ({ index, name: z.name, seconds: sec[index] }))
  }
  const hrMean = (t0: number, t1: number): number | null => {
    let sum = 0
    let n = 0
    for (let k = 0; k < act.hr.length; k++) {
      if (act.elapsed[k] < t0 || act.elapsed[k] > t1 || !Number.isFinite(act.hr[k])) continue
      sum += act.hr[k]
      n++
    }
    return n ? Math.round(sum / n) : null
  }

  const laps: LapInfo[] = act.laps.map((l, index) => {
    const start = (l.start - act.start) / 1000
    const i = idxAt(distAtElapsed(start))
    const j = idxAt(distAtElapsed(start + l.elapsed))
    let dPlus = 0
    for (let k = i + 1; k <= j; k++) dPlus += Math.max(0, s.e[k] - s.e[k - 1])
    const dt = s.m[j] - s.m[i]
    const intensity = dt > 0 ? (s.eq[j] - s.eq[i]) / dt / a.cs : l.timer > 0 ? l.distance / l.timer / a.cs : 0
    return { index, start, duration: l.timer, distance: l.distance, dPlus, intensity, zone: zoneIndexOfIntensity(intensity, a), hr: hasHr ? hrMean(start, start + l.elapsed) : null }
  })

  // Meilleurs efforts (temps écoulé : les arrêts comptent).
  const best: BestEffort[] = []
  for (const T of EFFORT_DURATIONS) {
    let top = 0
    let j = 0
    for (let i = 0; i < n; i++) {
      if (j < i) j = i
      while (j < n && s.t[j] - s.t[i] < T) j++
      if (j >= n) break
      top = Math.max(top, (s.eq[j] - s.eq[i]) / (s.t[j] - s.t[i]))
    }
    if (top > 0) {
      const predicted = a.cs + a.dPrime / T
      best.push({ seconds: T, speed: top, predicted, ratio: top / predicted })
    }
  }
  // Un effort de 2 à 30 min au-dessus du modèle implique une VC au moins égale à v − D′/T.
  let csFloor: Insights['csFloor'] = null
  for (const b of best) {
    if (b.seconds < 120 || b.seconds > 1800 || b.ratio <= 1.01) continue
    const cs = b.speed - a.dPrime / b.seconds
    if (cs > a.cs && (!csFloor || cs > csFloor.cs)) csFloor = { cs, seconds: b.seconds }
  }

  // Tours de 3′, 7′ ou 12′ courus à fond (≥ 95 % VC) : candidats au test VC.
  const tests: CsTrial[] = []
  for (const sec of [180, 420, 720]) {
    const lap = laps
      .filter((l) => Math.abs(l.duration - sec) <= Math.max(3, sec * 0.02) && l.intensity >= 0.95 && l.distance > 0)
      .sort((x, y) => y.distance - x.distance)[0]
    if (lap) {
      tests.push({ id: crypto.randomUUID(), date: new Date(act.start).toISOString(), seconds: sec, dist: Math.round((lap.distance * sec) / lap.duration), source: 'lap' })
    }
  }

  return { zoneTimes, hrZoneTimes, vamZoneTimes, laps, best, csFloor, tests }
}

// --- Durabilité : découplage cardiaque ---------------------------------------------
// La durabilité est la détérioration des caractéristiques physiologiques au fil d'un effort
// prolongé, décrite par son moment d'apparition et son ampleur (Maunder et al., 2021). Sur le
// terrain, Hunter et al. (2025) proposent le découplage cardiaque : à allure égale, le rapport
// FC / vitesse augmente. En trail, la vitesse est ramenée au plat (correction de pente).

/** Durée minimale en mouvement pour mesurer le découplage (s). */
export const DRIFT_MIN_SECONDS = 3600
/** Fenêtres de 10 min en mouvement (lissent les bosses), échauffement exclu, référence = 10 à 30 min. */
const DRIFT_WINDOW = 600
const DRIFT_WARMUP = 600
const DRIFT_BASE_END = 1800
/** Ampleur en deçà de laquelle on ne parle pas de dérive (fraction). */
const DRIFT_MIN_RISE = 0.02

export interface DriftPoint {
  /** Milieu de la fenêtre (s en mouvement). */
  t: number
  /** FC / vitesse au plat (bpm par km/h). */
  ratio: number
  /** Écart à la référence (fraction). */
  drift: number
}

export interface CardiacDrift {
  points: DriftPoint[]
  /** Rapport de référence (10 à 30 min). */
  baseline: number
  /** Découplage : 20 dernières minutes par rapport à la référence (fraction). */
  decoupling: number
  /** Début de la dérive (h en mouvement), null s'il n'y a pas de dérive nette. */
  onsetH: number | null
  /** Vitesse de la dérive une fois commencée (fraction par heure). */
  perHour: number
  /** Niveau ajusté avant la dérive (fraction, ≈ 0). */
  level: number
  /** Durée analysée (s en mouvement). */
  seconds: number
}

/**
 * Découplage cardiaque d'une séance (FC et au moins 1 h en mouvement) : rapport FC / vitesse au
 * plat par fenêtres de 5 min, comparé à celui de 10 à 30 min. Le début de la dérive est le coude
 * d'une droite brisée (palier puis hausse) ajustée sur les fenêtres.
 */
export function cardiacDrift(act: Activity): CardiacDrift | null {
  const nRaw = act.moving.length
  const total = act.moving[nRaw - 1] ?? 0
  if (total < DRIFT_MIN_SECONDS || !act.hr.some((h) => Number.isFinite(h))) return null
  const s = series(act)
  // Distance au plat cumulée à un temps en mouvement donné.
  const eqAt = (t: number): number => {
    let lo = 0
    let hi = s.m.length - 1
    if (t <= s.m[0]) return s.eq[0]
    if (t >= s.m[hi]) return s.eq[hi]
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (s.m[mid] <= t) lo = mid
      else hi = mid
    }
    const f = (t - s.m[lo]) / (s.m[hi] - s.m[lo] || 1)
    return s.eq[lo] + (s.eq[hi] - s.eq[lo]) * f
  }
  const raw: { t: number; ratio: number }[] = []
  let k = 1
  for (let t0 = 0; t0 + DRIFT_WINDOW <= total; t0 += DRIFT_WINDOW) {
    const t1 = t0 + DRIFT_WINDOW
    let sum = 0
    let w = 0
    while (k < nRaw && act.moving[k] <= t1) {
      const dt = act.moving[k] - act.moving[k - 1]
      if (act.moving[k] > t0 && dt > 0 && dt < 30 && Number.isFinite(act.hr[k])) {
        sum += act.hr[k] * dt
        w += dt
      }
      k++
    }
    const kmh = ((eqAt(t1) - eqAt(t0)) / DRIFT_WINDOW) * 3.6
    // Fenêtre retenue : FC présente sur 60 % du temps au moins, et on avance vraiment.
    if (w >= DRIFT_WINDOW * 0.6 && kmh >= 3.6 && t0 >= DRIFT_WARMUP) raw.push({ t: (t0 + t1) / 2, ratio: sum / w / kmh })
  }
  if (raw.length < 5) return null
  const base = raw.filter((p) => p.t <= DRIFT_BASE_END)
  const ref = base.length >= 2 ? base : raw.slice(0, 2)
  const baseline = ref.reduce((a, p) => a + p.ratio, 0) / ref.length
  const points = raw.map((p) => ({ ...p, drift: p.ratio / baseline - 1 }))
  const end = points.filter((p) => p.t >= points[points.length - 1].t - 1200)
  const decoupling = end.reduce((a, p) => a + p.drift, 0) / end.length
  // Droite brisée y = c + pente × max(0, t − b) : coude b qui minimise l'erreur.
  let best = { sse: Infinity, b: 0, c: 0, slope: 0 }
  for (let i = 1; i < points.length - 2; i++) {
    const b = points[i].t
    const fit = brokenLine(points, b)
    if (fit && fit.slope > 0 && fit.sse < best.sse) best = { ...fit, b }
  }
  const lastT = points[points.length - 1].t
  const rise = best.slope * (lastT - best.b)
  const drifts = best.sse < Infinity && rise >= DRIFT_MIN_RISE
  return {
    points,
    baseline,
    decoupling,
    onsetH: drifts ? best.b / 3600 : null,
    perHour: drifts ? best.slope * 3600 : 0,
    level: drifts ? best.c : 0,
    seconds: total,
  }
}

/** Moindres carrés de y = c + pente × max(0, t − b). */
function brokenLine(pts: DriftPoint[], b: number): { c: number; slope: number; sse: number } | null {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const p of pts) {
    const x = Math.max(0, p.t - b)
    n++
    sx += x
    sy += p.drift
    sxx += x * x
    sxy += x * p.drift
  }
  const det = n * sxx - sx * sx
  if (det <= 0) return null
  const slope = (n * sxy - sx * sy) / det
  const c = (sy - slope * sx) / n
  const sse = pts.reduce((a, p) => a + (p.drift - c - slope * Math.max(0, p.t - b)) ** 2, 0)
  return { c, slope, sse }
}

