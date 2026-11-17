import { CHECKPOINT_LABELS, isRavitoKind } from '../lib/splits'
import { Activity, Bell, BellOff, Check, Flag, Hourglass, Info, Map as MapIcon, MapPin, Mountain, Navigation, Radio, Route, Tent, Utensils } from 'lucide-react'
import { navUrl, tripLegs } from '../lib/assist'
import { lazy, Suspense, useEffect, useState } from 'react'
import { timeAtDist, type ShareSnapshot } from '../lib/share'
import { formatClock, formatDuration } from '../lib/time'
import { estimatedDist, parseWatchPlan, plannedAtWatch, watchStartMs, watchStatus, type WatchReport } from '../lib/watchLive'

import type { MapPoint, Runner } from './ShareMap'
import { CourseProfile } from './CourseProfile'

const ShareMap = lazy(() => import('./ShareMap'))

/** Un relevé de montre plus ancien que ceci n'est plus considéré comme « en direct ». */
const WATCH_FRESH_S = 3 * 3600

/** Icône du type de point (arrivée à part). */
function KindIcon({ kind, finish }: { kind: string; finish?: boolean }) {
  const label = finish ? 'Arrivée' : (CHECKPOINT_LABELS as Record<string, string>)[kind] ?? 'Point'
  const Icon = finish ? Flag : kind === 'ravito' ? Utensils : kind === 'base' ? Tent : kind === 'cutoff' ? Hourglass : kind === 'info' ? Info : MapPin
  return (
    <span className={`kind-icon kind-${finish ? 'finish' : kind}`} title={label} aria-label={label} role="img">
      <Icon />
    </span>
  )
}

/** Au-delà de cette distance après un ravito (m), le coureur en est reparti : 300 m pour une base de vie. */
const awayM = (kind: string) => (kind === 'base' ? 300 : 150)

/** Durée (ms) en « 42 min » ou « 1 h 05 ». */
function minText(ms: number): string {
  const m = Math.round(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`
}

/**
 * Temps passé aux ravitos (ms) : ravitos quittés (départ noté) et ravito en cours ; arrêts prévus de ces
 * mêmes ravitos. Null si aucun ne compte encore.
 */
function ravitoTotals(rows: ShareSnapshot['rows'], at: ShareSnapshot['rows'][number] | undefined, nowMs: number): { spent: number; planned: number } | null {
  let spent = 0
  let planned = 0
  let n = 0
  for (const r of rows) {
    if (!isRavitoKind(r.kind) || !r.actual) continue
    const end = r.left ? Date.parse(r.left) : r === at ? nowMs : null
    if (end === null) continue
    spent += Math.max(0, end - Date.parse(r.actual))
    planned += r.stopMin * 60000
    n++
  }
  return n ? { spent, planned } : null
}

/** Temps au ravito : arrêt prévu, et réel une fois reparti (ou en cours, s'il y est). */
function StopInfo({ row, at, sinceMin }: { row: ShareSnapshot['rows'][number]; at: boolean; sinceMin: number }) {
  const planned = Math.round(row.stopMin)
  if (at) {
    return (
      <div className={`stop-info at ${planned > 0 && sinceMin > planned ? 'over' : ''}`}>
        Au ravito depuis {sinceMin} min{planned > 0 ? ` · arrêt prévu ${planned} min` : ''}
      </div>
    )
  }
  if (row.actual && row.left) {
    const real = Math.round((Date.parse(row.left) - Date.parse(row.actual)) / 60000)
    const diff = real - planned
    return (
      <div className="stop-info">
        Arrêt {real} min
        {planned > 0 && (
          <span className={diff > 0 ? 'late' : diff < 0 ? 'early' : ''}>
            {' '}(prévu {planned} min{diff ? `, ${diff > 0 ? '+' : '−'}${Math.abs(diff)}` : ''})
          </span>
        )}
      </div>
    )
  }
  return planned > 0 ? <div className="stop-info muted">Arrêt prévu {planned} min</div> : null
}

/** Avance (−) ou retard (+) sur l'heure prévue, en min ou en h. */
function signedDelay(sec: number): string {
  const m = Math.round(sec / 60)
  const sign = m > 0 ? '+' : m < 0 ? '−' : ''
  const a = Math.abs(m)
  return a >= 60 ? `${sign}${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')}` : `${sign}${a} min`
}

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
  report: rawReport,
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
  // Relevé d'une autre activité (fait avant l'envoi de cette course à la montre, ou au-delà de son
  // arrivée) : ignoré, sinon tout le parcours paraît fait dès l'ouverture d'un nouveau parcours.
  const report =
    rawReport &&
    !(input.watchSince && rawReport.t * 1000 < Date.parse(input.watchSince)) &&
    !(input.totalDist > 0 && rawReport.d > input.totalDist + 1000)
      ? rawReport
      : null
  const nowSec0 = nowMs / 1000
  // Heures recalées sur le départ réel (montre, sinon mode course) s'il diffère du départ officiel ;
  // les barrières horaires suivent le même décalage. Départ libre pas encore parti : heures pour un
  // départ maintenant. Une fois parti, fixes pendant toute l'activité (même si le relevé date).
  const watchStart = watchStartMs(report, nowSec0)
  const freeStarted = watchStart !== null || !!snap.live
  const officialMs = Date.parse(snap.plannedStart ?? snap.start)
  const realStart = watchStart ?? (snap.live ? Date.parse(snap.live.startedAt) : snap.freeStart ? Math.ceil(nowMs / 60000) * 60000 : null)
  const startShift = realStart !== null ? realStart - officialMs : 0
  if (realStart !== null) {
    const off = realStart - Date.parse(snap.start)
    const cutOff = startShift
    if (Math.abs(off) >= 30000 || Math.abs(cutOff) >= 30000) {
      const by = (ms: number) => (iso: string | null) => (iso && Math.abs(ms) >= 30000 ? new Date(Date.parse(iso) + ms).toISOString() : iso)
      const shift = by(off)
      const shiftCut = by(cutOff)
      snap = {
        ...snap,
        start: new Date(realStart).toISOString(),
        rows: snap.rows.map((r) => ({ ...r, planned: shift(r.planned)!, early: shift(r.early), late: shift(r.late), eta: shift(r.eta)!, cutoff: shiftCut(r.cutoff) })),
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
        left: watch.departed.has(i) ? new Date(watch.departed.get(i)! * 1000).toISOString() : (r.left ?? null),
        eta: new Date(watch.etas[i] * 1000).toISOString(),
      })),
    }
  }
  // Suivi saisi à la main (sans montre) : le prochain point n'est jamais estimé avant maintenant.
  if (!watch && snap.live) {
    // Encore au ravito (pas de « Reparti ») : l'arrêt qui s'allonge depuis la dernière mise à jour du
    // partage décale la suite (la part d'avant est déjà dans les heures estimées du partage).
    const lastIn = [...snap.rows].reverse().find((r) => r.actual)
    if (lastIn && isRavitoKind(lastIn.kind) && !lastIn.left) {
      const stayEnd = Date.parse(lastIn.actual!) + lastIn.stopMin * 60000
      const extra = Math.max(0, nowMs - stayEnd) - Math.max(0, Date.parse(snap.updatedAt) - stayEnd)
      if (extra > 0) snap = { ...snap, rows: snap.rows.map((r) => (r.actual ? r : { ...r, eta: new Date(Date.parse(r.eta) + extra).toISOString() })) }
    }
    const nextRow = snap.rows.find((r) => !r.actual)
    const lag = nextRow ? nowMs - Date.parse(nextRow.eta) : 0
    if (lag > 60000) snap = { ...snap, rows: snap.rows.map((r) => (r.actual ? r : { ...r, eta: new Date(Date.parse(r.eta) + lag).toISOString() })) }
  }
  const long = Date.parse(snap.rows[snap.rows.length - 1]?.planned ?? snap.start) - Date.parse(snap.start) > 20 * 3600000
  const lastDone = [...snap.rows].reverse().find((r) => r.actual)
  const next = snap.rows.find((r) => !r.actual)
  // Coureur au ravito : arrivé (passage noté), pas encore reparti. Montre : position à moins de 150 m
  // après le point (300 m après une base de vie). Mode course : dernier passage saisi, sans « Reparti ».
  const atRavito = watch
    ? [...snap.rows].reverse().find((r) => isRavitoKind(r.kind) && r.actual && !r.left && watch.dist < r.dist + awayM(r.kind) && watch.dist > r.dist - 2 * awayM(r.kind))
    : snap.live && lastDone && isRavitoKind(lastDone.kind) && !lastDone.left
      ? lastDone
      : undefined
  const atSinceMin = atRavito ? Math.max(0, Math.round((nowMs - Date.parse(atRavito.actual!)) / 60000)) : 0
  const elapsed = snap.live ? (nowMs - Date.parse(snap.live.startedAt)) / 1000 : null
  const atBanner = atRavito && (
    <div className={`live-sub at-ravito-banner ${atRavito.stopMin > 0 && atSinceMin > Math.round(atRavito.stopMin) ? 'over' : ''}`}>
      <KindIcon kind={atRavito.kind} /> Au ravito : <strong>{atRavito.name}</strong> depuis {atSinceMin} min
      {atRavito.stopMin > 0 ? ` (arrêt prévu ${Math.round(atRavito.stopMin)} min)` : ''}
    </div>
  )
  // Cumul du temps aux ravitos : ravitos quittés (départ noté) et ravito en cours, face à leurs arrêts prévus.
  const stops = ravitoTotals(snap.rows, atRavito, nowMs)
  const stopsLine = stops && (
    <div className={stops.planned > 0 && Math.round(stops.spent / 60000) > Math.round(stops.planned / 60000) ? 'live-sub stops-over' : 'live-sub'}>
      Aux ravitos : {minText(stops.spent)}{stops.planned > 0 ? ` (prévu ${minText(stops.planned)})` : ''}
    </div>
  )
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
          estimate: !atRavito && estimate !== null ? { dist: estimate, label: `Estimé maintenant : km ${km(estimate)}` } : null,
        }
      : snap.live && lastDone
        ? { dist: lastDone.dist, label: `Dernier passage : ${lastDone.name} à ${clock(lastDone.actual)}` }
        : null
  const planStartMs = Date.parse(snap.start)
  const startMs = watch && report ? report.s * 1000 : snap.live ? Date.parse(snap.live.startedAt) : planStartMs
  const alerts = useCrossingAlerts(snap.rows, snap.athleteName || 'Coureur', shareId, (iso) => clock(iso, long), startMs, planStartMs)
  // Toucher le tracé sur la carte : heure de passage à cet endroit (réelle si déjà passé, estimée sinon).
  const runnerAt = watch ? (estimate ?? watch.dist) : lastDone ? lastDone.dist : null
  const passageAt = (d: number) => {
    const ms = timeAtDist(snap.rows, snap.start, startMs, d, plan ? (dd) => plannedAtWatch(plan, dd) : undefined)
    return { when: formatClock(new Date(ms), tz, long), passed: runnerAt !== null && d <= runnerAt }
  }
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
            : Math.abs(startShift) >= 30000
              ? `parti à ${formatClock(new Date(snap.start), tz, true)} (départ officiel ${formatClock(new Date(officialMs), tz)}, heures et barrières recalées)`
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
        {/* Pointeur : position estimée entre deux relevés (sinon celle du dernier relevé). */}
        <CourseProfile profile={snap.profile} rows={snap.rows} atId={atRavito?.id ?? null} position={watch ? (atRavito ? watch.dist : (estimate ?? watch.dist)) : null} />
        {watch && report ? (
          <section className="live-hero">
            <div className="live-label">Montre · en course depuis</div>
            <div className="live-clock">{formatDuration(watch.elapsed)}</div>
            <div className={`live-delta ${watch.delta > 60 ? 'late' : 'early'}`}>
              km {(watch.dist / 1000).toFixed(1)} · {signedMin(watch.delta)} sur le plan
            </div>
            {!atRavito && estimate !== null && estimate > watch.dist + 50 && (
              <div className="live-sub">≈ km {km(estimate)} maintenant (estimé d'après son rythme, entre deux relevés)</div>
            )}
            {atBanner}
            {stopsLine}
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
            {atBanner}
            {stopsLine}
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
                <ShareMap route={snap.route} points={mapPoints} runner={runner} passageAt={passageAt} />
              </Suspense>
            )}
          </>
        )}
        {/* Tableau plus large qu'un téléphone : il défile seul, la colonne des points reste visible. */}
        <div className="scroll share-points">
        <table className="table">
          <thead>
            <tr><th>Point</th><th>Km</th><th>Au plus tôt</th><th>Prévu</th><th>Au plus tard</th><th>Réel / estimé</th><th>Barrière</th></tr>
          </thead>
          <tbody>
            {snap.rows.map((r, i) => (
              <tr key={r.id} className={`${isRavitoKind(r.kind) ? 'kind-ravito' : ''} ${r.actual ? 'done' : ''} ${r === atRavito ? 'at-ravito' : ''}`}>
                <td>
                  <KindIcon kind={r.kind} finish={i === snap.rows.length - 1} /> {r.name}
                  {isRavitoKind(r.kind) && <StopInfo row={r} at={r === atRavito} sinceMin={atSinceMin} />}
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
                <td>
                  {r.actual ? <strong><Check className="inline" /> {clock(r.actual, long)}</strong> : snap.live || watch ? <span className="muted">~{clock(r.eta, long)}</span> : ''}
                  {(r.actual || snap.live || watch) && (() => {
                    // Avance / retard sur l'heure prévue : réel si passé, sinon estimé.
                    const delay = (Date.parse(r.actual ?? r.eta) - Date.parse(r.planned)) / 1000
                    return Math.abs(delay) >= 60 ? (
                      <div className={`delay ${delay > 0 ? 'late' : 'early'} ${r.actual ? '' : 'est'}`}>{signedDelay(delay)}</div>
                    ) : (
                      <div className="delay on-time">à l'heure</div>
                    )
                  })()}
                </td>
                <td>{clock(r.cutoff, long)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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
                  <KindIcon kind={r.kind} finish={r === points[points.length - 1] && r.id === '__finish'} /> <strong>{r.name}</strong> <span className="muted small">km {(r.dist / 1000).toFixed(1).replace('.', ',')}</span>
                  <br />
                  <span className="small">
                    {done ? `passé à ${clock(r.actual)}` : `${live ? 'estimé' : 'prévu'} ${clock(live ? r.eta : r.planned)}`}
                    {r.access ? ' · accès assistance' : ''}
                    {!r.assist && <span className="muted"> · assistance non autorisée</span>}
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

/**
 * Profil de la page assistance : nom des points (inclinés, sans chevauchement : assistance
 * autorisée et dropbags prioritaires), marqueurs assistance / dropbag et position du coureur.
 */
/** D+ cumulé jusqu'à d (m) d'après le profil simplifié (anciens partages sans D+ par point). */
