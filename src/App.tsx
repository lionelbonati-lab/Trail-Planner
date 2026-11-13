import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  deleteUser,
  reauthenticateWithPopup,
  type User,
} from 'firebase/auth'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityPanel } from './components/ActivityPanel'
import { AthletePanel } from './components/AthletePanel'
import { CsCalculator } from './components/CsCalculator'
import { RacePlan } from './components/RacePlan'
import { Card, Hint } from './components/ui'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete, normalizeRace } from './lib/defaults'
import { download } from './lib/exportGpx'
import { parseGpx } from './lib/gpx'
import { auth, clearLocalData, cloudStore, hasLocalAthlete, localRaceCount, localStore, signOutAndClear, type Backup, type Store, type SyncStatus } from './lib/storage'
import type { Athlete, Race } from './lib/types'

type Tab = 'races' | 'athlete' | 'cs' | 'analyse'

function readHash(): { tab: Tab; raceId: string | null } {
  const [tab, raceId] = window.location.hash.replace(/^#\/?/, '').split('/')
  return {
    tab: tab === 'athlete' || tab === 'cs' || tab === 'analyse' ? tab : 'races',
    raceId: tab === 'races' && raceId ? raceId : null,
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

  const store: Store = useMemo(() => (user ? cloudStore(user) : localStore), [user])

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!auth) return
    const a = auth
    // Retour depuis le lien de connexion reçu par e-mail.
    if (isSignInWithEmailLink(a, window.location.href)) {
      const email = localStorage.getItem('tp.emailForSignIn') ?? prompt('Confirme ton e-mail') ?? ''
      signInWithEmailLink(a, email, window.location.href)
        .then(() => {
          localStorage.removeItem('tp.emailForSignIn')
          window.history.replaceState(null, '', window.location.pathname + '#/races')
        })
        .catch((e) => setError(`Connexion impossible : ${e.message}`))
    }
    return onAuthStateChanged(a, setUser)
  }, [])

  useEffect(() => {
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
  }, [store])

  const report = (e: unknown) => setError(`Sauvegarde impossible : ${(e as Error).message ?? e}`)
  const saveAthleteLater = useDebounced<Athlete>((a) => store.saveAthlete(a).catch(report))
  const saveRaceLater = useDebounced<Race>((r) => store.saveRace(r).catch(report))

  const updateAthlete = (a: Athlete) => {
    const next = { ...a, updatedAt: new Date().toISOString() }
    setAthlete(next)
    saveAthleteLater('athlete', next)
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
    if (!user || store.kind !== 'cloud') return
    if (!confirm('Supprimer ton compte et toutes tes données (profil, courses) ? Cette action est définitive.')) return
    try {
      await store.deleteAll?.()
      try {
        await deleteUser(user)
      } catch (e) {
        if ((e as { code?: string }).code !== 'auth/requires-recent-login') throw e
        // Firebase exige une connexion récente pour supprimer le compte.
        if (user.providerData.some((p) => p.providerId === 'google.com')) {
          await reauthenticateWithPopup(user, new GoogleAuthProvider())
          await deleteUser(user)
        } else {
          alert('Tes données sont supprimées. Pour supprimer aussi le compte, reconnecte-toi puis recommence.')
        }
      }
      await signOutAndClear()
    } catch (e) {
      setError(`Suppression impossible : ${(e as Error).message}`)
    }
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
          <button className={route.tab === 'analyse' ? 'on' : ''} onClick={() => go('analyse')}>Analyse</button>
        </nav>
        <InstallButton />
        {sync && <SyncBadge status={sync} />}
        <AuthBox user={user} onDeleteAccount={deleteAccount} />
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
        ) : route.tab === 'analyse' ? (
          <ActivityPanel athlete={athlete} races={races} onChange={updateAthlete} />
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

function AuthBox({ user, onDeleteAccount }: { user: User | null; onDeleteAccount: () => void }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [open, setOpen] = useState(false)
  if (!auth) return <span className="auth muted" title="Configure Firebase pour synchroniser">Stockage local</span>
  const a = auth
  if (user) {
    return (
      <details className="auth account">
        <summary title={user.email ?? ''}>{user.displayName || user.email}</summary>
        <div className="account-menu">
          <div className="muted">{user.email}</div>
          <button onClick={() => signOutAndClear()}>Se déconnecter</button>
          <button className="ghost danger" onClick={onDeleteAccount}>Supprimer mon compte…</button>
        </div>
      </details>
    )
  }
  if (sent) return <span className="auth muted">Lien envoyé, vérifie tes e-mails.</span>
  return (
    <span className="auth">
      <button onClick={() => signInWithPopup(a, new GoogleAuthProvider()).catch((e) => alert(e.message))}>
        Connexion Google
      </button>
      {open ? (
        <form
          className="auth"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await sendSignInLinkToEmail(a, email, {
                url: window.location.origin + window.location.pathname,
                handleCodeInApp: true,
              })
              localStorage.setItem('tp.emailForSignIn', email)
              setSent(true)
            } catch (err) {
              alert((err as Error).message)
            }
          }}
        >
          <input type="email" placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit">Recevoir un lien</button>
        </form>
      ) : (
        <button className="ghost" onClick={() => setOpen(true)}>par e-mail</button>
      )}
    </span>
  )
}

const SYNC_LABELS: Record<SyncStatus, { text: string; title: string }> = {
  synced: { text: '☁ Synchronisé', title: 'Toutes les modifications sont enregistrées dans ton compte' },
  pending: { text: '⟳ Envoi…', title: 'Modifications en cours d\'envoi' },
  offline: { text: '⚠ Hors ligne', title: 'Modifications gardées sur cet appareil, envoyées au retour du réseau' },
}

function SyncBadge({ status }: { status: SyncStatus }) {
  const l = SYNC_LABELS[status]
  return (
    <span className={`sync sync-${status}`} title={l.title}>
      {l.text}
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
        ⬇ Installer l'app
      </button>
    )
  }
  if (ios) {
    return (
      <button className="install ghost" onClick={() => alert("Dans Safari : touche Partager (carré avec flèche), puis « Sur l'écran d'accueil ».")}>
        ⬇ Installer l'app
      </button>
    )
  }
  return null
}
