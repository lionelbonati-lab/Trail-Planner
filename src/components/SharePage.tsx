import { Activity, Bell, BellOff, Check, Map as MapIcon, Mountain, Navigation, Radio, Route } from 'lucide-react'
import { navUrl, tripLegs } from '../lib/assist'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { ShareSnapshot } from '../lib/share'
import { formatClock, formatDuration } from '../lib/time'
import { estimatedDist, parseWatchPlan, watchStatus, type WatchReport } from '../lib/watchLive'

import type { MapPoint, Runner } from './ShareMap'

const ShareMap = lazy(() => import('./ShareMap'))

/** Un relevé de montre plus ancien que ceci n'est plus considéré comme « en direct ». */
const WATCH_FRESH_S = 3 * 3600

function signedMin(sec: number): string {
  const m = Math.round(sec / 60)
  return `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} min`
}

/** Page publique pour l'assistance : plan, fenêtres de passage et suivi en direct. */
export function SharePage({ shareId }: { shareId: string }) {
  const [snap, setSnap] = useState<ShareSnapshot | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<WatchReport | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    let unsub: (() => void) | undefined
    let cancelled = false
    import('../lib/cloud')
      .then((c) => {
        if (!cancelled) unsub = c.subscribeShare(shareId, setSnap, (e) => setError(e.message))
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [shareId])
  // Suivi envoyé par la montre, si cette course est sur la montre : avec le code montre long
  // ou le code court (8 chiffres) ; le relevé le plus récent l'emporte.
  const liveRef = snap?.liveRef ?? null
  const liveRefShort = snap?.liveRefShort ?? null
  useEffect(() => {
    const refs = [liveRef, liveRefShort].filter((r): r is string => !!r)
    if (!refs.length) return
    const latest = new Map<string, WatchReport | null>()
    const unsubs: (() => void)[] = []
    let cancelled = false
    import('../lib/cloud').then((c) => {
      if (cancelled) return
      for (const ref of refs) {
        unsubs.push(
          c.subscribeLive(ref, (r) => {
            latest.set(ref, r)
            const best = [...latest.values()].reduce<WatchReport | null>((a, b) => (b && (!a || b.t > a.t) ? b : a), null)
            setReport(best)
          }),
        )
      }
    })
    return () => {
      cancelled = true
      unsubs.forEach((u) => u())
    }
  }, [liveRef, liveRefShort])
  useEffect(() => {
    // Toutes les 15 s : la position estimée avance entre deux relevés de la montre.
    const id = setInterval(() => tick((x) => x + 1), 15000)
    return () => clearInterval(id)
  }, [])

  if (error) return <main><p className="warn">Lien indisponible : {error}</p></main>
  if (snap === undefined) return <main><p className="muted">Chargement…</p></main>
  if (snap === null) return <main><p className="warn">Ce lien n'existe plus.</p></main>

  return <ShareView snap={snap} report={report} shareId={shareId} />
}

/**
 * Lien Garmin LiveTrack reçu par e-mail au départ (envoi automatique de Garmin) : collé une fois
 * par l'assistance, gardé sur son téléphone. Le lien change à chaque activité.
 */
function LiveTrackBox({ shareId }: { shareId?: string }) {
  const key = `tp-livetrack-${shareId ?? 'local'}`
  const [link, setLink] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  })
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const store = (v: string | null) => {
    setLink(v)
    try {
      if (v) localStorage.setItem(key, v)
      else localStorage.removeItem(key)
    } catch {
      /* stockage indisponible : le lien reste le temps de la visite */
    }
  }
  const save = (e: React.FormEvent) => {
    e.preventDefault()
    const v = draft.trim().match(/https:\/\/\S+/)?.[0] ?? ''
    if (!/^https:\/\/([a-z0-9-]+\.)*garmin\.com\//i.test(v)) {
      setError('Colle le lien de l’e-mail LiveTrack de Garmin (il commence par https://livetrack.garmin.com/…).')
      return
    }
    setError(null)
    setDraft('')
    store(v)
  }
  return (
    <section className="livetrack">
      {link ? (
        <div className="row">
          <a className="button primary" href={link} target="_blank" rel="noreferrer"><Radio /> Ouvrir Garmin LiveTrack</a>
          <span className="muted small">position toutes les minutes environ, sur le site de Garmin</span>
          <button className="ghost" onClick={() => store(null)}>Changer de lien</button>
        </div>
      ) : (
        <details>
          <summary><Radio className="inline" /> Garmin LiveTrack : position toutes les minutes environ</summary>
          <p className="small">
            Si le coureur a activé l'envoi automatique de LiveTrack, Garmin t'envoie un e-mail à chaque départ. Colle ici le lien de
            cet e-mail : il restera sur ce téléphone.
          </p>
          <form className="row" onSubmit={save}>
            <input type="text" inputMode="url" autoComplete="off" placeholder="https://livetrack.garmin.com/…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Lien LiveTrack" />
            <button className="primary" type="submit">Enregistrer</button>
          </form>
          {error && <p className="warn-text">{error}</p>}
        </details>
      )}
    </section>
  )
}

/** Lecture / écriture sûres du stockage du téléphone (absent en navigation privée ou au rendu serveur). */
function readStore(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStore(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* stockage indisponible : le choix reste le temps de la visite */
  }
}

/** Réglage booléen gardé sur ce téléphone. */
function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    const s = readStore(key)
    return s === null ? initial : s === '1'
  })
  return [
    v,
    (next: boolean) => {
      setV(next)
      writeStore(key, next ? '1' : '0')
    },
  ]
}

/**
 * Points cochés par l'équipe pour son trajet, gardés sur ce téléphone : choix explicites par
 * point ; sans choix, un point est coché si l'assistance y est autorisée.
 */
function useTripChoices(shareId: string | undefined): [Record<string, boolean>, (id: string, on: boolean) => void] {
  const key = `tp-assist-${shareId ?? 'local'}`
  const [choices, setChoices] = useState<Record<string, boolean>>(() => {
    try {
      const v = JSON.parse(readStore(key) ?? '{}') as unknown
      // Ancien format : liste des points décochés.
      if (Array.isArray(v)) return Object.fromEntries(v.map((id) => [String(id), false]))
      return v && typeof v === 'object' ? (v as Record<string, boolean>) : {}
    } catch {
      return {}
    }
  })
  const set = (id: string, on: boolean) => {
    const next = { ...choices, [id]: on }
    setChoices(next)
    writeStore(key, JSON.stringify(next))
  }
  return [choices, set]
}

/** Notification système (via le service worker si possible : seule voie sur Android). */
async function showNotice(title: string, body: string, tag: string) {
  const opts = { body, tag, icon: './icon-192.png', badge: './icon-192.png', data: { url: location.href }, vibrate: [200, 100, 200] } as NotificationOptions
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, opts)
      return
    }
  } catch {
    /* repli ci-dessous */
  }
  try {
    new Notification(title, opts)
  } catch {
    /* notifications indisponibles */
  }
}

/**
 * Notifications au passage d'un point (passage réel : montre ou mode course), tant que la page
 * est ouverte. Les passages déjà connus à l'ouverture ne sont pas notifiés.
 */
function useCrossingAlerts(
  rows: ShareSnapshot['rows'],
  who: string,
  shareId: string | undefined,
  fmt: (iso: string | null) => string,
  /** Départ réel et départ prévu (ms) : l'écart au plan se compte depuis le vrai départ. */
  startMs: number,
  planStartMs: number,
) {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const [enabled, setEnabledFlag] = useStoredFlag(`tp-notify-${shareId ?? 'local'}`, false)
  const [permission, setPermission] = useState<string>(supported ? Notification.permission : 'unsupported')
  const passedKey = rows
    .filter((r) => r.actual)
    .map((r) => r.id)
    .join(',')
  useEffect(() => {
    const key = `tp-notified-${shareId ?? 'local'}`
    const passed = rows.filter((r) => r.actual)
    const stored = readStore(key)
    if (stored === null) {
      writeStore(key, JSON.stringify(passed.map((r) => r.id)))
      return
    }
    let seen: string[] = []
    try {
      seen = JSON.parse(stored) as string[]
    } catch {
      seen = []
    }
    const fresh = passed.filter((r) => !seen.includes(r.id))
    if (!fresh.length) return
    writeStore(key, JSON.stringify([...seen, ...fresh.map((r) => r.id)]))
    if (!enabled || !supported || Notification.permission !== 'granted') return
    for (const r of fresh) {
      const late = r.actual ? Math.round((Date.parse(r.actual) - startMs - (Date.parse(r.planned) - planStartMs)) / 60000) : 0
      const plan = late === 0 ? "à l'heure prévue" : `${late > 0 ? '+' : '−'}${Math.abs(late)} min sur le plan`
      void showNotice(`${who} · ${r.name}`, `Passé à ${fmt(r.actual)} · km ${(r.dist / 1000).toFixed(1).replace('.', ',')} · ${plan}`, `tp-${shareId ?? 'local'}-${r.id}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passedKey, enabled])
  const enable = async () => {
    if (!supported) return
    const p = await Notification.requestPermission()
    setPermission(p)
    setEnabledFlag(p === 'granted')
  }
  return { supported, permission, enabled: enabled && permission === 'granted', enable, disable: () => setEnabledFlag(false) }
}

/** Activation des notifications de passage. */
function NotifyBox({ alerts }: { alerts: ReturnType<typeof useCrossingAlerts> }) {
  if (!alerts.supported) {
    return <p className="muted small">Notifications non disponibles sur ce navigateur (sur iPhone : ajoute d'abord cette page à l'écran d'accueil).</p>
  }
  if (alerts.permission === 'denied') {
    return <p className="muted small"><BellOff className="inline" /> Notifications bloquées pour ce site : autorise-les dans les réglages du navigateur.</p>
  }
  return (
    <div className="notify-box row">
      {alerts.enabled ? (
        <>
          <span><Bell className="inline" /> Notification à chaque passage d'un point</span>
          <button className="ghost" onClick={alerts.disable}>Désactiver</button>
        </>
      ) : (
        <button onClick={() => void alerts.enable()}><Bell /> Me prévenir à chaque passage</button>
      )}
      <span className="muted small">Tant que cette page reste ouverte (même en arrière-plan), avec le délai des relevés de la montre.</span>
    </div>
  )
}

/** Affichage du lien assistance (séparé du chargement, pour pouvoir le tester). */
export function ShareView({
  snap: input,
  report,
  nowMs = Date.now(),
  shareId,
  initialTab,
}: {
  snap: ShareSnapshot
  report: WatchReport | null
  nowMs?: number
  shareId?: string
  /** Onglet affiché à l'ouverture (sinon le dernier choisi sur ce téléphone). */
  initialTab?: 'suivi' | 'trajets'
}) {
  const [choices, setChoice] = useTripChoices(shareId)
  const [tab, setTabState] = useState<'suivi' | 'trajets'>(() => initialTab ?? (readStore('tp-share-tab') === 'trajets' ? 'trajets' : 'suivi'))
  const setTab = (t: 'suivi' | 'trajets') => {
    setTabState(t)
    writeStore('tp-share-tab', t)
  }
  const [showMap, setShowMap] = useStoredFlag('tp-share-map', false)
  let snap = input
  const nowSec0 = nowMs / 1000
  // Départ libre : heures recalées sur le départ réel (montre, sinon mode course), ou sur
  // maintenant tant que le coureur n'est pas parti.
  const freshReport = report && nowSec0 - report.t < WATCH_FRESH_S ? report : null
  const freeStarted = !!(freshReport || snap.live)
  if (snap.freeStart) {
    const real = freshReport ? freshReport.s * 1000 : snap.live ? Date.parse(snap.live.startedAt) : Math.ceil(nowMs / 60000) * 60000
    const off = real - Date.parse(snap.start)
    if (Math.abs(off) >= 30000) {
      const shift = (iso: string | null) => (iso ? new Date(Date.parse(iso) + off).toISOString() : iso)
      snap = {
        ...snap,
        start: new Date(real).toISOString(),
        rows: snap.rows.map((r) => ({ ...r, planned: shift(r.planned)!, early: shift(r.early), late: shift(r.late), eta: shift(r.eta)! })),
      }
    }
  }
  const tz = snap.timeZone
  const clock = (iso: string | null, day = false) => (iso ? formatClock(new Date(iso), tz, day) : '')
  // Relevé de la montre : remplace passages et estimations quand il est récent.
  const plan = snap.w ? parseWatchPlan(snap.w) : null
  const nowSec = nowMs / 1000
  const watch = report && plan && nowSec - report.t < WATCH_FRESH_S ? watchStatus(report, plan, nowSec) : null
  if (watch && plan && plan.cps.length === snap.rows.length) {
    snap = {
      ...snap,
      rows: snap.rows.map((r, i) => ({
        ...r,
        actual: watch.passed.has(i) ? new Date(watch.passed.get(i)! * 1000).toISOString() : r.actual,
        eta: new Date(watch.etas[i] * 1000).toISOString(),
      })),
    }
  }
  const long = Date.parse(snap.rows[snap.rows.length - 1]?.planned ?? snap.start) - Date.parse(snap.start) > 20 * 3600000
  const lastDone = [...snap.rows].reverse().find((r) => r.actual)
  const next = snap.rows.find((r) => !r.actual)
  const elapsed = snap.live ? (nowMs - Date.parse(snap.live.startedAt)) / 1000 : null
  // Carte : position GPS de la montre (sinon sa distance le long du parcours), ou dernier passage saisi.
  const km = (d: number) => (d / 1000).toFixed(1).replace('.', ',')
  const estimate = watch && report && plan ? estimatedDist(report, plan, nowSec) : null
  const runner: Runner | null =
    watch && report
      ? {
          dist: watch.dist,
          lat: report.lat,
          lon: report.lon,
          label: `Dernier relevé : km ${km(watch.dist)} · il y a ${Math.max(0, Math.round(watch.age / 60))} min`,
          estimate: estimate !== null ? { dist: estimate, label: `Estimé maintenant : km ${km(estimate)}` } : null,
        }
      : snap.live && lastDone
        ? { dist: lastDone.dist, label: `Dernier passage : ${lastDone.name} à ${clock(lastDone.actual)}` }
        : null
  const planStartMs = Date.parse(snap.start)
  const startMs = watch && report ? report.s * 1000 : snap.live ? Date.parse(snap.live.startedAt) : planStartMs
  const alerts = useCrossingAlerts(snap.rows, snap.athleteName || 'Coureur', shareId, (iso) => clock(iso, long), startMs, planStartMs)
  const mapPoints: MapPoint[] = snap.rows.map((r) => ({
    dist: r.dist,
    kind: r.kind,
    done: !!r.actual,
    text: `${r.name} · km ${(r.dist / 1000).toFixed(1).replace('.', ',')} · ${r.actual ? `passé à ${clock(r.actual, long)}` : `prévu ${clock(r.planned, long)}`}`,
  }))

  return (
    <div className="app">
      <header className="topbar"><span className="brand"><Mountain className="inline" /> Trail Planner · Assistance</span></header>
      <main className="share">
        <h1>{snap.raceName}</h1>
        <p className="muted">
          {snap.athleteName} ·{' '}
          {snap.freeStart
            ? freeStarted
              ? `parti à ${formatClock(new Date(snap.start), tz)}`
              : 'départ libre (heures pour un départ maintenant)'
            : `départ ${formatClock(new Date(snap.start), tz, true)}`}{' '}
          · {(snap.totalDist / 1000).toFixed(1)} km, +{Math.round(snap.dPlus)} m
        </p>
        <div className="seg share-tabs" role="tablist" aria-label="Affichage">
          <button role="tab" aria-selected={tab === 'suivi'} className={tab === 'suivi' ? 'on' : ''} onClick={() => setTab('suivi')}>
            <Activity /> Suivi
          </button>
          <button role="tab" aria-selected={tab === 'trajets'} className={tab === 'trajets' ? 'on' : ''} onClick={() => setTab('trajets')}>
            <Route /> Trajets
          </button>
        </div>
        {tab === 'trajets' ? (
          <AssistTrip rows={snap.rows} choices={choices} onCheck={setChoice} clock={(iso) => clock(iso, long)} live={!!snap.live || !!watch} />
        ) : (
        <>
        <MiniProfile profile={snap.profile} rows={snap.rows} position={watch ? watch.dist : null} />
        {watch && report ? (
          <section className="live-hero">
            <div className="live-label">Montre · en course depuis</div>
            <div className="live-clock">{formatDuration(watch.elapsed)}</div>
            <div className={`live-delta ${watch.delta > 60 ? 'late' : 'early'}`}>
              km {(watch.dist / 1000).toFixed(1)} · {signedMin(watch.delta)} sur le plan
            </div>
            {estimate !== null && estimate > watch.dist + 50 && (
              <div className="live-sub">≈ km {km(estimate)} maintenant (estimé d'après son rythme, entre deux relevés)</div>
            )}
            {lastDone && <div className="live-sub">Dernier passage : {lastDone.name} à {clock(lastDone.actual)}</div>}
            {next && <div className="live-sub">Prochain : <strong>{next.name}</strong> vers {clock(next.eta, long)}</div>}
            <div className="live-sub">Arrivée estimée {formatClock(new Date(watch.finishEta * 1000), tz, long)}</div>
            <div className="live-sub small">
              Relevé de {formatClock(new Date(report.t * 1000), tz)} (il y a {Math.max(0, Math.round(watch.age / 60))} min)
              {report.bat !== undefined ? ` · batterie ${Math.round(report.bat)} %` : ''}
              {report.lat !== undefined && report.lon !== undefined && (
                <> · <a href={`https://www.openstreetmap.org/?mlat=${report.lat}&mlon=${report.lon}#map=15/${report.lat}/${report.lon}`} target="_blank" rel="noreferrer">voir sur la carte</a></>
              )}
            </div>
          </section>
        ) : snap.live ? (
          <section className="live-hero">
            <div className="live-label">En course depuis</div>
            <div className="live-clock">{elapsed !== null ? formatDuration(elapsed) : ''}</div>
            {lastDone && <div className="live-sub">Dernier passage : {lastDone.name} à {clock(lastDone.actual)}</div>}
            {next && <div className="live-sub">Prochain : <strong>{next.name}</strong> vers {clock(next.eta, long)}</div>}
          </section>
        ) : (
          <p className="hint">Le suivi en direct apparaîtra ici dès le départ.</p>
        )}
        <NotifyBox alerts={alerts} />
        <LiveTrackBox shareId={shareId} />
        {snap.route && snap.route.length >= 2 && (
          <>
            <label className="check map-toggle">
              <input type="checkbox" checked={showMap} onChange={(e) => setShowMap(e.target.checked)} /> <MapIcon className="inline" /> Carte en direct
            </label>
            {showMap && (
              <Suspense fallback={<div className="share-map share-map-loading" />}>
                <ShareMap route={snap.route} points={mapPoints} runner={runner} />
              </Suspense>
            )}
          </>
        )}
        <table className="table">
          <thead>
            <tr><th>Point</th><th>Km</th><th>Au plus tôt</th><th>Prévu</th><th>Au plus tard</th><th>Réel / estimé</th><th>Barrière</th></tr>
          </thead>
          <tbody>
            {snap.rows.map((r) => (
              <tr key={r.id} className={`${r.kind === 'ravito' ? 'kind-ravito' : ''} ${r.actual ? 'done' : ''}`}>
                <td>
                  {r.name}
                  {r.notes && <div className="muted small">{r.notes}</div>}
                  {r.lat !== undefined && r.lon !== undefined && (
                    <div>
                      <a className="nav-link" href={navUrl({ lat: r.lat, lon: r.lon })} target="_blank" rel="noreferrer">
                        <Navigation className="inline" /> Y aller{r.access ? ' (accès assistance)' : ''}
                      </a>
                    </div>
                  )}
                </td>
                <td>{(r.dist / 1000).toFixed(1)}</td>
                <td>{clock(r.early, long)}</td>
                <td><strong>{clock(r.planned, long)}</strong></td>
                <td>{clock(r.late, long)}</td>
                <td>{r.actual ? <strong><Check className="inline" /> {clock(r.actual, long)}</strong> : snap.live ? <span className="muted">~{clock(r.eta, long)}</span> : ''}</td>
                <td>{clock(r.cutoff, long)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
        )}
        <p className="hint">Mis à jour {formatClock(new Date(snap.updatedAt), tz, true)}. Cette page se met à jour toute seule.</p>
      </main>
    </div>
  )
}

/**
 * Trajets de l'assistance : tous les points du parcours, à cocher (coches gardées sur ce
 * téléphone ; ceux où l'assistance est autorisée le sont d'office), et itinéraire Google Maps
 * entre les points cochés pas encore passés.
 */
function AssistTrip({
  rows,
  choices,
  onCheck,
  clock,
  live,
}: {
  rows: ShareSnapshot['rows']
  choices: Record<string, boolean>
  onCheck: (id: string, on: boolean) => void
  clock: (iso: string | null) => string
  live: boolean
}) {
  const points = rows.filter((r) => r.lat !== undefined && r.lon !== undefined)
  if (!points.length) return <p className="hint">Les points de ce parcours n'ont pas encore de coordonnées : le coureur doit rouvrir son plan.</p>
  const checked = (r: (typeof rows)[number]) => !r.actual && (choices[r.id] ?? !!r.assist)
  const todo = points.filter(checked)
  const legs = tripLegs(todo.map((r) => ({ lat: r.lat!, lon: r.lon! })))
  return (
    <section className="assist-trip">
      <h3><Route className="inline" /> Trajet de l'assistance</h3>
      <p className="muted small">Coche les points où tu veux aller : ceux où l'assistance est autorisée le sont d'office.</p>
      <ul>
        {points.map((r) => {
          const done = !!r.actual
          return (
            <li key={r.id} className={done ? 'muted' : ''}>
              <label>
                <input type="checkbox" checked={checked(r)} disabled={done} onChange={(e) => onCheck(r.id, e.target.checked)} />
                <span>
                  <strong>{r.name}</strong> <span className="muted small">km {(r.dist / 1000).toFixed(1).replace('.', ',')}</span>
                  <br />
                  <span className="small">
                    {done ? `passé à ${clock(r.actual)}` : `${live ? 'estimé' : 'prévu'} ${clock(live ? r.eta : r.planned)}`}
                    {r.access ? ' · accès assistance' : ''}
                    {!r.assist && <span className="muted"> · assistance non prévue</span>}
                  </span>
                </span>
              </label>
              <a className="nav-link" href={navUrl({ lat: r.lat!, lon: r.lon! })} target="_blank" rel="noreferrer" aria-label={`Y aller : ${r.name}`}>
                <Navigation className="inline" /> Y aller
              </a>
            </li>
          )
        })}
      </ul>
      {legs.length === 0 ? (
        <p className="muted small">Coche au moins un point à venir pour préparer le trajet.</p>
      ) : (
        <div className="trip-links">
          {legs.map((l, i) => (
            <a key={l.url} className="button primary" href={l.url} target="_blank" rel="noreferrer">
              <Route />
              {legs.length === 1
                ? `Itinéraire Google Maps (${todo.length} point${todo.length > 1 ? 's' : ''})`
                : `Trajet ${i + 1} : ${i === 0 ? 'ma position' : todo[l.from - 1].name} → ${todo[l.to].name}`}
            </a>
          ))}
          <span className="muted small">
            Départ de ta position, puis les points cochés dans l'ordre de la course.
            {legs.length > 1 ? ' Google Maps sur téléphone accepte 3 étapes par trajet : chaque trajet repart du dernier point du précédent.' : ''}
          </span>
        </div>
      )}
    </section>
  )
}

function MiniProfile({ profile, rows, position }: { profile: [number, number][]; rows: ShareSnapshot['rows']; position: number | null }) {
  if (profile.length < 2) return null
  const W = 900
  const H = 120
  const total = profile[profile.length - 1][0] || 1
  const eles = profile.map((p) => p[1])
  const lo = Math.min(...eles)
  const hi = Math.max(...eles)
  const x = (d: number) => 8 + (d / total) * (W - 16)
  const y = (e: number) => H - 8 - ((e - lo) / (hi - lo || 1)) * (H - 24)
  const line = profile.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')
  const eleAt = (d: number) => profile.reduce((best, p) => (Math.abs(p[0] - d) < Math.abs(best[0] - d) ? p : best))[1]
  return (
    <svg className="profile" viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Profil du parcours">
      <path d={`${line}L${x(total)},${H - 8}L${x(0)},${H - 8}Z`} className="area" />
      <path d={line} className="line" />
      {rows.map((r) => (
        <circle key={r.id} cx={x(r.dist)} cy={y(eleAt(r.dist))} r={r.kind === 'ravito' ? 4 : 2.5} className={r.actual ? 'done-dot' : r.kind === 'ravito' ? 'ravito-dot' : 'cp-dot'} />
      ))}
      {position !== null && (
        <g className="me">
          <line x1={x(position)} x2={x(position)} y1={8} y2={H - 8} />
          <circle cx={x(position)} cy={y(eleAt(position))} r={6} />
        </g>
      )}
    </svg>
  )
}
