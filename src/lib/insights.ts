// Analyse générale d'une séance quelconque : allure « plat équivalent » (correction
// de pente de Minetti), temps par zone, tours de la montre, meilleurs efforts comparés
// à la VC et au D′, détection d'un test VC.
import { timesAt, type Activity } from './activity'
import { gapFactor } from './model'
import type { Athlete, CsTrial } from './types'
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

  return { zoneTimes, hrZoneTimes, laps, best, csFloor, tests }
}
