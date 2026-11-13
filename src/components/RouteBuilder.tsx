import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  Check,
  ChevronDown,
  Eraser,
  FileDown,
  FileUp,
  Footprints,
  LocateFixed,
  Maximize2,
  Plus,
  Redo2,
  Repeat2,
  Route,
  Ruler,
  Search,
  Settings,
  Trash2,
  TrendingDown,
  TrendingUp,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { newRace } from '../lib/defaults'
import { download } from '../lib/exportGpx'
import { elevationGain, gpxRawPoints, haversine, indexAt, trackFromRaw, type RawPoint } from '../lib/gpx'
import { simulate } from '../lib/model'
import { planOptions } from '../lib/plan'
import {
  closeLoop,
  drawnFromRaw,
  drawnGpx,
  fillElevationSparse,
  joinSegments,
  nearestIndex,
  outAndBack,
  readTrackFile,
  reverseRoute,
  routeLeg,
  searchPlace,
  segmentKey,
  SEG_MODES,
  snapTolerance,
  splitByWaypoints,
  type DrawnRoute,
  type Place,
  type SegMode,
  type Waypoint,
} from '../lib/routing'
import { formatDuration, formatPace } from '../lib/time'
import type { Athlete, PaceZone, Race, RaceKind, SimResult, Track } from '../lib/types'
import { colorForIndex, MODEL_COLOR, wholeRoute, wholeRouteZone, zoneTarget, type Target } from '../lib/zones'
import { addLayers } from './mapLayers'

export interface DrawResult {
  name: string
  kind: RaceKind
  gpxText: string
  drawn: DrawnRoute
  /** Longueur de la trace (m). */
  total: number
  /** Zones d'allure à enregistrer avec le parcours, ou null pour garder celles de la course. */
  zones: PaceZone[] | null
}

/** Allure simulée : modèle de course, zones déjà placées sur le parcours, ou une zone du profil (indice). */
type Pace = 'model' | 'route' | number

interface Props {
  athlete: Athlete
  /** Course ou parcours dont on modifie le tracé, ou null pour un nouveau tracé. */
  race: Race | null
  onSave: (r: DrawResult) => void
  onCancel: () => void
}

/** Segment calculé ; `offroad` : point hors du réseau de chemins, tracé en ligne droite. */
type Seg = { status: 'ok'; points: RawPoint[]; offroad?: boolean } | { status: 'loading' } | { status: 'error'; message: string }

/** Hauteurs de la feuille du bas (téléphone) : chiffres seuls, avec la barre d'édition, ou dépliée. */
type SheetState = 'mini' | 'peek' | 'full'
const SHEET_ORDER: SheetState[] = ['mini', 'peek', 'full']

/** Sélection : un point de passage, ou un tronçon (avec l'endroit touché, pour y insérer un point). */
type Sel = { kind: 'wp'; k: number } | { kind: 'seg'; k: number; lat: number; lon: number } | null

const DRAFT_KEY = 'tp-draw-draft'
const VIEW_KEY = 'tp-draw-view'
const MODE_KEY = 'tp-draw-mode'
const ACCENT = '#2f6b4f'
const SELECTED = '#f39c12'
/** Durée de l'appui (doigt) pour poser un point. */
const HOLD_MS = 350
const DEFAULT_CENTER: [number, number] = [45.9237, 6.8694]

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

function useMediaQuery(q: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(q)
    if (!mq) return
    const f = () => setOn(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [q])
  return !!on
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
function initialState(race: Race | null, a: Athlete): { wps: Waypoint[]; cache: Map<string, Seg>; name: string; kind: RaceKind; pace: Pace } {
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
    const pace: Pace = wholeRouteZone(race.zones, a) ?? (race.zones.length ? 'route' : 'model')
    return { wps, cache, name: race.name, kind: race.kind, pace }
  }
  const draft = readJson<{ wps: Waypoint[]; name: string; kind: RaceKind; pace?: Pace }>(DRAFT_KEY)
  const pace = typeof draft?.pace === 'number' && draft.pace < a.zones.length ? draft.pace : 'model'
  return { wps: draft?.wps ?? [], cache, name: draft?.name ?? '', kind: draft?.kind ?? 'route', pace }
}

const same = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7

// Icônes Lucide (épingle de départ, drapeau d'arrivée) en SVG brut pour les marqueurs Leaflet.
const svgIcon = (body: string) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const PIN_SVG = svgIcon('<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>')
const FLAG_SVG = svgIcon('<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>')

function wpIcon(k: number, n: number, selected: boolean): L.DivIcon {
  const role = k === 0 ? 'start' : k === n - 1 ? 'end' : 'mid'
  const size = role === 'mid' ? 16 : 26
  const html = role === 'start' ? PIN_SVG : role === 'end' ? FLAG_SVG : ''
  return L.divIcon({ className: `wp-icon wp-${role}${selected ? ' wp-sel' : ''}`, html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}

const MODE_ICON: Record<SegMode, LucideIcon> = { trail: Footprints, shortest: Route, line: Ruler }
const MapPinIcon = () => <span className="svg-inline" dangerouslySetInnerHTML={{ __html: PIN_SVG }} />
const FlagIcon = () => <span className="svg-inline" dangerouslySetInnerHTML={{ __html: FLAG_SVG }} />

/** Durée courte : 6′, 48′, 1h05. */
function shortTime(sec: number): string {
  return sec < 3600 ? `${Math.round(sec / 60)}′` : formatDuration(sec)
}
const km = (m: number) => (m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: m < 10000 ? 2 : 1 })
const modeLabel = (m: SegMode) => SEG_MODES.find((x) => x.key === m)?.label ?? m

function ModeSeg({ value, onChange }: { value: SegMode; onChange: (m: SegMode) => void }) {
  return (
    <div className="seg mode-seg" role="group" aria-label="Mode du tronçon">
      {SEG_MODES.map((m) => {
        const Icon = MODE_ICON[m.key]
        return (
          <button key={m.key} className={value === m.key ? 'on' : ''} onClick={() => onChange(m.key)} title={m.title}>
            <Icon aria-hidden /> {m.label}
          </button>
        )
      })}
    </div>
  )
}

/** Traceur de parcours plein écran : toucher = point sur les chemins, appui long = point hors sentier. */
export default function RouteBuilder({ athlete, race, onSave, onCancel }: Props) {
  const init = useMemo(() => initialState(race, athlete), []) // eslint-disable-line react-hooks/exhaustive-deps
  const cache = useRef(init.cache)
  const [wps, setWps] = useState<Waypoint[]>(init.wps)
  const history = useRef<Waypoint[][]>([])
  const future = useRef<Waypoint[][]>([])
  const [mode, setMode] = useState<SegMode>(() => readJson<SegMode>(MODE_KEY) ?? 'trail')
  const [tick, setTick] = useState(0)
  const [name, setName] = useState(init.name)
  const [kind, setKind] = useState<RaceKind>(init.kind)
  const [pace, setPace] = useState<Pace>(init.pace)
  const [hover, setHover] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<{ name: string; raw: RawPoint[] } | null>(null)
  const [dropping, setDropping] = useState(false)
  const [sel, setSel] = useState<Sel>(null)
  const [menu, setMenu] = useState(false)
  const [sheet, setSheet] = useState<SheetState>('peek')
  // Glisser la feuille : hauteur suivie au doigt, puis calage sur la hauteur voisine.
  const [dragH, setDragH] = useState<number | null>(null)
  const drag = useRef<{ y: number; h: number; id: number; moved: boolean } | null>(null)
  const [paceOpen, setPaceOpen] = useState(false)
  const mobile = useMediaQuery('(max-width: 899px)')
  const panelRef = useRef<HTMLElement>(null)
  const [sheetH, setSheetH] = useState(0)
  // Appui maintenu (téléphone) : position de l'anneau de progression, et instant du dernier point posé ainsi.
  const [holdAt, setHoldAt] = useState<{ x: number; y: number } | null>(null)
  const held = useRef(0)
  const lastPointer = useRef('mouse')
  const coarse = useMediaQuery('(pointer: coarse)')

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
  const errorAt = segs.findIndex((s) => s.status === 'error')
  const offroadCount = segs.filter((s) => s.status === 'ok' && s.offroad).length
  const loop = wps.length > 2 && same(wps[0], wps[wps.length - 1])

  const joined = useMemo(() => (ready ? joinSegments(segs.map((s) => (s as { points: RawPoint[] }).points)) : null), [segs, ready])
  const track = useMemo<Track | null>(() => {
    if (!joined || joined.points.length < 2) return null
    try {
      return trackFromRaw(joined.points, name || 'Parcours')
    } catch {
      return null
    }
  }, [joined]) // eslint-disable-line react-hooks/exhaustive-deps
  // Zones d'allure de la simulation (et de l'enregistrement).
  const paceZones = (t: Target | null): PaceZone[] =>
    t ? wholeRoute(t, track?.totalDist ?? 0) : pace === 'route' && race ? race.zones : []
  const replacesZones = !!race?.zones.length && wholeRouteZone(race.zones, athlete) === null && pace !== 'route'
  const estimate = useMemo<{ time: number; range: [number, number] | null; sim: SimResult } | null>(() => {
    if (!track) return null
    const run = (zones: PaceZone[]) => {
      // Sans nuit, chaleur ni pluie : altitude et technicité (déduite de la pente) seulement.
      const r = { ...newRace(name, ''), zones }
      r.env = { ...r.env, night: { ...r.env.night, enabled: false }, heat: { ...r.env.heat, enabled: false }, rain: { ...r.env.rain, enabled: false } }
      return simulate(track, athlete, planOptions(r, track))
    }
    try {
      if (typeof pace !== 'number' || !athlete.zones[pace]) {
        const sim = run(typeof pace === 'number' ? [] : paceZones(null))
        return { time: sim.totalTime, range: null, sim }
      }
      const z = athlete.zones[pace]
      const at = (value: number) => run(paceZones({ kind: 'intensity', value, label: z.name }))
      const sim = at((z.low + z.high) / 2)
      // Haut de zone = plus rapide ; bas de zone = plus lent.
      return { time: sim.totalTime, range: [at(z.high).totalTime, at(z.low).totalTime], sim }
    } catch {
      return null
    }
  }, [track, athlete, pace]) // eslint-disable-line react-hooks/exhaustive-deps

  // Points de repère : distance, altitude et temps prévu à chaque point de passage.
  const rows = useMemo(() => {
    if (!joined || !track || joined.starts.length !== wps.length) return null
    const cum = [0]
    for (let i = 1; i < joined.points.length; i++) {
      const a = joined.points[i - 1]
      const b = joined.points[i]
      cum.push(cum[i - 1] + haversine(a.lat, a.lon, b.lat, b.lon))
    }
    const scale = track.totalDist / (cum[cum.length - 1] || 1)
    return wps.map((_, k) => {
      const d = cum[joined.starts[k]] * scale
      const i = indexAt(track.points, d)
      return { d, ele: track.points[i].ele, t: estimate?.sim.points[i]?.t ?? null }
    })
  }, [joined, track, wps, estimate])

  // Calcule les segments manquants. Hors du réseau de chemins (au-delà de ~24 px du chemin le
  // plus proche au zoom courant, ou sans chemin du tout) : ligne droite automatique.
  useEffect(() => {
    wps.slice(1).forEach((b, k) => {
      const a = wps[k]
      const key = segmentKey(a, b, b.mode)
      if (cache.current.has(key)) return
      cache.current.set(key, { status: 'loading' })
      const snap = map.current ? snapTolerance(map.current.getZoom(), b.lat) : 40
      limited(() => routeLeg(a, b, b.mode, snap))
        .then(({ points, offroad }) => {
          cache.current.set(key, { status: 'ok', points, offroad })
        })
        .catch((e: unknown) => {
          cache.current.set(key, { status: 'error', message: (e as Error).message })
        })
        .finally(() => setTick((t) => t + 1))
    })
  }, [wps, tick])

  // Brouillon d'un nouveau tracé, retrouvé si la page est rechargée.
  useEffect(() => {
    if (!race) writeJson(DRAFT_KEY, { wps, name, kind, pace })
  }, [wps, name, kind, pace, race])

  // Plein écran : la page derrière ne défile plus.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Hauteur de la feuille du bas (téléphone) : les boutons flottants restent au-dessus.
  useLayoutEffect(() => {
    const p = panelRef.current
    if (!p || !mobile) {
      setSheetH(0)
      return
    }
    const update = () => setSheetH(p.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(p)
    return () => ro.disconnect()
  }, [mobile])
  useEffect(() => {
    map.current?.invalidateSize()
  }, [mobile])

  // Actions (lues par les gestionnaires de la carte, créés une seule fois).
  const change = (next: Waypoint[]) => {
    history.current.push(wps)
    if (history.current.length > 200) history.current.shift()
    future.current = []
    setWps(next)
    setSel(null)
    setNotice(null)
  }
  const reversedSegments = () => {
    segs.forEach((s, k) => {
      if (s.status === 'ok') cache.current.set(segmentKey(wps[k + 1], wps[k], wps[k + 1].mode), { status: 'ok', points: [...s.points].reverse(), offroad: s.offroad })
    })
  }
  /** Mode du tronçon qui arrive au point j. */
  const setSegMode = (j: number, m: SegMode) => {
    if (j <= 0 || j >= wps.length || wps[j].mode === m) return
    change(wps.map((w, i) => (i === j ? { ...w, mode: m } : w)))
  }
  const act = {
    add: (lat: number, lon: number, m: SegMode = mode) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
      change([...wps, { lat, lon, mode: m }])
    },
    /** Ferme ce qui est ouvert ; renvoie true s'il y avait quelque chose. */
    dismiss: () => {
      if (!sel && !menu && !places) return false
      setSel(null)
      setMenu(false)
      setPlaces(null)
      return true
    },
    // Clic (souris) : ferme d'abord ce qui est ouvert, sinon ajoute un point.
    tap: (lat: number, lon: number) => {
      if (!act.dismiss()) act.add(lat, lon)
    },
    // Appui maintenu (téléphone) : ajoute toujours un point.
    holdAdd: (lat: number, lon: number) => {
      setMenu(false)
      setPlaces(null)
      act.add(lat, lon)
    },
    // En boucle, le départ et l'arrivée bougent ensemble.
    move: (k: number, lat: number, lon: number) =>
      change(wps.map((w, j) => (j === k || (loop && k === 0 && j === wps.length - 1) ? { ...w, lat, lon } : w))),
    // Sur le départ d'une boucle : ouvre la boucle.
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
      cache.current.set(segmentKey(wps[k], p, b.mode), { status: 'ok', points: s.points.slice(0, i + 1), offroad: s.offroad })
      cache.current.set(segmentKey(p, b, b.mode), { status: 'ok', points: s.points.slice(i), offroad: s.offroad })
      change([...wps.slice(0, k + 1), p, ...wps.slice(k + 1)])
    },
    selectWp: (k: number) => {
      if (Date.now() - held.current < 800) return
      setMenu(false)
      setSel({ kind: 'wp', k })
    },
    selectSeg: (k: number, lat: number, lon: number) => {
      if (Date.now() - held.current < 800) return
      setMenu(false)
      setSel({ kind: 'seg', k, lat, lon })
    },
    undo: () => {
      const prev = history.current.pop()
      if (!prev) return
      future.current.push(wps)
      setWps(prev)
      setSel(null)
    },
    redo: () => {
      const next = future.current.pop()
      if (!next) return
      history.current.push(wps)
      setWps(next)
      setSel(null)
    },
    deleteSel: () => {
      if (sel?.kind === 'wp') act.remove(sel.k)
    },
  }
  const actRef = useRef(act)
  actRef.current = act

  // Carte (créée une fois).
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { doubleClickZoom: false, zoomControl: false, tapHold: false } as L.MapOptions)
    const pts = init.wps
    const view = readJson<{ lat: number; lon: number; z: number }>(VIEW_KEY)
    addLayers(m, pts.length ? [pts[0].lat, pts[0].lon] : view ? [view.lat, view.lon] : DEFAULT_CENTER)
    L.control.zoom({ position: 'topright' }).addTo(m)
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m)
    kms.current = L.layerGroup().addTo(m)
    lines.current = L.layerGroup().addTo(m)
    marks.current = L.layerGroup().addTo(m)
    cursor.current = L.circleMarker([0, 0], { radius: 7, color: '#1f2420', fillColor: '#f5c542', fillOpacity: 1, weight: 2, interactive: false })
    if (pts.length >= 2) m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])), { padding: [40, 40] })
    else if (pts.length === 1) m.setView([pts[0].lat, pts[0].lon], 15)
    else m.setView(view ? [view.lat, view.lon] : DEFAULT_CENTER, view?.z ?? 13)
    // Souris : un clic pose un point. Doigt : un toucher bref ne fait que fermer ce qui est
    // ouvert (on peut déplacer la carte sans rien poser) ; un point se pose par un appui maintenu.
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (Date.now() - held.current < 800) return
      if (lastPointer.current === 'mouse') actRef.current.tap(e.latlng.lat, e.latlng.lng)
      else actRef.current.dismiss()
    })
    const box = el.current
    let timer: ReturnType<typeof setTimeout> | undefined
    let start: { x: number; y: number; id: number } | null = null
    let touches = 0
    const cancel = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      start = null
      setHoldAt(null)
    }
    const down = (e: PointerEvent) => {
      lastPointer.current = e.pointerType
      if (e.pointerType === 'mouse') return
      touches++
      const target = e.target as HTMLElement
      if (touches > 1 || target.closest('.leaflet-marker-icon, .leaflet-control')) {
        cancel()
        return
      }
      const r = box.getBoundingClientRect()
      start = { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId }
      setHoldAt({ x: start.x, y: start.y })
      timer = setTimeout(() => {
        if (!start) return
        const ll = m.containerPointToLatLng([start.x, start.y])
        held.current = Date.now()
        navigator.vibrate?.(15)
        cancel()
        actRef.current.holdAdd(ll.lat, ll.lng)
      }, HOLD_MS)
    }
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const r = box.getBoundingClientRect()
      if (Math.hypot(e.clientX - r.left - start.x, e.clientY - r.top - start.y) > 10) cancel()
    }
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') touches = Math.max(0, touches - 1)
      cancel()
    }
    box.addEventListener('pointerdown', down)
    box.addEventListener('pointermove', move)
    box.addEventListener('pointerup', up)
    box.addEventListener('pointercancel', up)
    m.on('zoomstart movestart', () => {
      if (start) cancel()
    })
    m.on('moveend', () => {
      const c = m.getCenter()
      writeJson(VIEW_KEY, { lat: c.lat, lon: c.lng, z: m.getZoom() })
    })
    map.current = m
    return () => {
      cancel()
      box.removeEventListener('pointerdown', down)
      box.removeEventListener('pointermove', move)
      box.removeEventListener('pointerup', up)
      box.removeEventListener('pointercancel', up)
      m.remove()
      map.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Clavier : Ctrl+Z / Ctrl+Y (ou Maj+Ctrl+Z), Suppr pour le point choisi, Échap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName)) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault()
        actRef.current.redo()
      } else if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault()
        actRef.current.undo()
      } else if (k === 'delete' || k === 'backspace') {
        actRef.current.deleteSel()
      } else if (k === 'escape') {
        setSel(null)
        setMenu(false)
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
      const picked = sel?.kind === 'seg' && sel.k === k
      const latlngs: [number, number][] = s.status === 'ok' ? s.points.map((p) => [p.lat, p.lon]) : [[a.lat, a.lon], [b.lat, b.lon]]
      const straight = b.mode === 'line' || (s.status === 'ok' && s.offroad)
      L.polyline(latlngs, {
        color: s.status === 'error' ? '#c0392b' : s.status === 'loading' ? '#8a8f88' : picked ? SELECTED : ACCENT,
        weight: s.status === 'ok' ? (picked ? 7 : 5) : 3,
        opacity: 0.95,
        dashArray: s.status !== 'ok' ? '4 6' : straight ? '9 7' : undefined,
        interactive: false,
      }).addTo(g)
      // Bande invisible plus large : facile à toucher au doigt.
      L.polyline(latlngs, { color: '#000', weight: 24, opacity: 0.01, bubblingMouseEvents: false })
        .on('click', (e: L.LeafletMouseEvent) => actRef.current.selectSeg(k, e.latlng.lat, e.latlng.lng))
        .addTo(g)
    })
    const n = wps.length
    // Marqueur à l'extrémité du tracé (accrochée au chemin), sinon là où le point a été posé.
    const at = (k: number): [number, number] => {
      const before = k > 0 ? segs[k - 1] : undefined
      if (before?.status === 'ok') {
        const p = before.points[before.points.length - 1]
        return [p.lat, p.lon]
      }
      const after = segs[k]
      if (after?.status === 'ok') return [after.points[0].lat, after.points[0].lon]
      return [wps[k].lat, wps[k].lon]
    }
    wps.forEach((_, k) => {
      if (loop && k === n - 1) return // arrivée = départ
      const picked = sel?.kind === 'wp' && sel.k === k
      L.marker(k === 0 && loop ? at(0) : at(k), {
        draggable: true,
        icon: wpIcon(k, loop ? n - 1 : n, picked),
        zIndexOffset: picked ? 2000 : k === 0 || k === n - 1 ? 1000 : 0,
        autoPan: true,
        title: k === 0 ? (loop ? 'Départ et arrivée' : 'Départ') : k === n - 1 ? 'Arrivée' : `Point ${k}`,
      })
        .on('dragend', (e: L.LeafletEvent) => {
          const p = (e.target as L.Marker).getLatLng()
          actRef.current.move(k, p.lat, p.lng)
        })
        .on('click', () => actRef.current.selectWp(k))
        .addTo(mk)
    })
  }, [segs, wps, loop, sel])

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
    if (m && wps.length >= 2) m.fitBounds(L.latLngBounds(wps.map((p) => [p.lat, p.lon])), { padding: [40, 40] })
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
    map.current?.setView([p.lat, p.lon], 15)
    setPlaces(null)
  }
  const locate = () => {
    if (!navigator.geolocation) return setNotice('Position indisponible sur cet appareil.')
    navigator.geolocation.getCurrentPosition(
      (p) => map.current?.setView([p.coords.latitude, p.coords.longitude], 15),
      () => setNotice('Position refusée ou indisponible.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }
  // Import d'un GPX ou d'un FIT : la trace devient un tracé modifiable.
  const importFile = async (f: File | undefined) => {
    if (!f) return
    setMenu(false)
    try {
      const imp = readTrackFile(f.name, new Uint8Array(await f.arrayBuffer()))
      if (imp.raw.some((p) => p.ele === null)) {
        setNotice('Altitude du fichier importé…')
        imp.raw = await fillElevationSparse(imp.raw)
        setNotice(null)
      }
      if (wps.length) setPendingImport(imp)
      else applyImport(imp, 'replace')
    } catch (e) {
      setNotice(`${f.name} : ${(e as Error).message}`)
    }
  }
  const applyImport = (imp: { name: string; raw: RawPoint[] }, how: 'replace' | 'append') => {
    setPendingImport(null)
    const d = drawnFromRaw(imp.raw)
    const iw: Waypoint[] = d.waypoints.map(({ lat, lon, mode }) => ({ lat, lon, mode }))
    splitByWaypoints(imp.raw, d.waypoints.map((w) => w.i)).forEach((points, k) => {
      cache.current.set(segmentKey(iw[k], iw[k + 1], iw[k + 1].mode), { status: 'ok', points })
    })
    if (how === 'append') change([...wps, { ...iw[0], mode }, ...iw.slice(1)])
    else change(iw)
    if (how === 'replace' && (!race || !name.trim())) setName(imp.name)
    map.current?.fitBounds(L.latLngBounds(imp.raw.map((p) => [p.lat, p.lon])), { padding: [40, 40] })
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
    const nm = name.trim() || 'Nouveau parcours'
    return {
      name: nm,
      kind,
      gpxText: drawnGpx(nm, joined.points),
      drawn: { waypoints: wps.map((w, k) => ({ ...w, i: joined.starts[k] })) },
      total: track.totalDist,
      // Zone du profil : tout le parcours dans cette zone ; allure de course : aucune zone.
      zones: typeof pace === 'number' ? paceZones(zoneTarget(athlete, pace)) : pace === 'model' ? [] : null,
    }
  }
  const save = () => {
    const r = result()
    if (!r) return
    if (!race) writeJson(DRAFT_KEY, { wps: [], name: '', kind, pace })
    onSave(r)
  }
  const exportGpx = () => {
    const r = result()
    if (r) download(`${r.name.replace(/[^\w-]+/g, '_')}.gpx`, r.gpxText)
    setMenu(false)
  }
  const clearAll = () => {
    setMenu(false)
    if (wps.length && confirm('Effacer tout le tracé ?')) change([])
  }
  const trash = () => (sel?.kind === 'wp' ? act.remove(sel.k) : clearAll())

  const onSheetDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!mobile || (e.target as HTMLElement).closest('button, input, select, a, label')) return
    const p = panelRef.current
    if (!p) return
    drag.current = { y: e.clientY, h: p.offsetHeight, id: e.pointerId, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onSheetMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dy = e.clientY - d.y
    if (!d.moved && Math.abs(dy) < 6) return
    d.moved = true
    setDragH(Math.max(56, Math.min(window.innerHeight * 0.85, d.h - dy)))
  }
  const onSheetUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    setDragH(null)
    const dy = e.clientY - d.y
    if (Math.abs(dy) < 30) return // un toucher ne change rien : seul le glisser ouvre ou ferme
    const i = SHEET_ORDER.indexOf(sheet)
    const steps = Math.abs(dy) > 220 ? 2 : 1
    setSheet(SHEET_ORDER[Math.max(0, Math.min(SHEET_ORDER.length - 1, i + (dy < 0 ? steps : -steps)))])
  }

  const floatBottom = (mobile ? sheetH : 0) + 12
  const paceLabel = pace === 'model' ? 'Course' : pace === 'route' ? 'Zones' : (athlete.zones[pace]?.name ?? '').replace(/^Zone\s*/i, 'Z')
  const paceColor = typeof pace === 'number' ? colorForIndex(pace, athlete) : MODEL_COLOR
  const wpName = (k: number) => (k === 0 ? (loop ? 'Départ et arrivée' : 'Départ') : k === wps.length - 1 ? 'Arrivée' : `Point ${k}`)

  return (
    <div className="draw-shell" style={{ ['--sheet-h' as string]: `${mobile ? sheetH : 0}px` }}>
      <div className="draw-mapwrap">
        <div
          ref={el}
          className={`draw-map${dropping ? ' dropping' : ''}`}
          role="region"
          aria-label="Carte de tracé"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setDropping(true)
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDropping(false)
            importFile(e.dataTransfer.files[0])
          }}
        />

        {holdAt && <span className="hold-ring" style={{ left: holdAt.x, top: holdAt.y, animationDuration: `${HOLD_MS}ms` }} aria-hidden />}

        <div className="draw-top">
          <button className="fab" onClick={onCancel} title="Quitter sans enregistrer" aria-label="Retour"><ArrowLeft /></button>
          <form className="draw-search" onSubmit={search}>
            <Search className="draw-search-icon" aria-hidden />
            <input type="search" placeholder="Rechercher un lieu…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {places && places.length > 1 && (
              <ul className="place-list">
                {places.map((p) => (
                  <li key={`${p.lat},${p.lon}`}><button type="button" className="ghost" onClick={() => goTo(p)}>{p.name}</button></li>
                ))}
              </ul>
            )}
          </form>
        </div>

        {(pendingImport || notice || !wps.length) && (
          <div className="draw-banner">
            {pendingImport ? (
              <div className="banner info">
                <span>« {pendingImport.name} » : que faire du tracé en cours ?</span>
                <span className="row tight">
                  <button className="primary" onClick={() => applyImport(pendingImport, 'append')} title="Relie la fin du tracé actuel au début du fichier">Ajouter à la suite</button>
                  <button onClick={() => applyImport(pendingImport, 'replace')}>Remplacer</button>
                  <button className="ghost" onClick={() => setPendingImport(null)}>Annuler</button>
                </span>
              </div>
            ) : notice ? (
              <div className="banner info"><span>{notice}</span><button className="ghost" onClick={() => setNotice(null)} aria-label="Fermer"><X /></button></div>
            ) : (
              <div className="draw-tip">
                {coarse ? 'Appuie un instant sur la carte pour poser le départ' : 'Clique sur la carte pour poser le départ'} · hors d'un chemin, le tracé
                passe en ligne droite
              </div>
            )}
          </div>
        )}

        <div className="draw-fabs" style={{ bottom: floatBottom + 26 }}>
          <button className="fab" onClick={locate} title="Ma position" aria-label="Ma position"><LocateFixed /></button>
          <button className="fab" onClick={fit} disabled={wps.length < 2} title="Voir tout le tracé" aria-label="Voir tout le tracé"><Maximize2 /></button>
        </div>

        {sel ? (
          <div className="draw-card" style={{ bottom: floatBottom + 26 }}>
            {sel.kind === 'wp' && wps[sel.k] ? (
              <>
                <div className="draw-card-head">
                  <strong>{wpName(sel.k)}</strong>
                  {rows?.[sel.k] && <span className="muted">km {km(rows[sel.k].d)} · {Math.round(rows[sel.k].ele)} m{rows[sel.k].t !== null ? ` · ${shortTime(rows[sel.k].t!)}` : ''}</span>}
                  <button className="ghost" onClick={() => setSel(null)} aria-label="Fermer"><X /></button>
                </div>
                {sel.k > 0 && (
                  <div className="draw-card-row">
                    <span className="muted">Tronçon pour y arriver</span>
                    <ModeSeg value={wps[sel.k].mode} onChange={(m) => setSegMode(sel.k, m)} />
                  </div>
                )}
                <div className="row tight">
                  <button className="danger-btn" onClick={() => act.remove(sel.k)}>{loop && sel.k === 0 ? <><Repeat2 /> Ouvrir la boucle</> : <><Trash2 /> Supprimer le point</>}</button>
                  <span className="muted small">Glisse le point pour le déplacer</span>
                </div>
              </>
            ) : sel.kind === 'seg' && wps[sel.k + 1] ? (
              <>
                <div className="draw-card-head">
                  <strong>Tronçon {sel.k + 1}</strong>
                  {rows?.[sel.k + 1] && track && (
                    <span className="muted">
                      {km(rows[sel.k + 1].d - rows[sel.k].d)} km · <TrendingUp className="inline" /> {Math.round(elevationGain(track.points, rows[sel.k].d, rows[sel.k + 1].d).dPlus)} m
                    </span>
                  )}
                  <button className="ghost" onClick={() => setSel(null)} aria-label="Fermer"><X /></button>
                </div>
                <ModeSeg value={wps[sel.k + 1].mode} onChange={(m) => setSegMode(sel.k + 1, m)} />
                {segs[sel.k]?.status === 'ok' && (segs[sel.k] as { offroad?: boolean }).offroad && (
                  <span className="muted small">Hors du réseau de chemins : tracé en ligne droite.</span>
                )}
                <button onClick={() => act.insert(sel.k, sel.lat, sel.lon)}><Plus /> Ajouter un point ici</button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside
        ref={panelRef}
        className={`draw-panel sheet-${sheet}${dragH !== null ? ' dragging' : ''}`}
        style={mobile && dragH !== null ? { height: dragH } : undefined}
      >
        <div className="draw-panel-body">
          <div className="sheet-drag" onPointerDown={onSheetDown} onPointerMove={onSheetMove} onPointerUp={onSheetUp} onPointerCancel={onSheetUp}>
          {mobile && (
            <div className="sheet-handle" title="Glisser vers le haut ou le bas" aria-hidden>
              <span />
            </div>
          )}
          <div className="draw-head">
            <input className="draw-name" value={name} placeholder={race ? race.name : 'Nouveau parcours'} onChange={(e) => setName(e.target.value)} aria-label="Nom du parcours" />
          </div>
          <div className="draw-summary">
            <span>{track ? km(track.totalDist) : '0'} km</span>
            <span><TrendingUp className="inline" /> {track ? Math.round(track.dPlus) : 0} m</span>
            <span><TrendingDown className="inline" /> {track ? Math.round(track.dMinus) : 0} m</span>
            <span className="draw-time" title="Selon ton profil (VC, VAM, durabilité ou zone choisie), sans arrêt, nuit ni chaleur">
              {estimate ? shortTime(estimate.time) : '—'}
            </span>
            <button
              className="pace-chip"
              onClick={(e) => {
                e.stopPropagation()
                setPaceOpen(!paceOpen)
                setSheet('full')
              }}
              title="Allure simulée"
            >
              <i className="zone-swatch" style={{ background: paceColor }} />
              {paceLabel} <ChevronDown className="inline" />
            </button>
          </div>
          </div>
          {(pending > 0 || errorAt >= 0 || offroadCount > 0) && (
            <div className="draw-status">
              {pending > 0 && <span className="muted">Calcul de {pending} tronçon{pending > 1 ? 's' : ''}…</span>}
              {errorAt >= 0 && (
                <span className="warn-text">
                  {(segs[errorAt] as { message: string }).message}{' '}
                  <button className="ghost" onClick={retry}>Réessayer</button>
                  <button className="ghost" onClick={() => setSegMode(errorAt + 1, 'line')}>Ligne droite</button>
                </span>
              )}
              {offroadCount > 0 && (
                <span className="muted">{offroadCount} tronçon{offroadCount > 1 ? 's' : ''} hors sentier (ligne droite)</span>
              )}
            </div>
          )}

          <div className="draw-more">
            {paceOpen && (
              <div className="pace-pick">
                <div className="pace-chips" role="group" aria-label="Allure simulée">
                  <button className={pace === 'model' ? 'on' : ''} onClick={() => setPace('model')} title="Allure de course : intensité selon la durée (durabilité)">
                    <i className="zone-swatch" style={{ background: MODEL_COLOR }} />Course
                  </button>
                  {race && race.zones.length > 0 && wholeRouteZone(race.zones, athlete) === null && (
                    <button className={pace === 'route' ? 'on' : ''} onClick={() => setPace('route')} title="Les zones d'allure déjà placées sur ce parcours">
                      Zones du parcours
                    </button>
                  )}
                  {athlete.zones.map((z, k) => (
                    <button
                      key={k}
                      className={pace === k ? 'on' : ''}
                      onClick={() => setPace(k)}
                      title={`${z.name}${z.use ? ` · ${z.use}` : ''} : ${Math.round(z.low * 100)}–${Math.round(z.high * 100)} % VC`}
                    >
                      <i className="zone-swatch" style={{ background: colorForIndex(k, athlete) }} />
                      {z.name.replace(/^Zone\s*/i, 'Z')}
                    </button>
                  ))}
                </div>
                <span className="muted pace-info">
                  {typeof pace === 'number' && athlete.zones[pace]
                    ? `${athlete.zones[pace].use ? `${athlete.zones[pace].use} · ` : ''}${Math.round(athlete.zones[pace].low * 100)}–${Math.round(athlete.zones[pace].high * 100)} % VC · ${formatPace(1000 / (athlete.cs * athlete.zones[pace].high))}–${formatPace(1000 / (athlete.cs * athlete.zones[pace].low))}/km sur le plat.${estimate?.range ? ` Haut / bas de zone : ${shortTime(estimate.range[0])} – ${shortTime(estimate.range[1])}.` : ''} Enregistrée avec le parcours${replacesZones ? ', à la place des zones déjà placées' : ''}.`
                    : pace === 'route'
                      ? 'Zones déjà placées sur le parcours.'
                      : `Intensité de course : elle baisse avec la durée selon ta durabilité.${replacesZones ? ' Les zones placées sur le parcours seront retirées à l’enregistrement.' : ''}`}
                </span>
              </div>
            )}
            {track && <MiniProfile track={track} onHover={setHover} />}

            {wps.length > 0 && (
              <>
                <h3 className="draw-h">Points de repère</h3>
                <ol className="wp-list">
                  {wps.map((w, k) => {
                    if (loop && k === wps.length - 1 && k > 0) return null
                    const r = rows?.[k]
                    const next = rows?.[k + 1]
                    const g = r && next && track ? elevationGain(track.points, r.d, next.d) : null
                    return (
                      <li key={k}>
                        <button
                          className={`wp-row${sel?.kind === 'wp' && sel.k === k ? ' on' : ''}`}
                          onClick={() => {
                            act.selectWp(k)
                            map.current?.panTo([w.lat, w.lon])
                          }}
                        >
                          <span className={`wp-dot wp-${k === 0 ? 'start' : k === wps.length - 1 && !loop ? 'end' : 'mid'}`}>
                            {k === 0 ? <MapPinIcon /> : k === wps.length - 1 && !loop ? <FlagIcon /> : null}
                          </span>
                          <span className="wp-name">{wpName(k)}</span>
                          <span className="muted">{r ? `${km(r.d)} km · ${Math.round(r.ele)} m` : '…'}</span>
                          <strong className="wp-time">{r?.t !== null && r?.t !== undefined ? shortTime(r.t) : ''}</strong>
                        </button>
                        {k < wps.length - 1 && (
                          <button className="wp-seg" onClick={() => act.selectSeg(k, (w.lat + wps[k + 1].lat) / 2, (w.lon + wps[k + 1].lon) / 2)}>
                            {(() => {
                              const Icon = segs[k]?.status === 'ok' && (segs[k] as { offroad?: boolean }).offroad ? Ruler : MODE_ICON[wps[k + 1].mode]
                              return <Icon className="inline" />
                            })()}{' '}
                            {g && r && next ? (
                              <>
                                {km(next.d - r.d)} km <TrendingUp className="inline" /> {Math.round(g.dPlus)} m <TrendingDown className="inline" /> {Math.round(g.dMinus)} m
                              </>
                            ) : (
                              '…'
                            )}{' '}
                            · {segs[k]?.status === 'ok' && (segs[k] as { offroad?: boolean }).offroad ? 'Hors sentier (auto)' : modeLabel(wps[k + 1].mode)}
                          </button>
                        )}
                      </li>
                    )
                  })}
                  {loop && rows && (
                    <li>
                      <span className="wp-row static">
                        <span className="wp-dot wp-end"><FlagIcon /></span>
                        <span className="wp-name">Arrivée (départ)</span>
                        <span className="muted">{km(rows[rows.length - 1].d)} km</span>
                        <strong className="wp-time">{rows[rows.length - 1].t !== null ? shortTime(rows[rows.length - 1].t!) : ''}</strong>
                      </span>
                    </li>
                  )}
                </ol>
              </>
            )}

            {!race && (
              <label className="field">
                <span className="field-label">Enregistrer comme</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as RaceKind)}>
                  <option value="route">Parcours d'entraînement (bibliothèque)</option>
                  <option value="race">Course</option>
                </select>
              </label>
            )}
            <p className="muted small draw-help">
              Pour poser un point : appui maintenu un instant sur la carte (clic sur ordinateur) ; un toucher bref ne pose rien, pour
              déplacer la carte librement. Sur un chemin, le tracé le suit ; hors d'un chemin, il passe automatiquement en ligne droite.
              Touche un point ou un tronçon pour le supprimer, y ajouter un point ou forcer son mode ; glisse un point pour le déplacer.
              Itinéraires : routeur public BRouter (OpenStreetMap).
              {race && ' Les points de passage au-delà de la nouvelle arrivée sont retirés ; la technicité OSM est à recharger.'}
            </p>
          </div>
        </div>

        {menu && (
          <div className="draw-menu" role="menu">
            <span className="field-label">Nouveaux points (Sentiers : hors-route automatique)</span>
            <ModeSeg value={mode} onChange={pickMode} />
            <button onClick={() => { setMenu(false); change(closeLoop(wps, mode)) }} disabled={wps.length < 2 || loop}><Repeat2 /> Boucler vers le départ</button>
            <button onClick={() => { setMenu(false); reversedSegments(); change(outAndBack(wps)) }} disabled={wps.length < 2}><ArrowLeftRight /> Aller-retour</button>
            <button onClick={() => { setMenu(false); reversedSegments(); change(reverseRoute(wps)) }} disabled={wps.length < 2}><ArrowDownUp /> Inverser le sens</button>
            <label className="button">
              <FileUp /> Importer un GPX ou un FIT
              <input type="file" accept=".gpx,.fit,application/gpx+xml" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            <button onClick={exportGpx} disabled={!ready}><FileDown /> Exporter en GPX</button>
            <button className="danger-btn" onClick={clearAll} disabled={!wps.length}><Eraser /> Tout effacer</button>
          </div>
        )}
        <div className="draw-toolbar">
          <button
            className={`tb${menu ? ' on' : ''}${mode !== 'trail' ? ' flagged' : ''}`}
            onClick={() => setMenu(!menu)}
            title={mode === 'trail' ? 'Options' : `Options (nouveaux points : ${modeLabel(mode)})`}
            aria-label="Options"
          >
            <Settings />
          </button>
          <span className="tb-group">
            <button className="tb" onClick={act.undo} disabled={!history.current.length} title="Annuler (Ctrl+Z)" aria-label="Annuler"><Undo2 /></button>
            <button className="tb" onClick={act.redo} disabled={!future.current.length} title="Rétablir (Ctrl+Y)" aria-label="Rétablir"><Redo2 /></button>
          </span>
          <button className="tb" onClick={trash} disabled={!wps.length} title={sel?.kind === 'wp' ? 'Supprimer le point' : 'Tout effacer'} aria-label="Supprimer"><Trash2 /></button>
          <button className="tb-ok" onClick={save} disabled={!ready}><Check /> {race ? 'OK' : 'Enregistrer'}</button>
        </div>
      </aside>
    </div>
  )
}

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
