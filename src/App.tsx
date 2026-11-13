import type { User } from 'firebase/auth'
import {
  ArrowLeft,
  ChartLine,
  Cloud,
  CloudOff,
  Copy,
  Download,
  FileDown,
  FileUp,
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
  Upload,
  User as UserIcon,
  X,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityPanel } from './components/ActivityPanel'
import { AthletePanel } from './components/AthletePanel'
import { LiveMode } from './components/LiveMode'
import { computePlan, scenarioWindows } from './lib/plan'
import { buildSnapshot, shareUrl } from './lib/share'
import { LibraryPanel } from './components/LibraryPanel'
import { RacePlan } from './components/RacePlan'
import { planSession, toRoute } from './lib/library'
import { SessionsPanel } from './components/SessionsPanel'
import { Card, Hint } from './components/ui'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete, normalizeRace } from './lib/defaults'
import { download } from './lib/exportGpx'
import { parseGpx } from './lib/gpx'
import { withNewTrace } from './lib/routing'
import { epPayload } from './lib/endurancepro'
import type { DrawResult } from './components/RouteBuilder'
import { clearLocalData, hasLocalAthlete, localRaceCount, localStore, type Backup, type Store, type SyncStatus } from './lib/storage'

type Cloud = typeof import('./lib/cloud')
const RouteBuilder = lazy(() => import('./components/RouteBuilder'))

/** Marqueur local : une session était ouverte, on attend Firebase avant d'afficher les données. */
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

type Tab = 'races' | 'athlete' | 'cs' | 'analyse' | 'live' | 'parcours' | 'tracer'

function readHash(): { tab: Tab; raceId: string | null } {
  const [hashTab, raceId] = window.location.hash.replace(/^#\/?/, '').split('/')
  // Calculateur VC et Séances ne font plus qu'un onglet (Test VC) : les anciens liens y mènent.
  const tab = hashTab === 'seances' ? 'cs' : hashTab
  return {
    tab: tab === 'athlete' || tab === 'cs' || tab === 'analyse' || tab === 'live' || tab === 'parcours' || tab === 'tracer' ? tab : 'races',
    raceId: (tab === 'races' || tab === 'live' || tab === 'tracer') && raceId ? raceId : null,
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
    const next = { ...r, updatedAt: new Date().toISOString() }
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
        const r = { ...newRace(name, text), kind }
        setRaces((all) => [r, ...all])
        await store.saveRace(r)
        go('races', r.id)
      } catch (e) {
        setError(`${f.name} : ${(e as Error).message}`)
      }
    }
  }

  // Bibliothèque : ajout d'une copie comme parcours modèle, et séances datées créées depuis un parcours.
  const addRaceCopy = async (r: Race, open = true) => {
    setRaces((all) => [r, ...all])
    await store.saveRace(r).catch(report)
    if (open) go('races', r.id)
  }
  // Traceur : nouveau parcours, ou tracé modifié d'une course existante.
  const saveDrawing = async (d: DrawResult, edited: Race | null) => {
    // Points de repère du tracé → points de passage (« Repère »), sauf s'il y en a déjà un à moins de 100 m.
    const markPoints = (existing: Checkpoint[]): Checkpoint[] =>
      d.marks
        .filter((m) => !existing.some((c) => Math.abs(c.dist - m.dist) < 100))
        .map((m) => ({ id: crypto.randomUUID(), dist: m.dist, name: m.name, kind: 'info', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }))
    if (edited) {
      const next = { ...withNewTrace(edited, d.gpxText, d.drawn, d.total), name: d.name }
      const checkpoints = [...next.checkpoints, ...markPoints(next.checkpoints)].sort((a, b) => a.dist - b.dist)
      updateRace({ ...next, checkpoints, ...(d.zones ? { zones: d.zones } : {}) })
      go('races', edited.id)
    } else await addRaceCopy({ ...newRace(d.name, d.gpxText), kind: d.kind, drawn: d.drawn, zones: d.zones ?? [], checkpoints: markPoints([]) })
  }
  const removeRace = async (id: string) => {
    setRaces((all) => all.filter((r) => r.id !== id))
    await store.deleteRace(id).catch(report)
  }

  const deleteRace = async (id: string) => {
    if (!confirm('Supprimer cette course ?')) return
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

  // --- Liens d'assistance -----------------------------------------------------
  const lastShared = useRef(new Map<string, string>())
  const publish = useCallback(
    async (race: Race, a: Athlete, shareId: string) => {
      if (!user || !cloud) return
      const plan = computePlan(race, a)
      if (!plan) return
      const snap = buildSnapshot(user.uid, race, a, plan.track, plan.sim, scenarioWindows(plan.track, a, plan.opts))
      // Document du code montre : réglages EndurancePro en plus du plan (si la synchro est active).
      if (a.epSync && (shareId === a.watchId || shareId === a.epCode)) snap.ep = epPayload(a, race)
      const key = JSON.stringify({ ...snap, updatedAt: '' })
      if (lastShared.current.get(shareId) === key) return
      await cloud.publishShare(shareId, snap)
      lastShared.current.set(shareId, key)
    },
    [user, cloud],
  )
  const shareRace = async (race: Race) => {
    const shareId = race.shareId ?? crypto.randomUUID()
    try {
      await publish(race, athlete, shareId)
      if (!race.shareId) updateRace({ ...race, shareId })
    } catch (e) {
      const msg = (e as Error).message
      setError(
        /permission/i.test(msg)
          ? "Partage refusé par Firebase : mets à jour les règles Firestore (contenu du fichier firestore.rules)."
          : `Partage impossible : ${msg}`,
      )
    }
  }
  // Montre : un document partagé fixe par compte (code saisi une fois sur la montre),
  // qui contient la course choisie.
  const sendToWatch = (race: Race) => {
    // Sans tirets : plus simple à saisir dans les réglages Garmin.
    const watchId = athlete.watchId ?? crypto.randomUUID().replace(/-/g, '')
    const next = { ...athlete, watchId, watchRaceId: race.id }
    updateAthlete(next)
    publish(race, next, watchId).catch((e) => setError(`Envoi à la montre impossible : ${(e as Error).message}`))
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
      if (onWatch && athlete.watchId) publish(onWatch, athlete, athlete.watchId).catch(() => undefined)
      else if (athlete.epSync && athlete.watchId && cloud) {
        // Pas de course sur la montre : seulement les réglages EndurancePro.
        const ep = epPayload(athlete, null)
        const key = `ep:${ep}`
        if (lastShared.current.get(athlete.watchId) !== key) {
          const watchId = athlete.watchId
          cloud
            .publishWatchProfile(watchId, user.uid, ep)
            .then(() => lastShared.current.set(watchId, key))
            .catch((e) => setError(`Synchronisation EndurancePro impossible : ${(e as Error).message}`))
        }
      }
      // Code court saisi sur la montre : plan de la course envoyée (champ Trail Planner) et réglages
      // EndurancePro, sinon réglages EndurancePro seulement.
      if (onWatch && athlete.epCode) publish(onWatch, athlete, athlete.epCode).catch(() => undefined)
      else if (athlete.epSync && athlete.epCode && cloud) {
        const ep = epPayload(athlete, onWatch ?? null)
        const key = `ep:${ep}`
        const code = athlete.epCode
        if (lastShared.current.get(code) !== key) {
          cloud
            .publishWatchProfile(code, user.uid, ep)
            .then(() => lastShared.current.set(code, key))
            .catch((e) => setError(`Synchronisation EndurancePro impossible : ${(e as Error).message}`))
        }
      }
    }, 5000)
    return () => clearTimeout(id)
  }, [races, athlete, user, publish, cloud])
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

  return (
    <div className="app">
      <header className="topbar no-print">
        <a className="brand" href="#/races"><Mountain className="inline" /> Trail Planner</a>
        <nav>
          <button className={route.tab === 'races' ? 'on' : ''} onClick={() => go('races')}><Flag /> Courses</button>
          <button className={route.tab === 'athlete' ? 'on' : ''} onClick={() => go('athlete')}><UserIcon /> Profil athlète</button>
          <button className={route.tab === 'parcours' ? 'on' : ''} onClick={() => go('parcours')}><LibraryBig /> Parcours</button>
          <button className={route.tab === 'tracer' ? 'on' : ''} onClick={() => go('tracer')}><Spline /> Tracer</button>
          <button className={route.tab === 'cs' ? 'on' : ''} onClick={() => go('cs')}><Gauge /> Test VC</button>
          <button className={route.tab === 'analyse' ? 'on' : ''} onClick={() => go('analyse')}><ChartLine /> Analyse</button>
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
        {!loaded ? (
          <p className="muted">Chargement…</p>
        ) : route.tab === 'tracer' ? (
          <Suspense fallback={<p className="muted">Chargement de la carte…</p>}>
            <RouteBuilder
              key={current?.id ?? 'new'}
              athlete={athlete}
              race={current ?? null}
              onSave={(d) => saveDrawing(d, current ?? null)}
            />
          </Suspense>
        ) : route.tab === 'athlete' ? (
          <AthletePanel
            athlete={athlete}
            onChange={updateAthlete}
            garmin={{ signedIn: !!user, onWatch: races.find((r) => r.id === athlete.watchRaceId) ?? null }}
          />
        ) : route.tab === 'cs' ? (
          <SessionsPanel athlete={athlete} onChange={updateAthlete} />
        ) : route.tab === 'parcours' ? (
          <LibraryPanel
            races={races}
            athlete={athlete}
            onOpen={(id) => go('races', id)}
            onAdd={(f) => addGpx(f, 'route')}
            onDraw={() => go('tracer')}
            onUpdate={updateRace}
            onDelete={removeRace}
            onPlan={(r, start) => addRaceCopy(planSession(r, start))}
          />
        ) : route.tab === 'analyse' ? (
          <ActivityPanel athlete={athlete} races={races} onChange={updateAthlete} />
        ) : route.tab === 'live' && current ? (
          <LiveMode race={current} athlete={athlete} onChange={updateRace} onExit={() => go('races', current.id)} />
        ) : current ? (
          <>
            <div className="crumbs no-print">
              {current.kind === 'race' ? (
                <a href="#/races"><ArrowLeft className="inline" /> Toutes les courses</a>
              ) : (
                <a href="#/parcours"><ArrowLeft className="inline" /> Bibliothèque de parcours</a>
              )}
              {current.kind === 'route' && <span className="badge">Parcours modèle</span>}
              {current.kind === 'session' && <span className="badge">Séance d'entraînement</span>}
            </div>
            <RacePlan
              race={current}
              athlete={athlete}
              onChange={updateRace}
              onAthleteChange={updateAthlete}
              onLive={() => go('live', current.id)}
              onRedraw={() => go('tracer', current.id)}
              library={{
                kind: current.kind,
                addToLibrary: () => addRaceCopy(toRoute(current)),
                planSession: (start: string) => addRaceCopy(planSession(current, start)),
              }}
              share={{
                available: !!user,
                url: current.shareId ? shareUrl(current.shareId) : null,
                create: () => shareRace(current),
                remove: () => unshareRace(current),
              }}
              watch={{
                available: !!user,
                code: athlete.watchId ?? null,
                shortCode: athlete.epCode ?? null,
                active: athlete.watchRaceId === current.id && !!athlete.watchId,
                activate: () => sendToWatch(current),
              }}
            />
          </>
        ) : (
          <RaceList
            races={races.filter((r) => r.kind === 'race')}
            onOpen={(id) => go('races', id)}
            onAdd={addGpx}
            onDraw={() => go('tracer')}
            onDelete={deleteRace}
            onDuplicate={duplicateRace}
            onExport={exportBackup}
            onImport={importBackup}
            storeKind={store.kind}
            localCount={store.kind === 'cloud' ? localCount : 0}
            onPushLocal={pushLocalToCloud}
            onDiscardLocal={discardLocal}
          />
        )}
      </main>
    </div>
  )
}

function RaceList(props: {
  races: Race[]
  onOpen: (id: string) => void
  onAdd: (f: FileList | null) => void
  onDraw: () => void
  onDelete: (id: string) => void
  onDuplicate: (r: Race) => void
  onExport: () => void
  onImport: (f: FileList | null) => void
  storeKind: 'local' | 'cloud'
  localCount: number
  onPushLocal: () => void
  onDiscardLocal: () => void
}) {
  const sorted = [...props.races].sort((a, b) => a.env.start.localeCompare(b.env.start))
  return (
    <div className="grid">
      {props.localCount > 0 && (
        <div className="banner info">
          <span>
            Ce navigateur contient {props.localCount} course{props.localCount > 1 ? 's' : ''} enregistrée
            {props.localCount > 1 ? 's' : ''} sans compte.
          </span>
          <span className="row tight">
            <button className="primary" onClick={props.onPushLocal}>Les ajouter à mon compte</button>
            <button className="ghost" onClick={props.onDiscardLocal}>Les effacer</button>
          </span>
        </div>
      )}
      <Card
        title="Mes courses"
        actions={
          <>
            <button onClick={props.onDraw} title="Dessine le parcours sur la carte"><Spline /> Tracer sur la carte</button>
            <label className="button primary">
              <Upload /> Importer un GPX
              <input type="file" accept=".gpx,application/gpx+xml" multiple hidden onChange={(e) => { props.onAdd(e.target.files); e.target.value = '' }} />
            </label>
          </>
        }
      >
        {sorted.length === 0 ? (
          <div className="empty">
            <p>Importe le fichier .gpx d'une course, ou trace-la sur la carte, pour commencer ton plan.</p>
            <Hint>Renseigne d'abord ton profil (VC, VAM, durabilité) : tous les temps en découlent.</Hint>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Course</th><th>Départ</th><th>Distance</th><th>D+</th><th>Points</th><th /></tr>
            </thead>
            <tbody>
              {sorted.map((r) => <RaceRow key={r.id} race={r} {...props} />)}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Sauvegarde">
        <p className="muted">
          Données stockées {props.storeKind === 'cloud' ? 'dans ton compte (synchronisées)' : 'dans ce navigateur uniquement'}.
        </p>
        <div className="row">
          <button onClick={props.onExport}><FileDown /> Exporter (JSON)</button>
          <label className="button">
            <FileUp /> Importer (JSON)
            <input type="file" accept=".json,application/json" hidden onChange={(e) => { props.onImport(e.target.files); e.target.value = '' }} />
          </label>
        </div>
      </Card>
    </div>
  )
}

function RaceRow({ race, onOpen, onDelete, onDuplicate }: { race: Race; onOpen: (id: string) => void; onDelete: (id: string) => void; onDuplicate: (r: Race) => void }) {
  const info = useMemo(() => {
    try {
      const t = parseGpx(race.gpxText, race.smoothing)
      return { dist: t.totalDist, dPlus: t.dPlus }
    } catch {
      return null
    }
  }, [race.gpxText, race.smoothing])
  return (
    <tr className="clickable" onClick={() => onOpen(race.id)}>
      <td><strong>{race.name}</strong></td>
      <td>{race.env.start.replace('T', ' ')}</td>
      <td>{info ? `${(info.dist / 1000).toFixed(1)} km` : '—'}</td>
      <td>{info ? `${Math.round(info.dPlus)} m` : '—'}</td>
      <td>{race.checkpoints.length}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <button className="ghost" onClick={() => onDuplicate(race)} title="Dupliquer (ex. tester une autre stratégie)" aria-label="Dupliquer"><Copy /></button>
        <button className="ghost" onClick={() => onDelete(race.id)} title="Supprimer" aria-label="Supprimer"><Trash2 /></button>
      </td>
    </tr>
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
