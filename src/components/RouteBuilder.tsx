import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { newRace } from '../lib/defaults'
import { download } from '../lib/exportGpx'
import { gpxRawPoints, indexAt, trackFromRaw, type RawPoint } from '../lib/gpx'
import { simulate } from '../lib/model'
import { planOptions } from '../lib/plan'
import {
  closeLoop,
  drawnFromRaw,
  drawnGpx,
  joinSegments,
  nearestIndex,
  outAndBack,
  reverseRoute,
  routeSegment,
  searchPlace,
  segmentKey,
  SEG_MODES,
  splitByWaypoints,
  type DrawnRoute,
  type Place,
  type SegMode,
  type Waypoint,
} from '../lib/routing'
import { formatDuration } from '../lib/time'
import type { Athlete, Race, RaceKind, Track } from '../lib/types'
import { LAYERS } from './mapLayers'
import { Card, Hint } from './ui'

export interface DrawResult {
  name: string
  kind: RaceKind
  gpxText: string
  drawn: DrawnRoute
  /** Longueur de la trace (m). */
  total: number
}

interface Props {
  athlete: Athlete
  /** Course ou parcours dont on modifie le tracé, ou null pour un nouveau tracé. */
  race: Race | null
  onSave: (r: DrawResult) => void
  onCancel: () => void
}

type Seg = { status: 'ok'; points: RawPoint[] } | { status: 'loading' } | { status: 'error'; message: string }

const DRAFT_KEY = 'tp-draw-draft'
const VIEW_KEY = 'tp-draw-view'
const MODE_KEY = 'tp-draw-mode'
const ACCENT = '#2f6b4f'

function readJson<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key)
    return s ? (JSON.parse(s) as T) : null
  } catch {
    return null
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* stockage indisponible */
  }
}

// Au plus 3 calculs d'itinéraire à la fois : le routeur public est partagé.
let active = 0
const waiting: (() => void)[] = []
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((r) => waiting.push(r))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiting.shift()?.()
  }
}

/** Points de passage et segments déjà connus (tracé à modifier, ou brouillon). */
function initialState(race: Race | null): { wps: Waypoint[]; cache: Map<string, Seg>; name: string; kind: RaceKind } {
  const cache = new Map<string, Seg>()
  if (race) {
    let wps: Waypoint[] = []
    try {
      const raw = gpxRawPoints(race.gpxText).map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele }))
      const drawn = race.drawn?.waypoints.length && race.drawn.waypoints[race.drawn.waypoints.length - 1].i < raw.length ? race.drawn : drawnFromRaw(raw)
      wps = drawn.waypoints.map(({ lat, lon, mode }) => ({ lat, lon, mode }))
      splitByWaypoints(raw, drawn.waypoints.map((w) => w.i)).forEach((points, k) => {
        cache.set(segmentKey(wps[k], wps[k + 1], wps[k + 1].mode), { status: 'ok', points })
      })
    } catch {
      /* GPX illisible : tracé vide */
    }
    return { wps, cache, name: race.name, kind: race.kind }
  }
  const draft = readJson<{ wps: Waypoint[]; name: string; kind: RaceKind }>(DRAFT_KEY)
  return { wps: draft?.wps ?? [], cache, name: draft?.name ?? 'Nouveau parcours', kind: draft?.kind ?? 'route' }
}

const same = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7

function wpIcon(k: number, n: number, loop: boolean): L.DivIcon {
  const role = k === 0 ? 'start' : k === n - 1 ? 'end' : 'mid'
  const size = role === 'mid' ? 14 : 22
  const label = role === 'start' ? (loop ? '⟲' : 'D') : role === 'end' ? 'A' : ''
  return L.divIcon({ className: `wp-icon wp-${role}`, html: label, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}

/** Traceur de parcours : clic = point, itinéraire sur les sentiers ou en ligne droite. */
export default function RouteBuilder({ athlete, race, onSave, onCancel }: Props) {
  const init = useMemo(() => initialState(race), []) // eslint-disable-line react-hooks/exhaustive-deps
  const cache = useRef(init.cache)
  const [wps, setWps] = useState<Waypoint[]>(init.wps)
  const history = useRef<Waypoint[][]>([])
  const [mode, setMode] = useState<SegMode>(() => readJson<SegMode>(MODE_KEY) ?? 'trail')
  const [tick, setTick] = useState(0)
  const [name, setName] = useState(init.name)
  const [kind, setKind] = useState<RaceKind>(init.kind)
  const [hover, setHover] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const lines = useRef<L.LayerGroup | null>(null)
  const marks = useRef<L.LayerGroup | null>(null)
  const kms = useRef<L.LayerGroup | null>(null)
  const cursor = useRef<L.CircleMarker | null>(null)

  const keys = wps.slice(1).map((w, k) => segmentKey(wps[k], w, w.mode))
  const sig = `${keys.join('|')}#${tick}`
  const segs = useMemo<Seg[]>(() => keys.map((k) => cache.current.get(k) ?? { status: 'loading' }), [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  const ready = wps.length >= 2 && segs.every((s) => s.status === 'ok')
  const pending = segs.filter((s) => s.status === 'loading').length
  const errors = segs.filter((s) => s.status === 'error') as { status: 'error'; message: string }[]
  const loop = wps.length > 2 && same(wps[0], wps[wps.length - 1])

  const joined = useMemo(() => (ready ? joinSegments(segs.map((s) => (s as { points: RawPoint[] }).points)) : null), [segs, ready])
  const track = useMemo<Track | null>(() => {
    if (!joined || joined.points.length < 2) return null
    try {
      return trackFromRaw(joined.points, name)
    } catch {
      return null
    }
  }, [joined]) // eslint-disable-line react-hooks/exhaustive-deps
  const estimate = useMemo(() => {
    if (!track) return null
    try {
      // Sans nuit, chaleur ni pluie : altitude et technicité (déduite de la pente) seulement.
      const r = newRace(name, '')
      r.env = { ...r.env, night: { ...r.env.night, enabled: false }, heat: { ...r.env.heat, enabled: false }, rain: { ...r.env.rain, enabled: false } }
      return simulate(track, athlete, planOptions(r, track)).totalTime
    } catch {
      return null
    }
  }, [track, athlete]) // eslint-disable-line react-hooks/exhaustive-deps

  // Calcule les segments manquants.
  useEffect(() => {
    wps.slice(1).forEach((b, k) => {
      const a = wps[k]
      const key = segmentKey(a, b, b.mode)
      if (cache.current.has(key)) return
      cache.current.set(key, { status: 'loading' })
      limited(() => routeSegment(a, b, b.mode))
        .then((points) => cache.current.set(key, { status: 'ok', points }))
        .catch((e: Error) => cache.current.set(key, { status: 'error', message: e.message }))
        .finally(() => setTick((t) => t + 1))
    })
  }, [wps, tick])

  // Brouillon d'un nouveau tracé, retrouvé si la page est rechargée.
  useEffect(() => {
    if (!race) writeJson(DRAFT_KEY, { wps, name, kind })
  }, [wps, name, kind, race])

  // Actions (lues par les gestionnaires de la carte, créés une seule fois).
  const change = (next: Waypoint[]) => {
    history.current.push(wps)
    if (history.current.length > 200) history.current.shift()
    setWps(next)
    setNotice(null)
  }
  const reversedSegments = () => {
    segs.forEach((s, k) => {
      if (s.status === 'ok') cache.current.set(segmentKey(wps[k + 1], wps[k], wps[k + 1].mode), { status: 'ok', points: [...s.points].reverse() })
    })
  }
  const act = {
    add: (lat: number, lon: number) => change([...wps, { lat, lon, mode }]),
    // En boucle, le départ et l'arrivée bougent ensemble ; un clic sur le départ ouvre la boucle.
    move: (k: number, lat: number, lon: number) =>
      change(wps.map((w, j) => (j === k || (loop && k === 0 && j === wps.length - 1) ? { ...w, lat, lon } : w))),
    remove: (k: number) => change(loop && k === 0 ? wps.slice(0, -1) : wps.filter((_, j) => j !== k)),
    insert: (k: number, lat: number, lon: number) => {
      const s = segs[k]
      const b = wps[k + 1]
      if (s?.status !== 'ok' || s.points.length < 3) {
        change([...wps.slice(0, k + 1), { lat, lon, mode: b.mode }, ...wps.slice(k + 1)])
        return
      }
      // Le nouveau point est posé sur le tracé : les deux moitiés gardent leur géométrie.
      const i = Math.min(s.points.length - 2, Math.max(1, nearestIndex(s.points, lat, lon)))
      const p = { lat: s.points[i].lat, lon: s.points[i].lon, mode: b.mode }
      cache.current.set(segmentKey(wps[k], p, b.mode), { status: 'ok', points: s.points.slice(0, i + 1) })
      cache.current.set(segmentKey(p, b, b.mode), { status: 'ok', points: s.points.slice(i) })
      change([...wps.slice(0, k + 1), p, ...wps.slice(k + 1)])
    },
    undo: () => {
      const prev = history.current.pop()
      if (prev) setWps(prev)
    },
  }
  const actRef = useRef(act)
  actRef.current = act

  // Carte (créée une fois).
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { doubleClickZoom: false })
    const layers = Object.fromEntries(Object.entries(LAYERS).map(([k, f]) => [k, f()]))
    Object.values(layers)[0].addTo(m)
    L.control.layers(layers, undefined, { position: 'topright' }).addTo(m)
    L.control.scale({ imperial: false }).addTo(m)
    kms.current = L.layerGroup().addTo(m)
    lines.current = L.layerGroup().addTo(m)
    marks.current = L.layerGroup().addTo(m)
    cursor.current = L.circleMarker([0, 0], { radius: 7, color: '#1f2420', fillColor: '#f5c542', fillOpacity: 1, weight: 2, interactive: false })
    const pts = init.wps
    if (pts.length >= 2) m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])), { padding: [30, 30] })
    else if (pts.length === 1) m.setView([pts[0].lat, pts[0].lon], 14)
    else {
      const v = readJson<{ lat: number; lon: number; z: number }>(VIEW_KEY)
      m.setView(v ? [v.lat, v.lon] : [45.9237, 6.8694], v?.z ?? 12)
    }
    m.on('click', (e: L.LeafletMouseEvent) => actRef.current.add(e.latlng.lat, e.latlng.lng))
    m.on('moveend', () => {
      const c = m.getCenter()
      writeJson(VIEW_KEY, { lat: c.lat, lon: c.lng, z: m.getZoom() })
    })
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Annuler avec Ctrl+Z (hors champs de saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) {
        e.preventDefault()
        actRef.current.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Segments et points de passage.
  useEffect(() => {
    const g = lines.current
    const mk = marks.current
    if (!g || !mk) return
    g.clearLayers()
    mk.clearLayers()
    segs.forEach((s, k) => {
      const a = wps[k]
      const b = wps[k + 1]
      if (s.status === 'ok') {
        L.polyline(
          s.points.map((p) => [p.lat, p.lon] as [number, number]),
          { color: ACCENT, weight: 5, opacity: 0.9, dashArray: b.mode === 'line' ? '8 7' : undefined, bubblingMouseEvents: false },
        )
          .bindTooltip('Clic : ajouter un point ici', { sticky: true })
          .on('click', (e: L.LeafletMouseEvent) => actRef.current.insert(k, e.latlng.lat, e.latlng.lng))
          .addTo(g)
      } else {
        L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
          color: s.status === 'error' ? '#c0392b' : '#8a8f88',
          weight: 3,
          dashArray: '4 6',
          interactive: s.status === 'error',
        })
          .bindTooltip(s.status === 'error' ? s.message : 'Calcul…')
          .addTo(g)
      }
    })
    const n = wps.length
    wps.forEach((w, k) => {
      if (loop && k === n - 1) return // arrivée = départ
      L.marker([w.lat, w.lon], { draggable: true, icon: wpIcon(k, n, loop), zIndexOffset: k === 0 || k === n - 1 ? 1000 : 0, autoPan: true })
        .bindTooltip(
          k === 0 && loop
            ? 'Départ et arrivée · glisser pour déplacer, clic pour ouvrir la boucle'
            : `${k === 0 ? 'Départ' : k === n - 1 ? 'Arrivée' : `Point ${k}`} · glisser pour déplacer, clic pour supprimer`,
        )
        .on('dragend', (e: L.LeafletEvent) => {
          const p = (e.target as L.Marker).getLatLng()
          actRef.current.move(k, p.lat, p.lng)
        })
        .on('click', () => actRef.current.remove(k))
        .addTo(mk)
    })
  }, [segs, wps, loop])

  // Bornes kilométriques.
  useEffect(() => {
    const g = kms.current
    if (!g) return
    g.clearLayers()
    if (!track) return
    const step = track.totalDist > 60000 ? 10000 : track.totalDist > 25000 ? 5000 : 1000
    for (let d = step; d < track.totalDist - step / 4; d += step) {
      const p = track.points[indexAt(track.points, d)]
      L.marker([p.lat, p.lon], { interactive: false, icon: L.divIcon({ className: 'km-icon', html: String(d / 1000), iconSize: [20, 16], iconAnchor: [-6, 20] }) }).addTo(g)
    }
  }, [track])

  // Curseur synchronisé avec le survol du profil.
  useEffect(() => {
    const m = map.current
    const c = cursor.current
    if (!m || !c) return
    if (hover === null || !track) {
      c.remove()
      return
    }
    const p = track.points[indexAt(track.points, hover)]
    c.setLatLng([p.lat, p.lon])
    if (!m.hasLayer(c)) c.addTo(m)
  }, [hover, track])

  const fit = () => {
    const m = map.current
    if (m && wps.length >= 2) m.fitBounds(L.latLngBounds(wps.map((p) => [p.lat, p.lon])), { padding: [30, 30] })
  }
  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    try {
      const res = await searchPlace(query)
      setPlaces(res)
      if (!res.length) setNotice('Aucun lieu trouvé.')
      else if (res.length === 1) goTo(res[0])
    } catch (err) {
      setNotice((err as Error).message)
    }
  }
  const goTo = (p: Place) => {
    map.current?.setView([p.lat, p.lon], 14)
    setPlaces(null)
  }
  const locate = () => {
    if (!navigator.geolocation) return setNotice('Position indisponible sur cet appareil.')
    navigator.geolocation.getCurrentPosition(
      (p) => map.current?.setView([p.coords.latitude, p.coords.longitude], 14),
      () => setNotice('Position refusée ou indisponible.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }
  const retry = () => {
    for (const [k, s] of cache.current) if (s.status === 'error') cache.current.delete(k)
    setTick((t) => t + 1)
  }
  const pickMode = (m: SegMode) => {
    setMode(m)
    writeJson(MODE_KEY, m)
  }
  const result = (): DrawResult | null => {
    if (!joined || !track) return null
    const nm = name.trim() || 'Parcours'
    return {
      name: nm,
      kind,
      gpxText: drawnGpx(nm, joined.points),
      drawn: { waypoints: wps.map((w, k) => ({ ...w, i: joined.starts[k] })) },
      total: track.totalDist,
    }
  }
  const save = () => {
    const r = result()
    if (!r) return
    if (!race) writeJson(DRAFT_KEY, { wps: [], name: 'Nouveau parcours', kind })
    onSave(r)
  }
  const exportGpx = () => {
    const r = result()
    if (r) download(`${r.name.replace(/[^\w-]+/g, '_')}.gpx`, r.gpxText)
  }

  return (
    <div className="grid">
      <Card
        title={race ? `Modifier le tracé · ${race.name}` : 'Tracer un parcours'}
        actions={
          <>
            <button className="ghost" onClick={onCancel} title="Quitter sans enregistrer">Retour</button>
            <button onClick={exportGpx} disabled={!ready}>⬇ GPX</button>
            <button className="primary" onClick={save} disabled={!ready}>{race ? 'Enregistrer le tracé' : 'Enregistrer'}</button>
          </>
        }
      >
        <Hint>
          Clique sur la carte pour poser les points : l'itinéraire suit les sentiers et chemins d'OpenStreetMap (calculé par le routeur
          public BRouter), ou une ligne droite hors sentier. Glisse un point pour le déplacer, clique dessus pour le supprimer, clique sur
          le tracé pour ajouter un point intermédiaire. Ctrl+Z annule.
        </Hint>
        <div className="row draw-tools">
          <div className="seg" role="group" aria-label="Mode des prochains segments">
            {SEG_MODES.map((m) => (
              <button key={m.key} className={mode === m.key ? 'on' : ''} onClick={() => pickMode(m.key)} title={m.title}>{m.label}</button>
            ))}
          </div>
          <button onClick={act.undo} disabled={!history.current.length} title="Ctrl+Z">↶ Annuler</button>
          <button onClick={() => change(closeLoop(wps, mode))} disabled={wps.length < 2 || loop} title="Relie l'arrivée au départ">⟲ Boucler</button>
          <button onClick={() => { reversedSegments(); change(outAndBack(wps)) }} disabled={wps.length < 2} title="Revient au départ par le même chemin">⇄ Aller-retour</button>
          <button onClick={() => { reversedSegments(); change(reverseRoute(wps)) }} disabled={wps.length < 2} title="Parcourt le tracé dans l'autre sens">⇅ Inverser</button>
          <button className="ghost" onClick={() => wps.length && confirm('Effacer tout le tracé ?') && change([])} disabled={!wps.length}>Effacer</button>
          <span className="spacer" />
          <form className="row tight" onSubmit={search}>
            <input type="search" placeholder="Aller à un lieu…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 200 }} />
            <button type="submit">🔍</button>
          </form>
          <button onClick={locate} title="Centrer sur ma position">📍</button>
          <button onClick={fit} disabled={wps.length < 2} title="Voir tout le tracé">⤢</button>
        </div>
        {places && places.length > 1 && (
          <ul className="place-list">
            {places.map((p) => (
              <li key={`${p.lat},${p.lon}`}><button className="ghost" onClick={() => goTo(p)}>{p.name}</button></li>
            ))}
          </ul>
        )}
        {notice && <p className="warn-text">{notice}</p>}
        <div ref={el} className="map draw-map" role="region" aria-label="Carte de tracé" />
        <div className="draw-stats">
          <span><strong>{track ? (track.totalDist / 1000).toFixed(2) : '—'}</strong> km</span>
          <span>D+ <strong>{track ? Math.round(track.dPlus) : '—'}</strong> m</span>
          <span>D− <strong>{track ? Math.round(track.dMinus) : '—'}</strong> m</span>
          <span title="Selon ton profil (VC, VAM, durabilité), avec l'altitude et la technicité déduite de la pente ; sans arrêt, nuit ni chaleur">
            Temps estimé <strong>{estimate ? formatDuration(estimate) : '—'}</strong>
          </span>
          <span className="muted">{wps.length} point{wps.length > 1 ? 's' : ''}</span>
          {pending > 0 && <span className="muted">Calcul de {pending} segment{pending > 1 ? 's' : ''}…</span>}
          {errors.length > 0 && (
            <span className="warn-text">
              {errors[0].message} <button className="ghost" onClick={retry}>Réessayer</button>
              {mode !== 'line' && ' · ou passe en « Ligne droite » pour ce passage'}
            </span>
          )}
        </div>
        {track && <MiniProfile track={track} onHover={setHover} />}
        <div className="fields draw-save">
          <label className="field">
            <span className="field-label">Nom</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 260 }} />
          </label>
          {!race && (
            <label className="field">
              <span className="field-label">Enregistrer comme</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as RaceKind)}>
                <option value="route">Parcours d'entraînement (bibliothèque)</option>
                <option value="race">Course</option>
              </select>
            </label>
          )}
        </div>
        {race && (
          <Hint>
            Les points de passage au-delà de la nouvelle arrivée sont retirés et la technicité OSM est à recharger ; les autres réglages
            sont conservés.
          </Hint>
        )}
      </Card>
    </div>
  )
}

/** Profil d'altitude compact, synchronisé avec la carte au survol. */
function MiniProfile({ track, onHover }: { track: Track; onHover: (d: number | null) => void }) {
  const [x, setX] = useState<number | null>(null)
  const W = 1000
  const H = 140
  const pts = track.points
  const lo = Math.min(...pts.map((p) => p.ele))
  const hi = Math.max(...pts.map((p) => p.ele))
  const span = Math.max(50, hi - lo)
  const px = (d: number) => (d / track.totalDist) * W
  const py = (e: number) => H - 6 - ((e - lo) / span) * (H - 16)
  const path = `M0,${H} ${pts.map((p) => `L${px(p.dist).toFixed(1)},${py(p.ele).toFixed(1)}`).join(' ')} L${W},${H} Z`
  const at = x === null ? null : pts[indexAt(pts, (x / W) * track.totalDist)]
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const v = Math.max(0, Math.min(W, ((e.clientX - r.left) / r.width) * W))
    setX(v)
    onHover((v / W) * track.totalDist)
  }
  return (
    <div className="mini-profile">
      <div className="mini-profile-head muted">
        <span>{Math.round(hi)} m</span>
        {at && <span><strong>km {(at.dist / 1000).toFixed(1)}</strong> · {Math.round(at.ele)} m</span>}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onPointerMove={move}
        onPointerLeave={() => {
          setX(null)
          onHover(null)
        }}
        role="img"
        aria-label="Profil d'altitude du tracé"
      >
        <path d={path} fill="rgba(47,107,79,0.18)" stroke={ACCENT} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {x !== null && <line x1={x} x2={x} y1={0} y2={H} stroke="#1f2420" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mini-profile-head muted">
        <span>{Math.round(lo)} m</span>
        <span>{(track.totalDist / 1000).toFixed(1)} km</span>
      </div>
    </div>
  )
}
