import type { User } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AthletePanel } from './components/AthletePanel'
import { CsCalculator } from './components/CsCalculator'
import { RacePlan } from './components/RacePlan'
import { Card, Hint } from './components/ui'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete, normalizeRace } from './lib/defaults'
import { download } from './lib/exportGpx'
import { parseGpx } from './lib/gpx'
import { cloudStore, localStore, supabase, type Backup, type Store } from './lib/storage'
import type { Athlete, Race } from './lib/types'

type Tab = 'races' | 'athlete' | 'cs'

function readHash(): { tab: Tab; raceId: string | null } {
  const [tab, raceId] = window.location.hash.replace(/^#\/?/, '').split('/')
  return {
    tab: tab === 'athlete' || tab === 'cs' ? tab : 'races',
    raceId: tab === 'races' && raceId ? raceId : null,
  }
}

/** Sauvegarde différée : regroupe les modifications rapides (saisie au clavier). */
function useDebounced<T>(fn: (v: T) => void, delay = 600) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  return useCallback(
    (key: string, v: T) => {
      clearTimeout(timers.current.get(key))
      timers.current.set(key, setTimeout(() => fn(v), delay))
    },
    [fn, delay],
  )
}

export default function App() {
  const [route, setRoute] = useState(readHash)
  const [user, setUser] = useState<User | null>(null)
  const [athlete, setAthlete] = useState<Athlete>(DEFAULT_ATHLETE)
  const [races, setRaces] = useState<Race[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const store: Store = useMemo(() => (supabase && user ? cloudStore(supabase, user) : localStore), [user])

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    Promise.all([store.loadAthlete(), store.listRaces()])
      .then(([a, r]) => {
        if (cancelled) return
        setAthlete(a)
        setRaces(r)
        setLoaded(true)
      })
      .catch((e) => setError(`Chargement impossible : ${e.message ?? e}`))
    return () => {
      cancelled = true
    }
  }, [store])

  const report = (e: unknown) => setError(`Sauvegarde impossible : ${(e as Error).message ?? e}`)
  const saveAthleteLater = useDebounced<Athlete>((a) => store.saveAthlete(a).catch(report))
  const saveRaceLater = useDebounced<Race>((r) => store.saveRace(r).catch(report))

  const updateAthlete = (a: Athlete) => {
    setAthlete(a)
    saveAthleteLater('athlete', a)
  }
  const updateRace = (r: Race) => {
    const next = { ...r, updatedAt: new Date().toISOString() }
    setRaces((all) => all.map((x) => (x.id === r.id ? next : x)))
    saveRaceLater(r.id, next)
  }

  const go = (tab: Tab, raceId?: string) => {
    window.location.hash = raceId ? `/${tab}/${raceId}` : `/${tab}`
  }

  const addGpx = async (files: FileList | null) => {
    if (!files) return
    for (const f of Array.from(files)) {
      const text = await f.text()
      try {
        const t = parseGpx(text)
        const name = t.name && t.name !== 'Course' ? t.name : f.name.replace(/\.gpx$/i, '')
        const r = newRace(name, text)
        setRaces((all) => [r, ...all])
        await store.saveRace(r)
        go('races', r.id)
      } catch (e) {
        setError(`${f.name} : ${(e as Error).message}`)
      }
    }
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

  const pushLocalToCloud = async () => {
    const a = await localStore.loadAthlete()
    const rs = await localStore.listRaces()
    await store.saveAthlete(a)
    for (const r of rs) await store.saveRace(r)
    setAthlete(a)
    setRaces(await store.listRaces())
  }

  const current = route.raceId ? races.find((r) => r.id === route.raceId) : null

  return (
    <div className="app">
      <header className="topbar no-print">
        <a className="brand" href="#/races">⛰ Trail Planner</a>
        <nav>
          <button className={route.tab === 'races' ? 'on' : ''} onClick={() => go('races')}>Courses</button>
          <button className={route.tab === 'athlete' ? 'on' : ''} onClick={() => go('athlete')}>Profil athlète</button>
          <button className={route.tab === 'cs' ? 'on' : ''} onClick={() => go('cs')}>Calculateur VC</button>
        </nav>
        <AuthBox user={user} />
      </header>

      <main>
        {error && (
          <div className="banner error no-print">
            {error} <button className="ghost" onClick={() => setError(null)}>✕</button>
          </div>
        )}
        {!loaded ? (
          <p className="muted">Chargement…</p>
        ) : route.tab === 'athlete' ? (
          <AthletePanel athlete={athlete} onChange={updateAthlete} />
        ) : route.tab === 'cs' ? (
          <CsCalculator athlete={athlete} onChange={updateAthlete} />
        ) : current ? (
          <>
            <div className="crumbs no-print"><a href="#/races">← Toutes les courses</a></div>
            <RacePlan race={current} athlete={athlete} onChange={updateRace} onAthleteChange={updateAthlete} />
          </>
        ) : (
          <RaceList
            races={races}
            onOpen={(id) => go('races', id)}
            onAdd={addGpx}
            onDelete={deleteRace}
            onDuplicate={duplicateRace}
            onExport={exportBackup}
            onImport={importBackup}
            storeKind={store.kind}
            onPushLocal={store.kind === 'cloud' ? pushLocalToCloud : undefined}
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
  onDelete: (id: string) => void
  onDuplicate: (r: Race) => void
  onExport: () => void
  onImport: (f: FileList | null) => void
  storeKind: 'local' | 'cloud'
  onPushLocal?: () => void
}) {
  const sorted = [...props.races].sort((a, b) => a.env.start.localeCompare(b.env.start))
  return (
    <div className="grid">
      <Card
        title="Mes courses"
        actions={
          <label className="button primary">
            + Importer un GPX
            <input type="file" accept=".gpx,application/gpx+xml" multiple hidden onChange={(e) => { props.onAdd(e.target.files); e.target.value = '' }} />
          </label>
        }
      >
        {sorted.length === 0 ? (
          <div className="empty">
            <p>Importe le fichier .gpx d'une course pour commencer ton plan.</p>
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
          <button onClick={props.onExport}>Exporter (JSON)</button>
          <label className="button">
            Importer (JSON)
            <input type="file" accept=".json,application/json" hidden onChange={(e) => { props.onImport(e.target.files); e.target.value = '' }} />
          </label>
          {props.onPushLocal && <button onClick={props.onPushLocal}>Envoyer les données de ce navigateur vers mon compte</button>}
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
        <button className="ghost" onClick={() => onDuplicate(race)} title="Dupliquer (ex. tester une autre stratégie)">⧉</button>
        <button className="ghost" onClick={() => onDelete(race.id)} title="Supprimer">✕</button>
      </td>
    </tr>
  )
}

function AuthBox({ user }: { user: User | null }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  if (!supabase) return <span className="auth muted" title="Configure Supabase pour synchroniser">Stockage local</span>
  if (user) {
    return (
      <span className="auth">
        {user.email}
        <button className="ghost" onClick={() => supabase!.auth.signOut()}>Déconnexion</button>
      </span>
    )
  }
  if (sent) return <span className="auth muted">Lien envoyé, vérifie tes e-mails.</span>
  return (
    <form
      className="auth"
      onSubmit={async (e) => {
        e.preventDefault()
        const { error } = await supabase!.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        })
        if (error) alert(error.message)
        else setSent(true)
      }}
    >
      <input type="email" placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit">Connexion</button>
    </form>
  )
}

