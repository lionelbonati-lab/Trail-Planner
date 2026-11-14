import { Check, Mountain, Navigation, Route } from 'lucide-react'
import { navUrl, tripLegs } from '../lib/assist'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { ShareSnapshot } from '../lib/share'
import { formatClock, formatDuration } from '../lib/time'
import { parseWatchPlan, watchStatus, type WatchReport } from '../lib/watchLive'

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
    const id = setInterval(() => tick((x) => x + 1), 30000)
    return () => clearInterval(id)
  }, [])

  if (error) return <main><p className="warn">Lien indisponible : {error}</p></main>
  if (snap === undefined) return <main><p className="muted">Chargement…</p></main>
  if (snap === null) return <main><p className="warn">Ce lien n'existe plus.</p></main>

  return <ShareView snap={snap} report={report} shareId={shareId} />
}

/** Points décochés par l'équipe sur ce téléphone, par lien assistance. */
function useUnchecked(shareId: string | undefined): [Set<string>, (id: string, on: boolean) => void] {
  const key = `tp-assist-${shareId ?? 'local'}`
  const [off, setOff] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const toggle = (id: string, on: boolean) => {
    const next = new Set(off)
    if (on) next.delete(id)
    else next.add(id)
    setOff(next)
    try {
      localStorage.setItem(key, JSON.stringify([...next]))
    } catch {
      /* stockage indisponible : la coche ne sera pas gardée */
    }
  }
  return [off, toggle]
}

/** Affichage du lien assistance (séparé du chargement, pour pouvoir le tester). */
export function ShareView({
  snap: input,
  report,
  nowMs = Date.now(),
  shareId,
}: {
  snap: ShareSnapshot
  report: WatchReport | null
  nowMs?: number
  shareId?: string
}) {
  const [unchecked, setChecked] = useUnchecked(shareId)
  let snap = input
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
  const runner: Runner | null =
    watch && report
      ? {
          dist: watch.dist,
          lat: report.lat,
          lon: report.lon,
          label: `km ${(watch.dist / 1000).toFixed(1).replace('.', ',')} · il y a ${Math.max(0, Math.round(watch.age / 60))} min`,
        }
      : snap.live && lastDone
        ? { dist: lastDone.dist, label: `Dernier passage : ${lastDone.name} à ${clock(lastDone.actual)}` }
        : null
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
          {snap.athleteName} · départ {formatClock(new Date(snap.start), tz, true)} · {(snap.totalDist / 1000).toFixed(1)} km, +{Math.round(snap.dPlus)} m
        </p>
        <MiniProfile profile={snap.profile} rows={snap.rows} position={watch ? watch.dist : null} />
        {watch && report ? (
          <section className="live-hero">
            <div className="live-label">Montre · en course depuis</div>
            <div className="live-clock">{formatDuration(watch.elapsed)}</div>
            <div className={`live-delta ${watch.delta > 60 ? 'late' : 'early'}`}>
              km {(watch.dist / 1000).toFixed(1)} · {signedMin(watch.delta)} sur le plan
            </div>
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
        <AssistTrip rows={snap.rows} unchecked={unchecked} onCheck={setChecked} clock={(iso) => clock(iso, long)} live={!!snap.live || !!watch} />
        {snap.route && snap.route.length >= 2 && (
          <Suspense fallback={<div className="share-map share-map-loading" />}>
            <ShareMap route={snap.route} points={mapPoints} runner={runner} />
          </Suspense>
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
        <p className="hint">Mis à jour {formatClock(new Date(snap.updatedAt), tz, true)}. Cette page se met à jour toute seule.</p>
      </main>
    </div>
  )
}

/**
 * Trajet de l'assistance : points où elle est autorisée, à cocher (coches gardées sur ce
 * téléphone), et itinéraire Google Maps entre les points cochés pas encore passés.
 */
function AssistTrip({
  rows,
  unchecked,
  onCheck,
  clock,
  live,
}: {
  rows: ShareSnapshot['rows']
  unchecked: Set<string>
  onCheck: (id: string, on: boolean) => void
  clock: (iso: string | null) => string
  live: boolean
}) {
  const points = rows.filter((r) => r.assist && r.lat !== undefined && r.lon !== undefined)
  if (!points.length) return null
  const todo = points.filter((r) => !r.actual && !unchecked.has(r.id))
  const legs = tripLegs(todo.map((r) => ({ lat: r.lat!, lon: r.lon! })))
  return (
    <section className="assist-trip">
      <h3><Route className="inline" /> Trajet de l'assistance</h3>
      <ul>
        {points.map((r) => {
          const done = !!r.actual
          return (
            <li key={r.id} className={done ? 'muted' : ''}>
              <label>
                <input type="checkbox" checked={!done && !unchecked.has(r.id)} disabled={done} onChange={(e) => onCheck(r.id, e.target.checked)} />
                <span>
                  <strong>{r.name}</strong> <span className="muted small">km {(r.dist / 1000).toFixed(1).replace('.', ',')}</span>
                  <br />
                  <span className="small">
                    {done ? `passé à ${clock(r.actual)}` : `${live ? 'estimé' : 'prévu'} ${clock(live ? r.eta : r.planned)}`}
                    {r.access ? ' · accès assistance' : ''}
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
