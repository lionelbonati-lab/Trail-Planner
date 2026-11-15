import { newRace } from './defaults'
import { parseGpx } from './gpx'
import { scenarioInputs, simulate, withFinish, type SimOptions } from './model'
import type { Athlete, PaceZone, Race, SimResult, Track } from './types'

/**
 * Un parcours n'a pas d'heure de départ : il est toujours en départ libre (heures pour un départ
 * maintenant, puis calées sur le vrai départ). Une course l'est si l'option est cochée.
 */
export function isFreeStart(race: Pick<Race, 'kind' | 'freeStart'>): boolean {
  return race.kind === 'route' || !!race.freeStart
}

/** Options de simulation d'une course planifiée (équivalences km-effort : celles du profil). */
export function planOptions(race: Race, track: Track, athlete: Pick<Athlete, 'kme'>): SimOptions {
  return {
    mode: race.mode,
    kme: athlete.kme,
    env: race.env,
    checkpoints: withFinish(race, track),
    techOverrides: race.techOverrides,
    osmTech: race.osmTech,
    weather: race.weather,
    push: race.push,
    // Une course se calcule à l'intensité de course : ses zones éventuelles sont ignorées.
    zones: race.kind === 'race' ? [] : race.zones,
  }
}

/**
 * Parcours en cours de tracé, pour la simulation du traceur : type « parcours » (ses zones d'allure
 * comptent ; une course les ignore), sans nuit, chaleur ni pluie (altitude et technicité seulement).
 */
export function draftRoute(name: string, zones: PaceZone[]): Race {
  const r: Race = { ...newRace(name, ''), kind: 'route', zones }
  r.env = { ...r.env, night: { ...r.env.night, enabled: false }, heat: { ...r.env.heat, enabled: false }, rain: { ...r.env.rain, enabled: false } }
  return r
}

export function computePlan(race: Race, athlete: Athlete): { track: Track; opts: SimOptions; sim: SimResult } | null {
  try {
    const track = parseGpx(race.gpxText, race.smoothing)
    const opts = planOptions(race, track, athlete)
    return { track, opts, sim: simulate(track, athlete, opts) }
  } catch {
    return null
  }
}

/** Fenêtre de passage par point : bonne journée → journée difficile (s depuis le départ). */
export function scenarioWindows(track: Track, athlete: Athlete, opts: SimOptions) {
  const good = simulate(track, ...scenarioInputs(athlete, opts, 'good'))
  const hard = simulate(track, ...scenarioInputs(athlete, opts, 'hard'))
  return (cpId: string) => {
    const g = good.splits.find((x) => x.cp.id === cpId)
    const h = hard.splits.find((x) => x.cp.id === cpId)
    return g && h ? { early: g.arrival, late: h.arrival } : null
  }
}
