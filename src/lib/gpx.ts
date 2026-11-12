import type { GpxWaypoint, Track, TrackPoint } from './types'

const R = 6371000

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

interface RawPoint {
  lat: number
  lon: number
  ele: number | null
}

function attr(s: string, name: string): number | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(s)
  return m ? parseFloat(m[1]) : null
}

function tag(s: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(s)
  return m ? m[1].trim() : null
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parsePoints(xml: string, tagName: string): RawPoint[] {
  const re = new RegExp(`<${tagName}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tagName}>)`, 'g')
  const out: RawPoint[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const lat = attr(m[1], 'lat')
    const lon = attr(m[1], 'lon')
    if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) continue
    const eleStr = m[2] ? tag(m[2], 'ele') : null
    const ele = eleStr !== null ? parseFloat(eleStr) : null
    out.push({ lat, lon, ele: ele !== null && !Number.isNaN(ele) ? ele : null })
  }
  return out
}

/** Pas de rééchantillonnage de la trace (m). */
export const STEP = 20

/**
 * Lit un fichier GPX : trace (trkpt, ou rtept à défaut), waypoints et nom.
 * La trace est rééchantillonnée tous les STEP m et l'altitude lissée sur
 * ±`smoothing` points : plus de lissage donne un D+ plus faible.
 */
export function parseGpx(xml: string, smoothing = 2): Track {
  let raw = parsePoints(xml, 'trkpt')
  if (raw.length < 2) raw = parsePoints(xml, 'rtept')
  if (raw.length < 2) throw new Error('Aucune trace trouvée dans le fichier GPX.')

  // Altitudes manquantes : on prend la dernière connue.
  let lastEle = raw.find((p) => p.ele !== null)?.ele ?? 0
  for (const p of raw) {
    if (p.ele === null) p.ele = lastEle
    else lastEle = p.ele
  }

  // Distance cumulée brute.
  const cum: number[] = [0]
  for (let i = 1; i < raw.length; i++) {
    cum.push(cum[i - 1] + haversine(raw[i - 1].lat, raw[i - 1].lon, raw[i].lat, raw[i].lon))
  }
  const total = cum[cum.length - 1]

  // Rééchantillonnage régulier.
  const resampled: TrackPoint[] = []
  let j = 0
  for (let d = 0; d <= total + 1e-6; d += STEP) {
    const dd = Math.min(d, total)
    while (j < raw.length - 2 && cum[j + 1] < dd) j++
    const span = cum[j + 1] - cum[j]
    const f = span > 0 ? (dd - cum[j]) / span : 0
    resampled.push({
      lat: raw[j].lat + f * (raw[j + 1].lat - raw[j].lat),
      lon: raw[j].lon + f * (raw[j + 1].lon - raw[j].lon),
      ele: (raw[j].ele as number) + f * ((raw[j + 1].ele as number) - (raw[j].ele as number)),
      dist: dd,
    })
  }
  if (resampled[resampled.length - 1].dist < total - 1e-6) {
    const last = raw[raw.length - 1]
    resampled.push({ lat: last.lat, lon: last.lon, ele: last.ele as number, dist: total })
  }

  const points = smoothElevation(resampled, smoothing)
  const { dPlus, dMinus } = elevationGain(points, 0, total)

  const name = decodeXml(tag(xml.replace(/<wpt\b[\s\S]*?<\/wpt>/g, ''), 'name') ?? 'Course')

  const waypoints: GpxWaypoint[] = []
  const wptRe = /<wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/wpt>)/g
  let m: RegExpExecArray | null
  while ((m = wptRe.exec(xml))) {
    const lat = attr(m[1], 'lat')
    const lon = attr(m[1], 'lon')
    if (lat === null || lon === null) continue
    const wname = decodeXml((m[2] && tag(m[2], 'name')) || 'Point')
    waypoints.push({ name: wname, lat, lon, dist: projectOnTrack(points, lat, lon) })
  }
  waypoints.sort((a, b) => a.dist - b.dist)

  return { name, points, waypoints, totalDist: total, dPlus, dMinus }
}

/** Moyenne glissante centrée sur ±half points. */
export function smoothElevation(points: TrackPoint[], half: number): TrackPoint[] {
  const n = points.length
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + points[i].ele
  return points.map((p, i) => {
    const a = Math.max(0, i - half)
    const b = Math.min(n - 1, i + half)
    return { ...p, ele: (prefix[b + 1] - prefix[a]) / (b - a + 1) }
  })
}

/** Distance (m) du point de la trace le plus proche de (lat, lon). */
export function projectOnTrack(points: TrackPoint[], lat: number, lon: number): number {
  let best = Infinity
  let bestDist = 0
  for (const p of points) {
    const d = haversine(lat, lon, p.lat, p.lon)
    if (d < best) {
      best = d
      bestDist = p.dist
    }
  }
  return bestDist
}

/** Indice du point de trace le plus proche d'une distance donnée. */
export function indexAt(points: TrackPoint[], dist: number): number {
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].dist < dist) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(points[lo - 1].dist - dist) < Math.abs(points[lo].dist - dist)) return lo - 1
  return lo
}

export function elevationAt(points: { dist: number; ele: number }[], dist: number): number {
  if (dist <= points[0].dist) return points[0].ele
  const last = points[points.length - 1]
  if (dist >= last.dist) return last.ele
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].dist <= dist) lo = mid
    else hi = mid
  }
  const f = (dist - points[lo].dist) / (points[hi].dist - points[lo].dist || 1)
  return points[lo].ele + f * (points[hi].ele - points[lo].ele)
}

export function elevationGain(
  points: TrackPoint[],
  from: number,
  to: number,
): { dPlus: number; dMinus: number } {
  let dPlus = 0
  let dMinus = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (b.dist <= from || a.dist >= to) continue
    const d = b.ele - a.ele
    if (d > 0) dPlus += d
    else dMinus -= d
  }
  return { dPlus, dMinus }
}
