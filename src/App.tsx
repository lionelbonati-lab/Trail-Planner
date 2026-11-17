import type { User } from 'firebase/auth'
import {
  ArrowLeft,
  ChartLine,
  Cloud,
  CloudOff,
  Copy,
  Download,
  Flag,
  Gauge,
  LibraryBig,
  LogIn,
  LogOut,
  Mail,
  Mountain,
  RefreshCw,
  Spline,
  Trash2,
  User as UserIcon,
  Watch,
  Wheat,
  X,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityPanel } from './components/ActivityPanel'
import { AthletePanel } from './components/AthletePanel'
import { NutritionPanel } from './components/NutritionPanel'
import { WatchPanel } from './components/WatchPanel'
import { LiveMode } from './components/LiveMode'
import { computePlan, isFreeStart, scenarioWindows } from './lib/plan'
import { buildSnapshot, shareUrl } from './lib/share'
import { LibraryPanel } from './components/LibraryPanel'
import { RacePlan } from './components/RacePlan'
import { SessionsPanel } from './components/SessionsPanel'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete, normalizeRace } from './lib/defaults'
import { download } from './lib/exportGpx'
import { parseGpx } from './lib/gpx'
import { waypointCheckpoints } from './lib/splits'
import { withNewTrace } from './lib/routing'
import { epPayload } from './lib/endurancepro'
import { appCourses, appDocId, type AppCourse, watchList, watchProfile, watchRoute } from './lib/watch'
import type { DrawResult } from './components/RouteBuilder'
import { clearLocalData, hasLocalAthlete, localRaceCount, localStore, type Backup, type Store, type SyncStatus } from './lib/storage'

type Cloud = typeof import('./lib/cloud')
const RouteBuilder = lazy(() => import('./components/RouteBuilder'))

/** Marqueur local : une session était ouverte, on attend Firebase avant d'afficher les données. */
/** Copie dans le presse-papiers ; false si le navigateur la refuse. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const SIGNED_IN_KEY = 'tp.signedIn'
const wasSignedIn = () => {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === '1'
  } catch {
    return false
  }
}
const rememberSignedIn = (on: boolean) => {
  try {
    if (on) localStorage.setItem(SIGNED_IN_KEY, '1')
    else localStorage.removeItem(SIGNED_IN_KEY)
  } catch {
    /* stockage indisponible */
  }
}
import type { Athlete, Checkpoint, Race, RaceKind } from './lib/types'
import { reportCourse, watchStartMs, type WatchReport } from './lib/watchLive'
import { debriefPoints, debriefReport, debriefsToAnnounce, debriefsToNotify, signedGap, upsertLive, upsertWatch } from './lib/debrief'
import { debriefNotifyOn, notifiedDebriefs, rememberNotified, showNotice } from './lib/notify'
import { formatClock, formatDuration, zonedToUtc } from './lib/time'
import { DebriefPage } from './components/DebriefPage'

type Tab = 'races' | 'athlete' | 'nutrition' | 'cs' | 'analyse' | 'live' | 'parcours' | 'tracer' | 'montre' | 'debrief'

/** Onglets de la barre du haut. */
const NAV: { tab: Tab; label: string; Icon: typeof Flag }[] = [
  { tab: 'parcours', label: 'Parcours', Icon: LibraryBig },
  { tab: 'tracer', label: 'Tracer', Icon: Spline },
  { tab: 'athlete', label: 'Profil athlète', Icon: UserIcon },
  { tab: 'nutrition', label: 'Nutrition', Icon: Wheat },
  { tab: 'cs', label: 'Test VC', Icon: Gauge },
  { tab: 'analyse', label: 'Analyse', Icon: ChartLine },
  { tab: 'montre', label: 'Montre', Icon: Watch },
]

/** Mode course : passages copiés dans le debrief de la sortie (plan figé au premier passage). */
function withLiveDebrief(r: Race, athlete: Athlete): Race {
  if (!r.live) return r
  const next = upsertLive(r.debriefs ?? [], r.live, () => {
    const plan = computePlan(r, athlete)
    return plan ? debriefPoints(r, plan.sim) : []
  })
  return next ? { ...r, debriefs: next } : r
}

/**
 * Relevé de la montre pour la course qu'il concerne (parcours choisi dans l'appli montre, sinon la course
 * envoyée à la montre) : pris s'il date d'après l'envoi de la course à la montre (course sans id),
 * reste sur le parcours et a avancé (un passage ou 1 km). Null : rien à changer.
 */
function watchDebriefs(race: Race, athlete: Athlete, report: WatchReport): Race['debriefs'] | null {
  if (!reportCourse(report) && athlete.watchRaceAt && report.t * 1000 < Date.parse(athlete.watchRaceAt)) return null
  if (!report.p && report.d < 1000) return null
  const plan = computePlan(race, athlete)
  if (!plan || report.d > plan.track.totalDist + 1000) return null
  return upsertWatch(race.debriefs ?? [], report, () => debriefPoints(race, plan.sim))
}

function readHash(): { tab: Tab; raceId: string | null; debriefId: string | null } {
  const [hashTab, raceId, debriefId] = window.location.hash.replace(/^#\/?/, '').split('/')
  // Calculateur VC et Séances ne font plus qu'un onglet (Test VC) : les anciens liens y mènent.
  const tab = hashTab === 'seances' ? 'cs' : hashTab
  return {
    // Courses et parcours ne font plus qu'une page (Parcours) : les anciens liens « courses » y mènent.
    tab:
      tab === 'athlete' || tab === 'nutrition' || tab === 'cs' || tab === 'analyse' || tab === 'live' || tab === 'tracer' || tab === 'montre' || tab === 'debrief'
        ? tab
        : 'parcours',
    raceId: (tab === 'races' || tab === 'live' || tab === 'tracer' || tab === 'parcours' || tab === 'debrief') && raceId ? raceId : null,
    // Debrief d'une sortie : #/debrief/<parcours>/<debrief>.
    debriefId: tab === 'debrief' && debriefId ? debriefId : null,
  }
}

/**
 * Sauvegarde différée : regroupe les modifications rapides (saisie au clavier).
 * Les sauvegardes en attente sont envoyées immédiatement si la page est quittée.
 */
function useDebounced<T>(fn: (v: T) => void, delay = 600) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; value: T }>())
  useEffect(() => {
    const flush = () => {
      for (const [k, p] of pending.current) {
        clearTimeout(p.timer)
        pending.current.delete(k)
        fnRef.current(p.value)
      }
    }
    const onHide = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])
  return useCallback(
    (key: string, value: T) => {
      clearTimeout(pending.current.get(key)?.timer)
      const timer = setTimeout(() => {
        pending.current.delete(key)
        fnRef.current(value)
      }, delay)
      pending.current.set(key, { timer, value })
    },
    [delay],
  )
}

/** Garde la version la plus récente (les modifications locales en cours ne sont pas écrasées). */
const newer = (remote?: string, local?: string) => !local || (remote ?? '') > local

export default function App() {
  const [route, setRoute] = useState(readHash)
  const [user, setUser] = useState<User | null>(null)
  const [athlete, setAthlete] = useState<Athlete>(DEFAULT_ATHLETE)
  const [races, setRaces] = useState<Race[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)

  // Firebase est chargé en arrière-plan ; tant qu'il ne l'est pas, l'app fonctionne en local.
  const [cloud, setCloud] = useState<Cloud | null>(null)
  const [authReady, setAuthReady] = useState(() => !wasSignedIn())
  const store: Store = useMemo(() => (user && cloud ? cloud.cloudStore(user) : localStore), [user, cloud])

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    let unsub: (() => void) | undefined
    let cancelled = false
    import('./lib/cloud')
      .then((c) => {
        if (cancelled) return
        setCloud(c)
        // Retour depuis le lien de connexion reçu par e-mail.
        c.completeEmailLink().catch((e) => setError(`Connexion impossible : ${e.message}`))
        unsub = c.onUser((u) => {
          setUser(u)
          rememberSignedIn(!!u)
          setAuthReady(true)
        })
      })
      .catch(() => setAuthReady(true)) // hors ligne au premier chargement : mode local
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  useEffect(() => {
    if (!authReady) return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    setLoaded(false)
    setSync(null)
    ;(async () => {
      // Nouveau compte : profil par défaut au nom de la personne. Les données hors compte de
      // ce navigateur ne sont pas transférées d'office (appareil éventuellement partagé).
      if (store.kind === 'cloud' && user && (await store.isEmpty?.())) {
        const name = user.displayName || user.email?.split('@')[0] || 'Moi'
        await store.saveAthlete({ ...DEFAULT_ATHLETE, name, updatedAt: new Date().toISOString() })
      }
      const [a, r] = await Promise.all([store.loadAthlete(), store.listRaces()])
      if (cancelled) return
      setAthlete(a)
      setRaces(r)
      setLoaded(true)
      unsubscribe = store.subscribe?.({
        athlete: (remote) => setAthlete((local) => (newer(remote.updatedAt, local.updatedAt) ? remote : local)),
        raceUpsert: (remote) =>
          setRaces((all) => {
            const local = all.find((x) => x.id === remote.id)
            if (!local) return [remote, ...all]
            return newer(remote.updatedAt, local.updatedAt) ? all.map((x) => (x.id === remote.id ? remote : x)) : all
          }),
        raceRemoved: (id) => setRaces((all) => all.filter((x) => x.id !== id)),
        status: setSync,
        error: (e) => setError(`Synchronisation : ${e.message}`),
      })
    })().catch((e) => setError(`Chargement impossible : ${e.message ?? e}`))
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [store, authReady])

  const report = (e: unknown) => setError(`Sauvegarde impossible : ${(e as Error).message ?? e}`)
  const saveAthleteLater = useDebounced<Athlete>((a) => store.saveAthlete(a).catch(report))
  const saveRaceLater = useDebounced<Race>((r) => store.saveRace(r).catch(report))

  const updateAthlete = (a: Athlete) => {
    const next = { ...a, updatedAt: new Date().toISOString() }
    setAthlete(next)
    saveAthleteLater('athlete', next)
  }
  /** Modifie le profil à partir de sa dernière version (pour les réponses asynchrones). */
  const patchAthlete = (patch: Partial<Athlete>) =>
    setAthlete((prev) => {
      const next = { ...prev, ...patch, updatedAt: new Date().toISOString() }
      saveAthleteLater('athlete', next)
      return next
    })
  const updateRace = (r: Race) => {
    const next = { ...withLiveDebrief(r, athlete), updatedAt: new Date().toISOString() }
    setRaces((all) => all.map((x) => (x.id === r.id ? next : x)))
    saveRaceLater(r.id, next)
  }

  const go = (tab: Tab, raceId?: string) => {
    window.location.hash = raceId ? `/${tab}/${raceId}` : `/${tab}`
  }

  const addGpx = async (files: FileList | null, kind: RaceKind = 'race') => {
    if (!files) return
    for (const f of Array.from(files)) {
      const text = await f.text()
      try {
        const t = parseGpx(text)
        const name = t.name && t.name !== 'Course' ? t.name : f.name.replace(/\.gpx$/i, '')
        // Waypoints du GPX : points de passage (ravito, barrière, point inter ou repère selon le cas).
        const r = { ...newRace(name, text), kind, checkpoints: waypointCheckpoints(t, kind) }
        setRaces((all) => [r, ...all])
        await store.saveRace(r)
        go('parcours', r.id)
      } catch (e) {
        setError(`${f.name} : ${(e as Error).message}`)
      }
    }
  }

  // Bibliothèque : ajout d'une copie comme parcours (ou d'une course créée depuis un parcours).
  const addRaceCopy = async (r: Race, open = true) => {
    setRaces((all) => [r, ...all])
    await store.saveRace(r).catch(report)
    if (open) go('parcours', r.id)
  }
  // Traceur : nouveau parcours, ou tracé modifié d'une course existante.
  const saveDrawing = async (d: DrawResult, edited: Race | null) => {
    // Points de repère du tracé → points de passage (« Point inter »), sauf s'il y en a déjà un à moins de 100 m.
    const markPoints = (existing: Checkpoint[]): Checkpoint[] =>
      d.marks
        .filter((m) => !existing.some((c) => Math.abs(c.dist - m.dist) < 100))
        .map((m) => ({ id: crypto.randomUUID(), dist: m.dist, name: m.name, kind: 'split', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }))
    if (edited) {
      const next = { ...withNewTrace(edited, d.gpxText, d.drawn, d.total), name: d.name }
      // Points de course placés dans le traceur : ils remplacent ceux recalés sur le nouveau tracé.
      const base = d.checkpoints ?? next.checkpoints
      const checkpoints = [...base, ...markPoints(base)].sort((a, b) => a.dist - b.dist)
      updateRace({ ...next, checkpoints, ...(d.zones ? { zones: d.zones } : {}) })
      go('parcours', edited.id)
    } else {
      const placed = d.checkpoints ?? []
      await addRaceCopy({ ...newRace(d.name, d.gpxText), kind: d.kind, drawn: d.drawn, zones: d.zones ?? [], checkpoints: [...placed, ...markPoints(placed)].sort((a, b) => a.dist - b.dist) })
    }
  }
  const removeRace = async (id: string) => {
    setRaces((all) => all.filter((r) => r.id !== id))
    await store.deleteRace(id).catch(report)
  }

  const duplicateRace = async (r: Race) => {
    const copy = { ...structuredClone(r), id: crypto.randomUUID(), name: `${r.name} (copie)`, updatedAt: new Date().toISOString() }
    setRaces((all) => [copy, ...all])
    await store.saveRace(copy).catch(report)
  }

  const exportBackup = () => {
    const backup: Backup = { version: 1, athlete, races }
    download(`trail-planner-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup), 'application/json')
  }

  const importBackup = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    try {
      const b = JSON.parse(await f.text()) as Backup
      const a = normalizeAthlete(b.athlete)
      const rs = (b.races ?? []).map(normalizeRace)
      setAthlete(a)
      await store.saveAthlete(a)
      for (const r of rs) await store.saveRace(r)
      setRaces(await store.listRaces())
    } catch (e) {
      setError(`Import impossible : ${(e as Error).message}`)
    }
  }

  const [localCount, setLocalCount] = useState(() => localRaceCount())
  const pushLocalToCloud = async () => {
    try {
      const rs = await localStore.listRaces()
      for (const r of rs) await store.saveRace(r)
      // Le profil local ne remplace celui du compte que s'il n'a jamais été modifié.
      if (hasLocalAthlete() && !athlete.history.length && athlete.cs === DEFAULT_ATHLETE.cs) {
        const a = { ...(await localStore.loadAthlete()), updatedAt: new Date().toISOString() }
        await store.saveAthlete(a)
        setAthlete(a)
      }
      setRaces(await store.listRaces())
      clearLocalData()
      setLocalCount(0)
    } catch (e) {
      setError(`Import impossible : ${(e as Error).message}`)
    }
  }
  const discardLocal = () => {
    if (!confirm('Effacer les courses enregistrées dans ce navigateur sans compte ?')) return
    clearLocalData()
    setLocalCount(0)
  }
  const deleteAccount = async () => {
    if (!user || !cloud || store.kind !== 'cloud') return
    if (!confirm('Supprimer ton compte et toutes tes données (profil, courses) ? Cette action est définitive.')) return
    try {
      // Documents lus par la montre (code montre, code EndurancePro) : supprimés avec le compte.
      for (const id of [athlete.epCode, athlete.watchId]) if (id) await cloud.deleteShare(id).catch(() => undefined)
      if ((await cloud.deleteAccount(user)) === 'data-only') {
        alert('Tes données sont supprimées. Pour supprimer aussi le compte, reconnecte-toi puis recommence.')
      }
      rememberSignedIn(false)
      await cloud.signOutAndClear()
    } catch (e) {
      setError(`Suppression impossible : ${(e as Error).message}`)
    }
  }

  const current = route.raceId ? races.find((r) => r.id === route.raceId) : null

  // Départ libre d'une course sur la montre, sans le mode course du téléphone : départ réel donné par
  // la montre, pour que les heures prévues du plan restent fixes pendant toute l'activité.
  const [watchReport, setWatchReport] = useState<WatchReport | null>(null)
  // Relevés suivis dès qu'une course est sur la montre (ou que l'appli montre a ses parcours) : départ
  // réel (ci-dessous) et passages figés dans le debrief de la sortie.
  const watchRefs = user && (athlete.watchRaceId || athlete.appSync) ? [athlete.watchId, athlete.epCode].filter((r): r is string => !!r).join(',') : ''
  // Course du dernier relevé : parcours choisi dans l'appli montre, sinon la course envoyée à la montre.
  const reportRaceId = (watchReport && reportCourse(watchReport)) ?? athlete.watchRaceId ?? null
  useEffect(() => {
    setWatchReport(null)
    if (!watchRefs || !cloud) return
    const latest = new Map<string, WatchReport | null>()
    const unsubs = watchRefs.split(',').map((ref) =>
      cloud.subscribeLive(ref, (r) => {
        latest.set(ref, r)
        setWatchReport([...latest.values()].reduce<WatchReport | null>((a, b) => (b && (!a || b.t > a.t) ? b : a), null))
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [watchRefs, cloud])
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!watchReport) return
    const id = setInterval(() => setNowSec(Date.now() / 1000), 60000)
    return () => clearInterval(id)
  }, [watchReport])
  const watchStart =
    watchRefs && current && isFreeStart(current) && !current.live && reportRaceId === current.id
      ? watchStartMs(watchReport, Math.max(nowSec, watchReport?.t ?? 0))
      : null

  // Debrief prêt : sortie terminée proposée en haut de l'appli (quel que soit l'onglet) et, à
  // l'arrivée, notification du téléphone si elle est activée (une fois par sortie et par appareil).
  const [clockMs, setClockMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setClockMs(Date.now()), 60000)
    return () => clearInterval(id)
  }, [])
  const announced = debriefsToAnnounce(races, clockMs)[0]
  const announcedRace = announced ? races.find((r) => r.id === announced.raceId) : undefined
  useEffect(() => {
    if (!loaded) return
    const due = debriefsToNotify(races, notifiedDebriefs(), clockMs)
    if (!due.length) return
    rememberNotified(due.map((x) => x.debrief.id))
    if (!debriefNotifyOn()) return
    for (const { raceId, debrief, report } of due) {
      const race = races.find((r) => r.id === raceId)
      if (!race || report.finish === null || report.total === null) continue
      const body = `Arrivée à ${formatClock(new Date(report.finish), race.env.timeZone)} en ${formatDuration(report.total)} (${signedGap(report.total - report.plannedTotal)} sur le plan). Touche pour voir le debrief.`
      void showNotice(`Debrief prêt · ${race.name}`, body, `tp-debrief-${debrief.id}`, `${location.origin}${location.pathname}#/debrief/${raceId}/${debrief.id}`)
    }
  }, [races, clockMs, loaded])

  // Appli montre : parcours choisi dans sa liste au lieu de la course envoyée à la montre. Il devient la
  // course sur la montre dès son premier relevé (départ réel, direct, debrief, lien permanent), sauf si
  // une course a été envoyée à la montre depuis ce relevé. Envoi daté du départ de cette activité, pour
  // que ses relevés comptent.
  useEffect(() => {
    if (!watchReport || !loaded || !athlete.watchId) return
    const id = reportCourse(watchReport)
    if (!id || id === athlete.watchRaceId || !races.some((r) => r.id === id)) return
    if (athlete.watchRaceAt && watchReport.t * 1000 < Date.parse(athlete.watchRaceAt)) return
    patchAthlete({ watchRaceId: id, watchRaceAt: new Date((watchReport.s - 60) * 1000).toISOString() })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un relevé est traité à son arrivée (et au chargement)
  }, [watchReport, loaded, races, athlete])

  // Debrief : passages relevés par la montre copiés dans la sortie (un relevé n'est traité qu'une fois).
  const debriefDone = useRef('')
  useEffect(() => {
    if (!watchReport || !loaded) return
    const race = races.find((r) => r.id === (reportCourse(watchReport) ?? athlete.watchRaceId))
    const key = `${race?.id}|${watchReport.s}|${watchReport.t}|${watchReport.p ?? ''}`
    if (!race || debriefDone.current === key) return
    debriefDone.current = key
    const next = watchDebriefs(race, athlete, watchReport)
    if (next) updateRace({ ...race, debriefs: next })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un relevé est traité à son arrivée (et au chargement)
  }, [watchReport, loaded, races, athlete])

  // --- Liens d'assistance -----------------------------------------------------
  const lastShared = useRef(new Map<string, string>())
  // Liste des parcours de l'appli montre Trail Planner Companion (champ wl du document du code montre).
  const [appWl, setAppWl] = useState('')
  const appWlRef = useRef('')
  appWlRef.current = appWl
  const publish = useCallback(
    async (race: Race, a: Athlete, shareId: string) => {
      if (!user || !cloud) return
      const plan = computePlan(race, a)
      if (!plan) return
      const snap = buildSnapshot(user.uid, race, a, plan.track, plan.sim, scenarioWindows(plan.track, a, plan.opts))
      // Document du code montre : réglages EndurancePro en plus du plan (si la synchro est active), et
      // profil et tracé fins pour l'appli montre Trail Planner Companion.
      if (shareId === a.watchId || shareId === a.epCode) {
        if (a.epSync) snap.ep = epPayload(a, race)
        const wp = watchProfile(plan.track.points)
        if (wp) snap.wp = wp
        const wr = watchRoute(plan.track.points)
        if (wr) snap.wr = wr
        if (a.appSync && appWlRef.current) snap.wl = appWlRef.current
      }
      const key = JSON.stringify({ ...snap, updatedAt: '' })
      if (lastShared.current.get(shareId) === key) return
      await cloud.publishShare(shareId, snap)
      lastShared.current.set(shareId, key)
    },
    [user, cloud],
  )
  const shareRace = async (race: Race): Promise<string | null> => {
    const shareId = race.shareId ?? crypto.randomUUID()
    try {
      await publish(race, athlete, shareId)
      if (!race.shareId) updateRace({ ...race, shareId })
      return shareId
    } catch (e) {
      const msg = (e as Error).message
      setError(
        /permission/i.test(msg)
          ? "Partage refusé par Firebase : mets à jour les règles Firestore (contenu du fichier firestore.rules)."
          : `Partage impossible : ${msg}`,
      )
      return null
    }
  }
  // Montre : un document partagé fixe par compte (code saisi une fois sur la montre),
  // qui contient la course choisie.
  const sendToWatch = (race: Race) => {
    // Sans tirets : plus simple à saisir dans les réglages Garmin.
    const watchId = athlete.watchId ?? crypto.randomUUID().replace(/-/g, '')
    const next = { ...athlete, watchId, watchRaceId: race.id, watchRaceAt: athlete.watchRaceId === race.id && athlete.watchRaceAt ? athlete.watchRaceAt : new Date().toISOString() }
    updateAthlete(next)
    publish(race, next, watchId).catch((e) => setError(`Envoi à la montre impossible : ${(e as Error).message}`))
  }
  // Message bref (confirmation d'une action), effacé au bout de quelques secondes.
  const [notice, setNotice] = useState<{ text: string; link?: string; tab?: Tab } | null>(null)
  const flash = (text: string, extra: { link?: string; tab?: Tab } = {}) => setNotice({ text, ...extra })
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), notice.link ? 15000 : 6000)
    return () => clearTimeout(id)
  }, [notice])
  /** Liste des courses et des parcours : ⌚ met la course ou le parcours sur la montre. */
  const putOnWatch = (race: Race) => {
    if (!user) return alert('Connecte-toi pour envoyer ton plan à la montre.')
    sendToWatch(race)
    flash(`« ${race.name} » est sur ta montre (le champ Trail Planner la récupère tout seul).`, { tab: 'montre' })
  }
  /** Liste des courses et des parcours : lien assistance copié (créé au besoin). */
  const copyShareLink = async (race: Race) => {
    if (!user) return alert('Connecte-toi pour partager ton plan avec ton assistance.')
    // Lien existant : copié tout de suite (dans le geste de l'utilisateur, exigé par certains navigateurs).
    const id = race.shareId ?? (await shareRace(race))
    if (!id) return
    const url = shareUrl(id)
    if (await copyText(url)) flash(`Lien assistance de « ${race.name} » copié.`)
    else flash(`Lien assistance de « ${race.name} » :`, { link: url })
  }
  const unshareRace = async (race: Race) => {
    if (!race.shareId) return
    await cloud?.deleteShare(race.shareId).catch(() => undefined)
    lastShared.current.delete(race.shareId)
    updateRace({ ...race, shareId: null })
  }
  // Les liens existants suivent le plan et le direct (envoi groupé toutes les 5 s au plus).
  useEffect(() => {
    if (!user) return
    const id = setTimeout(() => {
      for (const r of races) if (r.shareId) publish(r, athlete, r.shareId).catch(() => undefined)
      const onWatch = races.find((r) => r.id === athlete.watchRaceId)
      // Liste des parcours de l'appli montre, si sa synchronisation est active.
      const wl = athlete.appSync && appWl ? appWl : undefined
      if (onWatch && athlete.watchId) publish(onWatch, athlete, athlete.watchId).catch(() => undefined)
      else if ((athlete.epSync || wl) && athlete.watchId && cloud) {
        // Pas de course sur la montre : seulement les réglages EndurancePro (et la liste de l'appli).
        const ep = athlete.epSync ? epPayload(athlete, null) : ''
        const key = `ep:${ep}|wl:${wl ?? ''}|${athlete.epCode ?? ''}`
        if (lastShared.current.get(athlete.watchId) !== key) {
          const watchId = athlete.watchId
          cloud
            .publishWatchProfile(watchId, user.uid, ep, wl, athlete.epCode)
            .then(() => lastShared.current.set(watchId, key))
            .catch((e) => setError(`Synchronisation EndurancePro impossible : ${(e as Error).message}`))
        }
      }
      // Code court saisi sur la montre : plan de la course envoyée (champ Trail Planner) et réglages
      // EndurancePro, sinon réglages EndurancePro seulement.
      if (onWatch && athlete.epCode) publish(onWatch, athlete, athlete.epCode).catch(() => undefined)
      else if ((athlete.epSync || wl) && athlete.epCode && cloud) {
        const ep = athlete.epSync ? epPayload(athlete, onWatch ?? null) : ''
        const key = `ep:${ep}|wl:${wl ?? ''}`
        const code = athlete.epCode
        if (lastShared.current.get(code) !== key) {
          cloud
            .publishWatchProfile(code, user.uid, ep, wl)
            .then(() => lastShared.current.set(code, key))
            .catch((e) => setError(`Synchronisation EndurancePro impossible : ${(e as Error).message}`))
        }
      }
    }, 5000)
    return () => clearTimeout(id)
  }, [races, athlete, user, publish, cloud, appWl])
  // Appli montre Trail Planner Companion (bêta) : plan de chaque course à venir et de chaque parcours de
  // la bibliothèque (documents <code>-<id> : lien assistance complet, lu par le lien permanent du
  // coureur, avec le profil et le tracé fins pour la montre), et leur liste pour l'écran de démarrage
  // (champ wl du document du code montre, publié par l'effet ci-dessus). Un parcours n'est recalculé que
  // s'il a changé (ou le profil de l'athlète).
  const appPublished = useRef(new Map<string, { race: Race; athlete: Athlete; entry: AppCourse }>())
  useEffect(() => {
    if (!user || !cloud || !athlete.appSync) return
    const codes = [athlete.watchId, athlete.epCode].filter((c): c is string => !!c)
    if (!codes.length) return
    const id = setTimeout(() => {
      const entries: AppCourse[] = []
      for (const r of appCourses(races, new Date().toLocaleDateString('sv'))) {
        const prev = appPublished.current.get(r.id)
        if (prev && prev.race === r && prev.athlete === athlete) {
          entries.push(prev.entry)
          continue
        }
        const plan = computePlan(r, athlete)
        if (!plan) continue
        const start = zonedToUtc(r.env.start, r.env.timeZone).getTime() / 1000
        const entry: AppCourse = {
          id: r.id,
          kind: r.kind,
          name: r.name,
          start: r.kind === 'race' && Number.isFinite(start) ? start : 0,
          dist: plan.track.totalDist,
          dPlus: plan.track.dPlus,
        }
        const snap = buildSnapshot(user.uid, r, athlete, plan.track, plan.sim, scenarioWindows(plan.track, athlete, plan.opts))
        const wp = watchProfile(plan.track.points)
        const wr = watchRoute(plan.track.points)
        const data = { ...snap, ...(wp ? { wp } : {}), ...(wr ? { wr } : {}) }
        appPublished.current.set(r.id, { race: r, athlete, entry })
        entries.push(entry)
        for (const code of codes) cloud.publishShare(appDocId(code, r.id), data).catch(() => appPublished.current.delete(r.id))
      }
      setAppWl(watchList(entries, athlete.watchRaceId))
    }, 5000)
    return () => clearTimeout(id)
  }, [races, athlete, user, cloud])
  // Montre utilisée (course envoyée ou synchro EndurancePro) : réserve le code court à 8 chiffres.
  const reservingEp = useRef(false)
  useEffect(() => {
    if (!user || !cloud || !(athlete.epSync || athlete.watchId) || athlete.epCode || reservingEp.current) return
    reservingEp.current = true
    cloud
      .reserveEpCode(user.uid)
      .then((epCode) => patchAthlete({ epCode }))
      .catch((e) => setError(`Code montre EndurancePro impossible à créer : ${(e as Error).message}`))
      .finally(() => {
        reservingEp.current = false
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, cloud, athlete.epSync, athlete.watchId, athlete.epCode])


  // Page Parcours : courses et parcours d'entraînement dans une seule liste.
  const libraryEl = (
    <LibraryPanel
      races={races}
      athlete={athlete}
      onOpen={(id) => go('parcours', id)}
      onAdd={(f) => addGpx(f, 'route')}
      onDraw={() => go('tracer')}
      onUpdate={updateRace}
      onDelete={removeRace}
      onDuplicate={duplicateRace}
      onWatchId={athlete.watchId ? athlete.watchRaceId ?? null : null}
      onWatch={putOnWatch}
      onShare={copyShareLink}
      backup={{
        onExport: exportBackup,
        onImport: importBackup,
        storeKind: store.kind,
        localCount: store.kind === 'cloud' ? localCount : 0,
        onPushLocal: pushLocalToCloud,
        onDiscardLocal: discardLocal,
      }}
    />
  )

  return (
    <div className="app">
      <header className="topbar no-print">
        <a className="brand" href="#/races"><Mountain className="inline" /> Trail Planner</a>
        <nav>
          {/* Sur téléphone, seules les icônes s'affichent (libellés masqués, gardés pour les lecteurs d'écran). */}
          {NAV.map(({ tab, label, Icon }) => (
            <button key={tab} className={route.tab === tab ? 'on' : ''} onClick={() => go(tab)} title={label} aria-label={label} aria-current={route.tab === tab ? 'page' : undefined}>
              <Icon /> <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        <InstallButton />
        {sync && <SyncBadge status={sync} />}
        <AuthBox user={user} cloud={cloud} onDeleteAccount={deleteAccount} />
      </header>

      <main>
        {error && (
          <div className="banner error no-print">
            {error} <button className="ghost" onClick={() => setError(null)} aria-label="Fermer"><X /></button>
          </div>
        )}
        {announced && announcedRace && route.tab !== 'debrief' && !(route.tab === 'parcours' && current?.id === announcedRace.id) && (() => {
          const rep = debriefReport(announced.debrief)
          const day = new Intl.DateTimeFormat('fr-FR', { timeZone: announcedRace.env.timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(rep.start))
          return (
            <div className="banner info no-print debrief-banner-global" role="status">
              <span>
                <Flag className="inline" /> <strong>{announcedRace.name}</strong> : sortie du {day} terminée
                {rep.total !== null ? ` en ${formatDuration(rep.total)} (${signedGap(rep.total - rep.plannedTotal)} sur le plan)` : ''}. Ton debrief est prêt.
              </span>
              <span className="row tight">
                <button className="primary" onClick={() => go('debrief', `${announcedRace.id}/${announced.debrief.id}`)}><Flag /> Voir le debrief</button>
                <button
                  className="ghost"
                  onClick={() => updateRace({ ...announcedRace, debriefs: (announcedRace.debriefs ?? []).map((d) => (d.id === announced.debrief.id ? { ...d, seen: true } : d)) })}
                >
                  Ignorer
                </button>
              </span>
            </div>
          )
        })()}
        {notice && (
          <div className="banner info notice no-print" role="status">
            <span>
              {notice.text}
              {notice.link && <> <a href={notice.link} target="_blank" rel="noreferrer">{notice.link}</a></>}
            </span>
            <span className="row tight">
              {notice.link && <button onClick={() => copyText(notice.link!).then((ok) => ok && flash('Lien copié.'))}><Copy /> Copier</button>}
              {notice.tab && <button onClick={() => { go(notice.tab!); setNotice(null) }}><Watch /> Onglet Montre</button>}
              <button className="ghost" onClick={() => setNotice(null)} aria-label="Fermer"><X /></button>
            </span>
          </div>
        )}
        {!loaded ? (
          <p className="muted">Chargement…</p>
        ) : route.tab === 'tracer' ? (
          <Suspense fallback={<p className="muted">Chargement de la carte…</p>}>
            <RouteBuilder
              key={current?.id ?? 'new'}
              athlete={athlete}
              race={current ?? null}
              onSave={(d) => saveDrawing(d, current ?? null)}
              onBack={() => (current ? go('parcours', current.id) : window.history.length > 1 ? window.history.back() : go('parcours'))}
            />
          </Suspense>
        ) : route.tab === 'athlete' ? (
          <AthletePanel athlete={athlete} onChange={updateAthlete} />
        ) : route.tab === 'nutrition' ? (
          <NutritionPanel athlete={athlete} onChange={updateAthlete} />
        ) : route.tab === 'montre' ? (
          <WatchPanel
            athlete={athlete}
            onChange={updateAthlete}
            signedIn={!!user}
            onWatch={races.find((r) => r.id === athlete.watchRaceId) ?? null}
            onOpen={(r) => go('parcours', r.id)}
          />
        ) : route.tab === 'cs' ? (
          <SessionsPanel athlete={athlete} races={races} onChange={updateAthlete} />
        ) : route.tab === 'parcours' && !current ? (
          libraryEl
        ) : route.tab === 'analyse' ? (
          <ActivityPanel athlete={athlete} races={races} onChange={updateAthlete} />
        ) : route.tab === 'debrief' && current ? (
          <DebriefPage
            key={`${current.id}/${route.debriefId}`}
            race={current}
            athlete={athlete}
            debriefId={route.debriefId}
            onChange={updateRace}
            onAthleteChange={updateAthlete}
            onBack={() => go('parcours', current.id)}
          />
        ) : route.tab === 'live' && current ? (
          <LiveMode key={current.id} race={current} athlete={athlete} onChange={updateRace} onExit={() => go('parcours', current.id)} />
        ) : current ? (
          <>
            <div className="crumbs no-print">
              <a href="#/parcours"><ArrowLeft className="inline" /> Tous les parcours</a>
              {current.kind === 'race' && <span className="badge">Course</span>}
            </div>
            <RacePlan
              key={current.id}
              race={current}
              athlete={athlete}
              watchStart={watchStart}
              onChange={updateRace}
              onAthleteChange={updateAthlete}
              onRedraw={() => go('tracer', current.id)}
              onDebrief={(id) => go('debrief', `${current.id}/${id}`)}
              share={{
                available: !!user,
                url: current.shareId ? shareUrl(current.shareId) : null,
                create: async () => {
                  await shareRace(current)
                },
                remove: () => unshareRace(current),
              }}
              watch={{
                available: !!user,
                active: athlete.watchRaceId === current.id && !!athlete.watchId,
                activate: () => sendToWatch(current),
              }}
            />
          </>
        ) : (
          libraryEl
        )}
      </main>
    </div>
  )
}

function AuthBox({ user, cloud, onDeleteAccount }: { user: User | null; cloud: Cloud | null; onDeleteAccount: () => void }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [open, setOpen] = useState(false)
  if (!cloud) return <span className="auth muted">Stockage local</span>
  if (!cloud.auth) return <span className="auth muted" title="Configure Firebase pour synchroniser">Stockage local</span>
  if (user) {
    return (
      <details className="auth account">
        <summary title={user.email ?? ''}><UserIcon className="inline" /> {user.displayName || user.email}</summary>
        <div className="account-menu">
          <div className="muted">{user.email}</div>
          <button onClick={() => { rememberSignedIn(false); cloud.signOutAndClear() }}><LogOut /> Se déconnecter</button>
          <button className="ghost danger" onClick={onDeleteAccount}><Trash2 /> Supprimer mon compte…</button>
        </div>
      </details>
    )
  }
  if (sent) return <span className="auth muted">Lien envoyé, vérifie tes e-mails.</span>
  return (
    <span className="auth">
      <button onClick={() => cloud.signInGoogle().catch((e) => alert(e.message))}>
        <LogIn /> Connexion Google
      </button>
      {open ? (
        <form
          className="auth"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await cloud.sendEmailLink(email)
              setSent(true)
            } catch (err) {
              alert((err as Error).message)
            }
          }}
        >
          <input type="email" placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit"><Mail /> Recevoir un lien</button>
        </form>
      ) : (
        <button className="ghost" onClick={() => setOpen(true)}><Mail /> par e-mail</button>
      )}
    </span>
  )
}

const SYNC_LABELS: Record<SyncStatus, { text: string; title: string; Icon: typeof Cloud }> = {
  synced: { text: 'Synchronisé', title: 'Toutes les modifications sont enregistrées dans ton compte', Icon: Cloud },
  pending: { text: 'Envoi…', title: 'Modifications en cours d\'envoi', Icon: RefreshCw },
  offline: { text: 'Hors ligne', title: 'Modifications gardées sur cet appareil, envoyées au retour du réseau', Icon: CloudOff },
}

function SyncBadge({ status }: { status: SyncStatus }) {
  const l = SYNC_LABELS[status]
  return (
    <span className={`sync sync-${status}`} title={l.title}>
      <l.Icon className="inline" /> {l.text}
    </span>
  )
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Bouton « Installer » : invite native (Chrome, Edge, Android) ou explication pour iPhone/iPad. */
function InstallButton() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null)
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvt(e as InstallPromptEvent)
    }
    const onInstalled = () => setEvt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  if (standalone) return null
  if (evt) {
    return (
      <button className="install" onClick={async () => { await evt.prompt(); await evt.userChoice; setEvt(null) }}>
        <Download /> Installer l'app
      </button>
    )
  }
  if (ios) {
    return (
      <button className="install ghost" onClick={() => alert("Dans Safari : touche Partager (carré avec flèche), puis « Sur l'écran d'accueil ».")}>
        <Download /> Installer l'app
      </button>
    )
  }
  return null
}
