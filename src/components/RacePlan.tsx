import { ArrowLeftToLine, ArrowRightToLine, Check, CloudSun, Copy, Droplets, FileDown, Flag, Gauge, Map as MapIcon, MapPin, Moon, Pencil, Plus, Printer, Scissors, Trash2, Users, Watch } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { buildCourseGpx, download } from '../lib/exportGpx'
import { buildCourseFit } from '../lib/fit'
import { bagText, brandsOf, dropbagPlan, dropbagText, flaskText, flaskWarning, isAtRavito, legSupply, nutritionPlan, PRODUCT_TYPES, productType, raceProducts, ravitoText, shortOf } from '../lib/nutrition'
import { applyRange, mergeInto, moveBoundary, partition, setTarget, splitAt, zone1Target, zoneColor, zoneShort, zoneText } from '../lib/zones'
import { fetchOsmTech, osmSummary } from '../lib/osm'
import { fetchRaceWeather, fetchWeatherSeries } from '../lib/weather'
import { indexAt, parseGpx } from '../lib/gpx'
import { assistAllowed, FINISH_ID } from '../lib/assist'
import { isDefaultLevel } from '../lib/level'
import { athleteKme } from '../lib/endurancepro'
import { isFreeStart, planOptions } from '../lib/plan'
import { bagFactor, calibrateDurability, scenarioInputs, SCENARIOS, simulate, type SimOptions } from '../lib/model'
import { CHECKPOINT_LABELS, commonStop, defaultStop, isRavitoKind, setStops, waypointCheckpoints, withKind } from '../lib/splits'
import { formatClock, formatDuration, formatPace, parseDuration, utcToZonedInput, zonedToUtc } from '../lib/time'
import type { Athlete, CalcMode, Checkpoint, CheckpointKind, ProductType, Race, SimPoint, SimResult, Track } from '../lib/types'
import { AssistControls } from './AssistControls'
import { PrintSheets, type PrintFormat } from './PrintSheets'
import { ProfileChart } from './ProfileChart'
import { CourseProfile } from './CourseProfile'
import { LIBRARY_BRANDS, libraryProduct, PRODUCT_LIBRARY, RAVITO_BRAND } from '../lib/productLibrary'
import { ZonePicker, ZonesCard } from './Zones'
import { Card, Hint, Kpi, Num, Toggle } from './ui'

/** Vrai si la requête média correspond (mise à jour au redimensionnement). */
function useMediaQuery(q: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia?.(q).matches ?? false)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [q])
  return match
}

// Carte chargée à la demande (Leaflet ne pèse pas sur le premier affichage).
const MapView = lazy(() => import('./MapView'))

const MODE_LABELS: Record<CalcMode, string> = {
  physio: 'VC + vitesse asc.',
  gap: 'Vitesse plat équivalente',
  kme: 'Km-effort',
}

const KIND_LABELS = CHECKPOINT_LABELS

const TIME_ZONES = ['Europe/Paris', 'Europe/Zurich', 'Europe/Rome', 'Europe/Madrid', 'Europe/London', 'Atlantic/Canary', 'Indian/Reunion', 'America/Martinique', 'America/New_York', 'America/Denver', 'America/Los_Angeles', 'Asia/Kathmandu', 'Asia/Hong_Kong']

/** Instant présent arrondi à la minute supérieure, mis à jour tant que `on` est vrai. */
function useMinuteClock(on: boolean): number {
  const next = () => Math.ceil(Date.now() / 60000) * 60000
  const [t, setT] = useState(next)
  useEffect(() => {
    if (!on) return
    setT(next())
    const id = setInterval(() => setT(next()), 15000)
    return () => clearInterval(id)
  }, [on])
  return t
}

export function useRaceComputation(race: Race, athlete: Athlete, watchStart: number | null = null) {
  // Départ libre : départ maintenant (mis à jour chaque minute) tant que l'activité n'a pas démarré,
  // puis le vrai départ (mode course, sinon montre), fixe jusqu'à la fin ; sinon l'heure saisie.
  // Un parcours n'a pas d'heure de départ : toujours en départ libre.
  const free = isFreeStart(race)
  const started = race.live ? Date.parse(race.live.startedAt) : watchStart
  const now = useMinuteClock(free && started === null)
  const start = free ? utcToZonedInput(started ?? now, race.env.timeZone) : race.env.start
  const effective = useMemo(() => (start === race.env.start ? race : { ...race, env: { ...race.env, start } }), [race, start])
  const track = useMemo<Track | null>(() => {
    try {
      return parseGpx(race.gpxText, race.smoothing)
    } catch {
      return null
    }
  }, [race.gpxText, race.smoothing])

  const opts = useMemo<SimOptions | null>(() => (track ? planOptions(effective, track, athlete) : null), [track, effective, athlete])

  const sim = useMemo<SimResult | null>(() => (track && opts ? simulate(track, athlete, opts) : null), [track, opts, athlete])
  return { track, opts, sim, start, free, started: free ? started : null }
}

export function RacePlan({
  race,
  athlete,
  onChange,
  onAthleteChange,
  onRedraw,
  share,
  watch,
  watchStart = null,
}: {
  race: Race
  athlete: Athlete
  onChange: (r: Race) => void
  onAthleteChange: (a: Athlete) => void
  /** Éditeur (traceur) : tracé et points de course. */
  onRedraw?: () => void
  share?: { available: boolean; url: string | null; create: () => Promise<void>; remove: () => Promise<void> }
  watch?: { available: boolean; active: boolean; activate: () => void }
  /** Départ libre : départ réel donné par la montre (ms), si l'activité est en cours. */
  watchStart?: number | null
}) {
  // Parcours : panneau « Vers une course » (cible, nom) puis résultat.
  const isRoute = race.kind === 'route'
  // Types proposés au changement de type (temps de passage).
  const kindOptions = (current: CheckpointKind) =>
    (Object.entries(KIND_LABELS) as [CheckpointKind, string][]).filter(([k]) => k !== 'info' || k === current)
  /**
   * Changement de type : renommage (voir withKind) ; passage en base de vie : arrêt de 20 min et
   * dropbag prévus d'office s'ils n'étaient pas réglés ; retour d'une base de vie : arrêt par défaut.
   */
  const kindPatch = (cp: Checkpoint, kind: CheckpointKind): Partial<Checkpoint> => ({
    ...withKind(cp, kind),
    ...(kind === 'base' && cp.kind !== 'base'
      ? { ...(cp.stopMin <= defaultStop(cp.kind) ? { stopMin: defaultStop('base') } : {}), ...(cp.dropbag === undefined ? { dropbag: true } : {}) }
      : {}),
    ...(cp.kind === 'base' && kind !== 'base' && cp.stopMin === defaultStop('base') ? { stopMin: defaultStop(kind) } : {}),
  })
  const [copied, setCopied] = useState(false)
  const [showWatch, setShowWatch] = useState(false)
  const [hoverDist, setHoverDist] = useState<number | null>(null)
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null)
  const [segment, setSegment] = useState<number | null>(null)
  // Le tableau complet demande ≈ 1 230 px (≈ 1 330 px pour une course, avec l'assistance) ; en dessous, vue en cartes.
  const narrow = useMediaQuery(race.kind === 'route' ? '(max-width: 1229px)' : '(max-width: 1399px)')
  const [editing, setEditing] = useState<string | null>(null)
  // Temps d'arrêt à appliquer à tous les ravitos (par défaut : le plus fréquent).
  const [bulkStop, setBulkStop] = useState<Record<string, number>>({})
  const [addingProduct, setAddingProduct] = useState(false)
  const [showMap, setShowMap] = useState(true)
  // Pose sur la carte de l'accès assistance d'un point (identifiant du point), ou null.
  const [pickAccess, setPickAccess] = useState<string | null>(null)
  /** Case « dropbag » d'un ravito ou d'une base de vie (dropbag prévu par l'organisation). */
  const dropbagOf = (cp: Checkpoint, labels = false) =>
    isRavitoKind(cp.kind) ? (
      <label className="assist-check" title="Dropbag prévu par l'organisation à ce point">
        <input type="checkbox" checked={!!cp.dropbag} onChange={(e) => setCp(cp.id, { dropbag: e.target.checked })} aria-label={`Dropbag à ${cp.name}`} />
        {labels && <span>Dropbag</span>}
      </label>
    ) : null
  /** Assistance d'un point (coche et accès), dans les temps de passage d'une course. */
  const assistOf = (cp: Checkpoint, labels = false) => {
    const finish = cp.id === FINISH_ID
    return (
      <AssistControls
        name={cp.name}
        allowed={assistAllowed(cp)}
        finish={finish}
        placed={!!(finish ? race.finishAccess : cp.access)}
        picking={pickAccess === cp.id}
        onAllow={(v) => setCp(cp.id, { assist: v })}
        onPick={(start) => startPick(start ? cp.id : null)}
        onClear={() => (finish ? set({ finishAccess: undefined }) : setCp(cp.id, { access: undefined }))}
        labels={labels}
      />
    )
  }
  const startPick = (id: string | null) => {
    setPickAccess(id)
    if (id) {
      setShowMap(true)
      setTimeout(() => document.getElementById('race-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
    }
  }
  useEffect(() => {
    if (!pickAccess) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPickAccess(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickAccess])
  const [osm, setOsm] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const { track, opts, sim, start, started, free } = useRaceComputation(race, athlete, watchStart)
  const [printFormat, setPrintFormat] = useState<PrintFormat | null>(null)
  const [compare, setCompare] = useState(false)
  const [weather, setWeather] = useState<{ busy: boolean; info: string | null; error: string | null }>({ busy: false, info: null, error: null })

  const set = (patch: Partial<Race>) => onChange({ ...race, ...patch })
  const setEnv = <K extends keyof Race['env']>(k: K, v: Race['env'][K]) => set({ env: { ...race.env, [k]: v } })
  const setCp = (id: string, patch: Partial<Checkpoint>) =>
    set({ checkpoints: race.checkpoints.map((c) => (c.id === id ? { ...c, ...patch, auto: patch.dist !== undefined || patch.name !== undefined || patch.kind !== undefined ? false : c.auto } : c)) })

  // Départ libre : départ maintenant ou vrai départ (voir useRaceComputation).
  // Départ libre lancé : instant exact du départ (le champ `start` est arrondi à la minute).
  const startMs = started ?? zonedToUtc(start, race.env.timeZone).getTime()

  // Scénarios : fenêtre de passage entre une bonne journée et une journée difficile.
  const scenarios = useMemo(() => {
    if (!track || !opts) return null
    const run = (k: 'good' | 'hard') => simulate(track, ...scenarioInputs(athlete, opts, k))
    return { good: run('good'), hard: run('hard') }
  }, [track, opts, athlete])
  const windowOf = (cpId: string) => {
    const g = scenarios?.good.splits.find((x) => x.cp.id === cpId)
    const h = scenarios?.hard.splits.find((x) => x.cp.id === cpId)
    return g && h ? { early: g.arrival, late: h.arrival } : null
  }

  const compareResults = useMemo(() => {
    if (!compare || !track || !opts) return null
    return (['physio', 'gap', 'kme'] as CalcMode[]).map((mode) => ({ mode, sim: simulate(track, athlete, { ...opts, mode }) }))
  }, [compare, track, opts, athlete])

  if (!track || !sim || !opts) {
    return <Card title={race.name} fold={false}><p className="warn">Impossible de lire le GPX de cette course.</p></Card>
  }

  // Waypoints du GPX pas encore repris en points de passage (importés d'office à l'import du GPX).
  const newWaypoints = waypointCheckpoints(track, race.kind, race.checkpoints)
  const importWaypoints = () => set({ checkpoints: [...race.checkpoints, ...newWaypoints].sort((a, b) => a.dist - b.dist) })

  const products = raceProducts(race, athlete.products)
  /**
   * Produit choisi pour la course (à la place de `replace`, ou en plus) : un des tiens, ou un article de la
   * bibliothèque, alors copié dans tes produits (onglet Nutrition).
   */
  const chooseProduct = (value: string, replace?: string) => {
    let id = value
    let all = athlete.products
    if (value.startsWith('lib:')) {
      const item = PRODUCT_LIBRARY.find((x) => x.id === value.slice(4))
      if (!item) return
      const np = libraryProduct(item)
      all = [...athlete.products, np]
      id = np.id
      onAthleteChange({ ...athlete, products: all })
    }
    const ids = products.map((x) => x.id)
    const next = replace ? ids.map((x) => (x === replace ? id : x)) : [...ids, id]
    set({ productIds: all.filter((x) => next.includes(x.id)).map((x) => x.id) })
  }
  /** Options du choix d'un produit : tes produits pas encore retenus, puis la bibliothèque par marque. */
  const productOptions = (current?: string) => {
    const ids = new Set(products.map((x) => x.id))
    const owned = new Set(athlete.products.map((x) => x.libraryId).filter(Boolean))
    return (
      <>
        {(Object.keys(PRODUCT_TYPES) as ProductType[]).map((t) => {
          const of = athlete.products.filter((x) => productType(x) === t && (x.id === current || !ids.has(x.id)))
          return of.length ? (
            <optgroup key={t} label={`Mes produits · ${PRODUCT_TYPES[t]}`}>
              {of.map((x) => <option key={x.id} value={x.id}>{x.name}{x.brand ? ` · ${x.brand}` : ''}{isAtRavito(x) ? ' · sur ravito' : ''}</option>)}
            </optgroup>
          ) : null
        })}
        {LIBRARY_BRANDS.map((b) => {
          const of = PRODUCT_LIBRARY.filter((it) => it.brand === b && !owned.has(it.id))
          return of.length ? (
            <optgroup key={b} label={`Bibliothèque · ${b}`}>
              {of.map((it) => <option key={it.id} value={`lib:${it.id}`}>{it.name}{it.brand === RAVITO_BRAND && !it.flask ? ' · sur ravito' : ''}</option>)}
            </optgroup>
          ) : null
        })}
      </>
    )
  }
  // Profil (comme la page assistance) : altitudes échantillonnées, points, technicité, nuit.
  const profileStride = Math.max(1, Math.floor(sim.points.length / 1500))
  const profilePts = sim.points.filter((_, i) => i % profileStride === 0 || i === sim.points.length - 1).map((p) => [p.dist, p.ele] as [number, number])
  const profileRows = sim.splits.map((s, i) => ({
    id: s.cp.id,
    name: s.cp.name,
    kind: s.cp.kind,
    dist: s.to,
    assist: assistAllowed(s.cp),
    dropbag: !!s.cp.dropbag && isRavitoKind(s.cp.kind),
    up: sim.splits.slice(0, i + 1).reduce((a, x) => a + x.dPlus, 0),
  }))
  const [techBands, nightBands] = (() => {
    const bands = (f: (p: SimPoint) => number) => {
      const out: { from: number; to: number; v: number }[] = []
      for (const p of sim.points) {
        const v = f(p)
        const last = out[out.length - 1]
        if (last && last.v === v) last.to = p.dist
        else out.push({ from: last ? last.to : p.dist, to: p.dist, v })
      }
      return out
    }
    return [bands((p) => p.tech).filter((b) => b.v > 1), bands((p) => (p.night ? 1 : 0)).filter((b) => b.v === 1)]
  })()
  const legs = nutritionPlan(race, sim, products)
  const brands = brandsOf(athlete.products)
  // Dropbags prévus par l'organisation (course) : contenu jusqu'au suivant.
  const dropbags = dropbagPlan(legs, sim.splits.map((s) => s.cp))
  const parts = partition(race.zones, track.totalDist)
  // Reporte eau et glucides de chaque tronçon sur le point de départ correspondant.
  const fillNutrition = () => {
    const byId = new Map(legs.filter((l) => l.fromId).map((l) => [l.fromId!, l]))
    set({ checkpoints: race.checkpoints.map((c) => (byId.has(c.id) ? { ...c, water: byId.get(c.id)!.water, carbs: byId.get(c.id)!.carbs } : c)) })
  }

  const fileBase = race.name.replace(/[^\w-]+/g, '_')
  const exportGpx = () => download(`${fileBase}_plan.gpx`, buildCourseGpx(race, track, sim))
  const exportFit = () => download(`${fileBase}_plan.fit`, buildCourseFit(race, track, sim), 'application/vnd.ant.fit')

  const loadWeather = async () => {
    setWeather({ busy: true, info: null, error: null })
    try {
      const p = track.points[0]
      const [w, series] = await Promise.all([
        fetchRaceWeather(p.lat, p.lon, new Date(startMs), sim.totalTime),
        fetchWeatherSeries(track.points, track.totalDist, new Date(startMs), sim.totalTime).catch(() => null),
      ])
      const round = (x: number) => Math.round(x * 10) / 10
      set({
        env: { ...race.env, heat: { ...race.env.heat, tMax: round(w.tMax), tMin: round(w.tMin), refAlt: Math.round(w.elevation), note: w.note } },
        weather: series,
      })
      const extras = [
        series ? `heure par heure en ${series.points.length} points du parcours` : null,
        w.precipProb !== null ? `pluie ${Math.round(w.precipProb)} %` : null,
        w.precipMm !== null ? `${round(w.precipMm)} mm/j` : null,
        w.windMax !== null ? `vent max ${Math.round(w.windMax)} km/h` : null,
      ].filter(Boolean)
      setWeather({ busy: false, info: extras.join(' · '), error: null })
    } catch (e) {
      setWeather({ busy: false, info: null, error: (e as Error).message })
    }
  }

  const loadOsm = async () => {
    setOsm({ busy: true, error: null })
    try {
      set({ osmTech: await fetchOsmTech(track) })
      setOsm({ busy: false, error: null })
    } catch (e) {
      setOsm({ busy: false, error: (e as Error).message })
    }
  }

  const calibrate = () => {
    const txt = prompt('Temps réalisé sur cette course (h:mm:ss) ?')
    if (!txt) return
    const target = parseDuration(txt)
    if (!target) return
    const d = calibrateDurability(track, athlete, opts, target)
    if (!d) {
      alert("Temps hors d'atteinte avec ce profil : ajuste d'abord VC, VAM ou %VC 1 h.")
      return
    }
    const val = d.mode === 'log' ? `k = ${(d.k * 100).toFixed(1)}` : `perte = ${(d.lossPerH * 100).toFixed(2)} %/h`
    if (confirm(`Durabilité calibrée : ${val}. Appliquer au profil ?`)) onAthleteChange({ ...athlete, durability: d })
  }

  // Accès assistance placés, pour la carte (reliés à leur point du parcours).
  const accessMarks = useMemo(
    () =>
      sim.splits.flatMap((s) => {
        const at = s.cp.id === FINISH_ID ? race.finishAccess : s.cp.access
        if (!at) return []
        const p = track.points[indexAt(track.points, s.to)]
        return [{ name: s.cp.name, at, trail: { lat: p.lat, lon: p.lon } }]
      }),
    [sim.splits, race.finishAccess, track],
  )
  const ravitos = sim.splits.filter((s) => isRavitoKind(s.cp.kind))
  // Arrêt commun : à chaque ravito et à chaque base de vie ; sur un parcours d'entraînement, aussi à chaque point.
  const stopGroups = [
    { kind: 'ravito', one: 'ravito', many: 'ravitos' },
    { kind: 'base', one: 'base de vie', many: 'bases de vie' },
    ...(isRoute ? [{ kind: null, one: 'point', many: 'points' }] : []),
  ].flatMap(({ kind, one, many }) => {
    const k = kind as CheckpointKind | null
    const targets = race.checkpoints.filter((c) => k === null || c.kind === k)
    if (!targets.length) return []
    const key = k ?? 'all'
    const value = bulkStop[key] ?? commonStop(race.checkpoints, k, k ? defaultStop(k) : 0)
    return [{ key, kind: k, one, word: targets.length > 1 ? `aux ${targets.length} ${many}` : `${k === 'base' ? 'à la' : 'au'} ${one}`, value, done: targets.every((c) => c.stopMin === value) }]
  })
  const totalStops = race.checkpoints.reduce((a, c) => a + c.stopMin * 60, 0)
  const nightShare = sim.points.filter((p) => p.night).length / sim.points.length

  return (
    <div className="plan">
      <div className="no-print">
        <Card
          title={
            <input className="title-input" value={race.name} onChange={(e) => set({ name: e.target.value })} />
          }
          actions={
            <>
              <button
                className={isRoute ? '' : 'on-watch'}
                onClick={() => set({ kind: isRoute ? 'race' : 'route' })}
                title={isRoute ? 'En faire une course : date et heure de départ dans « Départ et calcul », barrières horaires' : 'Course : revenir à un parcours d’entraînement (départ libre, zones d’allure)'}
                aria-pressed={!isRoute}
              >
                <Flag /> Course{!isRoute && <> <Check /></>}
              </button>
              {onRedraw && (
                <button onClick={() => onRedraw()} title="Modifier le tracé et les points de passage"><Pencil /> Modifier</button>
              )}
              {share && (
                <button
                  onClick={() => (share.available ? share.create() : alert("Connecte-toi pour partager ton plan avec ton assistance."))}
                  title="Lien en lecture seule pour ton assistance, mis à jour en direct"
                >
                  <Users /> Lien assistance
                </button>
              )}
              {watch && (
                <button
                  className={watch.active ? 'on-watch' : ''}
                  onClick={() => {
                    if (!watch.available) return alert('Connecte-toi pour envoyer ton plan à la montre.')
                    setShowWatch(true)
                    if (!watch.active) watch.activate()
                  }}
                  title="Envoie cette course au champ de données Trail Planner de ta montre Garmin"
                >
                  {watch.active ? <><Watch /> Sur la montre <Check /></> : <><Watch /> Mettre sur la montre</>}
                </button>
              )}
              {/* Feuille A4 (sacs de ravito…) et fiche assistance : courses uniquement. */}
              {!isRoute && <button onClick={() => setPrintFormat('a4')}><Printer /> Feuille A4</button>}
              <button onClick={() => setPrintFormat('strip')}><Printer /> Bande</button>
              {!isRoute && <button onClick={() => setPrintFormat('crew')}><Printer /> Assistance</button>}
              <button className="primary" onClick={exportFit} title="Parcours FIT pour Garmin Connect / PacePro (points de ravito, heures prévues)">
                <Watch /> Export Garmin (FIT)
              </button>
              <button onClick={exportGpx} title="Parcours GPX horodaté avec waypoints"><FileDown /> GPX</button>
            </>
          }
        >
          {share?.url && (
            <div className="banner info share-banner">
              <span>
                Lien assistance : <a href={share.url} target="_blank" rel="noreferrer">{share.url}</a>
                <span className="muted small">
                  {' '}— Position plus fréquente que les 5 min de la montre : active une fois Garmin LiveTrack en démarrage automatique dans
                  Garmin Connect (Sécurité et suivi › LiveTrack), avec l'e-mail de ton assistance. Garmin lui envoie le lien à chaque départ ;
                  elle le colle sur sa page assistance.
                </span>
              </span>
              <span className="row tight">
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(share.url!).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    })
                  }}
                >
                  {copied ? <><Check /> Copié</> : <><Copy /> Copier</>}
                </button>
                <button className="ghost" onClick={() => confirm('Désactiver ce lien ? Ton assistance ne pourra plus l’ouvrir.') && share.remove()}>
                  Arrêter le partage
                </button>
              </span>
            </div>
          )}
          {isDefaultLevel(athlete) && (
            <div className="banner info">
              <span>
                <strong>Profil par défaut</strong> (VC 4'15/km) : ces temps ne sont pas encore les tiens. Sans test VC, estime ton niveau
                à partir d'une course ou d'un entraînement déjà fait.
              </span>
              <a className="button primary" href="#/athlete"><Gauge /> Estimer mon niveau</a>
            </div>
          )}
          {showWatch && (
            <div className="banner info watch-banner">
              <span>
                <Watch className="inline" /> <strong>{race.name}</strong> {watch?.active ? 'est sur ta montre' : ': envoi en cours…'} (le champ Trail
                Planner la récupère tout seul). Code de synchronisation et applications : onglet Montre.
              </span>
              <span className="row tight">
                <a className="button" href="#/montre"><Watch /> Onglet Montre</a>
                <button className="ghost" onClick={() => setShowWatch(false)}>Fermer</button>
              </span>
            </div>
          )}
          <div className="kpis">
            <Kpi label="Distance" value={`${(track.totalDist / 1000).toFixed(1)} km`} sub={`${sim.totalKme.toFixed(1)} km-e`} />
            <Kpi label="Dénivelé" value={`+${Math.round(track.dPlus)} m`} sub={`−${Math.round(track.dMinus)} m`} />
            <Kpi label="Temps prévu" value={formatDuration(sim.totalTime)} sub={`dont ${formatDuration(totalStops)} d'arrêts`} />
            {scenarios && (
              <Kpi
                label="Fourchette"
                value={`${formatDuration(scenarios.good.totalTime)} – ${formatDuration(scenarios.hard.totalTime)}`}
                sub={`${SCENARIOS.good.label.toLowerCase()} → ${SCENARIOS.hard.label.toLowerCase()}`}
              />
            )}
            <Kpi label={free && started === null ? 'Arrivée (départ maintenant)' : 'Arrivée'} value={formatClock(new Date(startMs + sim.totalTime * 1000), race.env.timeZone, true)} sub={`${Math.round(nightShare * 100)} % de nuit`} />
            <Kpi label="Allure moy." value={`${formatPace(sim.totalTime / (track.totalDist / 1000))}/km`} sub={`${formatPace(sim.totalTime / sim.totalKme)}/km-e`} />
            {race.push.enabled && (
              <Kpi
                label="D′ au plus bas"
                value={`${Math.round((sim.minWbal / Math.max(1, athlete.dPrime)) * 100)} %`}
                sub={`${Math.round(sim.minWbal)} m sur ${Math.round(athlete.dPrime)} m`}
              />
            )}
          </div>
          <CourseProfile
            profile={profilePts}
            rows={profileRows}
            position={null}
            tech={techBands}
            night={nightBands}
            onHover={setHoverDist}
            readout={(d) => {
              const p = sim.points[indexAt(track.points, d)]
              return p ? `km ${(d / 1000).toFixed(1)} · ${Math.round(p.ele)} m · ${formatDuration(p.t)} · ${formatClock(new Date(startMs + p.t * 1000), race.env.timeZone)}` : ''
            }}
          />
          <div className="row">
            <Toggle label="Carte" checked={showMap} onChange={setShowMap} />
          </div>
          {showMap && (
            <div id="race-map" className="map-wrap">
              {pickAccess && (
                <div className="banner info">
                  <span>
                    <MapPin className="inline" /> Clique sur la carte à l'endroit où ton assistance se gare pour «{' '}
                    {sim.splits.find((x) => x.cp.id === pickAccess)?.cp.name} » (parking, salle du ravito).
                  </span>
                  <button className="ghost" onClick={() => setPickAccess(null)}>Annuler</button>
                </div>
              )}
              <Suspense fallback={<div className="map map-loading">Chargement de la carte…</div>}>
                <MapView
                  track={track}
                  splits={sim.splits}
                  timeZone={race.env.timeZone}
                  hoverDist={hoverDist}
                  accessPick={
                    pickAccess
                      ? (at) => {
                          if (pickAccess === FINISH_ID) set({ finishAccess: at })
                          else setCp(pickAccess, { access: at })
                          setPickAccess(null)
                        }
                      : null
                  }
                  accesses={accessMarks}
                />
              </Suspense>
            </div>
          )}
        </Card>

        {isRoute && (
          <Card title="Zones d'allure sur le profil" foldDesktop>
            {isRoute && (
              <div className="row profile-tools">
                <span className="muted small">Clic sur le profil :</span>
                <span className="click-mode">
                  <button className="on" title="Le clic coupe la portion de zone : fin de cycle"><Scissors /> Fin de cycle</button>
                </span>
                <span className="muted small">Glisser : appliquer une zone à une portion.</span>
              </div>
            )}
            <ProfileChart
              points={sim.points}
              splits={sim.splits}
              timeZone={race.env.timeZone}
              startMs={startMs}
              onPick={isRoute ? (d) => set({ zones: splitAt(race.zones, track.totalDist, d) }) : undefined}
              onSelect={
                isRoute
                  ? (from, to) => {
                      setSegment(null)
                      setSelection({ from, to })
                    }
                  : undefined
              }
              zones={isRoute ? parts.map((z) => ({ from: z.from, to: z.to, label: zoneShort(z, athlete), color: zoneColor(z, athlete) })) : undefined}
              onSegmentClick={
                isRoute
                  ? (i) => {
                      setSelection(null)
                      setSegment(i)
                    }
                  : undefined
              }
              onBoundaryMove={isRoute ? (i, d) => set({ zones: moveBoundary(parts, i, d) }) : undefined}
              dPrime={race.push.enabled ? athlete.dPrime : undefined}
              onHover={setHoverDist}
            />
            {isRoute && selection && (
              <ZonePicker
                athlete={athlete}
                title={
                  <>
                    <strong>Portion km {(selection.from / 1000).toFixed(1)} → {(selection.to / 1000).toFixed(1)}</strong> ({((selection.to - selection.from) / 1000).toFixed(1)} km) :
                    choisis sa zone.{race.zones.length === 0 && ' Avant et après, le parcours passe en zone 1 (modifiable).'}
                  </>
                }
                onApply={(t) => {
                  set({ zones: applyRange(race.zones, track.totalDist, selection.from, selection.to, t, zone1Target(athlete)) })
                  setSelection(null)
                }}
                onCancel={() => setSelection(null)}
              />
            )}
            {isRoute && segment !== null && parts[segment] && (
              <ZonePicker
                athlete={athlete}
                current={parts[segment]}
                title={
                  <>
                    <strong>
                      Portion {segment + 1} : km {(parts[segment].from / 1000).toFixed(1)} → {(parts[segment].to / 1000).toFixed(1)}
                    </strong>{' '}
                    ({zoneText(parts[segment], athlete)})
                  </>
                }
                onApply={(t) => set({ zones: setTarget(parts, segment, t) })}
                onCancel={() => setSegment(null)}
                extra={
                  <>
                    {segment > 0 && (
                      <button className="ghost" onClick={() => { set({ zones: mergeInto(parts, segment, -1) }); setSegment(null) }} title="Supprime la fin de cycle précédente">
                        <ArrowLeftToLine /> Fusionner avec la précédente
                      </button>
                    )}
                    {segment < parts.length - 1 && (
                      <button className="ghost" onClick={() => { set({ zones: mergeInto(parts, segment, 1) }); setSegment(null) }} title="Supprime la fin de cycle suivante">
                        Fusionner avec la suivante <ArrowRightToLine />
                      </button>
                    )}
                  </>
                }
              />
            )}
            <Hint>
              <strong>Fin de cycle</strong> : un clic coupe la portion ; glisse une limite (poignée sous le profil) pour la déplacer ; clique sur
              une portion de la barre de zones pour changer sa zone (couleurs Garmin). Bandes grises : nuit. Barre jaune → violet : technicité.
            </Hint>
          </Card>
        )}

        {isRoute && race.zones.length > 0 && <ZonesCard race={race} athlete={athlete} track={track} sim={sim} onChange={onChange} />}

        <div className="grid three">
          <Card title={isRoute ? 'Calcul' : 'Départ et calcul'} foldDesktop>
            <div className="fields">
              {isRoute ? null : free ? (
                <div className="field">
                  <span className="field-label">Départ</span>
                  <span>
                    <strong>libre</strong> · {started === null ? 'maintenant :' : race.live ? 'parti à' : 'parti à (montre)'} {formatClock(new Date(startMs), race.env.timeZone)}
                  </span>
                </div>
              ) : (
                <label className="field">
                  <span className="field-label">Départ</span>
                  <input type="datetime-local" value={race.env.start} onChange={(e) => setEnv('start', e.target.value)} />
                </label>
              )}
              <label className="field">
                <span className="field-label">Fuseau</span>
                <select value={race.env.timeZone} onChange={(e) => setEnv('timeZone', e.target.value)}>
                  {TIME_ZONES.includes(race.env.timeZone) ? null : <option>{race.env.timeZone}</option>}
                  {TIME_ZONES.map((z) => <option key={z}>{z}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Mode de calcul</span>
                <select value={race.mode} onChange={(e) => set({ mode: e.target.value as CalcMode })}>
                  {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <Num label="Lissage altitude" value={race.smoothing} onChange={(v) => set({ smoothing: Math.round(v) })} min={0} max={10} title="0 = brut ; plus haut = D+ plus faible" />
            </div>
            {isRoute ? (
              <Hint>
                Un parcours n'a pas d'heure de départ : les heures sont calculées pour un départ maintenant
                {started !== null && <> (parti à {formatClock(new Date(startMs), race.env.timeZone)})</>}, puis se calent sur ton vrai départ
                (mode course ou montre).
              </Hint>
            ) : (
              <>
                <Toggle label="Départ libre (entraînement)" checked={!!race.freeStart} onChange={(v) => set({ freeStart: v })} />
                {free && (
                  <Hint>
                    Heures calculées pour un départ maintenant, mises à jour chaque minute. Dès que tu pars (mode course), elles se calent sur ton
                    vrai départ ; ton assistance les voit aussi calées sur le départ donné par la montre.
                  </Hint>
                )}
              </>
            )}
            <Hint>
              Mode « Km-effort » et colonnes km-e : équivalences du <a href="#/athlete">profil athlète</a> (1 km-e = {athleteKme(athlete).upPer1km} m de D+
              {athleteKme(athlete).downPer1km > 0 ? ` ou ${athleteKme(athlete).downPer1km} m de D−` : ', D− ignoré'}
              {athlete.kmeAuto === false ? '' : ', calculées d’après ta VAM et ta descente'}).
            </Hint>
            <Toggle label="Relancer les montées (D′)" checked={race.push.enabled} onChange={(v) => set({ push: { ...race.push, enabled: v } })} />
            {race.push.enabled && (
              <div className="fields sub">
                <Num label="Intensité en montée" value={race.push.climbPct} scale={100} unit="% VC" min={50} max={150} onChange={(v) => set({ push: { ...race.push, climbPct: v } })} />
                <Num label="D′ utilisable" value={race.push.budget} scale={100} unit="%" min={0} max={100} onChange={(v) => set({ push: { ...race.push, budget: v } })} />
              </div>
            )}
            <Hint>
              Avec les relances, tu montes plus vite que ta VC tant qu'il te reste du D′ ({Math.round(athlete.dPrime)} m) ; il se
              recharge quand tu repasses sous ta VC.
            </Hint>
            <div className="row">
              <Toggle label="Comparer les modes" checked={compare} onChange={setCompare} />
              <button className="ghost" onClick={calibrate} title="Ajuste ta durabilité pour retrouver un temps réalisé">Calibrer sur un temps réel…</button>
            </div>
          </Card>

          <Card title="Environnement" foldDesktop>
            <Toggle label="Nuit (auto selon soleil)" checked={race.env.night.enabled} onChange={(v) => setEnv('night', { ...race.env.night, enabled: v })} />
            {race.env.night.enabled && (
              <div className="fields sub">
                <Num label="Pénalité" value={race.env.night.penalty} scale={100} onChange={(v) => setEnv('night', { ...race.env.night, penalty: v })} unit="%" />
                <Num label="+ par niveau techn." value={race.env.night.perTech} scale={100} onChange={(v) => setEnv('night', { ...race.env.night, perTech: v })} unit="%" />
              </div>
            )}
            <Toggle label="Chaleur" checked={race.env.heat.enabled} onChange={(v) => setEnv('heat', { ...race.env.heat, enabled: v })} />
            {race.env.heat.enabled && (
              <div className="fields sub">
                <Num label="T° max (jour)" value={race.env.heat.tMax} onChange={(v) => setEnv('heat', { ...race.env.heat, tMax: v, note: '' })} unit="°C" />
                <Num label="T° min (nuit)" value={race.env.heat.tMin} onChange={(v) => setEnv('heat', { ...race.env.heat, tMin: v, note: '' })} unit="°C" />
                <Num label="à l'altitude" value={race.env.heat.refAlt} onChange={(v) => setEnv('heat', { ...race.env.heat, refAlt: v, note: '' })} unit="m" />
                <Num label="Seuil" value={race.env.heat.threshold} onChange={(v) => setEnv('heat', { ...race.env.heat, threshold: v })} unit="°C" />
                <Num label="Pénalité" value={race.env.heat.perDeg} scale={100} onChange={(v) => setEnv('heat', { ...race.env.heat, perDeg: v })} unit="% / °C" />
              </div>
            )}
            <Toggle label="Altitude" checked={race.env.altitude.enabled} onChange={(v) => setEnv('altitude', { ...race.env.altitude, enabled: v })} />
            {race.env.altitude.enabled && (
              <div className="fields sub">
                <Num label="Au-dessus de" value={race.env.altitude.threshold} onChange={(v) => setEnv('altitude', { ...race.env.altitude, threshold: v })} unit="m" />
                <Num label="Pénalité" value={race.env.altitude.per1000} scale={100} onChange={(v) => setEnv('altitude', { ...race.env.altitude, per1000: v })} unit="% / 1000 m" />
              </div>
            )}
            <Toggle label="Poids du sac" checked={!!race.env.bag?.enabled} onChange={(v) => setEnv('bag', { kg: 3, relative: false, ...race.env.bag, enabled: v })} />
            {race.env.bag?.enabled && (
              <div className="fields sub">
                <Num label="Sac" value={race.env.bag.kg} unit="kg" min={0} max={30} onChange={(v) => setEnv('bag', { ...race.env.bag!, kg: v })} />
                <label className="field">
                  <span className="field-label">Effet</span>
                  <span className="seg">
                    <button className={!race.env.bag.relative ? 'on' : ''} onClick={() => setEnv('bag', { ...race.env.bag!, relative: false })} title="Temps allongé de 1 % par kg">1 % par kg</button>
                    <button className={race.env.bag.relative ? 'on' : ''} onClick={() => setEnv('bag', { ...race.env.bag!, relative: true })} title="Masse du sac rapportée au poids corporel du profil">
                      Au prorata du poids ({athlete.weight} kg)
                    </button>
                  </span>
                </label>
                <span className="muted small">Temps +{Math.round((bagFactor(race.env, athlete.weight) - 1) * 1000) / 10} %</span>
              </div>
            )}
            <Toggle label="Technicité" checked={race.env.tech.enabled} onChange={(v) => setEnv('tech', { ...race.env.tech, enabled: v })} />
            {race.env.tech.enabled && (
              <div className="fields sub">
                {race.env.tech.factors.map((f, i) => (
                  <Num key={i} label={`Niveau ${i + 1}`} value={f} scale={100} unit="%"
                    onChange={(v) => { const factors = [...race.env.tech.factors] as typeof race.env.tech.factors; factors[i] = v; setEnv('tech', { ...race.env.tech, factors }) }} />
                ))}
              </div>
            )}
            <div className="row">
              <button onClick={loadOsm} disabled={osm.busy} title="Échelle SAC, visibilité et revêtement des sentiers (OpenStreetMap)">
                {osm.busy ? 'OpenStreetMap…' : <><MapIcon /> Technicité OpenStreetMap</>}
              </button>
              {race.osmTech.length > 0 && <button className="ghost" onClick={() => set({ osmTech: [] })}>Effacer</button>}
            </div>
            {race.osmTech.length > 0 && <p className="hint">OSM : {osmSummary(race.osmTech)}</p>}
            {osm.error && <p className="warn">{osm.error}</p>}
            <Toggle label="Pluie (météo heure par heure)" checked={race.env.rain.enabled} onChange={(v) => setEnv('rain', { ...race.env.rain, enabled: v })} />
            {race.env.rain.enabled && (
              <div className="fields sub">
                <Num label="Pénalité" value={race.env.rain.perMm} scale={100} unit="% par mm/h" min={0} onChange={(v) => setEnv('rain', { ...race.env.rain, perMm: v })} />
              </div>
            )}
            <div className="row">
              <button onClick={loadWeather} disabled={weather.busy} title="Prévision à 15 jours, sinon normales des 5 dernières années (Open-Meteo)">
                {weather.busy ? 'Météo…' : <><CloudSun /> Récupérer la météo</>}
              </button>
            </div>
            {race.env.heat.note && (
              <p className="hint">
                {race.env.heat.note} : {race.env.heat.tMin}–{race.env.heat.tMax} °C à {race.env.heat.refAlt} m
                {weather.info ? ` · ${weather.info}` : ''}
              </p>
            )}
            {weather.error && <p className="warn">{weather.error}</p>}
            {race.weather && (
              <p className="hint">
                Météo heure par heure active (prévision du {race.weather.fetchedAt.slice(8, 10)}/{race.weather.fetchedAt.slice(5, 7)}).{' '}
                <button className="ghost" onClick={() => set({ weather: null })}>Revenir au cycle min/max</button>
              </p>
            )}
            <Hint>
              {race.weather
                ? 'Température et pluie prises à chaque instant et à chaque endroit du parcours, corrigées de l’altitude.'
                : 'Chaleur : cycle min à 6 h / max à 15 h, −0,65 °C par 100 m de montée. La pluie ne compte qu’avec la météo heure par heure.'}
            </Hint>
            {newWaypoints.length > 0 && (
              <button className="ghost" onClick={importWaypoints} title="Waypoints du GPX pas encore repris en points de passage">
                Importer {newWaypoints.length} waypoint{newWaypoints.length > 1 ? 's' : ''} GPX
              </button>
            )}
            <TechOverrides race={race} onChange={onChange} />
          </Card>

        </div>

        {compareResults && (
          <Card title="Comparaison des modes de calcul">
            <div className="scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Point</th>
                    <th>Km</th>
                    {compareResults.map((c) => <th key={c.mode}>{MODE_LABELS[c.mode]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sim.splits.map((s, i) => (
                    <tr key={s.cp.id}>
                      <td>{s.cp.name}</td>
                      <td>{(s.to / 1000).toFixed(1)}</td>
                      {compareResults.map((c) => (
                        <td key={c.mode}>
                          {formatDuration(c.sim.splits[i]?.arrival ?? NaN)}{' '}
                          <span className="muted">{formatClock(c.sim.splits[i]?.arrivalClock ?? new Date(NaN), race.env.timeZone)}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card
          title="Temps de passage"
          actions={
            <>
              {ravitos.length > 0 && (
                <button className="primary" onClick={fillNutrition} title="Eau et glucides du plan nutrition reportés sur chaque ravito (colonne Eau / Glu.)">
                  <Droplets /> Reporter eau et glucides sur les ravitos
                </button>
              )}
              {onRedraw && <button onClick={() => onRedraw()} title="Ajouter, déplacer, renommer ou supprimer des points dans l'éditeur"><Pencil /> Modifier les points</button>}
            </>
          }
        >
          {stopGroups.map((g) => (
            <div className="row bulk-stop" key={g.key}>
              <Num label={`Arrêt à chaque ${g.one}`} value={g.value} unit="min" min={0} width={56} onChange={(v) => setBulkStop((b) => ({ ...b, [g.key]: Math.max(0, v) }))} />
              <button
                onClick={() => {
                  set({ checkpoints: setStops(race.checkpoints, g.value, g.kind) })
                  setBulkStop((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== g.key)))
                }}
                disabled={g.done}
              >
                <Check /> Appliquer {g.word}
              </button>
            </div>
          ))}
          {narrow ? (
            <div className="split-cards">
              {sim.splits.map((s) => {
                const isFinish = s.cp.id === '__finish'
                const cp = s.cp
                const w = windowOf(cp.id)
                const open = editing === cp.id
                return (
                  <div key={cp.id} className={`split-card kind-${cp.kind} ${s.night ? 'is-night' : ''}`}>
                    <div className="sc-head">
                      <strong>{cp.name}</strong>
                      <span className="muted">km {(s.to / 1000).toFixed(1)}</span>
                    </div>
                    <div className="sc-main">
                      <span className="sc-time">{formatClock(s.arrivalClock, race.env.timeZone, sim.totalTime > 20 * 3600)}{s.night && <> <Moon className="inline night-icon" aria-label="de nuit" /></>}</span>
                      <span>{formatDuration(s.arrival)}</span>
                      {w && (
                        <span className="muted small">
                          {formatClock(new Date(startMs + w.early * 1000), race.env.timeZone)}–{formatClock(new Date(startMs + w.late * 1000), race.env.timeZone)}
                        </span>
                      )}
                    </div>
                    <div className="sc-meta muted">
                      {(s.dist / 1000).toFixed(1)} km · +{Math.round(s.dPlus)}/−{Math.round(s.dMinus)} m · {formatDuration(s.moveTime)} · {formatPace(s.avgPace)}/km
                      {cp.stopMin ? ` · arrêt ${cp.stopMin} min` : ''}
                    </div>
                    {s.cutoffMargin !== null && (
                      <div className={s.cutoffMargin < 1800 ? 'danger' : s.cutoffMargin < 3600 ? 'warn-text' : 'ok-text'}>
                        Barrière : {s.cutoffMargin < 0 ? 'hors délai ' : 'marge '}{formatDuration(Math.abs(s.cutoffMargin))}
                      </div>
                    )}
                    {cp.notes && !open && <div className="small">{cp.notes}</div>}
                    <div className="row tight">
                      {assistOf(cp, true)}
                      {dropbagOf(cp, true)}
                    </div>
                    {(!isFinish || !isRoute) && (
                      <button className="ghost" onClick={() => setEditing(open ? null : cp.id)}>{open ? 'Fermer' : 'Modifier'}</button>
                    )}
                    {open && isFinish && (
                      <div className="fields">
                        <label className="field">
                          <span className="field-label">Barrière à l’arrivée</span>
                          <input type="datetime-local" value={cp.cutoff} onChange={(e) => set({ finishCutoff: e.target.value })} />
                        </label>
                      </div>
                    )}
                    {open && !isFinish && (
                      <div className="fields">
                        <label className="field">
                          <span className="field-label">Type</span>
                          <select value={cp.kind} onChange={(e) => setCp(cp.id, kindPatch(cp, e.target.value as CheckpointKind))}>
                            {kindOptions(cp.kind).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </label>
                        <Num label="Arrêt" value={cp.stopMin} unit="min" min={0} onChange={(v) => setCp(cp.id, { stopMin: v })} />
                        {!isRoute && (
                          <label className="field">
                            <span className="field-label">Barrière</span>
                            <input type="datetime-local" value={cp.cutoff} onChange={(e) => setCp(cp.id, { cutoff: e.target.value })} />
                          </label>
                        )}
                        <Num label="Eau" value={cp.water} unit="L" min={0} onChange={(v) => setCp(cp.id, { water: v })} />
                        <Num label="Glucides" value={cp.carbs} unit="g" min={0} onChange={(v) => setCp(cp.id, { carbs: v })} />
                        <label className="field">
                          <span className="field-label">Notes</span>
                          <input type="text" value={cp.notes} placeholder="frontale, sac…" onChange={(e) => setCp(cp.id, { notes: e.target.value })} />
                        </label>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
          <div className="scroll">
            <table className="table splits">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Nom</th>
                  <th>Km</th>
                  <th>Tronçon</th>
                  <th>D+ / D−</th>
                  <th>Durée</th>
                  <th>Allure</th>
                  <th>Cumul</th>
                  <th>Heure</th>
                  <th>Arrêt</th>
                  {!isRoute && <th>Barrière</th>}
                  <th>Eau / Glu.</th>
                  <th title="Assistance autorisée à ce point, et son accès placé sur la carte">Assist.</th>
                  <th title="Dropbag prévu par l'organisation à ce point (ravito ou base de vie)">Dropbag</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sim.splits.map((s) => {
                  const isFinish = s.cp.id === '__finish'
                  const cp = s.cp
                  return (
                    <tr key={cp.id} className={`${s.night ? 'is-night' : ''} kind-${cp.kind} ${cp.auto ? 'is-auto' : ''}`}>
                      <td>
                        {isFinish ? 'Arrivée' : (
                          <select value={cp.kind} onChange={(e) => setCp(cp.id, kindPatch(cp, e.target.value as CheckpointKind))} aria-label={`Type de ${cp.name}`}>
                            {kindOptions(cp.kind).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="cp-name-cell">{cp.name}</td>
                      <td>{(s.to / 1000).toFixed(1)}</td>
                      <td>{(s.dist / 1000).toFixed(1)} km<br /><span className="muted">{s.kme.toFixed(1)} km-e</span></td>
                      <td>+{Math.round(s.dPlus)}<br /><span className="muted">−{Math.round(s.dMinus)}</span></td>
                      <td>{formatDuration(s.moveTime)}</td>
                      <td>{formatPace(s.avgPace)}</td>
                      <td><strong>{formatDuration(s.arrival)}</strong></td>
                      <td>
                        <strong>{formatClock(s.arrivalClock, race.env.timeZone, sim.totalTime > 20 * 3600)}</strong>{s.night && <> <Moon className="inline night-icon" aria-label="de nuit" /></>}
                        {(() => {
                          const w = windowOf(s.cp.id)
                          return w ? (
                            <div className="muted small" title="Fenêtre : bonne journée → journée difficile">
                              {formatClock(new Date(startMs + w.early * 1000), race.env.timeZone)}–{formatClock(new Date(startMs + w.late * 1000), race.env.timeZone)}
                            </div>
                          ) : null
                        })()}
                      </td>
                      <td>{isFinish ? '' : <Num value={cp.stopMin} width={44} unit="min" min={0} onChange={(v) => setCp(cp.id, { stopMin: v })} />}</td>
                      {!isRoute && (
                        <td>
                          <input
                            type="datetime-local"
                            value={cp.cutoff}
                            aria-label={`Barrière ${cp.name}`}
                            onChange={(e) => (isFinish ? set({ finishCutoff: e.target.value }) : setCp(cp.id, { cutoff: e.target.value }))}
                          />
                          {s.cutoffMargin !== null && (
                            <div className={s.cutoffMargin < 1800 ? 'danger' : s.cutoffMargin < 3600 ? 'warn-text' : 'ok-text'}>
                              {s.cutoffMargin < 0 ? 'Hors délai ' : 'Marge '}{formatDuration(Math.abs(s.cutoffMargin))}
                            </div>
                          )}
                        </td>
                      )}
                      <td>
                        {!isFinish && (
                          <div className="stack">
                            <Num value={cp.water} width={48} unit="L" min={0} onChange={(v) => setCp(cp.id, { water: v })} />
                            <Num value={cp.carbs} width={48} unit="g" min={0} onChange={(v) => setCp(cp.id, { carbs: v })} />
                          </div>
                        )}
                      </td>
                      <td>{assistOf(cp)}</td>
                      <td>{dropbagOf(cp)}</td>
                      <td>{!isFinish && <input type="text" className="wide" value={cp.notes} placeholder="frontale, sac…" onChange={(e) => setCp(cp.id, { notes: e.target.value })} />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          )}
          {(
            <Hint>
              Eau / glucides : quantités à emporter depuis ce point jusqu'au ravito suivant. Dropbag : coche les ravitos et bases de vie où l'organisation
              transporte ton sac (son contenu est dans le plan nutrition et sur la feuille A4). Assistance : coche les points où elle a le droit de
              venir (ils forment son trajet sur la page assistance) ; <MapPin className="inline" /> place son accès (parking, salle du ravito) sur
              la carte, destination de son lien GPS.
            </Hint>
          )}
        </Card>

        <Card title="Nutrition">
          <div className="fields">
            <Num label="Glucides" value={race.carbsPerH} onChange={(v) => set({ carbsPerH: v })} unit="g/h" />
            <Num label="Eau (à 15 °C)" value={race.waterPerH} onChange={(v) => set({ waterPerH: v })} unit="L/h" />
            <Num label="Sodium" value={race.sodiumPerH} onChange={(v) => set({ sodiumPerH: v })} unit="mg/h" />
            {(
              <label className="field">
                <span className="field-label">Marque aux ravitaillements</span>
                <select
                  value={race.ravitoBrand ?? ''}
                  onChange={(e) => {
                    const brand = e.target.value || undefined
                    // La marque coche ses produits et décoche ceux des autres marques ; les produits sans marque restent.
                    const ids = athlete.products
                      .filter((p) => (brand ? !p.brand?.trim() ? products.includes(p) : p.brand.trim() === brand : products.includes(p)))
                      .map((p) => p.id)
                    set({ ravitoBrand: brand, productIds: brand ? ids : race.productIds })
                  }}
                  disabled={brands.length === 0}
                >
                  <option value="">{brands.length ? 'Aucune en particulier' : 'Aucune marque saisie'}</option>
                  {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="field">
            <span className="field-label">Produits sur {isRoute ? 'ce parcours' : 'cette course'}</span>
            <div className="product-rows">
              {products.map((p) => (
                <div className="row tight" key={p.id}>
                  <select value={p.id} onChange={(e) => chooseProduct(e.target.value, p.id)} aria-label="Produit">
                    {productOptions(p.id)}
                  </select>
                  {isAtRavito(p) && <span className="tag ravito-tag" title="Mangé ou bu au ravito, pas emporté">sur ravito</span>}
                  <button className="ghost" onClick={() => set({ productIds: products.filter((x) => x.id !== p.id).map((x) => x.id) })} aria-label={`Retirer ${p.name}`}><Trash2 /></button>
                </div>
              ))}
              {addingProduct ? (
                <div className="row tight">
                  <select
                    value=""
                    autoFocus
                    onChange={(e) => {
                      if (e.target.value) chooseProduct(e.target.value)
                      setAddingProduct(false)
                    }}
                    aria-label="Produit à ajouter"
                  >
                    <option value="">Choisir un produit…</option>
                    {productOptions()}
                  </select>
                  <button className="ghost" onClick={() => setAddingProduct(false)} aria-label="Annuler"><Trash2 /></button>
                </div>
              ) : (
                <button className="ghost" onClick={() => setAddingProduct(true)}>
                  <Plus /> Ajouter un produit
                </button>
              )}
              {products.length === 0 && <span className="muted small">Aucun produit : l'eau seule est prévue.</span>}
            </div>
          </div>
          <Hint>
            Tes produits (gels, barres, isotonique en flasque) et leur marque se règlent dans l’onglet <a href="#/nutrition">Nutrition</a>.
            Choisir la marque présente aux ravitaillements retient ses produits ; « Ajouter un produit » en ajoute autant que tu veux,
            parmi tes produits ou la bibliothèque (le produit choisi est alors copié dans tes produits). L'eau augmente de 4 % par °C au-dessus de 15 °C.
          </Hint>
        </Card>

        <Card
          title="Plan nutrition"
          actions={ravitos.length > 0 ? <button className="primary" onClick={fillNutrition}><Droplets /> Reporter eau et glucides sur les ravitos</button> : undefined}
        >
          <div className="scroll">
            <table className="table">
              <thead>
                <tr><th>Tronçon</th><th>Durée</th><th>T° moy.</th><th title="Requis, puis prévu">Eau</th><th title="Requis, puis prévu">Glucides</th><th title="Requis, puis prévu">Sodium</th><th>À emporter</th></tr>
              </thead>
              <tbody>
                {legs.map((l) => (
                  <tr key={`${l.from}-${l.to}`}>
                    <td>{l.from} → {l.to}</td>
                    <td>{formatDuration(l.duration)}</td>
                    <td>{Math.round(l.temp)} °C</td>
                    {(() => {
                      // Requis (besoin du tronçon) et prévu (ce qu'apportent flasques, produits et sel).
                      const sup = legSupply(l)
                      const planned = (v: number, req: number, unit: string, title: string) => (
                        <div className={`small ${shortOf(v, req) ? 'warn-text' : 'muted'}`} title={title}>prévu {v} {unit}</div>
                      )
                      return (
                        <>
                          <td>
                            {l.water} L
                            {planned(sup.water, l.water, 'L', 'Eau des flasques emportées (500 ml chacune)')}
                            {flaskText(l) && <div className="muted small">{flaskText(l)}</div>}
                            {flaskWarning(l) && <div className="warn-text small">{flaskWarning(l)}</div>}
                          </td>
                          <td>
                            {l.carbs} g
                            {planned(sup.carbs, l.carbs, 'g', 'Glucides des produits emportés')}
                          </td>
                          <td>
                            {l.sodium} mg
                            {planned(sup.sodium, l.sodium, 'mg', 'Sodium des produits emportés et du sel à ajouter')}
                          </td>
                        </>
                      )
                    })()}
                    <td>
                      {bagText(l, false)}
                      {ravitoText(l) && <div className="small ravito-line">Sur ravito : {ravitoText(l)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Hint>
            Requis : besoin calculé sur la durée prévue de chaque tronçon (du départ d'un ravito à l'arrivée au suivant). Prévu : ce
            qu'apportent les flasques emportées, les produits et le sel à ajouter (en orange s'il manque plus de 10 %). Flasques de 500 ml :
            une seule d'isotonique si 500 ml suffisent, sinon une d'eau et une d'isotonique, puis une de plus par 500 ml commencés
            en alternant eau et isotonique ;
            les glucides et le sodium de l'isotonique sont déduits, les autres produits complètent.
          </Hint>
          {dropbags.length > 0 && (
            <>
              <h3>Dropbags</h3>
              <div className="scroll">
                <table className="table">
                  <thead>
                    <tr><th>Dropbag</th><th>Jusqu'à</th><th>Durée</th><th>Glucides</th><th>À mettre dans le sac</th></tr>
                  </thead>
                  <tbody>
                    {dropbags.map((b) => (
                      <tr key={b.id}>
                        <td>{b.name}</td>
                        <td>{b.until}</td>
                        <td>{formatDuration(b.duration)}</td>
                        <td>{b.carbs} g</td>
                        <td>{dropbagText(b)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Hint>Produits de ton plan nutrition de chaque dropbag jusqu'au suivant (ou l'arrivée), en plus de ce que donnent les ravitos.</Hint>
            </>
          )}
        </Card>
      </div>



      {printFormat && (
        <PrintSheets format={printFormat} race={race} track={track} sim={sim} athlete={athlete} windowOf={windowOf} legs={legs} onDone={() => setPrintFormat(null)} />
      )}
    </div>
  )
}

function TechOverrides({ race, onChange }: { race: Race; onChange: (r: Race) => void }) {
  const set = (techOverrides: Race['techOverrides']) => onChange({ ...race, techOverrides })
  return (
    <>
      <h3>Technicité manuelle</h3>
      <Hint>Par défaut, la technicité est estimée d'après la pente. Ici, tu la forces sur des tronçons.</Hint>
      {race.techOverrides.map((o) => (
        <div className="row tight" key={o.id}>
          <Num value={o.from / 1000} width={56} unit="km" onChange={(v) => set(race.techOverrides.map((x) => (x.id === o.id ? { ...x, from: v * 1000 } : x)))} />
          →
          <Num value={o.to / 1000} width={56} unit="km" onChange={(v) => set(race.techOverrides.map((x) => (x.id === o.id ? { ...x, to: v * 1000 } : x)))} />
          <select value={o.level} onChange={(e) => set(race.techOverrides.map((x) => (x.id === o.id ? { ...x, level: Number(e.target.value) as 1 } : x)))}>
            {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>Niveau {l}</option>)}
          </select>
          <button className="ghost" onClick={() => set(race.techOverrides.filter((x) => x.id !== o.id))} aria-label="Supprimer"><Trash2 /></button>
        </div>
      ))}
      <button className="ghost" onClick={() => set([...race.techOverrides, { id: crypto.randomUUID(), from: 0, to: 1000, level: 3 }])}>
        + Tronçon technique
      </button>
    </>
  )
}
