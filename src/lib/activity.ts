// Analyse d'activités enregistrées (GPX horodaté ou FIT de montre) et
// calibration du profil : durabilité, vitesse ascensionnelle, descente.
import { decodeFit, isFit, type FitLap } from './fitDecode'
import { elevationAt, gpxRawPoints, haversine, projectOnTrack, trackFromRaw, type RawPoint } from './gpx'
import { autoTech, environment, gapFactor, intensityAt, simulate, withFinish } from './model'
import type { ActivityRecord, Athlete, DescentPoint, Durability, EnvSettings, GradeStat, Race, Track, VamPoint } from './types'

export interface Activity {
  name: string
  track: Track
  /** Départ (ms Unix). */
  start: number
  /** Distance brute cumulée (m), temps écoulé (s) et temps en mouvement (s) par point brut. */
  dist: Float64Array
  elapsed: Float64Array
  moving: Float64Array
  /** Tours enregistrés par la montre (FIT uniquement). */
  laps: FitLap[]
  /** Fréquence cardiaque par point brut (NaN si absente). */
  hr: Float64Array
}

// --- Tours retenus pour les analyses ----------------------------------------------

/**
 * Portions de la séance retenues pour les analyses, en secondes écoulées depuis le départ
 * (tours de la montre choisis) ; null = toute la séance.
 */
export type Portions = [number, number][] | null

export const inPortions = (p: Portions, elapsedSec: number): boolean => !p || p.some(([a, b]) => elapsedSec >= a && elapsedSec <= b)

/** Portions correspondant aux tours cochés (null si tous le sont). */
export function lapPortions(act: Activity, keep: boolean[]): Portions {
  if (!act.laps.length || act.laps.every((_, i) => keep[i] !== false)) return null
  return act.laps.flatMap((l, i): [number, number][] => {
    if (keep[i] === false) return []
    const t0 = (l.start - act.start) / 1000
    return [[t0, t0 + l.elapsed]]
  })
}

/** Tours retenus d'office : tous sauf l'échauffement et le retour au calme marqués par la montre. */
export function defaultLapKeep(act: Activity): boolean[] {
  const keep = act.laps.map((l) => l.intensity !== 'warmup' && l.intensity !== 'cooldown')
  return keep.some(Boolean) ? keep : act.laps.map(() => true)
}

/** Sans échauffement ni retour au calme : tours marqués par la montre, sinon premier et dernier tours. */
export function lapKeepWithoutEnds(act: Activity): boolean[] {
  const n = act.laps.length
  if (act.laps.some((l) => l.intensity === 'warmup' || l.intensity === 'cooldown')) return defaultLapKeep(act)
  return act.laps.map((_, i) => n < 3 || (i > 0 && i < n - 1))
}

/** Distance le long de la trace (m) au temps écoulé `sec`. */
export function distAtElapsed(act: Activity, sec: number): number {
  const rawTotal = act.dist[act.dist.length - 1] || 1
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

/** Lit un fichier d'activité (GPX ou FIT) ; il doit être horodaté. */
export function readActivity(fileName: string, bytes: Uint8Array): Activity {
  let raw: RawPoint[]
  let laps: FitLap[] = []
  let name = fileName.replace(/\.(gpx|fit)$/i, '')
  if (isFit(bytes)) {
    const fit = decodeFit(bytes)
    raw = fit.records
    laps = fit.laps
  } else {
    const xml = new TextDecoder().decode(bytes)
    raw = gpxRawPoints(xml)
    const m = /<trk>\s*<name>([^<]+)<\/name>/.exec(xml)
    if (m && m[1].trim() && !/^(trail|run|course|activity)$/i.test(m[1].trim())) name = m[1].trim()
  }
  raw = raw.filter((p) => p.time !== undefined)
  if (raw.length < 10) throw new Error("Cette trace n'est pas horodatée : il faut l'enregistrement de ta montre (GPX ou FIT).")
  raw.sort((a, b) => a.time! - b.time!)
  return activityFromRaw(name, raw, laps)
}

export function activityFromRaw(name: string, raw: RawPoint[], laps: FitLap[] = []): Activity {
  const n = raw.length
  const dist = new Float64Array(n)
  const elapsed = new Float64Array(n)
  const moving = new Float64Array(n)
  const t0 = raw[0].time!
  for (let i = 1; i < n; i++) {
    dist[i] = dist[i - 1] + haversine(raw[i - 1].lat, raw[i - 1].lon, raw[i].lat, raw[i].lon)
    elapsed[i] = (raw[i].time! - t0) / 1000
  }
  // Arrêts : vitesse moyenne < 0,3 m/s sur une fenêtre d'environ ±10 s.
  for (let i = 1; i < n; i++) {
    const dt = elapsed[i] - elapsed[i - 1]
    let a = i
    let b = i
    while (a > 0 && elapsed[i] - elapsed[a - 1] <= 10) a--
    while (b < n - 1 && elapsed[b + 1] - elapsed[i] <= 10) b++
    const span = elapsed[b] - elapsed[a]
    const v = span > 0 ? (dist[b] - dist[a]) / span : (dist[i] - dist[i - 1]) / Math.max(dt, 1)
    moving[i] = moving[i - 1] + (v < 0.3 ? 0 : dt)
  }
  const track = trackFromRaw(raw, name, 2)
  const hr = Float64Array.from(raw, (p) => p.hr ?? NaN)
  return { name, track, start: t0, dist, elapsed, moving, laps, hr }
}

/** Temps écoulé et en mouvement (s) à une distance de la trace. */
export function timesAt(a: Activity, d: number): { elapsed: number; moving: number } {
  const x = (d / (a.track.totalDist || 1)) * a.dist[a.dist.length - 1]
  let lo = 0
  let hi = a.dist.length - 1
  if (x <= 0) return { elapsed: 0, moving: 0 }
  if (x >= a.dist[hi]) return { elapsed: a.elapsed[hi], moving: a.moving[hi] }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (a.dist[mid] <= x) lo = mid
    else hi = mid
  }
  const f = (x - a.dist[lo]) / (a.dist[hi] - a.dist[lo] || 1)
  return {
    elapsed: a.elapsed[lo] + f * (a.elapsed[hi] - a.elapsed[lo]),
    moving: a.moving[lo] + f * (a.moving[hi] - a.moving[lo]),
  }
}

/** Environnement pour l'analyse : chaleur et pluie inconnues, donc neutralisées. */
function analysisEnv(start: number, base: EnvSettings): EnvSettings {
  return {
    ...base,
    start: new Date(start).toISOString().slice(0, 16),
    timeZone: 'UTC',
    heat: { ...base.heat, enabled: false },
    rain: { ...base.rain, enabled: false },
  }
}

export const UP_BUCKETS: [number, number][] = [
  [10, 15],
  [15, 20],
  [20, 25],
  [25, 30],
  [30, 40],
  [40, 80],
]
export const DOWN_BUCKETS: [number, number][] = [
  [-8, -3],
  [-13, -8],
  [-18, -13],
  [-23, -18],
  [-30, -23],
  [-45, -30],
  [-80, -45],
]

interface Seg {
  h: number
  grade: number
  dist: number
  dz: number
  dt: number
  mult: number
}

const SEG = 200

function segments(a: Activity, env: EnvSettings, portions: Portions = null): Seg[] {
  const out: Seg[] = []
  const pts = a.track.points
  for (let s = 0; s + SEG <= a.track.totalDist; s += SEG) {
    const dz = elevationAt(pts, s + SEG) - elevationAt(pts, s)
    const grade = (dz / SEG) * 100
    const t0 = timesAt(a, s)
    const t1 = timesAt(a, s + SEG)
    const dt = t1.moving - t0.moving
    if (dt <= 1 || !inPortions(portions, (t0.elapsed + t1.elapsed) / 2)) continue
    const mid = pts[Math.min(pts.length - 1, Math.round((s + SEG / 2) / 20))]
    const e = environment(env, {
      ms: a.start + ((t0.elapsed + t1.elapsed) / 2) * 1000,
      lat: mid.lat,
      lon: mid.lon,
      dist: mid.dist,
      ele: mid.ele,
      tech: autoTech(grade),
      offsetMs: 0,
    })
    out.push({ h: (t0.elapsed + t1.elapsed) / 7200, grade, dist: SEG, dz, dt, mult: e.mult })
  }
  return out
}

/** Ajuste la durabilité sur des points (heure, %VC observé). */
export function fitDurability(points: [number, number][], current: Durability): Durability | null {
  if (points.length < 6) return null
  const hs = points.map((p) => p[0])
  if (Math.max(...hs) - Math.min(...hs) < 1) return null
  const xOf = (h: number) => (current.mode === 'log' ? Math.max(0, 1 + Math.log(h)) : Math.max(0, h - current.onsetH))
  const n = points.length
  const mx = points.reduce((s, p) => s + xOf(p[0]), 0) / n
  const my = points.reduce((s, p) => s + p[1], 0) / n
  let sxx = 0
  let sxy = 0
  for (const [h, y] of points) {
    sxx += (xOf(h) - mx) ** 2
    sxy += (xOf(h) - mx) * (y - my)
  }
  if (sxx < 1e-6) return null
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  if (current.mode === 'log') return { ...current, pct1h: clamp(intercept, 0.6, 1.1), k: clamp(-slope, 0, 0.25) }
  return { ...current, basePct: clamp(intercept, 0.5, 1.05), lossPerH: clamp(-slope, 0, 0.1) }
}

/** %VC observé sur le plat et les faux plats, médiane par quart d'heure. */
function intensityBins(segs: Seg[], athlete: Athlete): [number, number][] {
  const byBin = new Map<number, number[]>()
  for (const s of segs) {
    if (s.grade <= -3 || s.grade >= athlete.walkThreshold) continue
    const v = s.dist / s.dt
    const i = v / (athlete.cs * gapFactor(s.grade) * s.mult)
    const bin = Math.floor(s.h * 4)
    byBin.set(bin, [...(byBin.get(bin) ?? []), i])
  }
  return [...byBin.entries()]
    .filter(([, xs]) => xs.length >= 3)
    .map(([bin, xs]) => {
      const sorted = [...xs].sort((a, b) => a - b)
      return [(bin + 0.5) / 4, sorted[Math.floor(sorted.length / 2)]] as [number, number]
    })
    .sort((a, b) => a[0] - b[0])
}

function gradeStats(segs: Seg[], athlete: Athlete, durability: Durability): GradeStat[] {
  const stats: GradeStat[] = []
  const add = (lo: number, hi: number, kind: 'up' | 'down') => {
    const sel = segs.filter((s) => s.grade >= lo && s.grade < hi)
    if (!sel.length) return
    const dist = sel.reduce((a, s) => a + s.dist, 0)
    const dz = sel.reduce((a, s) => a + s.dz, 0)
    const time = sel.reduce((a, s) => a + s.dt, 0)
    // Temps « ramené à l'intensité VC » : dt × intensité × facteur d'environnement.
    const normTime = sel.reduce((a, s) => a + s.dt * intensityAt(s.h, durability) * s.mult, 0)
    const normalized = kind === 'up' ? (dz / normTime) * 3600 : dist / normTime / athlete.cs
    stats.push({ lo, hi, dist, dz, time, normalized })
  }
  for (const [lo, hi] of UP_BUCKETS) if (hi > athlete.walkThreshold) add(Math.max(lo, athlete.walkThreshold), hi, 'up')
  for (const [lo, hi] of DOWN_BUCKETS) add(lo, hi, 'down')
  // Côtes courues : rapport à la vitesse prévue par Minetti.
  const run = segs.filter((s) => s.grade >= 3 && s.grade < athlete.walkThreshold)
  if (run.length) {
    const dist = run.reduce((a, s) => a + s.dist, 0)
    const expected = run.reduce((a, s) => a + s.dist / (athlete.cs * gapFactor(s.grade) * intensityAt(s.h, durability) * s.mult), 0)
    const time = run.reduce((a, s) => a + s.dt, 0)
    stats.push({ lo: 3, hi: athlete.walkThreshold, dist, dz: run.reduce((a, s) => a + s.dz, 0), time, normalized: expected / time })
  }
  return stats
}

export interface Analysis {
  activity: Activity
  record: ActivityRecord
  /** Écart cumulé réel − prédit (s, en mouvement) tous les 500 m. */
  curve: { dist: number; real: number; predicted: number }[]
  /** Points (heure, %VC) observés. */
  intensity: [number, number][]
}

/**
 * Analyse d'une activité. `portions` : tours retenus (échauffement et retour au calme exclus,
 * par exemple) pour l'intensité au fil des heures et les mesures par pente ; l'écart à la
 * prévision porte toujours sur toute la séance.
 */
export function analyzeActivity(a: Activity, athlete: Athlete, baseEnv: EnvSettings, portions: Portions = null): Analysis {
  const env = analysisEnv(a.start, baseEnv)
  const segs = segments(a, env, portions)
  const intensity = intensityBins(segs, athlete)
  const fitted = fitDurability(intensity, athlete.durability) ?? athlete.durability
  const sim = simulate(a.track, athlete, { mode: 'physio', kme: { upPer1km: 100, downPer1km: 0 }, env, checkpoints: [], techOverrides: [] })
  const end = timesAt(a, a.track.totalDist)
  const curve: Analysis['curve'] = []
  for (let d = 0; d <= a.track.totalDist; d += 500) {
    const p = sim.points[Math.min(sim.points.length - 1, Math.round(d / 20))]
    curve.push({ dist: d, real: timesAt(a, d).moving, predicted: p.t })
  }
  const record: ActivityRecord = {
    id: crypto.randomUUID(),
    name: a.name,
    date: new Date(a.start).toISOString(),
    dist: a.track.totalDist,
    dPlus: a.track.dPlus,
    elapsed: end.elapsed,
    moving: end.moving,
    predicted: sim.totalTime,
    intensity,
    grades: gradeStats(segs, athlete, fitted),
    useForCalibration: true,
  }
  return { activity: a, record, curve, intensity }
}

export interface Calibration {
  athlete: Athlete
  changes: string[]
}

const mergeTable = <T extends { grade: number }>(current: T[], measured: T[]): T[] =>
  [...current.filter((c) => measured.every((m) => Math.abs(m.grade - c.grade) > 4)), ...measured].sort(
    (a, b) => a.grade - b.grade,
  )

/** Calibre le profil à partir des activités cochées. */
export function calibrateFromActivities(athlete: Athlete, records: ActivityRecord[]): Calibration {
  const used = records.filter((r) => r.useForCalibration)
  const changes: string[] = []
  let next: Athlete = { ...athlete }
  if (!used.length) return { athlete: next, changes: ['Aucune activité cochée pour la calibration.'] }

  const dur = fitDurability(
    used.flatMap((r) => r.intensity),
    athlete.durability,
  )
  if (dur) {
    next.durability = dur
    changes.push(
      dur.mode === 'log'
        ? `Durabilité : %VC 1 h ${Math.round(athlete.durability.pct1h * 100)} → ${Math.round(dur.pct1h * 100)} %, k ${(athlete.durability.k * 100).toFixed(1)} → ${(dur.k * 100).toFixed(1)}`
        : `Durabilité : départ ${Math.round(athlete.durability.basePct * 100)} → ${Math.round(dur.basePct * 100)} %, perte ${(athlete.durability.lossPerH * 100).toFixed(2)} → ${(dur.lossPerH * 100).toFixed(2)} %/h`,
    )
  } else changes.push('Durabilité inchangée : pas assez de portions courues ou activités trop courtes (< 1 h 30).')

  const combine = (lo: number, hi: number) => {
    const all = used.flatMap((r) => r.grades.filter((g) => g.lo === lo && g.hi === hi))
    const dist = all.reduce((a, g) => a + g.dist, 0)
    if (dist < 400) return null
    return {
      grade: Math.round((all.reduce((a, g) => a + g.dz, 0) / dist) * 1000) / 10,
      value: all.reduce((a, g) => a + g.normalized * g.dist, 0) / dist,
      dist,
    }
  }
  const vam: VamPoint[] = []
  const descent: DescentPoint[] = []
  const keys = new Set(used.flatMap((r) => r.grades.map((g) => `${g.lo}|${g.hi}`)))
  for (const k of keys) {
    const [lo, hi] = k.split('|').map(Number)
    if (lo === 3) continue // côtes courues : indicateur seulement
    const c = combine(lo, hi)
    if (!c) continue
    if (lo >= 0) vam.push({ grade: c.grade, vam: Math.round(c.value) })
    else descent.push({ grade: c.grade, factor: Math.round(c.value * 100) / 100 })
  }
  if (vam.length) {
    next.vam = mergeTable(athlete.vam, vam)
    changes.push(`Vitesse ascensionnelle mesurée : ${vam.sort((a, b) => a.grade - b.grade).map((v) => `${v.grade} % → ${v.vam} m/h`).join(', ')}`)
  } else changes.push('Vitesse ascensionnelle inchangée : pas assez de montées raides (≥ 400 m par tranche).')
  if (descent.length) {
    next.descent = mergeTable(athlete.descent, descent)
    changes.push(`Descente mesurée : ${descent.sort((a, b) => b.grade - a.grade).map((d) => `${d.grade} % → ×${d.factor.toFixed(2)}`).join(', ')}`)
  }
  next = { ...next, updatedAt: new Date().toISOString() }
  return { athlete: next, changes }
}

/**
 * Calibration complète : tables et durabilité depuis les activités cochées, puis
 * ajustement du niveau d'intensité pour retrouver le temps en mouvement de l'activité affichée.
 */
export function calibrateOnActivity(
  athlete: Athlete,
  records: ActivityRecord[],
  current: Activity,
  currentRecord: ActivityRecord,
  baseEnv: EnvSettings,
  portions: Portions = null,
): Calibration {
  const cal = calibrateFromActivities(athlete, records)
  const env = analysisEnv(current.start, baseEnv)
  const d0 = cal.athlete.durability
  const withScale = (m: number): Athlete => ({
    ...cal.athlete,
    durability: { ...d0, pct1h: d0.pct1h * m, basePct: d0.basePct * m },
  })
  // Niveau ajusté sur les tours retenus seulement (la simulation couvre toute la séance, pour
  // garder l'heure de course de chaque portion).
  const spans: [number, number][] = portions
    ? portions.map(([a, b]) => [distAtElapsed(current, a), distAtElapsed(current, b)])
    : [[0, current.track.totalDist]]
  const actual = portions ? spans.reduce((t, [a, b]) => t + timesAt(current, b).moving - timesAt(current, a).moving, 0) : currentRecord.moving
  const run = (m: number) => {
    const sim = simulate(current.track, withScale(m), { mode: 'physio', kme: { upPer1km: 100, downPer1km: 0 }, env, checkpoints: [], techOverrides: [] })
    if (!portions) return sim.totalTime
    const tAt = (d: number) => sim.points[Math.min(sim.points.length - 1, Math.round(d / 20))].t
    return spans.reduce((t, [a, b]) => t + tAt(b) - tAt(a), 0)
  }
  let lo = 0.8
  let hi = 1.2
  if (actual > 0 && run(hi) <= actual && run(lo) >= actual) {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (run(mid) > actual) lo = mid
      else hi = mid
    }
    const m = (lo + hi) / 2
    if (Math.abs(m - 1) > 0.002) {
      cal.changes.push(
        `Niveau ajusté de ${m > 1 ? '+' : ''}${((m - 1) * 100).toFixed(1)} % pour retrouver le temps en mouvement de « ${current.name} »${portions ? ' (tours retenus)' : ''}.`,
      )
    }
    return { athlete: withScale(m), changes: cal.changes }
  }
  return cal
}

export interface PlanComparison {
  name: string
  dist: number
  planned: number
  real: number
}

/** Compare les passages réels aux temps prévus d'un plan (points projetés sur l'activité). */
export function compareWithPlan(a: Activity, race: Race, planTrack: Track, arrivals: Map<string, number>): PlanComparison[] {
  const rows: PlanComparison[] = []
  let minDist = 0
  for (const cp of withFinish(race, planTrack)) {
    const p = planTrack.points[Math.min(planTrack.points.length - 1, Math.round(cp.dist / 20))]
    // Projection dans l'ordre du parcours (évite les boucles qui repassent au même endroit).
    const after = { ...a.track, points: a.track.points.filter((q) => q.dist >= minDist) }
    const d = after.points.length ? projectOnTrack(after.points, p.lat, p.lon) : a.track.totalDist
    minDist = d
    rows.push({ name: cp.name, dist: cp.dist, planned: arrivals.get(cp.id) ?? NaN, real: timesAt(a, d).elapsed })
  }
  return rows
}
