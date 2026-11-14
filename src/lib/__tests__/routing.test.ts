import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { FIT_EPOCH, FitWriter } from '../fit'
import { gpxRawPoints, haversine, parseGpx, type RawPoint } from '../gpx'
import { simulate } from '../model'
import { planOptions } from '../plan'
import type { PaceZone } from '../types'
import { MODEL_TARGET, wholeRoute, wholeRouteZone, zoneTarget } from '../zones'
import {
  brouterUrl,
  closeLoop,
  densify,
  drawnFromRaw,
  drawnGpx,
  fillElevation,
  fillElevationSparse,
  joinSegments,
  nearestIndex,
  NoPathError,
  outAndBack,
  parseBrouter,
  readTrackFile,
  reverseRoute,
  routeLeg,
  routeSegment,
  snapTolerance,
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

  it('point posé hors chemin : relié en ligne droite au chemin le plus proche', async () => {
    // Le routeur part d'un chemin à ~150 m du point cliqué A et s'arrête à ~200 m de B.
    const offA = { lat: A.lat + 0.00135, lon: A.lon }
    const offB = { lat: B.lat - 0.0018, lon: B.lon }
    const calls: string[] = []
    const fetcher: Fetcher = async (url) => {
      calls.push(url)
      if (url.includes('brouter.de')) {
        return json({ features: [{ geometry: { coordinates: [[offA.lon, offA.lat, 1000], [(offA.lon + offB.lon) / 2, (offA.lat + offB.lat) / 2, 1010], [offB.lon, offB.lat, 1020]] } }] })
      }
      const lats = new URL(url).searchParams.get('latitude')!.split(',')
      return json({ elevation: lats.map(() => 990) })
    }
    const pts = await routeSegment(A, B, 'trail', fetcher)
    expect(pts[0]).toMatchObject({ lat: A.lat, lon: A.lon, ele: 990 })
    expect(pts[pts.length - 1]).toMatchObject({ lat: B.lat, lon: B.lon, ele: 990 })
    expect(pts.some((p) => p.ele === 1010)).toBe(true)
    // Écart sous 15 m : pas de raccord ajouté.
    const close = await routeSegment(A, B, 'trail', async (url) =>
      json({ features: [{ geometry: { coordinates: [[A.lon, A.lat + 0.00005, 1000], [B.lon, B.lat, 1020]] } }] }),
    )
    expect(close).toHaveLength(2)
  })

  it('hors-route automatique : chemin si les deux points sont dessus, ligne droite sinon', async () => {
    // Le routeur s'accroche à un chemin passant à ~30 m au sud de B (et pile sur A).
    const net = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => [
      [a.lon, a.lat, 1000],
      [(a.lon + b.lon) / 2 + 0.002, (a.lat + b.lat) / 2, 1100],
      [b.lon, b.lat - 0.00027, 1200],
    ]
    const fetcher: Fetcher = async (url) => {
      if (url.includes('brouter.de')) return json({ features: [{ geometry: { coordinates: net(A, B) } }] })
      const lats = new URL(url).searchParams.get('latitude')!.split(',')
      return json({ elevation: lats.map(() => 990) })
    }
    // Tolérance 50 m : B est sur le chemin → itinéraire, extrémité accrochée au chemin.
    const on = await routeLeg(A, B, 'trail', 50, fetcher)
    expect(on.offroad).toBe(false)
    expect(on.points).toHaveLength(3)
    expect(on.points[2].lat).toBeCloseTo(B.lat - 0.00027, 6)
    // Tolérance 15 m : B est hors chemin → ligne droite depuis A (accroché), jusqu'au point touché.
    const off = await routeLeg(A, B, 'trail', 15, fetcher)
    expect(off.offroad).toBe(true)
    expect(off.points[0]).toMatchObject({ lat: A.lat, lon: A.lon })
    expect(off.points[off.points.length - 1]).toMatchObject({ lat: B.lat, lon: B.lon, ele: 990 })
    expect(off.points.length).toBe(densify(A, B).length)
    // Aucun chemin : ligne droite.
    const none = await routeLeg(A, B, 'trail', 50, fakeServices({ brouterStatus: 400, brouterText: 'from-position not mapped' }).fetcher)
    expect(none.offroad).toBe(true)
    // Autres refus du routeur (réponses réelles de BRouter, ou réponse d'erreur bloquée) : ligne droite aussi.
    for (const text of ['no track found at pass=0', 'target island detected for section 0', 'operation killed by thread-priority-watchdog after 61 seconds']) {
      const r = await routeLeg(A, B, 'trail', 50, fakeServices({ brouterStatus: 500, brouterText: text }).fetcher)
      expect(r.offroad).toBe(true)
      expect(r.points[r.points.length - 1]).toMatchObject({ lat: B.lat, lon: B.lon })
    }
    const blocked = fakeServices()
    const cors: Fetcher = async (url, init) => {
      if (url.includes('brouter.de')) throw new TypeError('Failed to fetch')
      return blocked.fetcher(url, init)
    }
    expect((await routeLeg(A, B, 'trail', 50, cors)).offroad).toBe(true)
    // Tolérance selon le zoom : ~24 px.
    expect(snapTolerance(17, 46)).toBeCloseTo(20, 0)
    expect(snapTolerance(10, 46)).toBe(150)
    expect(snapTolerance(22, 46)).toBe(12)
  })

  it('erreurs du routeur explicites', async () => {
    const none = fakeServices({ brouterStatus: 400, brouterText: 'to-position not mapped in existing datafile' })
    await expect(routeSegment(A, B, 'trail', none.fetcher)).rejects.toThrow('Aucun chemin trouvé')
    await expect(routeSegment(A, B, 'trail', none.fetcher)).rejects.toBeInstanceOf(NoPathError)
    const down: Fetcher = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(routeSegment(A, B, 'trail', down)).rejects.toThrow('injoignable')
  })

  it('altitude : erreur si le service répond mal', async () => {
    const bad: Fetcher = async () => json({ elevation: [] })
    await expect(fillElevation([{ lat: 45, lon: 6, ele: null }], bad)).rejects.toThrow('Altitude')
  })

  it('altitude : un point tous les 90 m demandé, les autres interpolés, rien de redemandé', async () => {
    let asked = 0
    const fetcher: Fetcher = async (url) => {
      const lats = new URL(url).searchParams.get('latitude')!.split(',').map(Number)
      asked += lats.length
      return json({ elevation: lats.map((l) => 1000 + (l - 45) * 10000) })
    }
    // Ligne droite de 2 km vers le nord, un point tous les 25 m.
    const line = densify({ lat: 45, lon: 7 }, { lat: 45.018, lon: 7 })
    const out = await fillElevation(line, fetcher)
    expect(asked).toBeLessThanOrEqual(25)
    expect(out.every((p) => p.ele !== null)).toBe(true)
    expect(out[40].ele).toBeCloseTo(1000 + (line[40].lat - 45) * 10000, 0)
    // Même ligne : tout vient du cache.
    asked = 0
    await fillElevation(line, fetcher)
    expect(asked).toBe(0)
  })

  it('altitude : service saturé (429), nouvelle tentative puis repli sur les altitudes du routeur', async () => {
    let n = 0
    const flaky: Fetcher = async (url) => {
      n++
      if (n === 1) return new Response('', { status: 429 })
      const lats = new URL(url).searchParams.get('latitude')!.split(',')
      return json({ elevation: lats.map(() => 1234) })
    }
    const out = await fillElevation([{ lat: 44, lon: 5, ele: null }], flaky, { retryMs: [0] })
    expect(out[0].ele).toBe(1234)
    expect(n).toBe(2)
    // Toujours saturé : le raccord prend l'altitude du point de chemin connu.
    const busy: Fetcher = async () => new Response('', { status: 429 })
    const conn = [...densify({ lat: 44.1, lon: 5 }, { lat: 44.101, lon: 5, ele: 800 })]
    const filled = await fillElevation(conn, busy, { retryMs: [0, 0] })
    expect(filled.every((p) => p.ele === 800)).toBe(true)
    // Aucune altitude connue : message clair.
    await expect(fillElevation([{ lat: 44.2, lon: 5, ele: null }], busy, { retryMs: [] })).rejects.toThrow('saturé')
    // Service en pause après le refus : plus aucune requête pendant une minute.
    let more = 0
    const counting: Fetcher = async () => {
      more++
      return new Response('', { status: 429 })
    }
    await fillElevation(conn.map((p) => ({ ...p, lat: p.lat + 0.01 })), counting, { retryMs: [] })
    await fillElevation(conn.map((p) => ({ ...p, lat: p.lat + 0.02 })), counting, { retryMs: [] })
    expect(more).toBe(1)
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

  it('allure simulée : tout le parcours dans une zone du profil', () => {
    const a = normalizeAthlete({ ...DEFAULT_ATHLETE, cs: 4 })
    const track = parseGpx(drawnGpx('Plat', seg([45, 6], [45.09, 6], 400).map((p) => ({ ...p, ele: 400 })))) // 10 km plat
    // Zones d'allure : propres aux parcours (une course les ignore).
    const time = (zones: PaceZone[]) => simulate(track, a, planOptions({ ...newRace('x', ''), kind: 'route', zones }, track)).totalTime
    const z2 = wholeRoute(zoneTarget(a, 1), track.totalDist)
    expect(z2).toHaveLength(1)
    expect(z2[0]).toMatchObject({ from: 0, to: track.totalDist, kind: 'intensity', value: 0.75, label: 'Zone 2' })
    // 10 km à 75 % de 4 m/s ≈ 55′33″ ; Z4 plus rapide.
    expect(time(z2) / 60).toBeCloseTo(track.totalDist / (4 * 0.75) / 60, 0)
    expect(time(wholeRoute(zoneTarget(a, 3), track.totalDist))).toBeLessThan(time(z2))
    expect(wholeRouteZone(z2, a)).toBe(1)
    expect(wholeRouteZone([], a)).toBeNull()
    expect(wholeRoute(MODEL_TARGET, track.totalDist)).toEqual([])
  })
})

describe('tracé sur carte : import de fichiers', () => {
  it('GPX : nom de la trace, points à moins de 2 m retirés, arrivée gardée', () => {
    const pts = [
      [45, 6, 1000],
      [45.000005, 6, 1000], // 0,6 m : retiré
      [45.001, 6, 1010],
      [45.002, 6, 1020],
      [45.002001, 6, 1020], // 0,1 m, dernier point : gardé
    ]
    const xml = `<?xml version="1.0"?><gpx><wpt lat="45" lon="6"><name>Ravito</name></wpt><trk><name>Tour du lac &amp; col</name><trkseg>${pts
      .map(([la, lo, e]) => `<trkpt lat="${la}" lon="${lo}"><ele>${e}</ele></trkpt>`)
      .join('')}</trkseg></trk></gpx>`
    const r = readTrackFile('fichier.gpx', new TextEncoder().encode(xml))
    expect(r.name).toBe('Tour du lac & col')
    expect(r.raw.map((p) => p.lat)).toEqual([45, 45.001, 45.002, 45.002001])
    expect(r.raw[0]).toEqual({ lat: 45, lon: 6, ele: 1000 })
  })

  it('FIT d’une sortie : positions et altitude, nom du fichier', () => {
    const w = new FitWriter()
    const ts = Math.round(Date.parse('2026-11-10T17:00:00Z') / 1000) - FIT_EPOCH
    const fields = [
      { num: 253, type: 'uint32' as const },
      { num: 0, type: 'sint32' as const },
      { num: 1, type: 'sint32' as const },
      { num: 2, type: 'uint16' as const },
    ]
    const semi = (deg: number) => Math.round((deg * 2 ** 31) / 180)
    for (let k = 0; k < 20; k++) w.message(20, fields, [ts + k, semi(45 + k * 0.0001), semi(6), (500 + k + 500) * 5])
    const r = readTrackFile('Sortie du jeudi.fit', w.finish())
    expect(r.name).toBe('Sortie du jeudi')
    expect(r.raw).toHaveLength(20)
    expect(r.raw[19].ele).toBeCloseTo(519, 0)
  })

  it('fichier sans trace : erreur', () => {
    expect(() => readTrackFile('vide.gpx', new TextEncoder().encode('<gpx></gpx>'))).toThrow()
  })

  it('longue trace sans altitude : au plus 1000 points interrogés, les autres interpolés', async () => {
    const pts: RawPoint[] = Array.from({ length: 5001 }, (_, k) => ({ lat: 45 + k * 0.0001, lon: 6, ele: null }))
    let asked = 0
    const fetcher: Fetcher = async (url) => {
      const lats = new URL(url).searchParams.get('latitude')!.split(',').map(Number)
      asked += lats.length
      return json({ elevation: lats.map((l) => 1000 + (l - 45) * 1000) })
    }
    const out = await fillElevationSparse(pts, fetcher)
    expect(asked).toBeLessThanOrEqual(1000)
    expect(out.every((p) => p.ele !== null)).toBe(true)
    expect(out[2501].ele).toBeCloseTo(1000 + 0.2501 * 1000, 0)
    // Peu de points (tous les 11 m) : un tous les 90 m environ suffit, les autres interpolés.
    asked = 0
    const few = await fillElevationSparse(pts.slice(0, 50).map((p) => ({ ...p, lon: 6.5 })), fetcher)
    expect(asked).toBeLessThanOrEqual(8)
    expect(few[23].ele).toBeCloseTo(1000 + 0.0023 * 1000, 1)
  })
})
