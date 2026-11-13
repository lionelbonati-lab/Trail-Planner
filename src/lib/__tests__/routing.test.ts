import { describe, expect, it } from 'vitest'
import { newRace } from '../defaults'
import { gpxRawPoints, haversine, parseGpx, type RawPoint } from '../gpx'
import {
  brouterUrl,
  closeLoop,
  densify,
  drawnFromRaw,
  drawnGpx,
  fillElevation,
  joinSegments,
  nearestIndex,
  outAndBack,
  parseBrouter,
  reverseRoute,
  routeSegment,
  searchPlace,
  splitByWaypoints,
  withNewTrace,
  type Fetcher,
  type Waypoint,
} from '../routing'

const A = { lat: 45.9237, lon: 6.8694 }
const B = { lat: 45.93, lon: 6.88 }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Faux services : BRouter (ligne brisée via un point intermédiaire) et altitude = 1000 + 1000 × (lat − 45,9). */
function fakeServices(opts: { brouterEle?: boolean; brouterStatus?: number; brouterText?: string } = {}) {
  const calls: string[] = []
  const fetcher: Fetcher = async (url) => {
    calls.push(url)
    const u = new URL(url)
    if (u.hostname === 'brouter.de') {
      if (opts.brouterStatus) return new Response(opts.brouterText ?? '', { status: opts.brouterStatus })
      const [a, b] = decodeURIComponent(u.searchParams.get('lonlats')!).split('|').map((s) => s.split(',').map(Number))
      const mid = [(a[0] + b[0]) / 2 + 0.001, (a[1] + b[1]) / 2]
      const coords = [a, mid, b].map((c) => (opts.brouterEle === false ? c : [...c, 1000 + 1000 * (c[1] - 45.9)]))
      return json({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] })
    }
    if (u.hostname === 'api.open-meteo.com') {
      const lats = u.searchParams.get('latitude')!.split(',').map(Number)
      return json({ elevation: lats.map((l) => 1000 + 1000 * (l - 45.9)) })
    }
    if (u.hostname === 'nominatim.openstreetmap.org') {
      return json([{ display_name: 'Chamonix-Mont-Blanc, Haute-Savoie', lat: '45.9237', lon: '6.8694' }])
    }
    return new Response('', { status: 404 })
  }
  return { fetcher, calls }
}

describe('tracé sur carte : services', () => {
  it('URL BRouter : lon,lat|lon,lat, profil randonnée montagne, GeoJSON', () => {
    const u = new URL(brouterUrl(A, B, 'trail'))
    expect(u.searchParams.get('lonlats')).toBe('6.869400,45.923700|6.880000,45.930000')
    expect(u.searchParams.get('profile')).toBe('hiking-mountain')
    expect(u.searchParams.get('format')).toBe('geojson')
    expect(new URL(brouterUrl(A, B, 'shortest')).searchParams.get('profile')).toBe('shortest')
  })

  it('réponse BRouter : points avec altitude', () => {
    const pts = parseBrouter({ features: [{ geometry: { coordinates: [[6.1, 45.1, 500], [6.2, 45.2]] } }] })
    expect(pts).toEqual([{ lat: 45.1, lon: 6.1, ele: 500 }, { lat: 45.2, lon: 6.2, ele: null }])
    expect(() => parseBrouter({})).toThrow()
  })

  it('segment sur sentiers : altitude du routeur, sans appel au modèle de terrain', async () => {
    const { fetcher, calls } = fakeServices()
    const pts = await routeSegment(A, B, 'trail', fetcher)
    expect(pts).toHaveLength(3)
    expect(pts[0].ele).toBeCloseTo(1023.7, 1)
    expect(calls.every((c) => c.includes('brouter.de'))).toBe(true)
  })

  it('segment sur sentiers sans altitude : complétée par Open-Meteo', async () => {
    const { fetcher, calls } = fakeServices({ brouterEle: false })
    const pts = await routeSegment(A, B, 'trail', fetcher)
    expect(pts.every((p) => p.ele !== null)).toBe(true)
    expect(calls.filter((c) => c.includes('open-meteo'))).toHaveLength(1)
  })

  it('ligne droite : un point tous les 25 m, altitudes par lots de 100', async () => {
    const line = densify(A, B)
    const d = haversine(A.lat, A.lon, B.lat, B.lon)
    expect(line.length).toBe(Math.ceil(d / 25) + 1)
    expect(line[0]).toMatchObject(A)
    expect(line[line.length - 1]).toMatchObject(B)
    const { fetcher, calls } = fakeServices()
    const pts = await routeSegment(A, B, 'line', fetcher)
    expect(calls).toHaveLength(Math.ceil(line.length / 100))
    expect(pts[pts.length - 1].ele).toBeCloseTo(1030, 0)
    // Très longue ligne droite : au plus 401 points.
    expect(densify({ lat: 45, lon: 6 }, { lat: 46, lon: 7 }).length).toBeLessThanOrEqual(401)
  })

  it('erreurs du routeur explicites', async () => {
    const none = fakeServices({ brouterStatus: 400, brouterText: 'to-position not mapped in existing datafile' })
    await expect(routeSegment(A, B, 'trail', none.fetcher)).rejects.toThrow('Aucun chemin trouvé')
    const down: Fetcher = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(routeSegment(A, B, 'trail', down)).rejects.toThrow('injoignable')
  })

  it('altitude : erreur si le service répond mal', async () => {
    const bad: Fetcher = async () => json({ elevation: [] })
    await expect(fillElevation([{ lat: 45, lon: 6, ele: null }], bad)).rejects.toThrow('Altitude')
  })

  it('recherche de lieu', async () => {
    const { fetcher, calls } = fakeServices()
    const res = await searchPlace('Chamonix', fetcher)
    expect(res[0]).toMatchObject({ lat: 45.9237, lon: 6.8694 })
    expect(calls[0]).toContain('q=Chamonix')
  })
})

describe('tracé sur carte : assemblage', () => {
  const seg = (from: [number, number], to: [number, number], n = 4): RawPoint[] =>
    Array.from({ length: n + 1 }, (_, k) => ({ lat: from[0] + ((to[0] - from[0]) * k) / n, lon: from[1] + ((to[1] - from[1]) * k) / n, ele: 1000 + k }))

  it('segments assemblés sans doublon, puis redécoupés à l’identique', () => {
    const s1 = seg([45, 6], [45.01, 6])
    const s2 = seg([45.01, 6], [45.01, 6.01], 3)
    const { points, starts } = joinSegments([s1, s2])
    expect(points).toHaveLength(5 + 3)
    expect(starts).toEqual([0, 4, 7])
    const ll = (xs: RawPoint[]) => xs.map((p) => [p.lat, p.lon])
    expect(splitByWaypoints(points, starts).map(ll)).toEqual([ll(s1), ll(s2)])
  })

  it('segments disjoints (point accroché à un sentier) : rien n’est perdu', () => {
    const s1 = seg([45, 6], [45.01, 6])
    const s2 = seg([45.0101, 6], [45.02, 6])
    const { points, starts } = joinSegments([s1, s2])
    expect(points).toHaveLength(10)
    expect(starts).toEqual([0, 4, 9])
  })

  it('aller-retour, boucle et sens inverse gardent le mode de chaque segment', () => {
    const w: Waypoint[] = [
      { lat: 1, lon: 1, mode: 'trail' },
      { lat: 2, lon: 2, mode: 'line' },
      { lat: 3, lon: 3, mode: 'shortest' },
    ]
    expect(outAndBack(w).map((p) => [p.lat, p.mode])).toEqual([[1, 'trail'], [2, 'line'], [3, 'shortest'], [2, 'shortest'], [1, 'line']])
    expect(closeLoop(w, 'trail').map((p) => p.lat)).toEqual([1, 2, 3, 1])
    expect(reverseRoute(w).map((p) => [p.lat, p.mode])).toEqual([[3, 'trail'], [2, 'shortest'], [1, 'line']])
  })

  it('point le plus proche sur une polyligne', () => {
    const s = seg([45, 6], [45.04, 6])
    expect(nearestIndex(s, 45.021, 6.0001)).toBe(2)
  })

  it('GPX du tracé relu par l’import habituel', () => {
    const pts = seg([45, 6], [45.02, 6], 40)
    const gpx = drawnGpx('Boucle <test>', pts)
    const t = parseGpx(gpx)
    expect(t.name).toBe('Boucle <test>')
    expect(t.totalDist).toBeCloseTo(haversine(45, 6, 45.02, 6), -1)
    expect(gpxRawPoints(gpx)).toHaveLength(41)
  })

  it('tracé modifié : points et zones au-delà de la nouvelle arrivée retirés', () => {
    const r = {
      ...newRace('x', ''),
      checkpoints: [
        { id: 'a', dist: 3000, name: 'Ravito', kind: 'ravito' as const, stopMin: 2, cutoff: '', notes: '' },
        { id: 'b', dist: 9000, name: 'Col', kind: 'split' as const, stopMin: 0, cutoff: '', notes: '' },
      ],
      zones: [
        { id: 'z1', from: 0, to: 4000, kind: 'intensity' as const, value: 0.75, label: 'Z2' },
        { id: 'z2', from: 4000, to: 10000, kind: 'intensity' as const, value: 0.9, label: 'Z4' },
        { id: 'z3', from: 8000, to: 10000, kind: 'intensity' as const, value: 1, label: 'Z5' },
      ],
      osmTech: [{ from: 0, to: 100, level: 2 as const }],
    }
    const drawn = { waypoints: [{ lat: 1, lon: 1, mode: 'trail' as const, i: 0 }] }
    const next = withNewTrace(r, '<gpx/>', drawn, 6000)
    expect(next.checkpoints.map((c) => c.id)).toEqual(['a'])
    expect(next.zones.map((z) => [z.id, z.from, z.to])).toEqual([['z1', 0, 4000], ['z2', 4000, 6000]])
    expect(next.osmTech).toEqual([])
    expect(next.drawn).toBe(drawn)
    expect(next.gpxText).toBe('<gpx/>')
  })

  it('trace importée découpée en points modifiables, géométrie conservée', () => {
    const raw = seg([45, 6], [45.1, 6], 1000) // 11,1 km, un point tous les 11 m
    const d = drawnFromRaw(raw)
    const idx = d.waypoints.map((w) => w.i)
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(1000)
    expect(d.waypoints.length).toBeGreaterThanOrEqual(20)
    expect(d.waypoints.length).toBeLessThanOrEqual(24)
    const segs = splitByWaypoints(raw, idx)
    expect(joinSegments(segs).points).toHaveLength(raw.length)
    // Très longue trace : 60 points au plus.
    expect(drawnFromRaw(seg([45, 6], [46.5, 6], 5000)).waypoints.length).toBeLessThanOrEqual(60)
  })
})
