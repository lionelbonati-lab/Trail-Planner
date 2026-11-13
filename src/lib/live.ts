// Suivi en direct : passages réels, avance/retard et recalcul de la suite.
import { indexAt, projectOnTrack } from './gpx'
import type { LiveState, SimResult, SplitRow, Track } from './types'

export interface LiveRow {
  split: SplitRow
  /** Arrivée prévue au plan (s depuis le départ réel). */
  planned: number
  /** Passage réel (s depuis le départ réel), ou null. */
  actual: number | null
  /** Arrivée estimée (s) : réel si passé, sinon recalculée. */
  eta: number
  /** Marge sur la barrière avec l'estimation (s), ou null. */
  cutoffMargin: number | null
}

export interface LiveStatus {
  /** Temps écoulé depuis le départ réel (s). */
  elapsed: number
  rows: LiveRow[]
  /** Indice du dernier point passé (−1 si aucun). */
  lastIdx: number
  /** Avance (−) ou retard (+) au dernier point passé (s). */
  delta: number
  /** Rapport réel / prévu appliqué à la suite (amorti). */
  ratio: number
  /** Arrivée estimée (s). */
  finishEta: number
}

/** Le retard (ou l'avance) se prolonge sur la suite, amorti de 30 %. */
const DAMPING = 0.7

export function liveStatus(live: LiveState, sim: SimResult, nowMs: number, cutoffMs: (s: SplitRow) => number | null): LiveStatus {
  const t0 = Date.parse(live.startedAt)
  const rows = sim.splits
  let lastIdx = -1
  rows.forEach((r, i) => {
    if (live.passages[r.cp.id]) lastIdx = i
  })
  const last = lastIdx >= 0 ? rows[lastIdx] : null
  const lastActual = last ? (Date.parse(live.passages[last.cp.id]) - t0) / 1000 : 0
  const lastPlanned = last ? last.arrival : 0
  // Borné : un passage saisi par erreur ne doit pas rendre l'estimation absurde.
  const raw = last && lastPlanned > 60 ? Math.min(1.6, Math.max(0.7, lastActual / lastPlanned)) : 1
  const ratio = 1 + DAMPING * (raw - 1)

  const out: LiveRow[] = rows.map((split, i) => {
    const iso = live.passages[split.cp.id]
    const actual = iso ? (Date.parse(iso) - t0) / 1000 : null
    let eta: number
    if (actual !== null) eta = actual
    else if (i > lastIdx) eta = lastActual + (lastIdx >= 0 ? rows[lastIdx].cp.stopMin * 60 : 0) + Math.max(0, split.arrival - (last ? last.departure : 0)) * ratio
    else eta = split.arrival
    const cut = cutoffMs(split)
    return { split, planned: split.arrival, actual, eta, cutoffMargin: cut === null ? null : (cut - (t0 + eta * 1000)) / 1000 }
  })
  return {
    elapsed: (nowMs - t0) / 1000,
    rows: out,
    lastIdx,
    delta: last ? lastActual - lastPlanned : 0,
    ratio,
    finishEta: out.length ? out[out.length - 1].eta : sim.totalTime,
  }
}

/**
 * Position GPS → distance sur le parcours, en cherchant après le dernier point
 * passé (le parcours peut repasser au même endroit).
 */
export function locate(track: Track, lat: number, lon: number, fromDist: number): number {
  const i0 = indexAt(track.points, Math.max(0, fromDist - 1000))
  return projectOnTrack(track.points.slice(i0), lat, lon)
}

/** Temps prévu (s) à une distance donnée, d'après la simulation. */
export function plannedAt(sim: SimResult, dist: number): number {
  const pts = sim.points
  let lo = 0
  let hi = pts.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid].dist < dist) lo = mid + 1
    else hi = mid
  }
  return pts[lo]?.t ?? 0
}
