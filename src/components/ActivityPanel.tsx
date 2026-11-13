import { useMemo, useState } from 'react'
import {
  analyzeActivity,
  calibrateFromActivities,
  calibrateOnActivity,
  compareWithPlan,
  readActivity,
  type Analysis,
  type Calibration,
} from '../lib/activity'
import { DEFAULT_ENV } from '../lib/defaults'
import { haversine } from '../lib/gpx'
import { averageIntensity, intensityAt, interp } from '../lib/model'
import { computePlan } from '../lib/plan'
import { formatDuration, formatPace } from '../lib/time'
import type { ActivityRecord, Athlete, GradeStat, Race } from '../lib/types'
import { Kpi } from './CsCalculator'
import { Card, Hint } from './ui'

interface Props {
  athlete: Athlete
  races: Race[]
  onChange: (a: Athlete) => void
}

const pct = (x: number) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)} %`

export function ActivityPanel({ athlete, races, onChange }: Props) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [raceId, setRaceId] = useState<string>('')
  const [calibration, setCalibration] = useState<Calibration | null>(null)

  const load = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setError(null)
    setCalibration(null)
    try {
      const act = readActivity(f.name, new Uint8Array(await f.arrayBuffer()))
      const an = analyzeActivity(act, athlete, DEFAULT_ENV)
      setAnalysis(an)
      // Plan correspondant : départ à moins de 1 km et distance à ±15 %.
      const start = act.track.points[0]
      const match = races.find((r) => {
        const plan = computePlan(r, athlete)
        if (!plan) return false
        const p0 = plan.track.points[0]
        return (
          haversine(p0.lat, p0.lon, start.lat, start.lon) < 1000 &&
          Math.abs(plan.track.totalDist / act.track.totalDist - 1) < 0.15
        )
      })
      setRaceId(match?.id ?? '')
    } catch (e) {
      setError((e as Error).message)
      setAnalysis(null)
    }
  }

  const comparison = useMemo(() => {
    const race = races.find((r) => r.id === raceId)
    if (!analysis || !race) return null
    const plan = computePlan(race, athlete)
    if (!plan) return null
    const arrivals = new Map(plan.sim.splits.map((s) => [s.cp.id, s.arrival]))
    return compareWithPlan(analysis.activity, race, plan.track, arrivals)
  }, [analysis, raceId, races, athlete])

  const records = analysis ? [analysis.record, ...athlete.activities] : athlete.activities
  const preview = () => {
    if (!analysis) return
    setCalibration(calibrateOnActivity(athlete, records, analysis.activity, analysis.record, DEFAULT_ENV))
  }
  const save = (withCalibration: boolean) => {
    if (!analysis) return
    const record: ActivityRecord = { ...analysis.record, raceId: raceId || undefined }
    const base = withCalibration && calibration ? calibration.athlete : athlete
    onChange({ ...base, activities: [record, ...athlete.activities.filter((a) => a.id !== record.id)] })
    setAnalysis(null)
    setCalibration(null)
  }

  return (
    <div className="grid">
      <Card
        title="Analyser une activité"
        actions={
          <label className="button primary">
            Importer GPX ou FIT
            <input type="file" accept=".gpx,.fit,application/gpx+xml" hidden onChange={(e) => { load(e.target.files); e.target.value = '' }} />
          </label>
        }
      >
        <Hint>
          Importe l'enregistrement d'une course ou d'une sortie (fichier de ta montre, horodaté). L'app compare le
          réalisé à ce que ton profil prévoyait, mesure ta vitesse ascensionnelle, tes descentes et ta durabilité, et
          propose de recalibrer ton profil.
        </Hint>
        {error && <p className="warn">{error}</p>}
      </Card>

      {analysis && (
        <>
          <Card title={analysis.record.name}>
            <div className="kpis">
              <Kpi label="Distance" value={`${(analysis.record.dist / 1000).toFixed(1)} km`} sub={`+${Math.round(analysis.record.dPlus)} m`} />
              <Kpi label="Temps total" value={formatDuration(analysis.record.elapsed)} sub={`${formatDuration(analysis.record.elapsed - analysis.record.moving)} d'arrêt`} />
              <Kpi label="En mouvement" value={formatDuration(analysis.record.moving)} />
              <Kpi
                label="Prévu par ton profil"
                value={formatDuration(analysis.record.predicted)}
                sub={`écart ${pct(analysis.record.predicted / analysis.record.moving - 1)}`}
              />
            </div>
            <h3>Avance (−) ou retard (+) sur la prévision, en mouvement</h3>
            <GapChart curve={analysis.curve} />
            <h3>Intensité tenue sur le plat (% de VC)</h3>
            <IntensityChart points={analysis.intensity} athlete={athlete} />
          </Card>

          <div className="grid two">
            <Card title="Mesures par pente">
              <GradeTable grades={analysis.record.grades} athlete={athlete} />
              <Hint>
                Valeurs ramenées à ton intensité VC, nuit et technicité déduites. « Côtes courues » : 1,00 = la formule de
                Minetti décrit parfaitement tes montées en courant.
              </Hint>
            </Card>

            <Card title="Comparer à un plan">
              <select value={raceId} onChange={(e) => setRaceId(e.target.value)}>
                <option value="">— Choisir une course —</option>
                {races.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              {comparison && (
                <table className="table compact">
                  <thead>
                    <tr><th>Point</th><th>Km</th><th>Prévu</th><th>Réel</th><th>Écart</th></tr>
                  </thead>
                  <tbody>
                    {comparison.map((c) => {
                      const gap = c.real - c.planned
                      return (
                        <tr key={c.name + c.dist}>
                          <td>{c.name}</td>
                          <td>{(c.dist / 1000).toFixed(1)}</td>
                          <td>{formatDuration(c.planned)}</td>
                          <td>{formatDuration(c.real)}</td>
                          <td className={gap > 0 ? 'warn-text' : 'ok-text'}>{gap > 0 ? '+' : '−'}{formatDuration(Math.abs(gap))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              <Hint>Le plan est calculé avec ton profil actuel ; les temps réels incluent les arrêts.</Hint>
            </Card>
          </div>

          <Card title="Calibrer mon profil">
            {!calibration ? (
              <div className="row">
                <button className="primary" onClick={preview}>Calculer la calibration</button>
                <button onClick={() => save(false)}>Enregistrer sans calibrer</button>
              </div>
            ) : (
              <>
                <ul className="changes">
                  {calibration.changes.map((c) => <li key={c}>{c}</li>)}
                </ul>
                <Hint>
                  Calibration sur cette activité et les {athlete.activities.filter((a) => a.useForCalibration).length} activité(s)
                  cochée(s) de l'historique.
                </Hint>
                <div className="row">
                  <button className="primary" onClick={() => save(true)}>Appliquer au profil et enregistrer</button>
                  <button onClick={() => save(false)}>Enregistrer sans calibrer</button>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      <History athlete={athlete} races={races} onChange={onChange} />
    </div>
  )
}

function History({ athlete, races, onChange }: Props) {
  const [result, setResult] = useState<Calibration | null>(null)
  const set = (activities: ActivityRecord[]) => onChange({ ...athlete, activities })
  if (!athlete.activities.length) {
    return (
      <Card title="Historique des courses">
        <p className="muted">Aucune activité analysée. Chaque activité enregistrée ici affine la calibration.</p>
      </Card>
    )
  }
  return (
    <Card
      title="Historique des courses"
      actions={
        <button onClick={() => setResult(calibrateFromActivities(athlete, athlete.activities))}>
          Recalibrer avec les activités cochées
        </button>
      }
    >
      {result && (
        <div className="banner info">
          <ul className="changes">{result.changes.map((c) => <li key={c}>{c}</li>)}</ul>
          <span className="row tight">
            <button className="primary" onClick={() => { onChange({ ...result.athlete, activities: athlete.activities }); setResult(null) }}>Appliquer</button>
            <button className="ghost" onClick={() => setResult(null)}>Annuler</button>
          </span>
        </div>
      )}
      <div className="scroll">
        <table className="table">
          <thead>
            <tr><th>Calibrer</th><th>Date</th><th>Activité</th><th>Distance</th><th>D+</th><th>Réel (mouv.)</th><th>Prévu</th><th>Écart</th><th>Plan</th><th /></tr>
          </thead>
          <tbody>
            {athlete.activities.map((a) => (
              <tr key={a.id}>
                <td>
                  <input type="checkbox" checked={a.useForCalibration} onChange={(e) => set(athlete.activities.map((x) => (x.id === a.id ? { ...x, useForCalibration: e.target.checked } : x)))} />
                </td>
                <td>{a.date.slice(0, 10)}</td>
                <td>{a.name}</td>
                <td>{(a.dist / 1000).toFixed(1)} km</td>
                <td>{Math.round(a.dPlus)} m</td>
                <td>{formatDuration(a.moving)}</td>
                <td>{formatDuration(a.predicted)}</td>
                <td>{pct(a.predicted / a.moving - 1)}</td>
                <td className="muted">{races.find((r) => r.id === a.raceId)?.name ?? ''}</td>
                <td><button className="ghost" onClick={() => set(athlete.activities.filter((x) => x.id !== a.id))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Hint>« Prévu » : prédiction du profil au moment de l'analyse. L'écart montre comment ton modèle s'améliore au fil des calibrations.</Hint>
    </Card>
  )
}

function GradeTable({ grades, athlete }: { grades: GradeStat[]; athlete: Athlete }) {
  return (
    <table className="table compact">
      <thead>
        <tr><th>Pente</th><th>Distance</th><th>Allure</th><th>Mesuré</th><th>Profil actuel</th></tr>
      </thead>
      <tbody>
        {grades.map((g) => {
          const mean = (g.dz / g.dist) * 100
          const runClimb = g.lo === 3
          const up = g.lo >= 0 && !runClimb
          const current = up
            ? `${Math.round(interp(athlete.vam, mean, (p) => p.grade, (p) => p.vam))} m/h`
            : runClimb
              ? '1,00'
              : `×${interp(athlete.descent, mean, (p) => p.grade, (p) => p.factor).toFixed(2)}`
          return (
            <tr key={`${g.lo}${g.hi}`}>
              <td>{runClimb ? `Côtes courues ${g.lo}–${g.hi} %` : `${g.lo} à ${g.hi} %`}</td>
              <td>{(g.dist / 1000).toFixed(1)} km</td>
              <td>{formatPace(g.time / (g.dist / 1000))}</td>
              <td><strong>{up ? `${Math.round(g.normalized)} m/h` : runClimb ? g.normalized.toFixed(2) : `×${g.normalized.toFixed(2)}`}</strong></td>
              <td className="muted">{current}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// --- Graphiques -------------------------------------------------------------

const W = 900
const H = 200
const M = { l: 52, r: 12, t: 12, b: 26 }

function scale(d0: number, d1: number, r0: number, r1: number) {
  return (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0)
}

function GapChart({ curve }: { curve: Analysis['curve'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const gaps = curve.map((c) => c.real - c.predicted)
  const lim = Math.max(60, ...gaps.map(Math.abs))
  const total = curve[curve.length - 1].dist
  const x = scale(0, total, M.l, W - M.r)
  const y = scale(-lim, lim, H - M.b, M.t)
  const line = curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.dist).toFixed(1)},${y(gaps[i]).toFixed(1)}`).join('')
  const ticks = [-lim, -lim / 2, 0, lim / 2, lim]
  const h = hover !== null ? curve[hover] : null
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      onMouseMove={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
        const d = (((e.clientX - r.left) / r.width) * W - M.l) / (W - M.l - M.r) * total
        setHover(Math.max(0, Math.min(curve.length - 1, Math.round(d / 500))))
      }}
      onMouseLeave={() => setHover(null)}
      role="img"
      aria-label="Écart entre le temps réel et le temps prévu le long du parcours"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
          <text x={M.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{t === 0 ? '0' : `${t > 0 ? '+' : '−'}${Math.round(Math.abs(t) / 60)}′`}</text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={x(total * f)} y={H - 6} textAnchor={f === 1 ? 'end' : f === 0 ? 'start' : 'middle'} className="tick">{((total * f) / 1000).toFixed(0)} km</text>
      ))}
      <path d={line} className="series-1 line" />
      {h && hover !== null && (
        <g>
          <line x1={x(h.dist)} x2={x(h.dist)} y1={M.t} y2={H - M.b} className="crosshair" />
          <circle cx={x(h.dist)} cy={y(gaps[hover])} r={4} className="series-1 dot" />
          <text x={Math.min(x(h.dist) + 8, W - 200)} y={M.t + 12} className="tip">
            km {(h.dist / 1000).toFixed(1)} · réel {formatDuration(h.real)} · prévu {formatDuration(h.predicted)} · {gaps[hover] > 0 ? 'retard' : 'avance'} {formatDuration(Math.abs(gaps[hover]), true).replace(/^0:/, '')}
          </text>
        </g>
      )}
    </svg>
  )
}

function IntensityChart({ points, athlete }: { points: [number, number][]; athlete: Athlete }) {
  const [hover, setHover] = useState<number | null>(null)
  const maxH = Math.max(1, ...points.map((p) => p[0])) * 1.05
  const ys = [...points.map((p) => p[1]), athlete.durability.pct1h, averageIntensity(maxH, athlete.durability)]
  const y0 = Math.floor(Math.min(...ys) * 10) / 10 - 0.05
  const y1 = Math.ceil(Math.max(...ys) * 10) / 10
  const x = scale(0, maxH, M.l, W - M.r)
  const y = scale(y0, y1, H - M.b, M.t)
  const model: string[] = []
  for (let i = 0; i <= 60; i++) {
    const h = (maxH * i) / 60
    model.push(`${i ? 'L' : 'M'}${x(h).toFixed(1)},${y(intensityAt(Math.max(h, 0.01), athlete.durability)).toFixed(1)}`)
  }
  const ticks: number[] = []
  for (let v = Math.ceil(y0 * 20) / 20; v <= y1 + 1e-9; v += 0.05) ticks.push(v)
  return (
    <>
      <div className="legend">
        <span><i className="swatch series-1" /> Observé (médiane par ¼ h)</span>
        <span><i className="swatch series-2" /> Profil actuel</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Intensité tenue au fil des heures, observée et prévue" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={M.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{Math.round(t * 100)} %</text>
          </g>
        ))}
        {Array.from({ length: Math.floor(maxH) + 1 }, (_, h) => (
          <text key={h} x={x(h)} y={H - 6} textAnchor="middle" className="tick">{h} h</text>
        ))}
        <path d={model.join('')} className="series-2 line" />
        {points.map(([h, v], i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <circle cx={x(h)} cy={y(v)} r={12} fill="transparent" />
            <circle cx={x(h)} cy={y(v)} r={4.5} className="series-1 dot" />
          </g>
        ))}
        {hover !== null && points[hover] && (
          <text x={Math.min(x(points[hover][0]) + 10, W - 230)} y={M.t + 12} className="tip">
            {formatDuration(points[hover][0] * 3600)} : {Math.round(points[hover][1] * 100)} % observé · profil {Math.round(intensityAt(points[hover][0], athlete.durability) * 100)} %
          </text>
        )}
      </svg>
    </>
  )
}
