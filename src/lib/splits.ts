import { kmeOf } from './model'
import type { Checkpoint, KmeSettings, SimPoint, Track } from './types'

export type AutoSplitMethod = 'distance' | 'peaks' | 'slope' | 'kme' | 'time'

export interface AutoSplitParams {
  method: AutoSplitMethod
  /** distance : km ; kme : km-e ; time : minutes ; peaks : proéminence (m) ; slope : tolérance (m). */
  value: number
}

export interface AutoPoint {
  dist: number
  name: string
}

export const METHOD_LABELS: Record<AutoSplitMethod, { label: string; unit: string; def: number }> = {
  distance: { label: 'Tous les X km', unit: 'km', def: 5 },
  peaks: { label: 'Sommets et points bas', unit: 'm de proéminence', def: 80 },
  slope: { label: 'Ruptures de pente', unit: 'm de tolérance', def: 40 },
  kme: { label: 'Tous les X km-effort', unit: 'km-e', def: 10 },
  time: { label: 'Toutes les X minutes', unit: 'min', def: 60 },
}

/** Écart minimal (m) entre un point auto et un point existant ou l'arrivée. */
const MIN_GAP = 300

export function everyDistance(track: Track, km: number): AutoPoint[] {
  const out: AutoPoint[] = []
  if (km <= 0) return out
  for (let d = km * 1000; d < track.totalDist - MIN_GAP; d += km * 1000) {
    out.push({ dist: d, name: `Km ${Math.round(d / 100) / 10}` })
  }
  return out
}

/**
 * Sommets et points bas par zigzag : un extremum est retenu quand la trace
 * s'en éloigne d'au moins `prominence` m dans l'autre sens.
 */
export function peaksAndValleys(track: Track, prominence: number): AutoPoint[] {
  const pts = track.points
  const out: AutoPoint[] = []
  if (pts.length < 3) return out
  // Direction initiale : premier écart de `prominence` dans un sens ou l'autre.
  let hi = pts[0]
  let lo = pts[0]
  let dir: 1 | -1 = 1
  let k = 0
  for (; k < pts.length; k++) {
    const p = pts[k]
    if (p.ele > hi.ele) hi = p
    if (p.ele < lo.ele) lo = p
    if (hi.ele - lo.ele >= prominence) {
      dir = hi.dist > lo.dist ? 1 : -1
      if (dir === 1 && lo !== pts[0]) out.push({ dist: lo.dist, name: `Point bas ${Math.round(lo.ele)} m` })
      if (dir === -1 && hi !== pts[0]) out.push({ dist: hi.dist, name: `Sommet ${Math.round(hi.ele)} m` })
      break
    }
  }
  let ext = dir === 1 ? hi : lo
  for (; k < pts.length; k++) {
    const p = pts[k]
    if (dir === 1) {
      if (p.ele > ext.ele) ext = p
      else if (ext.ele - p.ele >= prominence) {
        out.push({ dist: ext.dist, name: `Sommet ${Math.round(ext.ele)} m` })
        dir = -1
        ext = p
      }
    } else {
      if (p.ele < ext.ele) ext = p
      else if (p.ele - ext.ele >= prominence) {
        out.push({ dist: ext.dist, name: `Point bas ${Math.round(ext.ele)} m` })
        dir = 1
        ext = p
      }
    }
  }
  return out.filter((p) => p.dist > MIN_GAP && p.dist < track.totalDist - MIN_GAP)
}

/** Ruptures de pente : simplification Douglas-Peucker du profil (tolérance verticale en m). */
export function slopeBreaks(track: Track, tolerance: number): AutoPoint[] {
  const pts = track.points
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const pa = pts[a]
    const pb = pts[b]
    let maxErr = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const f = (pts[i].dist - pa.dist) / (pb.dist - pa.dist)
      const err = Math.abs(pts[i].ele - (pa.ele + f * (pb.ele - pa.ele)))
      if (err > maxErr) {
        maxErr = err
        idx = i
      }
    }
    if (idx >= 0 && maxErr > tolerance) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  const out: AutoPoint[] = []
  for (let i = 1; i < pts.length - 1; i++) {
    if (keep[i]) out.push({ dist: pts[i].dist, name: `Rupture ${Math.round(pts[i].ele)} m` })
  }
  return thin(out, MIN_GAP).filter((p) => p.dist < track.totalDist - MIN_GAP)
}

export function everyKme(track: Track, step: number, k: KmeSettings): AutoPoint[] {
  const out: AutoPoint[] = []
  if (step <= 0) return out
  let acc = 0
  let next = step
  const pts = track.points
  for (let i = 1; i < pts.length; i++) {
    const dz = pts[i].ele - pts[i - 1].ele
    acc += kmeOf(pts[i].dist - pts[i - 1].dist, Math.max(0, dz), Math.max(0, -dz), k)
    if (acc >= next) {
      out.push({ dist: pts[i].dist, name: `${Math.round(next)} km-e` })
      next += step
    }
  }
  return out.filter((p) => p.dist < track.totalDist - MIN_GAP)
}

export function everyTime(sim: SimPoint[], minutes: number, totalDist: number): AutoPoint[] {
  const out: AutoPoint[] = []
  if (minutes <= 0) return out
  let next = minutes * 60
  for (const p of sim) {
    if (p.t >= next) {
      const h = Math.floor(next / 3600)
      const m = Math.round((next % 3600) / 60)
      out.push({ dist: p.dist, name: `${h}h${String(m).padStart(2, '0')}` })
      next += minutes * 60
    }
  }
  return out.filter((p) => p.dist < totalDist - MIN_GAP)
}

function thin(points: AutoPoint[], gap: number): AutoPoint[] {
  const out: AutoPoint[] = []
  for (const p of points) {
    if (!out.length || p.dist - out[out.length - 1].dist >= gap) out.push(p)
  }
  return out
}

export function computeAutoPoints(
  track: Track,
  params: AutoSplitParams,
  k: KmeSettings,
  sim: SimPoint[] | null,
): AutoPoint[] {
  switch (params.method) {
    case 'distance':
      return everyDistance(track, params.value)
    case 'peaks':
      return peaksAndValleys(track, params.value)
    case 'slope':
      return slopeBreaks(track, params.value)
    case 'kme':
      return everyKme(track, params.value, k)
    case 'time':
      return sim ? everyTime(sim, params.value, track.totalDist) : []
  }
}

/**
 * Remplace les points auto existants par de nouveaux, sans toucher aux points
 * manuels (ravitos…) et en évitant les doublons trop proches d'eux.
 */
export function mergeAutoPoints(existing: Checkpoint[], auto: AutoPoint[]): Checkpoint[] {
  const manual = existing.filter((c) => !c.auto)
  const added: Checkpoint[] = auto
    .filter((a) => manual.every((m) => Math.abs(m.dist - a.dist) >= MIN_GAP))
    .map((a) => ({
      id: crypto.randomUUID(),
      dist: a.dist,
      name: a.name,
      kind: 'split',
      stopMin: 0,
      cutoff: '',
      water: 0,
      carbs: 0,
      notes: '',
      auto: true,
    }))
  return [...manual, ...added].sort((a, b) => a.dist - b.dist)
}
