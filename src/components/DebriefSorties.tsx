import { Bell, BellOff, Flag, Upload } from 'lucide-react'
import { useState } from 'react'
import { debriefEnded, debriefReport, signedGap, sortedDebriefs, type DebriefReport } from '../lib/debrief'
import { importActivity } from '../lib/debriefImport'
import { debriefNotifyOn, notifySupported, setDebriefNotify, TEST_NOTICE_MS } from '../lib/notify'
import { formatClock, formatDuration } from '../lib/time'
import { useBriefly } from '../lib/useBriefly'
import type { Athlete, Debrief, Race } from '../lib/types'
import { Card, Hint } from './ui'

/** Colonnes du tableau de comparaison (les sorties les plus récentes). */
const COMPARE_MAX = 6

const gapClass = (sec: number) => (Math.abs(sec) < 60 ? '' : sec > 0 ? 'late' : 'early')

/**
 * Sorties sur un parcours : liste des debriefs, import de l'enregistrement d'une activité,
 * notification à l'arrivée, et comparaison des sorties (temps à chaque point, évolution).
 */
export function SortiesCard({
  race,
  athlete,
  onChange,
  onDebrief,
}: {
  race: Race
  athlete: Athlete
  onChange: (r: Race) => void
  onDebrief: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notify, setNotify] = useState(debriefNotifyOn)
  // Abonnement au serveur fait : notification de confirmation annoncée dans la page.
  const [testing, setTesting] = useBriefly(TEST_NOTICE_MS)
  const tz = race.env.timeZone
  const debriefs = sortedDebriefs(race)
  const reports = debriefs.map((d) => ({ d, r: debriefReport(d) }))
  const runDay = (ms: number, short = false) =>
    new Intl.DateTimeFormat('fr-FR', short ? { timeZone: tz, day: 'numeric', month: 'short' } : { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms))

  const onFile = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const res = importActivity(race, athlete, f.name, bytes)
      onChange(res.race)
      onDebrief(res.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={`Sorties et debriefs (${debriefs.length})`} fold="open">
      {debriefs.length > 0 ? (
        <ul className="debrief-list">
          {reports.map(({ d, r }) => (
            <li key={d.id}>
              <span>
                <strong>{runDay(r.start)}</strong> · départ {formatClock(new Date(r.start), tz)}
                <span className="small muted">
                  {' · '}
                  {r.total !== null ? (
                    <>
                      arrivée en {formatDuration(r.total)} <span className={gapClass(r.total - r.plannedTotal)}>({signedGap(r.total - r.plannedTotal)})</span>
                    </>
                  ) : debriefEnded(d) ? (
                    'arrivée non relevée'
                  ) : (
                    'en cours'
                  )}
                </span>
              </span>
              <button onClick={() => onDebrief(d.id)}><Flag /> Debrief</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Pas encore de sortie sur ce parcours.</p>
      )}
      <div className="row no-print">
        <label className="button" aria-disabled={busy}>
          <Upload /> Importer l'activité (FIT / GPX)
          <input type="file" accept=".gpx,.fit,application/gpx+xml" hidden disabled={busy} onChange={(e) => { void onFile(e.target.files); e.target.value = '' }} />
        </label>
        {notifySupported() && (
          <button
            className={notify ? 'ghost on' : 'ghost'}
            onClick={async () => {
              const on = await setDebriefNotify(!notify)
              setNotify(on)
              // Envoyée aussi par le serveur, même appli fermée (si en place et connecté).
              const server = await import('../lib/push').then((p) => (p.pushAvailable() ? p.setOwnerPush(on) : false)).catch(() => false)
              setTesting(on && server)
            }}
            title="Notification de ce téléphone quand l'arrivée est relevée"
          >
            {notify ? <><Bell /> Notification à l'arrivée activée</> : <><BellOff /> Me prévenir à l'arrivée</>}
          </button>
        )}
        {testing && <span className="muted small">Une notification de test arrive dans quelques secondes.</span>}
        {busy && <span className="muted">Lecture…</span>}
      </div>
      {error && <p className="warn">{error}</p>}
      <Hint>
        Une sortie par départ : passages relevés par la montre (champ Trail Planner) ou notés en mode course, figés ici avec le plan
        d'alors (l'appli doit être ouverte une fois après la sortie pour récupérer ceux de la montre). Sortie faite sans eux : importe
        l'enregistrement de ta montre, les passages et les arrêts aux ravitos en sont tirés (il complète la sortie du même départ sans
        rien écraser).
      </Hint>
      {reports.length >= 2 && <SortiesCompare race={race} reports={reports.slice(0, COMPARE_MAX)} runDay={runDay} onDebrief={onDebrief} />}
    </Card>
  )
}

/** Comparaison des sorties : évolution du temps d'arrivée, temps écoulé à chaque point. */
function SortiesCompare({
  race,
  reports,
  runDay,
  onDebrief,
}: {
  race: Race
  reports: { d: Debrief; r: DebriefReport }[]
  runDay: (ms: number, short?: boolean) => string
  onDebrief: (id: string) => void
}) {
  // Points du parcours : ceux de la sortie la plus récente ; temps écoulé depuis le départ.
  const points = reports[0].r.rows.map((x) => x.point)
  const elapsedAt = (r: DebriefReport, id: string, dist: number) => {
    const row = r.rows.find((x) => x.point.id === id) ?? r.rows.find((x) => Math.abs(x.point.dist - dist) <= 200)
    return row?.actual != null ? Math.round((row.actual - r.start) / 1000) : null
  }
  const finished = [...reports].reverse().filter((x) => x.r.total !== null)
  return (
    <div className="sorties-compare">
      <h3>Comparaison des sorties</h3>
      {finished.length >= 2 && <TrendChart runs={finished.map((x) => ({ t: x.r.start, total: x.r.total!, planned: x.r.plannedTotal }))} label={(t) => runDay(t, true)} />}
      <div className="scroll">
        <table className="table compact debrief-compare">
          <thead>
            <tr>
              <th>Point</th>
              {reports.map(({ d, r }) => (
                <th key={d.id}>
                  <button className="link time-edit" onClick={() => onDebrief(d.id)} title="Ouvrir ce debrief">{runDay(r.start, true)}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => {
              const vals = reports.map(({ r }) => elapsedAt(r, p.id, p.dist))
              const known = vals.filter((v): v is number => v !== null)
              const best = known.length > 1 ? Math.min(...known) : null
              return (
                <tr key={p.id}>
                  <td>{p.name} <span className="small muted">km {(p.dist / 1000).toFixed(1).replace('.', ',')}</span></td>
                  {vals.map((v, i) => (
                    <td key={reports[i].d.id} className={v !== null && v === best ? 'best' : ''}>{v !== null ? formatDuration(v) : '—'}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Hint>Temps écoulé depuis le départ à chaque point ; en gras, le meilleur. {race.kind === 'route' ? 'Les sorties en zone d’endurance et les sorties à fond ne se comparent pas directement.' : ''}</Hint>
    </div>
  )
}

const W = 440
const H = 170
const M = { l: 56, r: 14, t: 14, b: 26 }

/** Évolution du temps d'arrivée d'une sortie à l'autre (une seule série ; info-bulle au survol). */
function TrendChart({ runs, label }: { runs: { t: number; total: number; planned: number }[]; label: (t: number) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const vs = runs.map((x) => x.total)
  const pad = (Math.max(...vs) - Math.min(...vs)) * 0.15 || vs[0] * 0.05
  const y0 = Math.min(...vs) - pad
  const y1 = Math.max(...vs) + pad
  const n = runs.length
  // Sorties régulièrement espacées (ordre chronologique), dates sous l'axe.
  const x = (i: number) => M.l + (n > 1 ? (i / (n - 1)) * (W - M.l - M.r) : (W - M.l - M.r) / 2)
  const y = (v: number) => H - M.b - ((v - y0) / (y1 - y0)) * (H - M.t - M.b)
  const line = runs.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join('')
  const ticks = [0.15, 0.5, 0.85].map((f) => y0 + f * (y1 - y0))
  const h = hover !== null ? runs[hover] : null
  const last = runs[n - 1]
  return (
    <div className="progress-chart">
      <h4 className="chart-title">Temps d'arrivée <span className="kpi-sub">dernière sortie {formatDuration(last.total)}</span></h4>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Évolution du temps d'arrivée d'une sortie à l'autre" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={M.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{formatDuration(t)}</text>
          </g>
        ))}
        {runs.map((p, i) => (
          <text key={p.t} x={x(i)} y={H - 6} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'} className="tick">{label(p.t)}</text>
        ))}
        <path d={line} className="series-1 line" />
        {runs.map((p, i) => (
          <g key={p.t} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
            <circle cx={x(i)} cy={y(p.total)} r={14} fill="transparent" />
            <circle cx={x(i)} cy={y(p.total)} r={4.5} className="series-1 dot" />
          </g>
        ))}
        {h && hover !== null && (
          <text x={Math.min(Math.max(x(hover) - 60, M.l), W - 230)} y={M.t + 2} className="tip">
            {label(h.t)} · {formatDuration(h.total)} ({signedGap(h.total - h.planned)} sur le plan)
          </text>
        )}
      </svg>
    </div>
  )
}
