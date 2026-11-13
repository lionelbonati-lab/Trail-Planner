import { parseGpx } from './gpx'
import { scenarioInputs, simulate, withFinish, type SimOptions } from './model'
import type { Athlete, Race, SimResult, Track } from './types'

/** Options de simulation d'une course planifiée. */
export function planOptions(race: Race, track: Track): SimOptions {
  return {
    mode: race.mode,
    kme: race.kme,
    env: race.env,
    checkpoints: withFinish(race, track),
    techOverrides: race.techOverrides,
    osmTech: race.osmTech,
    weather: race.weather,
    push: race.push,
    zones: race.zones,
  }
}

export function computePlan(race: Race, athlete: Athlete): { track: Track; opts: SimOptions; sim: SimResult } | null {
  try {
    const track = parseGpx(race.gpxText, race.smoothing)
    const opts = planOptions(race, track)
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
