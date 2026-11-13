// Technicité depuis OpenStreetMap (API Overpass) : échelle SAC des sentiers,
// visibilité, revêtement, marches. Chaque point de la trace prend le niveau du
// chemin OSM le plus proche (à moins de 15 m).
import type { TechInterval, Track } from './types'

export interface OsmWay {
  tags: Record<string, string>
  geometry: { lat: number; lon: number }[]
}

const SAC: Record<string, { level: 1 | 2 | 3 | 4 | 5; label: string }> = {
  hiking: { level: 1, label: 'T1' },
  mountain_hiking: { level: 2, label: 'T2' },
  demanding_mountain_hiking: { level: 3, label: 'T3' },
  alpine_hiking: { level: 4, label: 'T4' },
  demanding_alpine_hiking: { level: 5, label: 'T5' },
  difficult_alpine_hiking: { level: 5, label: 'T6' },
}

const ROUGH_SURFACES = new Set(['rock', 'scree', 'stones', 'pebblestone', 'gravel_rough'])

/** Niveau de technicité (1–5) et libellé d'un chemin OSM. */
export function wayLevel(tags: Record<string, string>): { level: 1 | 2 | 3 | 4 | 5; label: string } {
  const hw = tags.highway ?? ''
  let level = 1
  let label = hw === 'path' || hw === 'footway' ? 'sentier' : hw === 'track' ? 'piste' : hw === 'steps' ? 'marches' : 'route'
  const sac = SAC[tags.sac_scale]
  if (sac) {
    level = sac.level
    label = `sentier ${sac.label}`
  } else if (hw === 'steps') level = 3
  else if (ROUGH_SURFACES.has(tags.surface)) level = 2
  const vis = tags.trail_visibility
  if (vis === 'bad') level += 1
  else if (vis === 'horrible' || vis === 'no') level += 2
  return { level: Math.min(5, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5, label }
}

/** Requête Overpass : chemins à moins de 25 m d'une version simplifiée de la trace. */
export function overpassQuery(track: Track): string {
  const step = Math.max(150, track.totalDist / 800)
  const coords: string[] = []
  let next = 0
  for (const p of track.points) {
    if (p.dist >= next) {
      coords.push(`${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)
      next = p.dist + step
    }
  }
  const last = track.points[track.points.length - 1]
  coords.push(`${last.lat.toFixed(5)},${last.lon.toFixed(5)}`)
  return `[out:json][timeout:90];way(around:25,${coords.join(',')})[highway];out tags geom;`
}

/** Distance (m) d'un point à un segment, en projection locale. */
function distToSegment(lat: number, lon: number, a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const k = Math.cos((lat * Math.PI) / 180)
  const ax = (a.lon - lon) * k
  const ay = a.lat - lat
  const bx = (b.lon - lon) * k
  const by = b.lat - lat
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
  const px = ax + t * dx
  const py = ay + t * dy
  return Math.sqrt(px * px + py * py) * 111195
}

const CELL = 0.002 // ≈ 150–220 m

/** Associe chaque point de la trace au chemin OSM le plus proche et en déduit des intervalles de technicité. */
export function techFromWays(track: Track, ways: OsmWay[], maxDist = 15): TechInterval[] {
  const grid = new Map<string, { a: { lat: number; lon: number }; b: { lat: number; lon: number }; way: number }[]>()
  const levels = ways.map((w) => wayLevel(w.tags))
  ways.forEach((w, wi) => {
    for (let i = 1; i < w.geometry.length; i++) {
      const a = w.geometry[i - 1]
      const b = w.geometry[i]
      const x0 = Math.floor(Math.min(a.lon, b.lon) / CELL)
      const x1 = Math.floor(Math.max(a.lon, b.lon) / CELL)
      const y0 = Math.floor(Math.min(a.lat, b.lat) / CELL)
      const y1 = Math.floor(Math.max(a.lat, b.lat) / CELL)
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const key = `${x}:${y}`
          const cell = grid.get(key)
          if (cell) cell.push({ a, b, way: wi })
          else grid.set(key, [{ a, b, way: wi }])
        }
    }
  })

  const perPoint: (number | null)[] = track.points.map((p) => {
    const cx = Math.floor(p.lon / CELL)
    const cy = Math.floor(p.lat / CELL)
    let best = maxDist
    let way: number | null = null
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const s of grid.get(`${x}:${y}`) ?? []) {
          const d = distToSegment(p.lat, p.lon, s.a, s.b)
          if (d < best) {
            best = d
            way = s.way
          }
        }
      }
    return way
  })

  // Intervalles de niveau ≥ 2 (le niveau 1 n'apporte rien par rapport à l'estimation par la pente).
  const out: TechInterval[] = []
  track.points.forEach((p, i) => {
    const w = perPoint[i]
    const lv = w === null ? null : levels[w]
    if (!lv || lv.level < 2) return
    const last = out[out.length - 1]
    const prevDist = i > 0 ? track.points[i - 1].dist : p.dist
    if (last && last.level === lv.level && last.label === lv.label && Math.abs(last.to - prevDist) < 1) last.to = p.dist
    else out.push({ from: prevDist, to: p.dist, level: lv.level, label: lv.label })
  })
  return out.filter((iv) => iv.to - iv.from >= 40)
}

export async function fetchOsmTech(track: Track, fetcher: typeof fetch = fetch): Promise<TechInterval[]> {
  const r = await fetcher('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(track))}`,
  })
  if (!r.ok) throw new Error(r.status === 429 ? 'OpenStreetMap est surchargé, réessaie dans une minute.' : `OpenStreetMap : HTTP ${r.status}`)
  const j = await r.json()
  const ways: OsmWay[] = (j.elements ?? [])
    .filter((e: { type: string; geometry?: unknown[] }) => e.type === 'way' && e.geometry?.length)
    .map((e: { tags?: Record<string, string>; geometry: { lat: number; lon: number }[] }) => ({ tags: e.tags ?? {}, geometry: e.geometry }))
  if (!ways.length) throw new Error('Aucun chemin OpenStreetMap trouvé le long de la trace.')
  return techFromWays(track, ways)
}

/** Résumé : km par niveau. */
export function osmSummary(intervals: TechInterval[]): string {
  const byLabel = new Map<string, number>()
  for (const iv of intervals) byLabel.set(iv.label, (byLabel.get(iv.label) ?? 0) + (iv.to - iv.from))
  return [...byLabel.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([l, d]) => `${l} ${(d / 1000).toFixed(1)} km`)
    .join(' · ')
}

