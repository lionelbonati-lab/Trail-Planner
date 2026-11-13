// Zones d'allure : libellés, et entraînement Garmin découpé par distance d'après le plan.
import { zoneIndex } from './model'
import type { SimpleStep } from './sessions'
import { formatPace } from './time'
import type { Athlete, PaceZone, SimResult, Track } from './types'

/** Description courte d'une zone (« Tempo · 88 % VC », « Allure 4'30/km »…). */
export function zoneText(z: PaceZone, a: Athlete): string {
  if (z.kind === 'intensity') {
    const pct = `${Math.round(z.value * 100)} % VC`
    return `${z.label ? `${z.label} · ` : ''}${pct} (${formatPace(1000 / (a.cs * z.value))}/km sur le plat)`
  }
  if (z.kind === 'flatPace') return `Allure plat ${formatPace(z.value)}/km (${Math.round((1000 / z.value / a.cs) * 100)} % VC)`
  return `Allure imposée ${formatPace(z.value)}/km`
}

export interface ZoneRun {
  from: number
  to: number
  zone: PaceZone | null
  /** Temps prévu sur la portion (s). */
  time: number
}

/** Portions successives du parcours (zone ou allure libre), avec leur temps prévu. */
export function zoneRuns(track: Track, sim: SimResult, zones: PaceZone[]): ZoneRun[] {
  const idx = zoneIndex(track, zones)
  const pts = track.points
  const runs: ZoneRun[] = []
  // Pas k = du point k−1 au point k ; une portion regroupe des pas consécutifs de même zone.
  let first = 1
  for (let k = 2; k <= pts.length; k++) {
    if (k === pts.length || idx[k] !== idx[first]) {
      const from = pts[first - 1].dist
      const to = pts[k - 1].dist
      if (to - from >= 50) {
        runs.push({ from, to, zone: idx[first] >= 0 ? zones[idx[first]] : null, time: sim.points[k - 1].t - sim.points[first - 1].t })
      } else if (runs.length) {
        runs[runs.length - 1].to = to // bout trop court : rattaché à la portion précédente
      }
      first = k
    }
  }
  return runs
}

/** Étapes d'entraînement par distance : fourchette ±5 % autour de l'allure prévue dans chaque zone. */
export function zoneSteps(track: Track, sim: SimResult, zones: PaceZone[], a: Athlete): SimpleStep[] {
  return zoneRuns(track, sim, zones).map((r) => {
    const dist = r.to - r.from
    const v = r.time > 0 ? dist / r.time : 0
    const where = `km ${(r.from / 1000).toFixed(1)} → ${(r.to / 1000).toFixed(1)}`
    if (!r.zone || v <= 0) return { kind: 'active', name: 'Libre', seconds: null, meters: dist, notes: where }
    return {
      kind: 'active',
      name: (r.zone.label || (r.zone.kind === 'pace' ? 'Allure imposée' : 'Allure cible')).slice(0, 30),
      seconds: null,
      meters: dist,
      speed: [v * 0.95, v * 1.05],
      notes: `${where} · ≈ ${formatPace(1000 / v)}/km (${zoneText(r.zone, a)})`.slice(0, 63),
    }
  })
}

/** Rampe séquentielle (une teinte, clair → foncé) selon l'intensité de la zone. */
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95']

export function zoneIntensity(z: PaceZone, a: Athlete): number {
  return z.kind === 'intensity' ? z.value : 1000 / z.value / a.cs
}

export function zoneColor(z: PaceZone, a: Athlete): string {
  const i = zoneIntensity(z, a)
  const k = i < 0.7 ? 0 : i < 0.8 ? 1 : i < 0.9 ? 2 : i < 0.98 ? 3 : i < 1.05 ? 4 : 5
  return RAMP[k]
}
