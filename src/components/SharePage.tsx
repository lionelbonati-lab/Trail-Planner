import { useEffect, useState } from 'react'
import { subscribeShare, type ShareSnapshot } from '../lib/share'
import { formatClock, formatDuration } from '../lib/time'

/** Page publique pour l'assistance : plan, fenêtres de passage et suivi en direct. */
export function SharePage({ shareId }: { shareId: string }) {
  const [snap, setSnap] = useState<ShareSnapshot | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [, tick] = useState(0)
  useEffect(() => subscribeShare(shareId, setSnap, (e) => setError(e.message)), [shareId])
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 30000)
    return () => clearInterval(id)
  }, [])

  if (error) return <main><p className="warn">Lien indisponible : {error}</p></main>
  if (snap === undefined) return <main><p className="muted">Chargement…</p></main>
  if (snap === null) return <main><p className="warn">Ce lien n'existe plus.</p></main>

  const tz = snap.timeZone
  const clock = (iso: string | null, day = false) => (iso ? formatClock(new Date(iso), tz, day) : '')
  const long = Date.parse(snap.rows[snap.rows.length - 1]?.planned ?? snap.start) - Date.parse(snap.start) > 20 * 3600000
  const lastDone = [...snap.rows].reverse().find((r) => r.actual)
  const next = snap.rows.find((r) => !r.actual)
  const elapsed = snap.live ? (Date.now() - Date.parse(snap.live.startedAt)) / 1000 : null

  return (
    <div className="app">
      <header className="topbar"><span className="brand">⛰ Trail Planner · Assistance</span></header>
      <main className="share">
        <h1>{snap.raceName}</h1>
        <p className="muted">
          {snap.athleteName} · départ {formatClock(new Date(snap.start), tz, true)} · {(snap.totalDist / 1000).toFixed(1)} km, +{Math.round(snap.dPlus)} m
        </p>
        <MiniProfile profile={snap.profile} rows={snap.rows} />
        {snap.live ? (
          <section className="live-hero">
            <div className="live-label">En course depuis</div>
            <div className="live-clock">{elapsed !== null ? formatDuration(elapsed) : ''}</div>
            {lastDone && <div className="live-sub">Dernier passage : {lastDone.name} à {clock(lastDone.actual)}</div>}
            {next && <div className="live-sub">Prochain : <strong>{next.name}</strong> vers {clock(next.eta, long)}</div>}
          </section>
        ) : (
          <p className="hint">Le suivi en direct apparaîtra ici dès le départ.</p>
        )}
        <table className="table">
          <thead>
            <tr><th>Point</th><th>Km</th><th>Au plus tôt</th><th>Prévu</th><th>Au plus tard</th><th>Réel / estimé</th><th>Barrière</th></tr>
          </thead>
          <tbody>
            {snap.rows.map((r) => (
              <tr key={r.id} className={`${r.kind === 'ravito' ? 'kind-ravito' : ''} ${r.actual ? 'done' : ''}`}>
                <td>{r.name}{r.notes && <div className="muted small">{r.notes}</div>}</td>
                <td>{(r.dist / 1000).toFixed(1)}</td>
                <td>{clock(r.early, long)}</td>
                <td><strong>{clock(r.planned, long)}</strong></td>
                <td>{clock(r.late, long)}</td>
                <td>{r.actual ? <strong>✓ {clock(r.actual, long)}</strong> : snap.live ? <span className="muted">~{clock(r.eta, long)}</span> : ''}</td>
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

function MiniProfile({ profile, rows }: { profile: [number, number][]; rows: ShareSnapshot['rows'] }) {
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
    </svg>
  )
}
