// Tracé d'un parcours sur la carte : des points cliqués reliés segment par segment,
// soit en suivant les sentiers et chemins d'OpenStreetMap (routeur BRouter), soit en
// ligne droite (hors sentier). L'altitude manquante vient du modèle de terrain d'Open-Meteo.
import { decodeFitRecords, isFit } from './fitDecode'
import { gpxName, gpxRawPoints, haversine, type RawPoint } from './gpx'
import type { DrawnRoute, SegMode, Waypoint } from './types'

export type { DrawnRoute, SegMode, Waypoint }


export const SEG_MODES: { key: SegMode; label: string; title: string }[] = [
  { key: 'trail', label: 'Sentiers', title: 'Suit les sentiers et chemins (profil « randonnée montagne » de BRouter)' },
  { key: 'shortest', label: 'Plus court', title: 'Chemin le plus court sur tout le réseau OpenStreetMap, routes comprises' },
  { key: 'line', label: 'Ligne droite', title: 'Hors sentier : ligne droite, altitude du modèle de terrain' },
]

const BROUTER = 'https://brouter.de/brouter'
const BROUTER_PROFILE: Record<Exclude<SegMode, 'line'>, string> = { trail: 'hiking-mountain', shortest: 'shortest' }
const ELEVATION = 'https://api.open-meteo.com/v1/elevation'
/** Coordonnées par requête d'altitude (limite d'Open-Meteo). */
const ELEVATION_BATCH = 100

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const r6 = (x: number) => x.toFixed(6)

/** Clé de cache d'un segment : extrémités et mode. */
export function segmentKey(a: { lat: number; lon: number }, b: { lat: number; lon: number }, mode: SegMode): string {
  return `${r6(a.lat)},${r6(a.lon)}>${r6(b.lat)},${r6(b.lon)}:${mode}`
}

export function brouterUrl(a: { lat: number; lon: number }, b: { lat: number; lon: number }, mode: Exclude<SegMode, 'line'>): string {
  const lonlats = `${r6(a.lon)},${r6(a.lat)}|${r6(b.lon)},${r6(b.lat)}`
  return `${BROUTER}?lonlats=${encodeURIComponent(lonlats)}&profile=${BROUTER_PROFILE[mode]}&alternativeidx=0&format=geojson`
}

/** Points d'une réponse GeoJSON de BRouter ([lon, lat, alt]). */
export function parseBrouter(json: unknown): RawPoint[] {
  const coords = (json as { features?: { geometry?: { coordinates?: number[][] } }[] })?.features?.[0]?.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length < 2) throw new Error('Réponse du routeur sans tracé.')
  return coords.map((c) => ({ lat: c[1], lon: c[0], ele: Number.isFinite(c[2]) ? c[2] : null }))
}

/** Ligne droite de a à b, un point tous les `step` m au plus (extrémités comprises). */
export function densify(a: { lat: number; lon: number }, b: { lat: number; lon: number }, step = 25): RawPoint[] {
  const d = haversine(a.lat, a.lon, b.lat, b.lon)
  // Au plus 400 points par segment : un pas plus long sur les très grandes lignes droites.
  const n = Math.max(1, Math.ceil(d / Math.max(step, d / 400)))
  return Array.from({ length: n + 1 }, (_, k) => ({
    lat: a.lat + ((b.lat - a.lat) * k) / n,
    lon: a.lon + ((b.lon - a.lon) * k) / n,
    ele: null,
  }))
}

/** Complète les altitudes manquantes (modèle de terrain Copernicus 90 m d'Open-Meteo). */
export async function fillElevation(points: RawPoint[], fetcher: Fetcher = fetch): Promise<RawPoint[]> {
  const missing = points.map((p, i) => (p.ele === null ? i : -1)).filter((i) => i >= 0)
  if (!missing.length) return points
  const out = points.map((p) => ({ ...p }))
  for (let k = 0; k < missing.length; k += ELEVATION_BATCH) {
    const idx = missing.slice(k, k + ELEVATION_BATCH)
    const lat = idx.map((i) => points[i].lat.toFixed(5)).join(',')
    const lon = idx.map((i) => points[i].lon.toFixed(5)).join(',')
    const res = await fetcher(`${ELEVATION}?latitude=${lat}&longitude=${lon}`)
    if (!res.ok) throw new Error(`Altitude indisponible (${res.status}).`)
    const { elevation } = (await res.json()) as { elevation?: number[] }
    if (!Array.isArray(elevation) || elevation.length !== idx.length) throw new Error('Altitude indisponible.')
    idx.forEach((i, j) => {
      out[i].ele = Number.isFinite(elevation[j]) ? elevation[j] : null
    })
  }
  return out
}

/** Écart au-delà duquel un point posé hors chemin est relié en ligne droite au chemin (m). */
export const SNAP_GAP = 15

export class NoPathError extends Error {}

/** Itinéraire BRouter brut (sans raccord ni altitude complétée). */
async function brouterPoints(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  mode: Exclude<SegMode, 'line'>,
  fetcher: Fetcher,
): Promise<RawPoint[]> {
  let res: Response
  try {
    res = await fetcher(brouterUrl(a, b, mode))
  } catch {
    throw new Error('Routeur injoignable (connexion ?).')
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).trim()
    if (/not mapped|no route|not found/i.test(text)) throw new NoPathError('Aucun chemin trouvé entre ces points.')
    throw new Error(`Routeur : ${text.slice(0, 80) || `erreur ${res.status}`}`)
  }
  return parseBrouter(await res.json())
}

const withElevation = (pts: RawPoint[], fetcher: Fetcher) => (pts.some((p) => p.ele === null) ? fillElevation(pts, fetcher) : Promise.resolve(pts))

/**
 * Calcule un segment : chemin OSM (BRouter) ou ligne droite, avec altitude. Sur les chemins,
 * un point posé hors chemin (le routeur part du chemin le plus proche) est relié à celui-ci en
 * ligne droite : le tracé va exactement où l'on a cliqué. Sans aucun chemin entre les deux
 * points : NoPathError.
 */
export async function routeSegment(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  mode: SegMode,
  fetcher: Fetcher = fetch,
): Promise<RawPoint[]> {
  if (mode === 'line') return withElevation(densify(a, b), fetcher)
  let pts = await brouterPoints(a, b, mode, fetcher)
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (haversine(a.lat, a.lon, first.lat, first.lon) > SNAP_GAP) pts = [...densify(a, first).slice(0, -1), ...pts]
  if (haversine(last.lat, last.lon, b.lat, b.lon) > SNAP_GAP) pts = [...pts, ...densify(last, b).slice(1)]
  return withElevation(pts, fetcher)
}

/**
 * Tronçon du traceur, hors-route automatique (comme les applis de randonnée) : si les deux
 * points sont sur le réseau de chemins (à moins de `snap` m d'un chemin, selon le zoom), le
 * tronçon suit les chemins et ses extrémités sont accrochées au chemin ; sinon, ou s'il n'y a
 * aucun chemin, ligne droite (`offroad`), partant du chemin si l'extrémité y était accrochée.
 */
export async function routeLeg(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  mode: SegMode,
  snap: number,
  fetcher: Fetcher = fetch,
): Promise<{ points: RawPoint[]; offroad: boolean }> {
  if (mode === 'line') return { points: await withElevation(densify(a, b), fetcher), offroad: false }
  let net: RawPoint[]
  try {
    net = await brouterPoints(a, b, mode, fetcher)
  } catch (e) {
    if (e instanceof NoPathError) return { points: await withElevation(densify(a, b), fetcher), offroad: true }
    throw e
  }
  const first = net[0]
  const last = net[net.length - 1]
  const startOn = haversine(a.lat, a.lon, first.lat, first.lon) <= snap
  const endOn = haversine(last.lat, last.lon, b.lat, b.lon) <= snap
  if (startOn && endOn) return { points: await withElevation(net, fetcher), offroad: false }
  const from = startOn ? { lat: first.lat, lon: first.lon } : a
  const to = endOn ? { lat: last.lat, lon: last.lon } : b
  return { points: await withElevation(densify(from, to), fetcher), offroad: true }
}

/** Tolérance d'accrochage au chemin (m) : ~24 px à l'écran au zoom courant, entre 12 et 150 m. */
export function snapTolerance(zoom: number, lat: number): number {
  const metersPerPixel = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** (zoom + 8)
  return Math.min(150, Math.max(12, 24 * metersPerPixel))
}

/** Assemble les segments ; starts[k] = indice du point de passage k dans le résultat. */
export function joinSegments(segs: RawPoint[][]): { points: RawPoint[]; starts: number[] } {
  const points: RawPoint[] = []
  const starts: number[] = [0]
  for (const s of segs) {
    const last = points[points.length - 1]
    // Le premier point d'un segment est en général le dernier du précédent : on ne le double pas.
    const skip = last && s.length && haversine(last.lat, last.lon, s[0].lat, s[0].lon) < 1 ? 1 : 0
    points.push(...s.slice(skip))
    starts.push(Math.max(0, points.length - 1))
  }
  if (!points.length) starts.length = 0
  return { points, starts }
}

/** Découpe les points d'un GPX tracé en segments, d'après les indices des points de passage. */
export function splitByWaypoints(raw: RawPoint[], starts: number[]): RawPoint[][] {
  const out: RawPoint[][] = []
  for (let k = 0; k + 1 < starts.length; k++) out.push(raw.slice(starts[k], starts[k + 1] + 1))
  return out
}

/** Point de la polyligne le plus proche d'une position (indice). */
export function nearestIndex(points: { lat: number; lon: number }[], lat: number, lon: number): number {
  const c = Math.cos((lat * Math.PI) / 180)
  let best = 0
  let bestD = Infinity
  points.forEach((p, i) => {
    const d = (p.lat - lat) ** 2 + ((p.lon - lon) * c) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** Retour au départ par le même mode que le dernier segment. */
export function closeLoop(wps: Waypoint[], mode: SegMode): Waypoint[] {
  if (wps.length < 2) return wps
  return [...wps, { lat: wps[0].lat, lon: wps[0].lon, mode }]
}

/** Aller-retour : on revient par les mêmes points, chaque segment avec son mode. */
export function outAndBack(wps: Waypoint[]): Waypoint[] {
  const out = [...wps]
  for (let j = wps.length - 2; j >= 0; j--) out.push({ lat: wps[j].lat, lon: wps[j].lon, mode: wps[j + 1].mode })
  return out
}

/** Sens inverse : le segment j+1 → j garde le mode du segment j → j+1. */
export function reverseRoute(wps: Waypoint[]): Waypoint[] {
  const n = wps.length
  return wps.map((_, k) => {
    const j = n - 1 - k
    return { lat: wps[j].lat, lon: wps[j].lon, mode: k === 0 ? wps[0].mode : wps[j + 1].mode }
  })
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** GPX d'un tracé (trace avec altitude, sans horodatage). */
export function drawnGpx(name: string, points: RawPoint[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Trail Planner" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${esc(name)}</name></metadata>`,
    `  <trk><name>${esc(name)}</name><trkseg>`,
  ]
  for (const p of points) {
    lines.push(`    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.ele !== null ? `<ele>${p.ele.toFixed(1)}</ele>` : ''}</trkpt>`)
  }
  lines.push('  </trkseg></trk>', '</gpx>')
  return lines.join('\n')
}

/** Recherche de lieu (Nominatim, OpenStreetMap). */
export interface Place {
  name: string
  lat: number
  lon: number
}

export async function searchPlace(q: string, fetcher: Fetcher = fetch): Promise<Place[]> {
  const res = await fetcher(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=fr&q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`Recherche indisponible (${res.status}).`)
  const list = (await res.json()) as { display_name: string; lat: string; lon: string }[]
  return list.map((p) => ({ name: p.display_name, lat: parseFloat(p.lat), lon: parseFloat(p.lon) }))
}

/**
 * Course ou parcours dont le tracé a été modifié : nouvelle trace, et ce qui dépend des
 * distances ramené dans la nouvelle longueur (points au-delà retirés, zones et technicité
 * coupées). La technicité OSM est à recharger.
 */
export function withNewTrace<R extends { gpxText: string; drawn: DrawnRoute | null; checkpoints: { dist: number }[]; zones: { from: number; to: number }[]; techOverrides: { from: number; to: number }[]; osmTech: unknown[] }>(
  race: R,
  gpxText: string,
  drawn: DrawnRoute,
  total: number,
): R {
  const clip = <T extends { from: number; to: number }>(xs: T[]) =>
    xs.filter((x) => x.from < total - 1).map((x) => ({ ...x, to: Math.min(x.to, total) }))
  return {
    ...race,
    gpxText,
    drawn,
    checkpoints: race.checkpoints.filter((c) => c.dist < total - 1),
    zones: clip(race.zones),
    techOverrides: clip(race.techOverrides),
    osmTech: [],
  }
}

/**
 * Trace importée rendue modifiable : découpée en points de passage (un tous les `spacing` m
 * au moins, 60 au plus) ; chaque segment garde la géométrie d'origine tant qu'on n'y touche pas.
 */
export function drawnFromRaw(raw: RawPoint[], mode: SegMode = 'trail', maxPoints = 60, minSpacing = 500): DrawnRoute {
  let total = 0
  const cum = raw.map((p, i) => (i ? (total += haversine(raw[i - 1].lat, raw[i - 1].lon, p.lat, p.lon)) : 0))
  const spacing = Math.max(minSpacing, total / (maxPoints - 1))
  const idx = [0]
  for (let i = 1; i < raw.length - 1; i++) if (cum[i] - cum[idx[idx.length - 1]] >= spacing && total - cum[i] >= spacing / 2) idx.push(i)
  if (raw.length > 1) idx.push(raw.length - 1)
  return { waypoints: idx.map((i) => ({ lat: raw[i].lat, lon: raw[i].lon, mode, i })) }
}

/**
 * Altitude d'une longue trace qui n'en a pas : au plus `max` points interrogés, répartis
 * le long de la trace, les autres interpolés.
 */
export async function fillElevationSparse(points: RawPoint[], fetcher: Fetcher = fetch, max = 1000): Promise<RawPoint[]> {
  const missing = points.filter((p) => p.ele === null).length
  if (!missing) return points
  if (missing <= max) return fillElevation(points, fetcher)
  const n = points.length
  const idx = [...new Set(Array.from({ length: max }, (_, k) => Math.round((k * (n - 1)) / (max - 1))))]
  const sample = await fillElevation(idx.map((i) => ({ ...points[i], ele: null })), fetcher)
  const out = points.map((p) => ({ ...p }))
  for (let s = 0; s + 1 < idx.length; s++) {
    const a = idx[s]
    const b = idx[s + 1]
    const ea = sample[s].ele ?? 0
    const eb = sample[s + 1].ele ?? ea
    for (let i = a; i <= b; i++) if (out[i].ele === null) out[i].ele = ea + ((eb - ea) * (i - a)) / (b - a || 1)
  }
  return out
}

/**
 * Trace d'un fichier GPX ou FIT, pour le traceur : positions et altitude seulement, points
 * à moins de 2 m du précédent retirés (enregistrements à la seconde).
 */
export function readTrackFile(fileName: string, bytes: Uint8Array): { name: string; raw: RawPoint[] } {
  let name = fileName.replace(/\.(gpx|fit)$/i, '')
  let src: RawPoint[]
  if (isFit(bytes)) src = decodeFitRecords(bytes)
  else {
    const xml = new TextDecoder().decode(bytes)
    src = gpxRawPoints(xml)
    const n = gpxName(xml)
    if (n && n !== 'Course') name = n
  }
  const raw: RawPoint[] = []
  for (const p of src) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue
    const last = raw[raw.length - 1]
    if (last && haversine(last.lat, last.lon, p.lat, p.lon) < 2) continue
    raw.push({ lat: p.lat, lon: p.lon, ele: p.ele })
  }
  const last = src[src.length - 1]
  if (last && raw.length && raw[raw.length - 1] !== last && haversine(raw[raw.length - 1].lat, raw[raw.length - 1].lon, last.lat, last.lon) > 0) {
    raw.push({ lat: last.lat, lon: last.lon, ele: last.ele })
  }
  if (raw.length < 2) throw new Error('Trace trop courte.')
  return { name, raw }
}
