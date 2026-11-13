import { Check, Trash2, Upload, UserCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  analyzeActivity,
  calibrateFromActivities,
  calibrateOnActivity,
  compareWithPlan,
  defaultLapKeep,
  lapKeepWithoutEnds,
  lapPortions,
  readActivity,
  type Activity,
  type Analysis,
  type Calibration,
  type Portions,
} from '../lib/activity'
import type { LapIntensity } from '../lib/fitDecode'
import { DEFAULT_ENV } from '../lib/defaults'
import { haversine } from '../lib/gpx'
import { averageIntensity, intensityAt, interp } from '../lib/model'
import { computePlan } from '../lib/plan'
import { formatDuration, formatPace } from '../lib/time'
import { analyzeSession, cardiacDrift, DRIFT_MIN_SECONDS, type CardiacDrift } from '../lib/insights'
import { VAM_MIN_GRADE } from '../lib/vam'
import type { ActivityRecord, Athlete, GradeStat, Race } from '../lib/types'
import { colorForIndex } from '../lib/zones'
import { Card, Hint, Kpi } from './ui'

interface Props {
  athlete: Athlete
  races: Race[]
  onChange: (a: Athlete) => void
}

const pct = (x: number) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)} %`

export function ActivityPanel({ athlete, races, onChange }: Props) {
  const [activity, setActivity] = useState<Activity | null>(null)
  // Tours de la montre retenus (échauffement et retour au calme exclus d'office s'ils sont marqués).
  const [lapKeep, setLapKeep] = useState<boolean[]>([])
  const portions = useMemo(() => (activity ? lapPortions(activity, lapKeep) : null), [activity, lapKeep])
  const analysis = useMemo(() => (activity ? analyzeActivity(activity, athlete, DEFAULT_ENV, portions) : null), [activity, athlete, portions])
  const chooseLaps = (keep: boolean[]) => {
    if (!keep.some(Boolean)) return
    setLapKeep(keep)
    setCalibration(null)
  }
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
      setLapKeep(defaultLapKeep(act))
      setActivity(act)
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
      setActivity(null)
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

  const drift = useMemo(() => (activity ? cardiacDrift(activity, portions) : null), [activity, portions])
  const records = analysis ? [analysis.record, ...athlete.activities] : athlete.activities
  const preview = () => {
    if (!analysis) return
    setCalibration(calibrateOnActivity(athlete, records, analysis.activity, analysis.record, DEFAULT_ENV, portions))
  }
  const save = (withCalibration: boolean) => {
    if (!analysis) return
    const record: ActivityRecord = {
      ...analysis.record,
      raceId: raceId || undefined,
      // Découplage cardiaque gardé pour le suivi de la durabilité.
      metrics: drift
        ? { ...analysis.record.metrics, decoupling: drift.decoupling, driftOnsetH: drift.onsetH, driftHours: drift.seconds / 3600 }
        : analysis.record.metrics,
    }
    const base = withCalibration && calibration ? calibration.athlete : athlete
    onChange({ ...base, activities: [record, ...athlete.activities.filter((a) => a.id !== record.id)] })
    setActivity(null)
    setCalibration(null)
  }

  return (
    <div className="grid">
      <Card
        title="Analyser une séance"
        actions={
          <label className="button primary">
            <Upload /> Importer GPX ou FIT
            <input type="file" accept=".gpx,.fit,application/gpx+xml" hidden onChange={(e) => { load(e.target.files); e.target.value = '' }} />
          </label>
        }
      >
        <Hint>
          Importe n'importe quelle séance ou course (GPX ou FIT de ta montre, horodaté) : temps par zone, détail des tours,
          meilleurs efforts comparés à ta VC et ton D′, détection d'un test VC, et calibration de ta vitesse ascensionnelle,
          de tes descentes et de ta durabilité.
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
            {analysis.activity.laps.length > 1 && <LapPicker activity={analysis.activity} keep={lapKeep} onChange={chooseLaps} />}
            <h3>Intensité tenue sur le plat (% de VC)</h3>
            <IntensityChart points={analysis.intensity} athlete={athlete} />
            <h3>Durabilité : découplage cardiaque</h3>
            {drift ? (
              <DriftBlock drift={drift} />
            ) : (
              <p className="muted small">
                {analysis.activity.hr.some((h) => Number.isFinite(h))
                  ? `Il faut au moins ${DRIFT_MIN_SECONDS / 3600} h en mouvement, à allure assez régulière, pour mesurer le découplage.`
                  : 'Pas de fréquence cardiaque dans ce fichier : découplage non mesurable.'}
              </p>
            )}
          </Card>

          <SessionInsights activity={analysis.activity} athlete={athlete} onChange={onChange} portions={portions} lapKeep={lapKeep} onLapKeep={chooseLaps} />

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
                  <button className="primary" onClick={() => save(true)}><UserCheck /> Appliquer au profil et enregistrer</button>
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
                <td><button className="ghost" onClick={() => set(athlete.activities.filter((x) => x.id !== a.id))} aria-label="Supprimer"><Trash2 /></button></td>
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

/**
 * Découplage cardiaque (Hunter et al., 2025) : rapport FC / vitesse au plat par rapport au début
 * (10 à 30 min), moment où la dérive commence et son ampleur (Maunder et al., 2021).
 */
function DriftBlock({ drift }: { drift: CardiacDrift }) {
  const [hover, setHover] = useState<number | null>(null)
  const fr = (x: number) => x.toFixed(1).replace('.', ',')
  const pctFr = (x: number) => `${x > 0 ? '+' : ''}${fr(x * 100)} %`
  const pts = drift.points
  const maxH = (drift.seconds / 3600) * 1.02
  const ys = [0, ...pts.map((p) => p.drift)]
  const y0 = Math.min(-0.02, Math.floor(Math.min(...ys) * 50) / 50)
  const y1 = Math.max(0.04, Math.ceil(Math.max(...ys) * 50) / 50)
  const x = scale(0, maxH, M.l, W - M.r)
  const y = scale(y0, y1, H - M.b, M.t)
  const ticks: number[] = []
  const step = y1 - y0 > 0.12 ? 0.04 : 0.02
  for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) ticks.push(v)
  const lastH = pts[pts.length - 1].t / 3600
  const model =
    drift.onsetH === null
      ? `M${x(pts[0].t / 3600)},${y(0)}L${x(lastH)},${y(0)}`
      : `M${x(pts[0].t / 3600)},${y(drift.level)}L${x(drift.onsetH)},${y(drift.level)}L${x(lastH)},${y(drift.level + drift.perHour * (lastH - drift.onsetH))}`
  const strong = drift.decoupling >= 0.05
  return (
    <>
      <p>
        FC / vitesse au plat : <strong style={{ color: strong ? 'var(--warn)' : 'var(--ok)' }}>{pctFr(drift.decoupling)}</strong> sur les 20 dernières
        minutes par rapport au début ({Math.round(drift.baseFrom / 60)} à {Math.round(drift.baseTo / 60)} min, {fr(drift.baseline)} bpm par km/h).{' '}
        {drift.onsetH !== null
          ? `La dérive commence vers ${formatDuration(drift.onsetH * 3600)} puis progresse d'environ ${fr(drift.perHour * 100)} % par heure.`
          : 'Pas de dérive nette : le coût cardiaque reste stable.'}{' '}
        {strong
          ? "À allure égale, l'effort t'a coûté de plus en plus cher (chaleur, hydratation, glycogène… ou durabilité à travailler)."
          : 'Découplage faible : bonne tenue sur cette séance (repère courant : moins de 5 %).'}
      </p>
      <div className="legend">
        <span><i className="swatch series-1" /> Écart au début, par 10 min</span>
        <span><i className="swatch series-2" /> Palier puis dérive</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Découplage cardiaque au fil de la séance" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className={Math.abs(t) < 1e-9 ? 'axis' : 'grid'} />
            <text x={M.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{`${t > 0 ? '+' : ''}${Math.round(t * 100)} %`}</text>
          </g>
        ))}
        {Array.from({ length: Math.floor(maxH) + 1 }, (_, h) => (
          <text key={h} x={x(h)} y={H - 6} textAnchor="middle" className="tick">{h} h</text>
        ))}
        <path d={model} className="series-2 line" />
        {pts.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <circle cx={x(p.t / 3600)} cy={y(p.drift)} r={10} fill="transparent" />
            <circle cx={x(p.t / 3600)} cy={y(p.drift)} r={3.5} className="series-1 dot" />
          </g>
        ))}
        {hover !== null && pts[hover] && (
          <text x={Math.min(x(pts[hover].t / 3600) + 10, W - 260)} y={M.t + 12} className="tip">
            {formatDuration(pts[hover].t)} : {pctFr(pts[hover].drift)} ({fr(pts[hover].ratio)} bpm par km/h)
          </text>
        )}
      </svg>
      <Hint>
        Marqueur de terrain de la durabilité (Hunter et al., 2025) : à allure égale, une FC qui monte traduit un coût qui augmente.
        Fiable sur une sortie longue à allure régulière ; un fractionné, de longs arrêts ou la chaleur le faussent.
      </Hint>
    </>
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

/** Type de tour enregistré par la montre (entraînement structuré). */
const LAP_TAG: Partial<Record<LapIntensity, string>> = { warmup: 'échauffement', cooldown: 'retour au calme', rest: 'repos', recovery: 'récup.' }

/**
 * Choix des tours de la montre utilisés par les analyses : temps par zone, intensité au fil des
 * heures, découplage, mesures par pente et calibration.
 */
function LapPicker({ activity, keep, onChange }: { activity: Activity; keep: boolean[]; onChange: (keep: boolean[]) => void }) {
  const laps = activity.laps
  const kept = laps.filter((_, i) => keep[i] !== false).length
  const without = lapKeepWithoutEnds(activity)
  const dur = (sec: number) => (sec < 3600 ? `${Math.round(sec / 60)}′` : formatDuration(sec))
  return (
    <div className="lap-picker">
      <h3>Tours analysés ({kept} sur {laps.length})</h3>
      <div className="lap-chips">
        {laps.map((l, i) => {
          const on = keep[i] !== false
          return (
            <label key={i} className={`lap-chip${on ? ' on' : ''}`}>
              <input type="checkbox" checked={on} onChange={(e) => onChange(laps.map((_, j) => (j === i ? e.target.checked : keep[j] !== false)))} />
              <strong>{i + 1}</strong> {dur(l.timer)} · {(l.distance / 1000).toFixed(1).replace('.', ',')} km
              {l.intensity && LAP_TAG[l.intensity] ? <span className="muted"> · {LAP_TAG[l.intensity]}</span> : null}
            </label>
          )
        })}
      </div>
      <div className="row tight">
        <button className="ghost" onClick={() => onChange(laps.map(() => true))} disabled={kept === laps.length}>Tous les tours</button>
        <button className="ghost" onClick={() => onChange(without)} disabled={without.every((v, i) => v === (keep[i] !== false))}>
          Sans échauffement ni retour au calme
        </button>
      </div>
      <Hint>
        Les tours décochés sont ignorés dans le temps par zone, l'intensité au fil des heures, le découplage cardiaque, les mesures par
        pente et la calibration. L'écart à la prévision et les meilleurs efforts portent sur toute la séance.
      </Hint>
    </div>
  )
}

/** Analyse générale : temps par zone, tours, meilleurs efforts, test VC détecté. */
function SessionInsights({
  activity,
  athlete,
  onChange,
  portions,
  lapKeep,
  onLapKeep,
}: {
  activity: Activity
  athlete: Athlete
  onChange: (a: Athlete) => void
  portions: Portions
  lapKeep: boolean[]
  onLapKeep: (keep: boolean[]) => void
}) {
  const ins = useMemo(() => analyzeSession(activity, athlete, portions), [activity, athlete, portions])
  const [done, setDone] = useState<Set<string>>(new Set())
  const label = (sec: number) => (sec < 3600 ? `${Math.round(sec / 60)}′` : `${sec / 3600} h`)
  const mark = (k: string) => setDone(new Set([...done, k]))
  return (
    <Card title="Séance">
      <h3>Temps par zone (allure ramenée au plat)</h3>
      <ZoneStack times={ins.zoneTimes} color={(k) => colorForIndex(k, athlete)} />

      {ins.hrZoneTimes && (
        <>
          <h3>Temps par zone cardiaque</h3>
          <ZoneStack times={ins.hrZoneTimes} color={(k) => colorForIndex(k)} />
        </>
      )}

      {ins.vamZoneTimes && (
        <>
          <h3>Temps par zone VAM (montées à plus de {VAM_MIN_GRADE} %)</h3>
          <ZoneStack times={ins.vamZoneTimes} color={(k) => colorForIndex(k)} />
        </>
      )}

      {(ins.tests.length > 0 || ins.csFloor) && (
        <div className="banner info suggestions">
          {ins.tests.map((t) => {
            const k = `t${t.seconds}`
            return (
              <span key={k} className="row tight">
                Un tour de {Math.round(t.seconds / 60)}′ à fond : <strong>{t.dist} m</strong> ({formatPace(t.seconds / (t.dist / 1000))}/km).
                {done.has(k) ? (
                  <span className="ok-text"><Check className="inline" /> Enregistré</span>
                ) : (
                  <button className="primary" onClick={() => { onChange({ ...athlete, csTrials: [t, ...athlete.csTrials] }); mark(k) }}>
                    Enregistrer comme test VC {Math.round(t.seconds / 60)}′
                  </button>
                )}
              </span>
            )
          })}
          {ins.csFloor && (
            <span className="row tight">
              Ton meilleur effort de {label(ins.csFloor.seconds)} dépasse ce que permettent ta VC et ton D′ : ta VC est d'au moins{' '}
              <strong>{formatPace(1000 / ins.csFloor.cs)}/km</strong> (actuelle {formatPace(1000 / athlete.cs)}/km).
              {done.has('cs') ? (
                <span className="ok-text"><Check className="inline" /> Appliqué</span>
              ) : (
                <button onClick={() => { onChange({ ...athlete, cs: ins.csFloor!.cs }); mark('cs') }}>Appliquer</button>
              )}
            </span>
          )}
        </div>
      )}

      {ins.laps.length > 1 && (
        <>
          <h3>Tours de la montre</h3>
          <div className="scroll">
            <table className="table compact">
              <thead>
                <tr><th title="Tour utilisé dans les analyses">Analysé</th><th>#</th><th>Durée</th><th>Distance</th><th>Allure</th><th>D+</th><th>Intensité (plat éq.)</th><th>Zone</th>{ins.hrZoneTimes && <th>FC moy.</th>}</tr>
              </thead>
              <tbody>
                {ins.laps.map((l) => (
                  <tr key={l.index} className={l.kept ? '' : 'muted'}>
                    <td>
                      <input
                        type="checkbox"
                        checked={lapKeep[l.index] !== false}
                        onChange={(e) => onLapKeep(activity.laps.map((_, i) => (i === l.index ? e.target.checked : lapKeep[i] !== false)))}
                        aria-label={`Utiliser le tour ${l.index + 1} dans les analyses`}
                      />
                    </td>
                    <td>{l.index + 1}{activity.laps[l.index].intensity && LAP_TAG[activity.laps[l.index].intensity!] ? <span className="muted small"> {LAP_TAG[activity.laps[l.index].intensity!]}</span> : null}</td>
                    <td>{formatDuration(l.duration, true).replace(/^0:/, '')}</td>
                    <td>{l.distance >= 1000 ? `${(l.distance / 1000).toFixed(2)} km` : `${Math.round(l.distance)} m`}</td>
                    <td>{l.distance > 0 ? `${formatPace(l.duration / (l.distance / 1000))}/km` : '—'}</td>
                    <td>{Math.round(l.dPlus)} m</td>
                    <td>{Math.round(l.intensity * 100)} % VC</td>
                    <td><i className="zone-swatch" style={{ background: colorForIndex(l.zone, athlete) }} />{athlete.zones[l.zone]?.name}</td>
                    {ins.hrZoneTimes && <td>{l.hr ? `${l.hr} bpm` : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3>Meilleurs efforts (allure ramenée au plat)</h3>
      <div className="scroll">
        <table className="table compact">
          <thead>
            <tr><th>Durée</th>{ins.best.map((b) => <th key={b.seconds}>{label(b.seconds)}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td>Réalisé</td>{ins.best.map((b) => <td key={b.seconds}>{formatPace(1000 / b.speed)}</td>)}</tr>
            <tr className="muted"><td>Max. VC + D′</td>{ins.best.map((b) => <td key={b.seconds}>{formatPace(1000 / b.predicted)}</td>)}</tr>
            <tr>
              <td>% du max.</td>
              {ins.best.map((b) => (
                <td key={b.seconds} className={b.ratio > 1.01 && b.seconds >= 120 && b.seconds <= 1800 ? 'warn-text' : ''}>{Math.round(b.ratio * 100)} %</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <Hint>
        « Max. VC + D′ » : ce que ton profil permet au mieux sur chaque durée (modèle valable de 2 à 30 min environ). Un effort au-dessus
        signifie que ta VC (ou ton D′) est sous-estimée ; en dessous, la séance n'était simplement pas un effort maximal.
      </Hint>
    </Card>
  )
}

/** Barre empilée et légende du temps passé par zone. */
function ZoneStack({ times, color }: { times: { index: number; name: string; seconds: number }[]; color: (k: number) => string }) {
  const total = times.reduce((a, z) => a + z.seconds, 0) || 1
  const fmt = (sec: number) => {
    const r = Math.round(sec)
    return r < 3600 ? `${Math.floor(r / 60)}′${String(r % 60).padStart(2, '0')}` : formatDuration(r)
  }
  return (
    <>
      <div className="zone-stack" role="img" aria-label="Répartition du temps par zone">
        {times.filter((z) => z.seconds > 0).map((z) => (
          <span key={z.index} style={{ width: `${(z.seconds / total) * 100}%`, background: color(z.index) }} title={`${z.name} : ${fmt(z.seconds)}`} />
        ))}
      </div>
      <div className="zone-legend">
        {times.map((z) => (
          <span key={z.index}>
            <i className="zone-swatch" style={{ background: color(z.index) }} />
            {z.name} <strong>{fmt(z.seconds)}</strong> <span className="muted">({Math.round((z.seconds / total) * 100)} %)</span>
          </span>
        ))}
      </div>
    </>
  )
}
