import { useMemo, useState } from 'react'
import { buildCourseGpx, download } from '../lib/exportGpx'
import { buildCourseFit } from '../lib/fit'
import { fetchRaceWeather } from '../lib/weather'
import { parseGpx } from '../lib/gpx'
import { planOptions } from '../lib/plan'
import { calibrateDurability, simulate, type SimOptions } from '../lib/model'
import { computeAutoPoints, mergeAutoPoints, METHOD_LABELS, type AutoSplitMethod } from '../lib/splits'
import { formatClock, formatDuration, formatPace, parseDuration, zonedToUtc } from '../lib/time'
import type { Athlete, CalcMode, Checkpoint, CheckpointKind, Race, SimResult, Track } from '../lib/types'
import { Kpi } from './CsCalculator'
import { PrintSheets, type PrintFormat } from './PrintSheets'
import { ProfileChart } from './ProfileChart'
import { Card, Hint, Num, Toggle } from './ui'

const MODE_LABELS: Record<CalcMode, string> = {
  physio: 'VC + vitesse asc.',
  gap: 'Vitesse plat équivalente',
  kme: 'Km-effort',
}

const KIND_LABELS: Record<CheckpointKind, string> = {
  ravito: 'Ravito',
  split: 'Point inter',
  cutoff: 'Barrière',
  info: 'Repère',
}

const TIME_ZONES = ['Europe/Paris', 'Europe/Zurich', 'Europe/Rome', 'Europe/Madrid', 'Europe/London', 'Atlantic/Canary', 'Indian/Reunion', 'America/Martinique', 'America/New_York', 'America/Denver', 'America/Los_Angeles', 'Asia/Kathmandu', 'Asia/Hong_Kong']

export function useRaceComputation(race: Race, athlete: Athlete) {
  const track = useMemo<Track | null>(() => {
    try {
      return parseGpx(race.gpxText, race.smoothing)
    } catch {
      return null
    }
  }, [race.gpxText, race.smoothing])

  const opts = useMemo<SimOptions | null>(() => (track ? planOptions(race, track) : null), [track, race])

  const sim = useMemo<SimResult | null>(() => (track && opts ? simulate(track, athlete, opts) : null), [track, opts, athlete])
  return { track, opts, sim }
}

export function RacePlan({
  race,
  athlete,
  onChange,
  onAthleteChange,
}: {
  race: Race
  athlete: Athlete
  onChange: (r: Race) => void
  onAthleteChange: (a: Athlete) => void
}) {
  const { track, opts, sim } = useRaceComputation(race, athlete)
  const [method, setMethod] = useState<AutoSplitMethod>('peaks')
  const [methodValue, setMethodValue] = useState(METHOD_LABELS.peaks.def)
  const [printFormat, setPrintFormat] = useState<PrintFormat | null>(null)
  const [compare, setCompare] = useState(false)
  const [weather, setWeather] = useState<{ busy: boolean; info: string | null; error: string | null }>({ busy: false, info: null, error: null })

  const set = (patch: Partial<Race>) => onChange({ ...race, ...patch })
  const setEnv = <K extends keyof Race['env']>(k: K, v: Race['env'][K]) => set({ env: { ...race.env, [k]: v } })
  const setCp = (id: string, patch: Partial<Checkpoint>) =>
    set({ checkpoints: race.checkpoints.map((c) => (c.id === id ? { ...c, ...patch, auto: patch.dist !== undefined || patch.name !== undefined || patch.kind !== undefined ? false : c.auto } : c)) })

  const startMs = zonedToUtc(race.env.start, race.env.timeZone).getTime()

  const compareResults = useMemo(() => {
    if (!compare || !track || !opts) return null
    return (['physio', 'gap', 'kme'] as CalcMode[]).map((mode) => ({ mode, sim: simulate(track, athlete, { ...opts, mode }) }))
  }, [compare, track, opts, athlete])

  if (!track || !sim || !opts) {
    return <Card title={race.name}><p className="warn">Impossible de lire le GPX de cette course.</p></Card>
  }

  const addPoint = (dist: number, kind: CheckpointKind = 'ravito', name?: string) => {
    const cp: Checkpoint = {
      id: crypto.randomUUID(),
      dist: Math.round(dist),
      name: name ?? `${KIND_LABELS[kind]} km ${(dist / 1000).toFixed(1)}`,
      kind,
      stopMin: kind === 'ravito' ? 3 : 0,
      cutoff: '',
      water: 0,
      carbs: 0,
      notes: '',
      auto: false,
    }
    // Un point manuel remplace un point auto trop proche (moins de 300 m).
    const kept = race.checkpoints.filter((c) => !(c.auto && Math.abs(c.dist - cp.dist) < 300))
    set({ checkpoints: [...kept, cp].sort((a, b) => a.dist - b.dist) })
  }

  const generate = () => {
    const pts = computeAutoPoints(track, { method, value: methodValue }, race.kme, sim.points)
    set({ checkpoints: mergeAutoPoints(race.checkpoints, pts) })
  }

  const importWaypoints = () => {
    let cps = race.checkpoints
    for (const w of track.waypoints) {
      if (cps.some((c) => Math.abs(c.dist - w.dist) < 100)) continue
      cps = [...cps, { id: crypto.randomUUID(), dist: w.dist, name: w.name, kind: 'ravito' as const, stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
    }
    set({ checkpoints: cps.sort((a, b) => a.dist - b.dist) })
  }

  const fillNutrition = () => {
    // Quantités entre un ravito et le suivant, selon le temps prévu.
    const rows = sim.splits
    const updated = new Map<string, { water: number; carbs: number }>()
    let lastRavito: string | null = null
    let acc = 0
    for (const r of rows) {
      if (lastRavito) {
        acc += r.moveTime
      }
      if (r.cp.kind === 'ravito' || r.cp.id === '__finish') {
        if (lastRavito) {
          updated.set(lastRavito, {
            water: Math.round((acc / 3600) * race.waterPerH * 10) / 10,
            carbs: Math.round((acc / 3600) * race.carbsPerH),
          })
        }
        lastRavito = r.cp.id
        acc = 0
      }
    }
    set({ checkpoints: race.checkpoints.map((c) => (updated.has(c.id) ? { ...c, ...updated.get(c.id)! } : c)) })
  }

  const fileBase = race.name.replace(/[^\w-]+/g, '_')
  const exportGpx = () => download(`${fileBase}_plan.gpx`, buildCourseGpx(race, track, sim))
  const exportFit = () => download(`${fileBase}_plan.fit`, buildCourseFit(race, track, sim), 'application/vnd.ant.fit')

  const loadWeather = async () => {
    setWeather({ busy: true, info: null, error: null })
    try {
      const p = track.points[0]
      const w = await fetchRaceWeather(p.lat, p.lon, new Date(startMs), sim.totalTime)
      const round = (x: number) => Math.round(x * 10) / 10
      setEnv('heat', { ...race.env.heat, tMax: round(w.tMax), tMin: round(w.tMin), refAlt: Math.round(w.elevation), note: w.note })
      const extras = [
        w.precipProb !== null ? `pluie ${Math.round(w.precipProb)} %` : null,
        w.precipMm !== null ? `${round(w.precipMm)} mm/j` : null,
        w.windMax !== null ? `vent max ${Math.round(w.windMax)} km/h` : null,
      ].filter(Boolean)
      setWeather({ busy: false, info: extras.join(' · '), error: null })
    } catch (e) {
      setWeather({ busy: false, info: null, error: (e as Error).message })
    }
  }

  const calibrate = () => {
    const txt = prompt('Temps réalisé sur cette course (h:mm:ss) ?')
    if (!txt) return
    const target = parseDuration(txt)
    if (!target) return
    const d = calibrateDurability(track, athlete, opts, target)
    if (!d) {
      alert("Temps hors d'atteinte avec ce profil : ajuste d'abord VC, VAM ou %VC 1 h.")
      return
    }
    const val = d.mode === 'log' ? `k = ${(d.k * 100).toFixed(1)}` : `perte = ${(d.lossPerH * 100).toFixed(2)} %/h`
    if (confirm(`Durabilité calibrée : ${val}. Appliquer au profil ?`)) onAthleteChange({ ...athlete, durability: d })
  }

  const ravitos = sim.splits.filter((s) => s.cp.kind === 'ravito')
  const totalStops = race.checkpoints.reduce((a, c) => a + c.stopMin * 60, 0)
  const nightShare = sim.points.filter((p) => p.night).length / sim.points.length

  return (
    <div className="plan">
      <div className="no-print">
        <Card
          title={
            <input className="title-input" value={race.name} onChange={(e) => set({ name: e.target.value })} />
          }
          actions={
            <>
              <button onClick={() => setPrintFormat('a4')}>🖨 Feuille A4</button>
              <button onClick={() => setPrintFormat('strip')}>🖨 Bande</button>
              <button onClick={() => setPrintFormat('crew')}>🖨 Assistance</button>
              <button className="primary" onClick={exportFit} title="Parcours FIT pour Garmin Connect / PacePro (points de ravito, heures prévues)">
                ⌚ Export Garmin (FIT)
              </button>
              <button onClick={exportGpx} title="Parcours GPX horodaté avec waypoints">GPX</button>
            </>
          }
        >
          <div className="kpis">
            <Kpi label="Distance" value={`${(track.totalDist / 1000).toFixed(1)} km`} sub={`${sim.totalKme.toFixed(1)} km-e`} />
            <Kpi label="Dénivelé" value={`+${Math.round(track.dPlus)} m`} sub={`−${Math.round(track.dMinus)} m`} />
            <Kpi label="Temps prévu" value={formatDuration(sim.totalTime)} sub={`dont ${formatDuration(totalStops)} d'arrêts`} />
            <Kpi label="Arrivée" value={formatClock(new Date(startMs + sim.totalTime * 1000), race.env.timeZone, true)} sub={`${Math.round(nightShare * 100)} % de nuit`} />
            <Kpi label="Allure moy." value={`${formatPace(sim.totalTime / (track.totalDist / 1000))}/km`} sub={`${formatPace(sim.totalTime / sim.totalKme)}/km-e`} />
          </div>
          <ProfileChart points={sim.points} splits={sim.splits} timeZone={race.env.timeZone} startMs={startMs} onPick={(d) => addPoint(d)} />
          <Hint>Clique sur le profil pour ajouter un ravito à cet endroit. Bandes grises : nuit. Barre colorée sous le profil : technicité (jaune 2 → violet 5).</Hint>
        </Card>

        <div className="grid three">
          <Card title="Départ et calcul">
            <div className="fields">
              <label className="field">
                <span className="field-label">Départ</span>
                <input type="datetime-local" value={race.env.start} onChange={(e) => setEnv('start', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Fuseau</span>
                <select value={race.env.timeZone} onChange={(e) => setEnv('timeZone', e.target.value)}>
                  {TIME_ZONES.includes(race.env.timeZone) ? null : <option>{race.env.timeZone}</option>}
                  {TIME_ZONES.map((z) => <option key={z}>{z}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Mode de calcul</span>
                <select value={race.mode} onChange={(e) => set({ mode: e.target.value as CalcMode })}>
                  {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <Num label="1 km-e =" value={race.kme.upPer1km} onChange={(v) => set({ kme: { ...race.kme, upPer1km: v } })} unit="m D+" min={1} />
              <Num label="D− (0 = ignoré)" value={race.kme.downPer1km} onChange={(v) => set({ kme: { ...race.kme, downPer1km: v } })} unit="m = 1 km" min={0} />
              <Num label="Lissage altitude" value={race.smoothing} onChange={(v) => set({ smoothing: Math.round(v) })} min={0} max={10} title="0 = brut ; plus haut = D+ plus faible" />
            </div>
            <div className="row">
              <Toggle label="Comparer les modes" checked={compare} onChange={setCompare} />
              <button className="ghost" onClick={calibrate} title="Ajuste ta durabilité pour retrouver un temps réalisé">Calibrer sur un temps réel…</button>
            </div>
          </Card>

          <Card title="Environnement">
            <Toggle label="Nuit (auto selon soleil)" checked={race.env.night.enabled} onChange={(v) => setEnv('night', { ...race.env.night, enabled: v })} />
            {race.env.night.enabled && (
              <div className="fields sub">
                <Num label="Pénalité" value={race.env.night.penalty} scale={100} onChange={(v) => setEnv('night', { ...race.env.night, penalty: v })} unit="%" />
                <Num label="+ par niveau techn." value={race.env.night.perTech} scale={100} onChange={(v) => setEnv('night', { ...race.env.night, perTech: v })} unit="%" />
              </div>
            )}
            <Toggle label="Chaleur" checked={race.env.heat.enabled} onChange={(v) => setEnv('heat', { ...race.env.heat, enabled: v })} />
            {race.env.heat.enabled && (
              <div className="fields sub">
                <Num label="T° max (jour)" value={race.env.heat.tMax} onChange={(v) => setEnv('heat', { ...race.env.heat, tMax: v, note: '' })} unit="°C" />
                <Num label="T° min (nuit)" value={race.env.heat.tMin} onChange={(v) => setEnv('heat', { ...race.env.heat, tMin: v, note: '' })} unit="°C" />
                <Num label="à l'altitude" value={race.env.heat.refAlt} onChange={(v) => setEnv('heat', { ...race.env.heat, refAlt: v, note: '' })} unit="m" />
                <Num label="Seuil" value={race.env.heat.threshold} onChange={(v) => setEnv('heat', { ...race.env.heat, threshold: v })} unit="°C" />
                <Num label="Pénalité" value={race.env.heat.perDeg} scale={100} onChange={(v) => setEnv('heat', { ...race.env.heat, perDeg: v })} unit="% / °C" />
              </div>
            )}
            <Toggle label="Altitude" checked={race.env.altitude.enabled} onChange={(v) => setEnv('altitude', { ...race.env.altitude, enabled: v })} />
            {race.env.altitude.enabled && (
              <div className="fields sub">
                <Num label="Au-dessus de" value={race.env.altitude.threshold} onChange={(v) => setEnv('altitude', { ...race.env.altitude, threshold: v })} unit="m" />
                <Num label="Pénalité" value={race.env.altitude.per1000} scale={100} onChange={(v) => setEnv('altitude', { ...race.env.altitude, per1000: v })} unit="% / 1000 m" />
              </div>
            )}
            <Toggle label="Technicité" checked={race.env.tech.enabled} onChange={(v) => setEnv('tech', { ...race.env.tech, enabled: v })} />
            {race.env.tech.enabled && (
              <div className="fields sub">
                {race.env.tech.factors.map((f, i) => (
                  <Num key={i} label={`Niveau ${i + 1}`} value={f} scale={100} unit="%"
                    onChange={(v) => { const factors = [...race.env.tech.factors] as typeof race.env.tech.factors; factors[i] = v; setEnv('tech', { ...race.env.tech, factors }) }} />
                ))}
              </div>
            )}
            <div className="row">
              <button onClick={loadWeather} disabled={weather.busy} title="Prévision à 15 jours, sinon normales des 5 dernières années (Open-Meteo)">
                {weather.busy ? 'Météo…' : '☁ Récupérer la météo'}
              </button>
            </div>
            {race.env.heat.note && (
              <p className="hint">
                {race.env.heat.note} : {race.env.heat.tMin}–{race.env.heat.tMax} °C à {race.env.heat.refAlt} m
                {weather.info ? ` · ${weather.info}` : ''}
              </p>
            )}
            {weather.error && <p className="warn">{weather.error}</p>}
            <Hint>Chaleur : cycle min à 6 h / max à 15 h, −0,65 °C par 100 m de montée.</Hint>
          </Card>

          <Card title="Points automatiques">
            <div className="fields">
              <label className="field">
                <span className="field-label">Méthode</span>
                <select value={method} onChange={(e) => { const m = e.target.value as AutoSplitMethod; setMethod(m); setMethodValue(METHOD_LABELS[m].def) }}>
                  {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <Num label="Valeur" value={methodValue} onChange={setMethodValue} unit={METHOD_LABELS[method].unit} min={1} />
            </div>
            <div className="row">
              <button className="primary" onClick={generate}>Générer</button>
              <button className="ghost" onClick={() => set({ checkpoints: race.checkpoints.filter((c) => !c.auto) })}>Effacer les auto</button>
              {track.waypoints.length > 0 && (
                <button className="ghost" onClick={importWaypoints}>Importer {track.waypoints.length} waypoints GPX</button>
              )}
            </div>
            <Hint>Générer remplace les points auto précédents ; tes ravitos et points modifiés à la main sont conservés.</Hint>
            <h3>Nutrition</h3>
            <div className="fields">
              <Num label="Glucides" value={race.carbsPerH} onChange={(v) => set({ carbsPerH: v })} unit="g/h" />
              <Num label="Eau" value={race.waterPerH} onChange={(v) => set({ waterPerH: v })} unit="L/h" />
            </div>
            <button className="ghost" onClick={fillNutrition} disabled={ravitos.length === 0}>Calculer eau et glucides entre ravitos</button>
            <TechOverrides race={race} onChange={onChange} />
          </Card>
        </div>

        {compareResults && (
          <Card title="Comparaison des modes de calcul">
            <div className="scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Point</th>
                    <th>Km</th>
                    {compareResults.map((c) => <th key={c.mode}>{MODE_LABELS[c.mode]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sim.splits.map((s, i) => (
                    <tr key={s.cp.id}>
                      <td>{s.cp.name}</td>
                      <td>{(s.to / 1000).toFixed(1)}</td>
                      {compareResults.map((c) => (
                        <td key={c.mode}>
                          {formatDuration(c.sim.splits[i]?.arrival ?? NaN)}{' '}
                          <span className="muted">{formatClock(c.sim.splits[i]?.arrivalClock ?? new Date(NaN), race.env.timeZone)}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card
          title="Temps de passage"
          actions={<button onClick={() => addPoint(track.totalDist / 2, 'ravito')}>+ Ajouter un point</button>}
        >
          <div className="scroll">
            <table className="table splits">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Nom</th>
                  <th>Km</th>
                  <th>Tronçon</th>
                  <th>D+ / D−</th>
                  <th>Temps tronçon</th>
                  <th>Allure</th>
                  <th>Cumul</th>
                  <th>Heure</th>
                  <th>Arrêt</th>
                  <th>Barrière</th>
                  <th>Eau / Glu.</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sim.splits.map((s) => {
                  const isFinish = s.cp.id === '__finish'
                  const cp = s.cp
                  return (
                    <tr key={cp.id} className={`${s.night ? 'is-night' : ''} kind-${cp.kind} ${cp.auto ? 'is-auto' : ''}`}>
                      <td>
                        {isFinish ? 'Arrivée' : (
                          <select value={cp.kind} onChange={(e) => setCp(cp.id, { kind: e.target.value as CheckpointKind })}>
                            {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        )}
                      </td>
                      <td>{isFinish ? cp.name : <input type="text" value={cp.name} onChange={(e) => setCp(cp.id, { name: e.target.value })} />}</td>
                      <td>{isFinish ? (s.to / 1000).toFixed(1) : <Num value={cp.dist / 1000} width={64} onChange={(v) => setCp(cp.id, { dist: Math.max(0, Math.min(track.totalDist, v * 1000)) })} />}</td>
                      <td>{(s.dist / 1000).toFixed(1)} km<br /><span className="muted">{s.kme.toFixed(1)} km-e</span></td>
                      <td>+{Math.round(s.dPlus)}<br /><span className="muted">−{Math.round(s.dMinus)}</span></td>
                      <td>{formatDuration(s.moveTime)}</td>
                      <td>{formatPace(s.avgPace)}</td>
                      <td><strong>{formatDuration(s.arrival)}</strong></td>
                      <td><strong>{formatClock(s.arrivalClock, race.env.timeZone, sim.totalTime > 20 * 3600)}</strong>{s.night && ' 🌙'}</td>
                      <td>{isFinish ? '' : <Num value={cp.stopMin} width={44} unit="min" min={0} onChange={(v) => setCp(cp.id, { stopMin: v })} />}</td>
                      <td>
                        {!isFinish && (
                          <input type="datetime-local" value={cp.cutoff} onChange={(e) => setCp(cp.id, { cutoff: e.target.value })} />
                        )}
                        {s.cutoffMargin !== null && (
                          <div className={s.cutoffMargin < 1800 ? 'danger' : s.cutoffMargin < 3600 ? 'warn-text' : 'ok-text'}>
                            {s.cutoffMargin < 0 ? 'Hors délai ' : 'Marge '}{formatDuration(Math.abs(s.cutoffMargin))}
                          </div>
                        )}
                      </td>
                      <td>
                        {!isFinish && (
                          <>
                            <Num value={cp.water} width={44} unit="L" min={0} onChange={(v) => setCp(cp.id, { water: v })} />
                            <Num value={cp.carbs} width={44} unit="g" min={0} onChange={(v) => setCp(cp.id, { carbs: v })} />
                          </>
                        )}
                      </td>
                      <td>{!isFinish && <input type="text" value={cp.notes} placeholder="frontale, sac…" onChange={(e) => setCp(cp.id, { notes: e.target.value })} />}</td>
                      <td>{!isFinish && <button className="ghost" onClick={() => set({ checkpoints: race.checkpoints.filter((c) => c.id !== cp.id) })}>✕</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Hint>Eau / glucides : quantités à emporter depuis ce point jusqu'au ravito suivant.</Hint>
        </Card>
      </div>

      {printFormat && (
        <PrintSheets format={printFormat} race={race} track={track} sim={sim} athlete={athlete} onDone={() => setPrintFormat(null)} />
      )}
    </div>
  )
}

function TechOverrides({ race, onChange }: { race: Race; onChange: (r: Race) => void }) {
  const set = (techOverrides: Race['techOverrides']) => onChange({ ...race, techOverrides })
  return (
    <>
      <h3>Technicité manuelle</h3>
      <Hint>Par défaut, la technicité est estimée d'après la pente. Ici, tu la forces sur des tronçons.</Hint>
      {race.techOverrides.map((o) => (
        <div className="row tight" key={o.id}>
          <Num value={o.from / 1000} width={56} unit="km" onChange={(v) => set(race.techOverrides.map((x) => (x.id === o.id ? { ...x, from: v * 1000 } : x)))} />
          →
          <Num value={o.to / 1000} width={56} unit="km" onChange={(v) => set(race.techOverrides.map((x) => (x.id === o.id ? { ...x, to: v * 1000 } : x)))} />
          <select value={o.level} onChange={(e) => set(race.techOverrides.map((x) => (x.id === o.id ? { ...x, level: Number(e.target.value) as 1 } : x)))}>
            {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>Niveau {l}</option>)}
          </select>
          <button className="ghost" onClick={() => set(race.techOverrides.filter((x) => x.id !== o.id))}>✕</button>
        </div>
      ))}
      <button className="ghost" onClick={() => set([...race.techOverrides, { id: crypto.randomUUID(), from: 0, to: 1000, level: 3 }])}>
        + Tronçon technique
      </button>
    </>
  )
}
