import { useState } from 'react'
import { download } from '../lib/exportGpx'
import { formatDuration, formatPace, parseDuration } from '../lib/time'
import type { Athlete, PaceZone, Race, SimResult, Track } from '../lib/types'
import { buildWorkoutFit } from '../lib/workoutFit'
import { zoneColor, zoneRuns, zoneSteps, zoneText } from '../lib/zones'
import { Card, Hint, Num } from './ui'

type ZoneTarget = Omit<PaceZone, 'id' | 'from' | 'to'>

/** Choix de la cible pour la portion sélectionnée sur le profil. */
export function ZonePicker({
  athlete,
  from,
  to,
  onApply,
  onCancel,
}: {
  athlete: Athlete
  from: number
  to: number
  onApply: (z: ZoneTarget) => void
  onCancel: () => void
}) {
  const [pct, setPct] = useState(0.85)
  const [flat, setFlat] = useState(formatPace(1000 / (athlete.cs * 0.85)))
  const [pace, setPace] = useState(formatPace(1000 / (athlete.cs * 0.85)))
  const applyPace = (kind: 'flatPace' | 'pace', text: string) => {
    const sec = parseDuration(text)
    if (sec && sec > 120 && sec < 1800) onApply({ kind, value: sec, label: '' })
    else alert('Allure attendue au format m:ss (ex. 4:45).')
  }
  return (
    <div className="banner info zone-picker">
      <div>
        <strong>Portion km {(from / 1000).toFixed(1)} → {(to / 1000).toFixed(1)}</strong> ({((to - from) / 1000).toFixed(1)} km) : choisis une allure cible.
      </div>
      <div className="zone-buttons">
        {athlete.zones.map((z) => {
          const value = (z.low + z.high) / 2
          return (
            <button key={z.name} onClick={() => onApply({ kind: 'intensity', value, label: z.name })} title={`Milieu de zone : ${Math.round(value * 100)} % VC`}>
              <span>
                <i className="zone-swatch" style={{ background: zoneColor({ id: '', from: 0, to: 0, kind: 'intensity', value, label: '' }, athlete) }} />
                {z.name}
              </span>
              <small>
                {Math.round(z.low * 100)}–{Math.round(z.high * 100)} % VC · {formatPace(1000 / (athlete.cs * z.high))}–{formatPace(1000 / (athlete.cs * z.low))}/km
              </small>
            </button>
          )
        })}
      </div>
      <div className="row">
        <Num label="% de VC" value={pct} scale={100} unit="%" min={30} max={150} onChange={setPct} width={70} />
        <button onClick={() => onApply({ kind: 'intensity', value: pct, label: '' })}>Appliquer</button>
        <label className="field">
          <span className="field-label">Allure plat équivalente</span>
          <input type="text" value={flat} onChange={(e) => setFlat(e.target.value)} style={{ width: 80 }} />
        </label>
        <button onClick={() => applyPace('flatPace', flat)} title="Adaptée au terrain : plus lente en montée, plus rapide en descente">Appliquer</button>
        <label className="field">
          <span className="field-label">Allure imposée</span>
          <input type="text" value={pace} onChange={(e) => setPace(e.target.value)} style={{ width: 80 }} />
        </label>
        <button onClick={() => applyPace('pace', pace)} title="Telle quelle, sans tenir compte du terrain">Appliquer</button>
        <button className="ghost" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  )
}

/** Liste des zones d'allure de la course, temps prévus et export en entraînement. */
export function ZonesCard({ race, athlete, track, sim, onChange }: { race: Race; athlete: Athlete; track: Track; sim: SimResult; onChange: (r: Race) => void }) {
  const runs = zoneRuns(track, sim, race.zones)
  const setZones = (zones: PaceZone[]) => onChange({ ...race, zones })
  const exportWorkout = () => {
    const steps = zoneSteps(track, sim, race.zones, athlete)
    download(`${race.name.replace(/[^\w-]+/g, '_')}_allures.fit`, buildWorkoutFit(race.name.slice(0, 32), steps), 'application/vnd.ant.fit')
  }
  const addBoundaries = () => {
    const existing = race.checkpoints
    const added = runs
      .filter((r) => r.zone)
      .flatMap((r) => [
        { d: r.from, name: `Début ${r.zone!.label || 'zone'}` },
        { d: r.to, name: `Fin ${r.zone!.label || 'zone'}` },
      ])
      .filter((p) => p.d > 50 && p.d < track.totalDist - 50 && existing.every((c) => Math.abs(c.dist - p.d) > 50))
      .map((p) => ({ id: crypto.randomUUID(), dist: Math.round(p.d), name: p.name, kind: 'split' as const, stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }))
    onChange({ ...race, checkpoints: [...existing, ...added].sort((a, b) => a.dist - b.dist) })
  }
  return (
    <Card
      title="Zones d'allure"
      actions={
        <>
          <button onClick={addBoundaries} title="Ajoute des points de passage au début et à la fin de chaque zone">Points aux limites</button>
          <button className="primary" onClick={exportWorkout} title="Entraînement Garmin découpé par distance, avec une fourchette d'allure par portion">⌚ Entraînement .fit</button>
        </>
      }
    >
      <div className="scroll">
        <table className="table compact">
          <thead>
            <tr><th>De (km)</th><th>À (km)</th><th>Cible</th><th>Temps prévu</th><th>Allure moyenne prévue</th><th /></tr>
          </thead>
          <tbody>
            {race.zones.map((z) => {
              const zoneRunsOf = runs.filter((r) => r.zone?.id === z.id)
              const dist = zoneRunsOf.reduce((a, r) => a + (r.to - r.from), 0)
              const time = zoneRunsOf.reduce((a, r) => a + r.time, 0)
              const setZ = (patch: Partial<PaceZone>) => setZones(race.zones.map((x) => (x.id === z.id ? { ...x, ...patch } : x)))
              return (
                <tr key={z.id}>
                  <td><Num value={z.from / 1000} width={64} onChange={(v) => setZ({ from: Math.max(0, Math.min(z.to - 50, v * 1000)) })} /></td>
                  <td><Num value={z.to / 1000} width={64} onChange={(v) => setZ({ to: Math.min(track.totalDist, Math.max(z.from + 50, v * 1000)) })} /></td>
                  <td><i className="zone-swatch" style={{ background: zoneColor(z, athlete) }} />{zoneText(z, athlete)}</td>
                  <td>{time > 0 ? formatDuration(time) : '—'}</td>
                  <td>{dist > 0 && time > 0 ? `${formatPace(time / (dist / 1000))}/km` : '—'}</td>
                  <td><button className="ghost" onClick={() => setZones(race.zones.filter((x) => x.id !== z.id))}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Hint>
        Dans une zone, ton intensité de course est remplacée par la cible : temps de passage, export Garmin et lien assistance suivent.
        Si deux zones se chevauchent, la dernière ajoutée l'emporte. L'entraînement .fit se copie dans <code>GARMIN/NewFiles</code>.
      </Hint>
    </Card>
  )
}
