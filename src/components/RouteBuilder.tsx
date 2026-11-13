import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ArrowDownUp,
  ArrowLeftRight,
  Bookmark,
  BookmarkX,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  FileDown,
  FileUp,
  Footprints,
  LocateFixed,
  MapPin,
  Maximize2,
  Minus,
  Mountain,
  Plus,
  RefreshCw,
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
  WandSparkles,
  Waves,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { newRace } from '../lib/defaults'
import { download } from '../lib/exportGpx'
import { elevationGain, gpxRawPoints, haversine, indexAt, trackFromRaw, type RawPoint } from '../lib/gpx'
import { averageIntensity, simulate } from '../lib/model'
import { distanceForDuration, loopPoints, loopScore, rankBearings, TERRAINS, type Terrain } from '../lib/autoroute'
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
import { addLayers, ROUTE_COLOR, routeCasing } from './mapLayers'
import { Num } from './ui'

export interface DrawResult {
  name: string
  kind: RaceKind
  gpxText: string
  drawn: DrawnRoute
  /** Longueur de la trace (m). */
  total: number
  /** Zones d'allure à enregistrer avec le parcours, ou null pour garder celles de la course. */
  zones: PaceZone[] | null
  /** Points de repère : deviennent des points de passage de la course. */
  marks: { name: string; dist: number }[]
}

/** Allure simulée : modèle de course, zones déjà placées sur le parcours, ou une zone du profil (indice). */
type Pace = 'model' | 'route' | number

interface Props {
  athlete: Athlete
  /** Course ou parcours dont on modifie le tracé, ou null pour un nouveau tracé. */
  race: Race | null
  onSave: (r: DrawResult) => void
}

/** Segment calculé ; `offroad` : point hors du réseau de chemins, tracé en ligne droite. */
type Seg = { status: 'ok'; points: RawPoint[]; offroad?: boolean } | { status: 'loading' } | { status: 'error'; message: string }

/** Proposition de la création automatique : boucle routée et ses chiffres. */
interface Cand {
  wps: Waypoint[]
  legs: { points: RawPoint[]; offroad: boolean }[]
  dist: number
  dPlus: number
  density: number
  time: number
  score: number
}
/** Accrochage des points proposés au chemin le plus proche (m) : plus large qu'au doigt. */
const AUTO_SNAP = 400
const TERRAIN_ICON: Record<Terrain, LucideIcon> = { flat: Minus, hilly: Waves, mountain: Mountain }

/** Hauteurs de la feuille du bas (téléphone) : chiffres seuls, avec la barre d'édition, ou dépliée. */
type SheetState = 'mini' | 'peek' | 'full'
const SHEET_ORDER: SheetState[] = ['mini', 'peek', 'full']

/** Sélection : un point de passage, ou un tronçon (avec l'endroit touché, pour y insérer un point). */
type Sel = { kind: 'wp'; k: number } | { kind: 'seg'; k: number; lat: number; lon: number } | null

const DRAFT_KEY = 'tp-draw-draft'
const VIEW_KEY = 'tp-draw-view'
const MODE_KEY = 'tp-draw-mode'
const ACCENT = ROUTE_COLOR
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
      wps = drawn.waypoints.map(({ lat, lon, mode, mark, name }) => ({ lat, lon, mode, ...(mark ? { mark } : {}), ...(name ? { name } : {}) }))
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

function wpIcon(k: number, n: number, selected: boolean, letter: string | null): L.DivIcon {
  const role = k === 0 ? 'start' : k === n - 1 ? 'end' : letter ? 'mark' : 'mid'
  const size = role === 'mid' ? 16 : 26
  const html = role === 'start' ? PIN_SVG : role === 'end' ? FLAG_SVG : role === 'mark' ? letter! : ''
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
export default function RouteBuilder({ athlete, race, onSave }: Props) {
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
  // Points listés : départ, repères, arrivée.
  const listed = useMemo(() => wps.map((_, k) => k).filter((k) => k === 0 || k === wps.length - 1 || wps[k].mark), [wps])
  // Points de repère (lettres A, B… dans l'ordre du parcours) ; les autres points ne servent qu'à former le tracé.
  const letters = useMemo(() => {
    const out = new Map<number, string>()
    let n = 0
    wps.forEach((w, k) => {
      if (w.mark && k > 0 && k < wps.length - 1) out.set(k, String.fromCharCode(65 + (n++ % 26)))
    })
    return out
  }, [wps])

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
  // Ordinateur : la barre de menu de l'appli reste visible au-dessus du traceur.
  const [topOffset, setTopOffset] = useState(0)
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>('.topbar')
    if (mobile || !bar) {
      setTopOffset(0)
      return
    }
    const update = () => setTopOffset(Math.max(0, Math.round(bar.getBoundingClientRect().bottom)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [mobile])
  useEffect(() => {
    map.current?.invalidateSize()
  }, [mobile, topOffset])

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
    // Clic (souris) : ferme d'abord ce qui est ouvert, sinon ajoute un point (ou place le départ
    // de la boucle automatique).
    tap: (lat: number, lon: number) => {
      if (act.dismiss()) return
      if (autoOpen) act.placeStart(lat, lon)
      else act.add(lat, lon)
    },
    // Appui maintenu (téléphone) : ajoute toujours un point (ou place le départ de la boucle).
    holdAdd: (lat: number, lon: number) => {
      setMenu(false)
      setPlaces(null)
      if (autoOpen) act.placeStart(lat, lon)
      else act.add(lat, lon)
    },
    /** Départ de la boucle automatique ; la boucle proposée, partie d'ailleurs, est retirée. */
    placeStart: (lat: number, lon: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
      autoToken.current++
      setAutoStart({ lat, lon })
      if (auto?.cands.length) change([])
      setAuto(null)
      setAutoEdit(true)
    },
    // En boucle, le départ et l'arrivée bougent ensemble.
    move: (k: number, lat: number, lon: number) =>
      change(wps.map((w, j) => (j === k || (loop && k === 0 && j === wps.length - 1) ? { ...w, lat, lon } : w))),
    // Sur le départ d'une boucle : ouvre la boucle.
    remove: (k: number) => change(loop && k === 0 ? wps.slice(0, -1) : wps.filter((_, j) => j !== k)),
    insert: (k: number, lat: number, lon: number, mark = false) => {
      const s = segs[k]
      const b = wps[k + 1]
      const flag = mark ? { mark: true } : {}
      if (s?.status !== 'ok' || s.points.length < 3) {
        change([...wps.slice(0, k + 1), { lat, lon, mode: b.mode, ...flag }, ...wps.slice(k + 1)])
        return
      }
      // Le nouveau point est posé sur le tracé : les deux moitiés gardent leur géométrie.
      const i = Math.min(s.points.length - 2, Math.max(1, nearestIndex(s.points, lat, lon)))
      const p = { lat: s.points[i].lat, lon: s.points[i].lon, mode: b.mode, ...flag }
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
    /** Point de repère ou simple point de tracé. */
    toggleMark: (k: number) => change(wps.map((w, j) => (j === k ? (w.mark ? { lat: w.lat, lon: w.lon, mode: w.mode } : { ...w, mark: true }) : w))),
    /** Nom d'un point listé (sans historique : la saisie se fait lettre par lettre). */
    rename: (k: number, nm: string) =>
      setWps(wps.map((w, j) => (j === k ? (nm ? { ...w, name: nm } : { lat: w.lat, lon: w.lon, mode: w.mode, ...(w.mark ? { mark: true } : {}) }) : w))),
    /** Toucher le profil : sélectionne le tronçon à cette distance (pour y poser un repère). */
    pickDist: (d: number) => {
      if (!rows || !track) return
      let k = 0
      while (k < rows.length - 2 && rows[k + 1].d <= d) k++
      const p = track.points[indexAt(track.points, d)]
      setMenu(false)
      setSel({ kind: 'seg', k, lat: p.lat, lon: p.lon })
      map.current?.panTo([p.lat, p.lon])
      if (mobile && sheet === 'full') setSheet('peek')
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
      const weight = s.status === 'ok' ? (picked ? 7 : 5) : 3
      // Liseré blanc dessous : le tracé ressort sur les forêts, le relief et les photos aériennes.
      routeCasing(latlngs, weight).addTo(g)
      L.polyline(latlngs, {
        color: s.status === 'error' ? '#c0392b' : s.status === 'loading' ? '#8a8f88' : picked ? SELECTED : ACCENT,
        weight,
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
        // En boucle, l'arrivée est le départ (épingle) : aucun drapeau sur le dernier point posé.
        icon: wpIcon(k, n, picked, letters.get(k) ?? null),
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
  }, [segs, wps, loop, sel, letters])

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
      drawn: {
        waypoints: wps.map((w, k) => ({ lat: w.lat, lon: w.lon, mode: w.mode, i: joined.starts[k], ...(w.mark ? { mark: true } : {}), ...(w.name ? { name: w.name } : {}) })),
      },
      marks: rows ? [...letters].map(([k, letter]) => ({ name: wps[k].name || `Repère ${letter}`, dist: Math.round(rows[k].d) })) : [],
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
  // --- Création automatique d'une boucle ------------------------------------------------
  const [autoOpen, setAutoOpen] = useState(false)
  const [autoCfg, setAutoCfg] = useState<{ terrain: Terrain; by: 'dist' | 'time'; km: number; minutes: number }>(
    () => readJson('tp-draw-auto') ?? { terrain: 'hilly', by: 'dist', km: 15, minutes: 90 },
  )
  // `blind` : relief des directions inconnu (service d'altitude saturé), boucles départagées après coup.
  const [auto, setAuto] = useState<{ busy: boolean; error: string | null; cands: Cand[]; i: number; offset: number; blind?: boolean } | null>(null)
  // Une fois les propositions calculées, la fiche se réduit à la ligne de résultat (la boucle reste visible).
  const [autoEdit, setAutoEdit] = useState(true)
  // Départ choisi sur la carte (sinon : début du tracé, ou centre de la carte).
  const [autoStart, setAutoStart] = useState<{ lat: number; lon: number } | null>(null)
  const autoToken = useRef(0)
  const setCfg = (patch: Partial<typeof autoCfg>) => {
    const next = { ...autoCfg, ...patch }
    setAutoCfg(next)
    writeJson('tp-draw-auto', next)
  }
  /** Durée simulée d'une trace à l'allure choisie (sans nuit, chaleur ni pluie). */
  const simTime = (tr: Track): number => {
    const zone = typeof pace === 'number' && athlete.zones[pace] ? wholeRoute(zoneTarget(athlete, pace), tr.totalDist) : []
    const r = { ...newRace(name, ''), zones: zone }
    r.env = { ...r.env, night: { ...r.env.night, enabled: false }, heat: { ...r.env.heat, enabled: false }, rain: { ...r.env.rain, enabled: false } }
    return simulate(tr, athlete, planOptions(r, tr)).totalTime
  }
  /** Boucle départ → points → départ, sur les chemins, points accrochés au chemin le plus proche. */
  const routeLoop = async (start: { lat: number; lon: number }, points: { lat: number; lon: number }[], target: number): Promise<Cand> => {
    const ring = [start, ...points, start]
    const legs = await Promise.all(ring.slice(1).map((b, k) => limited(() => routeLeg(ring[k], b, 'trail', AUTO_SNAP))))
    const at = (k: number) => (k === 0 ? legs[0].points[0] : legs[k - 1].points[legs[k - 1].points.length - 1])
    const loopWps: Waypoint[] = ring.map((_, k) => ({ lat: at(k).lat, lon: at(k).lon, mode: 'trail' as SegMode }))
    loopWps[loopWps.length - 1] = { ...loopWps[0] }
    const tr = trackFromRaw(joinSegments(legs.map((l) => l.points)).points, 'auto')
    const time = simTime(tr)
    const density = tr.dPlus / Math.max(0.1, tr.totalDist / 1000)
    const error = autoCfg.by === 'dist' ? tr.totalDist / target - 1 : time / target - 1
    const offroad = legs.filter((l) => l.offroad).length
    return { wps: loopWps, legs, dist: tr.totalDist, dPlus: tr.dPlus, density, time, score: loopScore({ error, density, offroad, terrain: autoCfg.terrain }) }
  }
  const applyCand = (c: Cand) => {
    c.legs.forEach((l, k) => cache.current.set(segmentKey(c.wps[k], c.wps[k + 1], 'trail'), { status: 'ok', points: l.points, offroad: l.offroad }))
    change(c.wps)
    if (!name.trim() || /^Boucle /.test(name)) setName(`Boucle ${TERRAINS[autoCfg.terrain].label.toLowerCase()} ${(c.dist / 1000).toFixed(1).replace('.', ',')} km`)
    map.current?.fitBounds(L.latLngBounds(c.legs.flatMap((l) => l.points.map((p) => [p.lat, p.lon] as [number, number]))), {
      paddingTopLeft: [30, 80],
      paddingBottomRight: [30, (mobile ? 70 : 0) + 150],
    })
  }
  const generate = async (offset = 0) => {
    const token = ++autoToken.current
    const c = map.current?.getCenter()
    const start = autoStart ?? (wps[0] ? { lat: wps[0].lat, lon: wps[0].lon } : c ? { lat: c.lat, lon: c.lng } : { lat: DEFAULT_CENTER[0], lon: DEFAULT_CENTER[1] })
    setAuto({ busy: true, error: null, cands: [], i: 0, offset })
    try {
      const seconds = autoCfg.minutes * 60
      const intensity =
        typeof pace === 'number' && athlete.zones[pace]
          ? (athlete.zones[pace].low + athlete.zones[pace].high) / 2
          : averageIntensity(seconds / 3600, athlete.durability)
      const dist = autoCfg.by === 'dist' ? autoCfg.km * 1000 : distanceForDuration(seconds, athlete.cs, intensity, autoCfg.terrain)
      const target = autoCfg.by === 'dist' ? dist : seconds
      const plans = (await rankBearings(start, dist, autoCfg.terrain, offset)).slice(0, 3)
      const blind = plans.some((p) => Number.isNaN(p.density))
      const cands: Cand[] = []
      for (const plan of plans) {
        let cand = await routeLoop(start, plan.points, target)
        // Trop long ou trop court : on ajuste la taille de la boucle (deux fois au plus).
        let size = dist
        for (let tries = 0; tries < 2; tries++) {
          const ratio = autoCfg.by === 'dist' ? cand.dist / target : cand.time / target
          if (Math.abs(ratio - 1) <= 0.1) break
          size /= ratio
          const again = await routeLoop(start, loopPoints(start, size, plan.bearing), target)
          if (again.score < cand.score) cand = again
          else break
        }
        if (token !== autoToken.current) return
        cands.push(cand)
      }
      cands.sort((a, b) => a.score - b.score)
      setAuto({ busy: false, error: null, cands, i: 0, offset, blind })
      setAutoEdit(false)
      if (mobile) setSheet('mini')
      applyCand(cands[0])
    } catch (e) {
      if (token === autoToken.current) setAuto({ busy: false, error: (e as Error).message, cands: [], i: 0, offset })
    }
  }
  const showCand = (i: number) => {
    if (!auto?.cands.length) return
    const n = auto.cands.length
    const j = (i + n) % n
    setAuto({ ...auto, i: j })
    applyCand(auto.cands[j])
  }
  const openAuto = () => {
    setMenu(false)
    setSel(null)
    setAutoOpen(true)
    setAutoEdit(true)
    setAutoStart(null)
  }
  const closeAuto = () => {
    autoToken.current++
    setAutoOpen(false)
    setAuto(null)
    setAutoStart(null)
  }
  /** Départ de la boucle à ma position. */
  const startHere = () => {
    if (!navigator.geolocation) return setNotice('Position indisponible sur cet appareil.')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        act.placeStart(p.coords.latitude, p.coords.longitude)
        map.current?.setView([p.coords.latitude, p.coords.longitude], Math.max(14, map.current.getZoom()))
      },
      () => setNotice('Position refusée ou indisponible.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }
  // Repère du départ choisi, déplaçable, tant qu'aucune boucle n'est proposée.
  const startMark = useRef<L.Marker | null>(null)
  useEffect(() => {
    startMark.current?.remove()
    startMark.current = null
    const m = map.current
    if (!m || !autoOpen || !autoStart || auto?.cands.length) return
    const mk = L.marker([autoStart.lat, autoStart.lon], { icon: wpIcon(0, 2, false, null), draggable: true, zIndexOffset: 1000, title: 'Départ de la boucle' })
    mk.on('dragend', () => {
      const ll = mk.getLatLng()
      setAutoStart({ lat: ll.lat, lon: ll.lng })
    })
    startMark.current = mk.addTo(m)
  }, [autoOpen, autoStart, auto?.cands.length])

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
  const wpName = (k: number) =>
    wps[k]?.name ||
    (k === 0 ? (loop ? 'Départ et arrivée' : 'Départ') : k === wps.length - 1 ? 'Arrivée' : letters.has(k) ? `Repère ${letters.get(k)}` : 'Point du tracé')

  return (
    <div className="draw-shell" style={{ ['--sheet-h' as string]: `${mobile ? sheetH : 0}px`, top: topOffset }}>
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
              <div className="draw-tip-wrap">
                <div className="draw-tip">
                  {autoOpen
                    ? `${coarse ? 'Appuie un instant sur la carte' : 'Clique sur la carte'} pour placer le départ de la boucle`
                    : `${coarse ? 'Appuie un instant sur la carte pour poser le départ' : 'Clique sur la carte pour poser le départ'} · hors d'un chemin, le tracé passe en ligne droite`}
                </div>
                {!autoOpen && (
                  <button className="primary auto-cta" onClick={openAuto}><WandSparkles /> Créer une boucle automatiquement</button>
                )}
              </div>
            )}
          </div>
        )}

        {!(mobile && sheet === 'full') && (
        <div className="draw-fabs" style={{ bottom: floatBottom + 26 }}>
          <button className="fab" onClick={locate} title="Ma position" aria-label="Ma position"><LocateFixed /></button>
          <button className="fab" onClick={fit} disabled={wps.length < 2} title="Voir tout le tracé" aria-label="Voir tout le tracé"><Maximize2 /></button>
        </div>
        )}

        {autoOpen ? (
          <div className="draw-card auto-card" style={{ bottom: floatBottom + 26 }}>
            <div className="draw-card-head">
              <strong><WandSparkles className="inline" /> Création automatique</strong>
              <span className="muted">Boucle depuis {autoStart ? 'le départ placé' : wps.length ? 'le début du tracé' : 'le centre de la carte'}</span>
              <button className="ghost" onClick={closeAuto} aria-label="Fermer"><X /></button>
            </div>
            {(autoEdit || !auto?.cands.length) && (
            <>
            <div className="auto-start">
              <MapPin aria-hidden />
              <span>
                {autoStart
                  ? `Départ placé : ${coarse ? 'appuie ailleurs' : 'clique ailleurs'} ou fais-le glisser pour le déplacer`
                  : `${coarse ? 'Appuie un instant' : 'Clique'} sur la carte pour placer le départ`}
              </span>
              <button className="ghost" onClick={startHere} title="Partir de ma position"><LocateFixed /> Ma position</button>
            </div>
            <div className="seg mode-seg" role="group" aria-label="Terrain">
              {(Object.keys(TERRAINS) as Terrain[]).map((t) => {
                const Icon = TERRAIN_ICON[t]
                return (
                  <button key={t} className={autoCfg.terrain === t ? 'on' : ''} onClick={() => setCfg({ terrain: t })} title={`${TERRAINS[t].min}–${TERRAINS[t].max} m de D+ par km`}>
                    <Icon aria-hidden /> {TERRAINS[t].label}
                  </button>
                )
              })}
            </div>
            <div className="auto-target">
              <span className="seg">
                <button className={autoCfg.by === 'dist' ? 'on' : ''} onClick={() => setCfg({ by: 'dist' })}>Distance</button>
                <button className={autoCfg.by === 'time' ? 'on' : ''} onClick={() => setCfg({ by: 'time' })}>Durée</button>
              </span>
              {autoCfg.by === 'dist' ? (
                <Num value={autoCfg.km} unit="km" width={70} min={1} max={200} onChange={(v) => setCfg({ km: v })} />
              ) : (
                <Num value={autoCfg.minutes} unit={`min (${formatDuration(autoCfg.minutes * 60)})`} width={70} min={10} max={1440} onChange={(v) => setCfg({ minutes: v })} />
              )}
              <button className="primary" onClick={() => generate(auto?.offset ?? 0)} disabled={auto?.busy}>
                <WandSparkles /> {auto?.busy ? 'Calcul…' : 'Générer'}
              </button>
            </div>
            </>
            )}
            {auto?.busy && <span className="muted small">Trois boucles calculées sur les chemins, la meilleure est affichée…</span>}
            {auto?.error && <span className="warn-text">{auto.error}</span>}
            {auto?.blind && !auto.busy && auto.cands.length > 0 && (
              <span className="muted small">Service d'altitude saturé : directions choisies sans repérer le relief, boucles classées d'après le relief du routeur.</span>
            )}
            {auto && !auto.busy && auto.cands.length > 0 && (
              <div className="auto-result">
                <button className="ghost" onClick={() => showCand(auto.i - 1)} aria-label="Proposition précédente"><ChevronLeft /></button>
                <span>
                  <strong>{auto.i + 1}/{auto.cands.length}</strong> · {km(auto.cands[auto.i].dist)} km · <TrendingUp className="inline" /> {Math.round(auto.cands[auto.i].dPlus)} m
                  <span className="muted"> ({Math.round(auto.cands[auto.i].density)} m/km)</span> · {shortTime(auto.cands[auto.i].time)}
                </span>
                <button className="ghost" onClick={() => showCand(auto.i + 1)} aria-label="Proposition suivante"><ChevronRight /></button>
                <span className="spacer" />
                {!autoEdit && (
                  <button className="ghost" onClick={() => setAutoEdit(true)} title="Changer le terrain, la distance ou la durée" aria-label="Réglages"><Settings /></button>
                )}
                <button className="ghost" onClick={() => generate((auto.offset + 22.5) % 360)} title="Trois autres boucles, dans d'autres directions" aria-label="Autres propositions"><RefreshCw /></button>
                <button className="primary" onClick={closeAuto}><Check /> Garder</button>
              </div>
            )}
          </div>
        ) : sel ? (
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
                  {sel.k > 0 && sel.k < wps.length - 1 && (
                    <button onClick={() => act.toggleMark(sel.k)}>
                      {wps[sel.k].mark ? <><BookmarkX /> Retirer le repère</> : <><Bookmark /> Point de repère</>}
                    </button>
                  )}
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
                <div className="row tight">
                  <button className="primary" onClick={() => act.insert(sel.k, sel.lat, sel.lon, true)}><Bookmark /> Point de repère ici</button>
                  <button onClick={() => act.insert(sel.k, sel.lat, sel.lon)}><Plus /> Point de tracé</button>
                </div>
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

          {track && (
            <div className="draw-profile">
              <MiniProfile
                track={track}
                onHover={setHover}
                onPick={act.pickDist}
                marks={rows ? [...letters].map(([k, letter]) => ({ d: rows[k].d, label: letter })) : []}
              />
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
            {wps.length > 0 && (
              <>
                <h3 className="draw-h">Points de repère</h3>
                <ol className="wp-list">
                  {listed.map((k, j) => {
                    const w = wps[k]
                    const r = rows?.[k]
                    const nk = listed[j + 1]
                    const next = nk !== undefined ? rows?.[nk] : undefined
                    const g = r && next && track ? elevationGain(track.points, r.d, next.d) : null
                    const role = k === 0 ? 'start' : k === wps.length - 1 && !loop ? 'end' : 'mark'
                    const loopEnd = loop && k === wps.length - 1
                    return (
                      <li key={k}>
                        <div className={`wp-row${sel?.kind === 'wp' && sel.k === k ? ' on' : ''}`}>
                          <button
                            className={`wp-dot wp-${loopEnd ? 'end' : role}`}
                            onClick={() => {
                              if (loopEnd) return
                              act.selectWp(k)
                              map.current?.panTo([w.lat, w.lon])
                              if (mobile) setSheet('peek')
                            }}
                            aria-label="Voir sur la carte"
                          >
                            {role === 'start' && !loopEnd ? <MapPinIcon /> : role === 'end' || loopEnd ? <FlagIcon /> : letters.get(k)}
                          </button>
                          <input
                            className="wp-name"
                            value={loopEnd ? 'Arrivée (départ)' : (w.name ?? '')}
                            placeholder={wpName(k)}
                            readOnly={loopEnd}
                            onChange={(e) => act.rename(k, e.target.value)}
                            aria-label="Nom du point"
                          />
                          <span className="muted">{r ? `${km(r.d)} km · ${Math.round(r.ele)} m` : '…'}</span>
                          <strong className="wp-time">{r?.t !== null && r?.t !== undefined ? shortTime(r.t) : ''}</strong>
                        </div>
                        {nk !== undefined && (
                          <div className="wp-seg">
                            {g && r && next ? (
                              <>
                                {km(next.d - r.d)} km <TrendingUp className="inline" /> {Math.round(g.dPlus)} m <TrendingDown className="inline" /> {Math.round(g.dMinus)} m
                              </>
                            ) : (
                              '…'
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
                <p className="muted small">Touche le tracé ou le profil pour ajouter un point de repère ; il devient un point de passage de la course.</p>
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
              Touche un point ou un tronçon pour le supprimer, en faire un point de repère, ajouter un point ou forcer son mode ; glisse un
              point pour le déplacer. Seuls le départ, les points de repère et l'arrivée figurent dans la liste.
              Itinéraires : routeur public BRouter (OpenStreetMap).
              {race && ' Les points de passage au-delà de la nouvelle arrivée sont retirés ; la technicité OSM est à recharger.'}
            </p>
          </div>
        </div>

        {menu && (
          <div className="draw-menu" role="menu">
            <button onClick={openAuto}><WandSparkles /> Créer une boucle automatiquement</button>
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

function MiniProfile({
  track,
  onHover,
  onPick,
  marks = [],
}: {
  track: Track
  onHover: (d: number | null) => void
  /** Toucher bref (sans glisser) : distance touchée (m). */
  onPick?: (d: number) => void
  /** Points de repère à marquer sur le profil. */
  marks?: { d: number; label: string }[]
}) {
  const [x, setX] = useState<number | null>(null)
  const down = useRef<number | null>(null)
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
        onPointerDown={(e) => {
          down.current = e.clientX
          move(e)
        }}
        onPointerUp={(e) => {
          if (down.current !== null && Math.abs(e.clientX - down.current) < 8 && onPick) {
            const r = e.currentTarget.getBoundingClientRect()
            onPick(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * track.totalDist)
          }
          down.current = null
        }}
        onPointerLeave={() => {
          setX(null)
          onHover(null)
        }}
        role="img"
        aria-label="Profil d'altitude du tracé"
      >
        <path d={path} fill="rgba(224,0,122,0.12)" stroke={ACCENT} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {marks.map((m) => (
          <line key={m.label} x1={px(m.d)} x2={px(m.d)} y1={0} y2={H} stroke={ACCENT} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        ))}
        {x !== null && <line x1={x} x2={x} y1={0} y2={H} stroke="#1f2420" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {marks.length > 0 && (
        <div className="mini-profile-marks" aria-hidden>
          {marks.map((m) => (
            <span key={m.label} style={{ left: `${(m.d / track.totalDist) * 100}%` }}>{m.label}</span>
          ))}
        </div>
      )}
      <div className="mini-profile-head muted">
        <span>{Math.round(lo)} m</span>
        <span>{(track.totalDist / 1000).toFixed(1)} km</span>
      </div>
    </div>
  )
}
