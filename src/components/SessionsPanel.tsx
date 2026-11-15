import { Check, Plus, Trash2, Upload, UserCheck, Watch } from 'lucide-react'
import { useState } from 'react'
import { readActivity } from '../lib/activity'
import { predictTime } from '../lib/cs'
import { download } from '../lib/exportGpx'
import { progressSeries, type ProgressSeries } from '../lib/progress'
import { csFromTrials, describeSteps, OFFERED_SESSIONS, SESSIONS_BY_KEY, type SessionKey, type SessionResult, type SessionVariant } from '../lib/sessions'
import { formatDuration, formatPace } from '../lib/time'
import type { Athlete, CsTrial } from '../lib/types'
import { buildWorkoutFit } from '../lib/workoutFit'
import { Card, Hint, Num } from './ui'

interface Props {
  athlete: Athlete
  onChange: (a: Athlete) => void
}

/** Onglet Test VC : séance de test (montre ou saisie), tests et évolution. */
export function SessionsPanel({ athlete, onChange }: Props) {
  const [result, setResult] = useState<{ key: SessionKey; r: SessionResult } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const importFor = async (key: SessionKey, files: FileList | null, variant?: SessionVariant) => {
    const f = files?.[0]
    if (!f) return
    setError(null)
    setResult(null)
    try {
      const act = readActivity(f.name, new Uint8Array(await f.arrayBuffer()))
      setResult({ key, r: SESSIONS_BY_KEY[key].analyze(act, athlete, variant) })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setError(`${SESSIONS_BY_KEY[key].title} : ${(e as Error).message}`)
    }
  }

  const save = (apply: boolean) => {
    if (!result) return
    const base = apply ? result.r.athlete : { ...athlete, ...result.r.persist }
    onChange({ ...base, activities: [result.r.record, ...athlete.activities] })
    setResult(null)
  }

  const exportFit = (key: SessionKey, variant?: SessionVariant) => {
    const s = SESSIONS_BY_KEY[key]
    const title = variant ? `Test VC ${variant.label}` : s.title
    download(`TrailPlanner_${key}${variant ? `_${variant.key}` : ''}.fit`, buildWorkoutFit(title.slice(0, 32), s.steps(athlete, variant), Date.now(), { target: athlete.workoutTarget, athlete }), 'application/vnd.ant.fit')
  }

  return (
    <div className="grid">
      <Card title="Test de vitesse critique" fold="open">
        <p>
          De temps à autre, un test mesure ta VC et ton D′. Télécharge l'entraînement pour ta montre, fais la séance, puis
          importe son enregistrement (GPX ou FIT) : l'app en tire la distance, calcule VC et D′ et propose de mettre ton profil
          à jour. Sans la montre, saisis la distance de chaque test dans « Mes tests ».
        </p>
        {error && <p className="warn">{error}</p>}
      </Card>

      {result && (
        <Card title={`Résultat · ${SESSIONS_BY_KEY[result.key].title}`} className="result-card" fold="open">
          <ul className="changes">{result.r.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <h3>Mise à jour proposée du profil</h3>
          <ul className="changes">{result.r.changes.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="row">
            <button className="primary" onClick={() => save(true)}><UserCheck /> Appliquer au profil et enregistrer</button>
            <button onClick={() => save(false)}>Enregistrer sans appliquer</button>
            <button className="ghost" onClick={() => setResult(null)}>Annuler</button>
          </div>
        </Card>
      )}

      <div className="grid two">
        {OFFERED_SESSIONS.map((s) => {
          const last = athlete.activities.find((a) => a.session === s.key)
          return (
            <Card
              key={s.key}
              title={s.title}
              className={s.variants ? 'span2' : ''}
              actions={
                s.variants ? undefined : (
                  <>
                    <button onClick={() => exportFit(s.key)} title="Entraînement structuré pour la montre (GARMIN/NewFiles)"><Watch /> Entraînement .fit</button>
                    <label className="button primary">
                      <Upload /> Importer ma séance
                      <input type="file" accept=".gpx,.fit,application/gpx+xml" hidden onChange={(e) => { importFor(s.key, e.target.files); e.target.value = '' }} />
                    </label>
                  </>
                )
              }
            >
              <p className="muted">{s.measures}</p>
              <p className="small"><strong>Terrain :</strong> {s.terrain}</p>
              {s.variants && (
                <div className="variant-actions">
                  {s.variants.map((v) => (
                    <div key={v.key} className="variant">
                      <strong>Test {v.label}</strong>
                      <button onClick={() => exportFit(s.key, v)} title="Entraînement structuré pour la montre (GARMIN/NewFiles)"><Watch /> .fit</button>
                      <label className="button primary">
                        <Upload /> Importer
                        <input type="file" accept=".gpx,.fit,application/gpx+xml" hidden onChange={(e) => { importFor(s.key, e.target.files, v); e.target.value = '' }} />
                      </label>
                    </div>
                  ))}
                </div>
              )}
              <ol className="steps">{describeSteps(s.steps(athlete), athlete).map((d) => <li key={d}>{d}</li>)}</ol>
              {s.key === 'csTest' && <CsTrials athlete={athlete} onChange={onChange} />}
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

/** Tests VC enregistrés (un par séance), corrigeables, et VC / D′ qui en découlent. */
/** Temps de course : m:ss sous l'heure, h:mm:ss au-delà. */
function shortTime(seconds: number): string {
  const t = Math.round(seconds)
  return t < 3600 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : formatDuration(t, true)
}

function CsTrials({ athlete, onChange }: Props) {
  const trials = [...athlete.csTrials].sort((a, b) => b.date.localeCompare(a.date))
  const fit = csFromTrials(trials)
  const set = (csTrials: CsTrial[]) => onChange({ ...athlete, csTrials })
  // Saisie d'un test fait sans la montre (ou dont l'enregistrement est perdu).
  const [draft, setDraft] = useState<{ minutes: number; dist: number; day: string } | null>(null)
  const add = () => {
    if (!draft || !(draft.dist > 0)) return
    const date = new Date(`${draft.day}T12:00:00`).toISOString()
    set([{ id: crypto.randomUUID(), date, seconds: draft.minutes * 60, dist: draft.dist, source: 'manual' }, ...athlete.csTrials])
    setDraft(null)
  }
  const src = { lap: 'tour montre', gps: 'GPS', manual: 'saisie' } as const
  return (
    <>
      <h3>Mes tests</h3>
      {trials.length === 0 ? (
        <p className="muted small">Aucun test enregistré. Importe chaque séance après l'avoir faite, ou saisis sa distance.</p>
      ) : (
        <table className="table compact">
          <thead>
            <tr><th>Date</th><th>Durée</th><th>Distance (m)</th><th>Allure</th><th>Source</th><th /></tr>
          </thead>
          <tbody>
            {trials.map((t) => (
              <tr key={t.id} className={fit?.used.some((u) => u.id === t.id) ? '' : 'muted'}>
                <td>{t.date.slice(0, 10)}</td>
                <td>{Math.round(t.seconds / 60)}′</td>
                <td><Num value={t.dist} width={70} min={1} onChange={(v) => set(athlete.csTrials.map((x) => (x.id === t.id ? { ...x, dist: v, source: 'manual' } : x)))} /></td>
                <td>{formatPace(t.seconds / (t.dist / 1000))}/km</td>
                <td className="small">{src[t.source]}</td>
                <td><button className="ghost" onClick={() => set(athlete.csTrials.filter((x) => x.id !== t.id))} aria-label="Supprimer"><Trash2 /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {draft ? (
        <div className="row trial-form">
          <span className="seg" role="group" aria-label="Durée du test">
            {[3, 7, 12].map((m) => (
              <button key={m} className={draft.minutes === m ? 'on' : ''} onClick={() => setDraft({ ...draft, minutes: m })}>{m}′</button>
            ))}
          </span>
          <Num value={draft.dist} unit="m" width={80} min={0} onChange={(v) => setDraft({ ...draft, dist: v })} title="Distance parcourue" />
          <input type="date" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} aria-label="Date du test" />
          <button className="primary" onClick={add} disabled={!(draft.dist > 0)}><Check /> Ajouter</button>
          <button className="ghost" onClick={() => setDraft(null)}>Annuler</button>
        </div>
      ) : (
        <div className="row">
          <button className="ghost" onClick={() => setDraft({ minutes: 3, dist: 0, day: new Date().toISOString().slice(0, 10) })}><Plus /> Saisir un test</button>
        </div>
      )}
      {fit && (
        <div className="trial-fit">
          <span>
            VC <strong>{formatPace(1000 / fit.cs)}/km</strong> ({(fit.cs * 3.6).toFixed(2)} km/h), D′ <strong>{Math.round(fit.dPrime)} m</strong>
            {fit.r2 !== null ? ` · R² ${fit.r2.toFixed(3)}` : ''}
          </span>
          {(Math.abs(fit.cs - athlete.cs) > 0.001 || Math.abs(fit.dPrime - athlete.dPrime) > 1) && (
            <button className="primary" onClick={() => onChange({ ...athlete, cs: fit.cs, dPrime: fit.dPrime })}><UserCheck /> Appliquer au profil</button>
          )}
          <span className="muted small">
            Prédictions : {[1500, 3000, 5000, 10000].map((d) => `${(d / 1000).toString().replace('.', ',')} km ${shortTime(predictTime(fit.cs, fit.dPrime, d))}`).join(' · ')}
          </span>
          {fit.r2 !== null && fit.r2 < 0.99 && <span className="warn-text small">R² faible : un des tests n'est probablement pas maximal ou mal mesuré.</span>}
        </div>
      )}
      <Hint>Calcul sur le test le plus récent de chaque durée, sur 6 semaines au plus. Les lignes grisées ne sont pas utilisées.</Hint>
    </>
  )
}
