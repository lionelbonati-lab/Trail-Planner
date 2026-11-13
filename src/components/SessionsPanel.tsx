import { useState } from 'react'
import { readActivity } from '../lib/activity'
import { download } from '../lib/exportGpx'
import { progressSeries, type ProgressSeries } from '../lib/progress'
import { describeSteps, SESSIONS, SESSIONS_BY_KEY, type SessionKey, type SessionResult } from '../lib/sessions'
import { formatDuration } from '../lib/time'
import type { Athlete } from '../lib/types'
import { buildWorkoutFit } from '../lib/workoutFit'
import { Card, Hint } from './ui'

interface Props {
  athlete: Athlete
  onChange: (a: Athlete) => void
}

export function SessionsPanel({ athlete, onChange }: Props) {
  const [result, setResult] = useState<{ key: SessionKey; r: SessionResult } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const importFor = async (key: SessionKey, files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setError(null)
    setResult(null)
    try {
      const act = readActivity(f.name, new Uint8Array(await f.arrayBuffer()))
      setResult({ key, r: SESSIONS_BY_KEY[key].analyze(act, athlete) })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setError(`${SESSIONS_BY_KEY[key].title} : ${(e as Error).message}`)
    }
  }

  const save = (apply: boolean) => {
    if (!result) return
    const base = apply ? result.r.athlete : athlete
    onChange({ ...base, activities: [result.r.record, ...athlete.activities] })
    setResult(null)
  }

  const exportFit = (key: SessionKey) => {
    const s = SESSIONS_BY_KEY[key]
    download(`TrailPlanner_${key}.fit`, buildWorkoutFit(s.title.slice(0, 32), s.steps(athlete)), 'application/vnd.ant.fit')
  }

  return (
    <div className="grid">
      <Card title="Séances d'étalonnage">
        <p>
          De temps à autre, une séance ciblée mesure une partie de ton profil. Télécharge l'entraînement pour ta montre,
          fais la séance, puis importe son enregistrement (GPX ou FIT) : l'app en tire la mesure, propose de mettre ton profil
          à jour et l'ajoute à ton suivi.
        </p>
        <Hint>
          Montre Garmin (Enduro 3…) : branche-la en USB et copie le fichier .fit dans le dossier <code>GARMIN/NewFiles</code>.
          Après déconnexion, la séance apparaît dans <em>Entraînement → Entraînements</em>. Les cibles sont calculées depuis ton profil actuel.
        </Hint>
        {error && <p className="warn">{error}</p>}
      </Card>

      {result && (
        <Card title={`Résultat · ${SESSIONS_BY_KEY[result.key].title}`} className="result-card">
          <ul className="changes">{result.r.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <h3>Mise à jour proposée du profil</h3>
          <ul className="changes">{result.r.changes.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="row">
            <button className="primary" onClick={() => save(true)}>Appliquer au profil et enregistrer</button>
            <button onClick={() => save(false)}>Enregistrer sans appliquer</button>
            <button className="ghost" onClick={() => setResult(null)}>Annuler</button>
          </div>
        </Card>
      )}

      <div className="grid two">
        {SESSIONS.map((s) => {
          const last = athlete.activities.find((a) => a.session === s.key)
          return (
            <Card
              key={s.key}
              title={s.title}
              actions={
                <>
                  <button onClick={() => exportFit(s.key)} title="Entraînement structuré pour la montre (GARMIN/NewFiles)">⌚ Entraînement .fit</button>
                  <label className="button primary">
                    Importer ma séance
                    <input type="file" accept=".gpx,.fit,application/gpx+xml" hidden onChange={(e) => { importFor(s.key, e.target.files); e.target.value = '' }} />
                  </label>
                </>
              }
            >
              <p className="muted">{s.measures}</p>
              <p className="small"><strong>Terrain :</strong> {s.terrain}</p>
              <ol className="steps">{describeSteps(s.steps(athlete)).map((d) => <li key={d}>{d}</li>)}</ol>
              <ul className="tips">{s.tips.map((t) => <li key={t}>{t}</li>)}</ul>
              {last && <Hint>Dernière séance : {last.date.slice(0, 10)} ({formatDuration(last.elapsed)}).</Hint>}
            </Card>
          )
        })}
      </div>

      <Card title="Évolution">
        <div className="grid two">
          {progressSeries(athlete).map((s) => <ProgressChart key={s.key} series={s} />)}
        </div>
        <Hint>Chaque point est un test ou une séance enregistrée. Les séances non appliquées au profil apparaissent aussi.</Hint>
      </Card>
    </div>
  )
}

const W = 440
const H = 170
const M = { l: 74, r: 12, t: 12, b: 26 }

function ProgressChart({ series }: { series: ProgressSeries }) {
  const [hover, setHover] = useState<number | null>(null)
  const pts = series.points
  if (!pts.length) {
    return (
      <div className="progress-chart">
        <h3>{series.title}</h3>
        <p className="muted small">Pas encore de mesure.</p>
      </div>
    )
  }
  const t0 = pts[0].t
  const t1 = Math.max(pts[pts.length - 1].t, t0 + 7 * 86400000)
  const vs = pts.map((p) => p.value)
  const pad = (Math.max(...vs) - Math.min(...vs)) * 0.15 || Math.abs(vs[0]) * 0.05 || 1
  const y0 = Math.min(...vs) - pad
  const y1 = Math.max(...vs) + pad
  const x = (t: number) => M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r)
  const y = (v: number) => H - M.b - ((v - y0) / (y1 - y0)) * (H - M.t - M.b)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const ticks = [0.15, 0.5, 0.85].map((f) => y0 + f * (y1 - y0))
  const fmtDate = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
  const h = hover !== null ? pts[hover] : null
  const trend = pts.length > 1 ? pts[pts.length - 1].value - pts[0].value : 0
  const better = series.higherIsBetter ? trend > 0 : trend < 0
  return (
    <div className="progress-chart">
      <h3>
        {series.title}{' '}
        <span className="kpi-sub">
          {series.format(pts[pts.length - 1].value)}
          {pts.length > 1 && <span className={better ? 'ok-text' : 'warn-text'}> ({trend > 0 ? '+' : ''}{series.format(trend).replace(/^[k×]\s?/, '')} depuis le début)</span>}
        </span>
      </h3>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Évolution : ${series.title}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={M.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{series.format(t)}</text>
          </g>
        ))}
        <text x={M.l} y={H - 6} className="tick">{fmtDate(t0)}</text>
        <text x={W - M.r} y={H - 6} textAnchor="end" className="tick">{fmtDate(t1)}</text>
        {pts.length > 1 && <path d={line} className="series-1 line" />}
        {pts.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <circle cx={x(p.t)} cy={y(p.value)} r={12} fill="transparent" />
            <circle cx={x(p.t)} cy={y(p.value)} r={4.5} className="series-1 dot" />
          </g>
        ))}
        {h && (
          <text x={Math.min(x(h.t) + 8, W - 230)} y={M.t + 12} className="tip">
            {fmtDate(h.t)} · {series.format(h.value)}{h.detail ? ` ${h.detail}` : ''}
          </text>
        )}
      </svg>
      {h && <div className="muted small">{h.source}</div>}
    </div>
  )
}
