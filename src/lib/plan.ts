import { parseGpx } from './gpx'
import { simulate, withFinish, type SimOptions } from './model'
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
