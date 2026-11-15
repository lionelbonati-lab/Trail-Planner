// Niveau sans test VC : on part d'une course ou d'un entraînement déjà fait et on cherche le profil
// qui redonne le temps réalisé, pour prédire les temps de passage d'autres courses.
//
// Niveau global m : VC et VAM multipliées par m (la descente, relative à la VC, suit). Avec
// l'enregistrement d'une course (effort de course), on mesure en plus la VAM par pente, la descente
// et la durabilité sur la sortie, puis la VC est réajustée pour retrouver le temps en mouvement.
import { analysisEnv, analyzeActivity, calibrateFromActivities, timesAt, type Activity } from './activity'
import { DEFAULT_ATHLETE } from './defaults'
import { simulate, type SimOptions } from './model'
import { formatPace } from './time'
import type { Athlete, EnvSettings, Track } from './types'
import { interpVam } from './vam'
import { wholeRoute, zoneTarget } from './zones'

/** Effort de la sortie de référence : course (à fond sur la durée) ou zone d'entraînement du profil. */
export type Effort = { kind: 'race' } | { kind: 'zone'; index: number }

export interface LevelEstimate {
  athlete: Athlete
  /** Changements du profil, lisibles. */
  changes: string[]
  /** Temps prédit sur la sortie avec le nouveau profil (s). */
  predicted: number
  /** Temps réalisé (s) : en mouvement pour un enregistrement, à l'arrivée pour un temps saisi. */
  actual: number
}

/** Profil jamais réglé : VC par défaut, aucun test VC ni activité analysée. */
export function isDefaultLevel(a: Athlete): boolean {
  return Math.abs(a.cs - DEFAULT_ATHLETE.cs) < 1e-6 && a.csTrials.length === 0 && a.history.length === 0 && a.activities.length === 0
}

/** Profil au niveau m : VC et VAM multipliées par m. */
export function scaleLevel(a: Athlete, m: number): Athlete {
  return { ...a, cs: a.cs * m, vam: a.vam.map((v) => ({ ...v, vam: Math.round(v.vam * m) })) }
}

/** Zones imposées par l'effort : une zone du profil sur tout le parcours, ou aucune (intensité de course). */
function withEffort(opts: SimOptions, a: Athlete, effort: Effort, total: number): SimOptions {
  return { ...opts, zones: effort.kind === 'zone' ? wholeRoute(zoneTarget(a, effort.index), total) : [] }
}

/** Facteur qui redonne `target` (s) ; `time` décroît avec le facteur. Null si hors de [lo, hi]. */
function solve(time: (m: number) => number, target: number, lo: number, hi: number): number | null {
  if (!(target > 0) || time(lo) < target || time(hi) > target) return null
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    if (time(mid) > target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Lignes VC et VAM à 20 % avant → après. */
function levelLines(before: Athlete, after: Athlete): string[] {
  const vam = (a: Athlete) => Math.round(interpVam(a, 20))
  return [
    `Vitesse critique : ${formatPace(1000 / before.cs)} → ${formatPace(1000 / after.cs)} /km`,
    `Vitesse ascensionnelle à 20 % (à VC) : ${vam(before)} → ${vam(after)} m/h`,
  ]
}

/**
 * Niveau d'après un temps réalisé sur un parcours de l'app (temps d'arrivée, arrêts compris :
 * les arrêts prévus du plan sont comptés dans la simulation).
 */
export function levelFromTime(track: Track, athlete: Athlete, opts: SimOptions, target: number, effort: Effort): LevelEstimate | null {
  const o = withEffort(opts, athlete, effort, track.totalDist)
  const time = (m: number) => simulate(track, scaleLevel(athlete, m), o).totalTime
  const m = solve(time, target, 0.3, 3)
  if (m === null) return null
  const next = { ...scaleLevel(athlete, m), updatedAt: new Date().toISOString() }
  return { athlete: next, changes: levelLines(athlete, next), predicted: time(m), actual: target }
}

/**
 * Niveau d'après l'enregistrement d'une sortie (temps en mouvement). Niveau global d'abord ; pour
 * un effort de course, VAM par pente, descente et durabilité mesurées ensuite sur la sortie, puis VC
 * réajustée. Pour un entraînement en zone, niveau global seulement (mesures faites à une autre
 * intensité que celle de course).
 */
export function levelFromActivity(act: Activity, athlete: Athlete, baseEnv: EnvSettings, effort: Effort): LevelEstimate | null {
  const env = analysisEnv(act.start, baseEnv)
  const total = act.track.totalDist
  const opts = withEffort({ mode: 'physio', kme: { upPer1km: 100, downPer1km: 0 }, env, checkpoints: [], techOverrides: [] }, athlete, effort, total)
  const actual = timesAt(act, total).moving
  const timeOf = (a: Athlete) => simulate(act.track, a, opts).totalTime
  const m = solve((x) => timeOf(scaleLevel(athlete, x)), actual, 0.3, 3)
  if (m === null) return null
  let next = scaleLevel(athlete, m)
  const changes: string[] = []
  if (effort.kind === 'race') {
    const record = analyzeActivity(act, next, baseEnv).record
    const cal = calibrateFromActivities(next, [record])
    changes.push(...cal.changes.filter((c) => !/inchangée/.test(c)))
    const measured = cal.athlete
    // VC réajustée pour retrouver le temps en mouvement avec les mesures (VAM gardée).
    const c = solve((x) => timeOf({ ...measured, cs: measured.cs * x }), actual, 0.6, 1.6)
    next = c === null ? measured : { ...measured, cs: measured.cs * c }
  }
  next = { ...next, updatedAt: new Date().toISOString() }
  return { athlete: next, changes: [...levelLines(athlete, next), ...changes], predicted: timeOf(next), actual }
}
