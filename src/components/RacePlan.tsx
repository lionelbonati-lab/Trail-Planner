import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Check,
  CloudSun,
  Copy,
  FileDown,
  Flag,
  LibraryBig,
  Map as MapIcon,
  MapPin,
  Moon,
  Pencil,
  Play,
  Plus,
  Printer,
  Scissors,
  Sparkles,
  Trash2,
  Users,
  Watch,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { buildCourseGpx, download } from '../lib/exportGpx'
import { buildCourseFit } from '../lib/fit'
import { bagText, nutritionPlan } from '../lib/nutrition'
import { applyRange, mergeInto, moveBoundary, partition, setTarget, splitAt, zone1Target, zoneColor, zoneShort, zoneText } from '../lib/zones'
import { fetchOsmTech, osmSummary } from '../lib/osm'
import { fetchRaceWeather, fetchWeatherSeries } from '../lib/weather'
import { indexAt, parseGpx } from '../lib/gpx'
import { FINISH_ID } from '../lib/assist'
import { planOptions } from '../lib/plan'
import { bagFactor, calibrateDurability, scenarioInputs, SCENARIOS, simulate, type SimOptions } from '../lib/model'
import { commonStop, computeAutoPoints, mergeAutoPoints, METHOD_LABELS, setStops, type AutoSplitMethod } from '../lib/splits'
import { formatClock, formatDuration, formatPace, parseDuration, utcToZonedInput, zonedToUtc } from '../lib/time'
import type { Athlete, CalcMode, Checkpoint, CheckpointKind, Race, RaceKind, SimResult, Track } from '../lib/types'
import { AssistCard } from './AssistCard'
import { PrintSheets, type PrintFormat } from './PrintSheets'
import { ProfileChart } from './ProfileChart'
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

const KIND_LABELS: Record<CheckpointKind, string> = {
  ravito: 'Ravito',
  split: 'Point inter',
  cutoff: 'Barrière',
  info: 'Repère',
}

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
  const started = race.live ? Date.parse(race.live.startedAt) : watchStart
  const now = useMinuteClock(!!race.freeStart && started === null)
  const start = race.freeStart ? utcToZonedInput(started ?? now, race.env.timeZone) : race.env.start
  const effective = useMemo(() => (start === race.env.start ? race : { ...race, env: { ...race.env, start } }), [race, start])
  const track = useMemo<Track | null>(() => {
    try {
      return parseGpx(race.gpxText, race.smoothing)
    } catch {
      return null
    }
  }, [race.gpxText, race.smoothing])

  const opts = useMemo<SimOptions | null>(() => (track ? planOptions(effective, track) : null), [track, effective])

  const sim = useMemo<SimResult | null>(() => (track && opts ? simulate(track, athlete, opts) : null), [track, opts, athlete])
  return { track, opts, sim, start, started: race.freeStart ? started : null }
}

export function RacePlan({
  race,
  athlete,
  onChange,
  onAthleteChange,
  onLive,
  onRedraw,
  share,
  watch,
  library,
  toRace,
  watchStart = null,
}: {
  race: Race
  athlete: Athlete
  onChange: (r: Race) => void
  onAthleteChange: (a: Athlete) => void
  onLive?: () => void
  /** Ouvre le traceur pour modifier le parcours sur la carte. */
  onRedraw?: () => void
  share?: { available: boolean; url: string | null; create: () => Promise<void>; remove: () => Promise<void> }
  watch?: { available: boolean; code: string | null; shortCode?: string | null; active: boolean; activate: () => void }
  library?: { kind: RaceKind; addToLibrary: () => void }
  /** Parcours : envoi vers une course (nouvelle course si `target` est null, sinon tracé remplacé). */
  toRace?: { races: { id: string; name: string }[]; send: (target: string | null, name: string) => string; open: (id: string) => void }
  /** Départ libre : départ réel donné par la montre (ms), si l'activité est en cours. */
  watchStart?: number | null
}) {
  // Parcours : panneau « Vers une course » (cible, nom) puis résultat.
  const [sending, setSending] = useState<{ target: string | null; name: string } | null>(null)
  const [sent, setSent] = useState<{ id: string; name: string; replaced: boolean } | null>(null)
  const isRoute = race.kind === 'route'
  // Types proposés : un parcours n'a que des repères et points intermédiaires (le type actuel reste
  // affiché s'il en a un autre, venu d'une course).
  const kindOptions = (current: CheckpointKind) =>
    Object.entries(KIND_LABELS).filter(([k]) => !isRoute || k === 'info' || k === 'split' || k === current) as [CheckpointKind, string][]
  const [copied, setCopied] = useState(false)
  const [showWatch, setShowWatch] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const watchCode = watch?.code ?? null
  const [hoverDist, setHoverDist] = useState<number | null>(null)
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null)
  const [segment, setSegment] = useState<number | null>(null)
  // Clic sur le profil : fin de cycle (entraînement) ou ravito (compétition).
  // Clic sur le profil : fin de cycle (zones, parcours) ou ajout d'un point (repère / ravito).
  const [clickMode, setClickMode] = useState<'cycle' | 'point'>(race.kind === 'route' ? 'cycle' : 'point')
  // Le tableau complet demande ≈ 1 230 px ; en dessous, vue en cartes.
  const narrow = useMediaQuery('(max-width: 1229px)')
  const [editing, setEditing] = useState<string | null>(null)
  // Temps d'arrêt à appliquer à tous les ravitos (par défaut : le plus fréquent).
  const [bulkStop, setBulkStop] = useState<number | null>(null)
  const [showMap, setShowMap] = useState(true)
  // Pose sur la carte de l'accès assistance d'un point (identifiant du point), ou null.
  const [pickAccess, setPickAccess] = useState<string | null>(null)
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
  const { track, opts, sim, start, started } = useRaceComputation(race, athlete, watchStart)
  const [method, setMethod] = useState<AutoSplitMethod>('peaks')
  const [methodValue, setMethodValue] = useState(METHOD_LABELS.peaks.def)
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

  const addPoint = (dist: number, kind: CheckpointKind = race.kind === 'route' ? 'info' : 'ravito', name?: string) => {
    const cp: Checkpoint = {
      id: crypto.randomUUID(),
      dist: Math.round(dist),
      name: name ?? `${KIND_LABELS[kind]} km ${(dist / 1000).toFixed(1)}`,
      kind,
      stopMin: kind === 'ravito' ? 3 : 0,
      cutoff: '',
      water: 0,
      carbs: 0,
      notes: '',
      auto: false,
    }
    // Un point manuel remplace un point auto trop proche (moins de 300 m).
    const kept = race.checkpoints.filter((c) => !(c.auto && Math.abs(c.dist - cp.dist) < 300))
    set({ checkpoints: [...kept, cp].sort((a, b) => a.dist - b.dist) })
  }

  const generate = () => {
    const pts = computeAutoPoints(track, { method, value: methodValue }, race.kme, sim.points)
    set({ checkpoints: mergeAutoPoints(race.checkpoints, pts) })
  }

  const importWaypoints = () => {
    let cps = race.checkpoints
    for (const w of track.waypoints) {
      if (cps.some((c) => Math.abs(c.dist - w.dist) < 100)) continue
      // Waypoints GPX : ravitos d'une course, simples repères d'un parcours.
      cps = [...cps, { id: crypto.randomUUID(), dist: w.dist, name: w.name, kind: isRoute ? 'info' : 'ravito', stopMin: isRoute ? 0 : 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
    }
    set({ checkpoints: cps.sort((a, b) => a.dist - b.dist) })
  }

  const legs = nutritionPlan(race, sim, athlete.products)
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
  const ravitos = sim.splits.filter((s) => s.cp.kind === 'ravito')
  // Arrêt commun : à chaque ravito d'une course, à chaque point d'un parcours.
  const stopKind = isRoute ? null : 'ravito'
  const stopCount = race.checkpoints.filter((c) => isRoute || c.kind === 'ravito').length
  const stopAll = bulkStop ?? commonStop(race.checkpoints, stopKind, isRoute ? 0 : 3)
  const stopWord = isRoute ? (stopCount > 1 ? 'points' : 'point') : stopCount > 1 ? 'ravitos' : 'ravito'
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
              {isRoute && toRace && (
                <button
                  className="primary"
                  onClick={() => {
                    setSent(null)
                    setSending(sending ? null : { target: null, name: race.name })
                  }}
                  title="Crée une course à partir de ce parcours, ou remplace le tracé d'une course (copie indépendante)"
                >
                  <Flag /> Vers une course
                </button>
              )}
              {library && library.kind !== 'route' && (
                <button onClick={library.addToLibrary} title="Copie ce parcours dans ta bibliothèque d'entraînement"><LibraryBig /> Ajouter à la bibliothèque</button>
              )}
              {onRedraw && (
                <button onClick={onRedraw} title={race.drawn ? 'Modifier le tracé sur la carte' : 'Rendre la trace modifiable sur la carte (découpée en points à déplacer)'}>
                  <Pencil /> Modifier le tracé
                </button>
              )}
              {onLive && <button className={library?.kind === 'route' ? '' : 'primary'} onClick={onLive}><Play /> Mode course</button>}
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
          {sending && toRace && (
            <div className="banner info send-race">
              <span className="row tight">
                <label className="check"><input type="radio" checked={sending.target === null} onChange={() => setSending({ ...sending, target: null })} /> Nouvelle course</label>
                {sending.target === null && (
                  <input type="text" value={sending.name} onChange={(e) => setSending({ ...sending, name: e.target.value })} aria-label="Nom de la course" />
                )}
              </span>
              {toRace.races.length > 0 && (
                <span className="row tight">
                  <label className="check">
                    <input type="radio" checked={sending.target !== null} onChange={() => setSending({ ...sending, target: toRace.races[0].id })} /> Remplacer le tracé de
                  </label>
                  {sending.target !== null && (
                    <select value={sending.target} onChange={(e) => setSending({ ...sending, target: e.target.value })} aria-label="Course dont le tracé est remplacé">
                      {toRace.races.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  )}
                </span>
              )}
              <span className="muted small">
                {sending.target === null
                  ? 'La course reprend le tracé, les points de repère et les réglages, sans les zones d’allure. Copie indépendante : modifier le parcours ensuite ne la change pas.'
                  : 'Le tracé de la course est remplacé ; ses ravitos et réglages sont gardés (les points au-delà de la nouvelle distance sont retirés).'}
              </span>
              <span className="row tight">
                <button
                  className="primary"
                  onClick={() => {
                    const name = sending.target === null ? sending.name : (toRace.races.find((r) => r.id === sending.target)?.name ?? '')
                    if (sending.target !== null && !confirm(`Remplacer le tracé de « ${name} » par celui de ce parcours ?`)) return
                    const id = toRace.send(sending.target, sending.name)
                    setSent({ id, name: sending.target === null ? sending.name.trim() || race.name : name, replaced: sending.target !== null })
                    setSending(null)
                  }}
                >
                  <Flag /> Envoyer
                </button>
                <button className="ghost" onClick={() => setSending(null)}>Annuler</button>
              </span>
            </div>
          )}
          {sent && toRace && (
            <div className="banner info">
              <span>Course « {sent.name} » {sent.replaced ? 'mise à jour avec ce tracé' : 'créée'}.</span>
              <span className="row tight">
                <button className="primary" onClick={() => toRace.open(sent.id)}>Ouvrir la course</button>
                <button className="ghost" onClick={() => setSent(null)} aria-label="Fermer">OK</button>
              </span>
            </div>
          )}
          {showWatch && (
            <div className="banner info watch-banner">
              <div>
                <strong>Montre Garmin</strong> — {watch?.active ? 'cette course est sur ta montre' : 'envoi en cours…'}. Code à saisir sur la
                montre (une seule fois) :{' '}
                {watch?.shortCode ? (
                  <strong className="ep-short">{`${watch.shortCode.slice(0, 4)} ${watch.shortCode.slice(4)}`}</strong>
                ) : (
                  <span className="muted">création…</span>
                )}
                {watchCode && (
                  <span className="muted small">
                    {' '}· code long pour Garmin Connect : <code className="watch-code">{watchCode}</code>
                  </span>
                )}
                <ol className="watch-steps">
                  <li>Installe le champ de données « Trail Planner » sur ta montre.</li>
                  <li>
                    Sur la montre, pendant une activité : appui long sur Haut (menu) › Champs Connect IQ › Trail Planner › Code montre,
                    saisis les 8 chiffres. Si le champ vient du Store, tu peux aussi coller le code long dans Garmin Connect.
                  </li>
                  <li>Ajoute le champ à un écran de ton activité Trail.</li>
                  <li>Avant le départ, ouvre l'activité quelques minutes, téléphone à proximité : la montre télécharge la course (contrôle toutes les 5 min). Ensuite, tout fonctionne sans réseau.</li>
                  <li>Pour changer de course, clique « Mettre sur la montre » sur une autre course. Les modifications du plan sont envoyées automatiquement.</li>
                  <li>Pendant la course, si ton téléphone est avec toi, la montre envoie tes passages et ta position toutes les 5 min : ton assistance les voit sur le lien assistance.</li>
                </ol>
              </div>
              <span className="row tight">
                {watchCode && (
                  <button
                    onClick={() =>
                      navigator.clipboard?.writeText(watchCode).then(() => {
                        setCopiedCode(true)
                        setTimeout(() => setCopiedCode(false), 2000)
                      })
                    }
                  >
                    {copiedCode ? <><Check /> Copié</> : <><Copy /> Copier le code</>}
                  </button>
                )}
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
            <Kpi label={race.freeStart && started === null ? 'Arrivée (départ maintenant)' : 'Arrivée'} value={formatClock(new Date(startMs + sim.totalTime * 1000), race.env.timeZone, true)} sub={`${Math.round(nightShare * 100)} % de nuit`} />
            <Kpi label="Allure moy." value={`${formatPace(sim.totalTime / (track.totalDist / 1000))}/km`} sub={`${formatPace(sim.totalTime / sim.totalKme)}/km-e`} />
            {race.push.enabled && (
              <Kpi
                label="D′ au plus bas"
                value={`${Math.round((sim.minWbal / Math.max(1, athlete.dPrime)) * 100)} %`}
                sub={`${Math.round(sim.minWbal)} m sur ${Math.round(athlete.dPrime)} m`}
              />
            )}
          </div>
          {isRoute && (
            <div className="row profile-tools">
              <span className="muted small">Clic sur le profil :</span>
              <span className="click-mode">
                <button className={clickMode === 'cycle' ? 'on' : ''} onClick={() => setClickMode('cycle')} title="Le clic coupe la portion de zone : fin de cycle"><Scissors /> Fin de cycle</button>
                <button className={clickMode === 'point' ? 'on' : ''} onClick={() => setClickMode('point')} title="Le clic ajoute un point de repère"><Plus /> Repère</button>
              </span>
              <span className="muted small">Glisser : appliquer une zone à une portion.</span>
            </div>
          )}
          <ProfileChart
            points={sim.points}
            splits={sim.splits}
            timeZone={race.env.timeZone}
            startMs={startMs}
            onPick={(d) => (isRoute && clickMode === 'cycle' ? set({ zones: splitAt(race.zones, track.totalDist, d) }) : addPoint(d))}
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
          {isRoute ? (
            <Hint>
              <strong>Fin de cycle</strong> : un clic coupe la portion ; glisse une limite (poignée sous le profil) pour la déplacer ; clique sur
              une portion de la barre de zones pour changer sa zone (couleurs Garmin). <strong>Repère</strong> : un clic ajoute un point de
              repère (aussi possible sur la carte). Bandes grises : nuit. Barre jaune → violet : technicité.
            </Hint>
          ) : (
            <Hint>
              Un clic sur le profil (ou sur la carte) ajoute un ravito. Bandes grises : nuit. Barre jaune → violet : technicité. Une course se
              calcule à ton intensité de course (durabilité), sans zones d'allure.
            </Hint>
          )}
          <div className="row">
            <Toggle label="Carte" checked={showMap} onChange={setShowMap} />
          </div>
          {showMap && (
            <div id="race-map">
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
                  onPick={(d) => addPoint(d)}
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

        {!isRoute && (
        <AssistCard
          race={race}
          track={track}
          splits={sim.splits}
          picking={pickAccess}
          onPick={startPick}
          onCheckpoint={setCp}
          onRace={(patch) => set(patch)}
        />
        )}

        {isRoute && race.zones.length > 0 && <ZonesCard race={race} athlete={athlete} track={track} sim={sim} onChange={onChange} />}

        <div className="grid three">
          <Card title="Départ et calcul">
            <div className="fields">
              {race.freeStart ? (
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
              <Num label="1 km-e =" value={race.kme.upPer1km} onChange={(v) => set({ kme: { ...race.kme, upPer1km: v } })} unit="m D+" min={1} />
              <Num label="D− (0 = ignoré)" value={race.kme.downPer1km} onChange={(v) => set({ kme: { ...race.kme, downPer1km: v } })} unit="m = 1 km" min={0} />
              <Num label="Lissage altitude" value={race.smoothing} onChange={(v) => set({ smoothing: Math.round(v) })} min={0} max={10} title="0 = brut ; plus haut = D+ plus faible" />
            </div>
            <Toggle label="Départ libre (entraînement)" checked={!!race.freeStart} onChange={(v) => set({ freeStart: v })} />
            {race.freeStart && (
              <Hint>
                Heures calculées pour un départ maintenant, mises à jour chaque minute. Dès que tu pars (mode course), elles se calent sur ton
                vrai départ ; ton assistance les voit aussi calées sur le départ donné par la montre.
              </Hint>
            )}
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

          <Card title="Environnement">
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
          </Card>

          <Card title="Points automatiques">
            <div className="fields">
              <label className="field">
                <span className="field-label">Méthode</span>
                <select value={method} onChange={(e) => { const m = e.target.value as AutoSplitMethod; setMethod(m); setMethodValue(METHOD_LABELS[m].def) }}>
                  {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <Num label="Valeur" value={methodValue} onChange={setMethodValue} unit={METHOD_LABELS[method].unit} min={1} />
            </div>
            <div className="row">
              <button className="primary" onClick={generate}><Sparkles /> Générer</button>
              <button className="ghost" onClick={() => set({ checkpoints: race.checkpoints.filter((c) => !c.auto) })}>Effacer les auto</button>
              {track.waypoints.length > 0 && (
                <button className="ghost" onClick={importWaypoints}>Importer {track.waypoints.length} waypoints GPX</button>
              )}
            </div>
            <Hint>Générer remplace les points auto précédents ; tes ravitos et points modifiés à la main sont conservés.</Hint>
            <h3>Nutrition</h3>
            <div className="fields">
              <Num label="Glucides" value={race.carbsPerH} onChange={(v) => set({ carbsPerH: v })} unit="g/h" />
              <Num label="Eau (à 15 °C)" value={race.waterPerH} onChange={(v) => set({ waterPerH: v })} unit="L/h" />
              <Num label="Sodium" value={race.sodiumPerH} onChange={(v) => set({ sodiumPerH: v })} unit="mg/h" />
            </div>
            {!isRoute && <button className="ghost" onClick={fillNutrition} disabled={ravitos.length === 0}>Reporter eau et glucides sur les ravitos</button>}
            <Hint>Tes produits (gels, boissons…) se règlent dans le profil athlète. L'eau augmente de 4 % par °C au-dessus de 15 °C.</Hint>
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
          actions={<button onClick={() => addPoint(track.totalDist / 2)}><Plus /> Ajouter un point</button>}
        >
          {stopCount > 0 && (
            <div className="row bulk-stop">
              <Num label={`Arrêt à chaque ${isRoute ? 'point' : 'ravito'}`} value={stopAll} unit="min" min={0} width={56} onChange={(v) => setBulkStop(Math.max(0, v))} />
              <button
                onClick={() => { set({ checkpoints: setStops(race.checkpoints, stopAll, stopKind) }); setBulkStop(null) }}
                disabled={race.checkpoints.every((c) => !(isRoute || c.kind === 'ravito') || c.stopMin === stopAll)}
              >
                <Check /> Appliquer {stopCount > 1 ? `aux ${stopCount} ${stopWord}` : `au ${stopWord}`}
              </button>
            </div>
          )}
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
                    {!isFinish && (
                      <button className="ghost" onClick={() => setEditing(open ? null : cp.id)}>{open ? 'Fermer' : 'Modifier'}</button>
                    )}
                    {open && !isFinish && (
                      <div className="fields">
                        <label className="field">
                          <span className="field-label">Type</span>
                          <select value={cp.kind} onChange={(e) => setCp(cp.id, { kind: e.target.value as CheckpointKind })}>
                            {kindOptions(cp.kind).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </label>
                        <label className="field">
                          <span className="field-label">Nom</span>
                          <input type="text" value={cp.name} onChange={(e) => setCp(cp.id, { name: e.target.value })} />
                        </label>
                        <Num label="Km" value={cp.dist / 1000} onChange={(v) => setCp(cp.id, { dist: Math.max(0, Math.min(track.totalDist, v * 1000)) })} />
                        <Num label="Arrêt" value={cp.stopMin} unit="min" min={0} onChange={(v) => setCp(cp.id, { stopMin: v })} />
                        {!isRoute && (
                          <>
                            <label className="field">
                              <span className="field-label">Barrière</span>
                              <input type="datetime-local" value={cp.cutoff} onChange={(e) => setCp(cp.id, { cutoff: e.target.value })} />
                            </label>
                            <Num label="Eau" value={cp.water} unit="L" min={0} onChange={(v) => setCp(cp.id, { water: v })} />
                            <Num label="Glucides" value={cp.carbs} unit="g" min={0} onChange={(v) => setCp(cp.id, { carbs: v })} />
                          </>
                        )}
                        <label className="field">
                          <span className="field-label">Notes</span>
                          <input type="text" value={cp.notes} placeholder="frontale, sac…" onChange={(e) => setCp(cp.id, { notes: e.target.value })} />
                        </label>
                        <button className="ghost danger" onClick={() => set({ checkpoints: race.checkpoints.filter((c) => c.id !== cp.id) })}>Supprimer ce point</button>
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
                  {!isRoute && <th>Eau / Glu.</th>}
                  <th>Notes</th>
                  <th />
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
                          <select value={cp.kind} onChange={(e) => setCp(cp.id, { kind: e.target.value as CheckpointKind })}>
                            {kindOptions(cp.kind).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        )}
                      </td>
                      <td>{isFinish ? cp.name : <input type="text" className="wide" value={cp.name} onChange={(e) => setCp(cp.id, { name: e.target.value })} />}</td>
                      <td>{isFinish ? (s.to / 1000).toFixed(1) : <Num value={cp.dist / 1000} width={64} onChange={(v) => setCp(cp.id, { dist: Math.max(0, Math.min(track.totalDist, v * 1000)) })} />}</td>
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
                          {!isFinish && (
                            <input type="datetime-local" value={cp.cutoff} onChange={(e) => setCp(cp.id, { cutoff: e.target.value })} />
                          )}
                          {s.cutoffMargin !== null && (
                            <div className={s.cutoffMargin < 1800 ? 'danger' : s.cutoffMargin < 3600 ? 'warn-text' : 'ok-text'}>
                              {s.cutoffMargin < 0 ? 'Hors délai ' : 'Marge '}{formatDuration(Math.abs(s.cutoffMargin))}
                            </div>
                          )}
                        </td>
                      )}
                      {!isRoute && (
                        <td>
                          {!isFinish && (
                            <div className="stack">
                              <Num value={cp.water} width={48} unit="L" min={0} onChange={(v) => setCp(cp.id, { water: v })} />
                              <Num value={cp.carbs} width={48} unit="g" min={0} onChange={(v) => setCp(cp.id, { carbs: v })} />
                            </div>
                          )}
                        </td>
                      )}
                      <td>{!isFinish && <input type="text" className="wide" value={cp.notes} placeholder="frontale, sac…" onChange={(e) => setCp(cp.id, { notes: e.target.value })} />}</td>
                      <td>{!isFinish && <button className="ghost" onClick={() => set({ checkpoints: race.checkpoints.filter((c) => c.id !== cp.id) })} aria-label="Supprimer"><Trash2 /></button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          )}
          {!isRoute && <Hint>Eau / glucides : quantités à emporter depuis ce point jusqu'au ravito suivant.</Hint>}
        </Card>

        <Card title="Plan nutrition">
          <div className="scroll">
            <table className="table">
              <thead>
                <tr><th>Tronçon</th><th>Durée</th><th>T° moy.</th><th>Eau</th><th>Glucides</th><th>Sodium</th><th>À emporter</th></tr>
              </thead>
              <tbody>
                {legs.map((l) => (
                  <tr key={`${l.from}-${l.to}`}>
                    <td>{l.from} → {l.to}</td>
                    <td>{formatDuration(l.duration)}</td>
                    <td>{Math.round(l.temp)} °C</td>
                    <td>{l.water} L</td>
                    <td>{l.carbs} g</td>
                    <td>{l.sodium} mg</td>
                    <td>{bagText(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Hint>Calculé sur la durée prévue de chaque tronçon (du départ d'un ravito à l'arrivée au suivant).</Hint>
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
