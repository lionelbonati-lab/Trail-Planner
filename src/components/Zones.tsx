import { useState, type ReactNode } from 'react'
import { download } from '../lib/exportGpx'
import { formatDuration, formatPace, parseDuration } from '../lib/time'
import type { Athlete, PaceZone, Race, SimResult, Track } from '../lib/types'
import { buildWorkoutFit } from '../lib/workoutFit'
import { colorForIndex, MODEL_COLOR, MODEL_TARGET, mergeInto, moveBoundary, partition, zoneColor, zoneRuns, zoneSteps, zoneText } from '../lib/zones'
import { Card, Hint, Num } from './ui'

export type ZoneTarget = Pick<PaceZone, 'kind' | 'value' | 'label'>

/** Choix d'une cible : zones du profil (couleurs Garmin), allure modèle, % VC, allure plat ou imposée. */
export function ZonePicker({
  athlete,
  title,
  current,
  onApply,
  onCancel,
  extra,
}: {
  athlete: Athlete
  title: ReactNode
  current?: ZoneTarget
  onApply: (z: ZoneTarget) => void
  onCancel: () => void
  extra?: ReactNode
}) {
  const startPct = current?.kind === 'intensity' ? current.value : 0.85
  const [pct, setPct] = useState(startPct)
  const [flat, setFlat] = useState(formatPace(1000 / (athlete.cs * startPct)))
  const [pace, setPace] = useState(formatPace(1000 / (athlete.cs * startPct)))
  const applyPace = (kind: 'flatPace' | 'pace', text: string) => {
    const sec = parseDuration(text)
    if (sec && sec > 120 && sec < 1800) onApply({ kind, value: sec, label: '' })
    else alert('Allure attendue au format m:ss (ex. 4:45).')
  }
  return (
    <div className="banner info zone-picker">
      <div>{title}</div>
      <div className="zone-buttons">
        {athlete.zones.map((z, k) => {
          const value = (z.low + z.high) / 2
          const on = current?.kind === 'intensity' && current.label === z.name
          return (
            <button key={z.name} className={on ? 'on' : ''} onClick={() => onApply({ kind: 'intensity', value, label: z.name })} title={`Milieu de zone : ${Math.round(value * 100)} % VC`}>
              <span>
                <i className="zone-swatch" style={{ background: colorForIndex(k, athlete) }} />
                {z.name}
              </span>
              <small>
                {Math.round(z.low * 100)}–{Math.round(z.high * 100)} % VC · {formatPace(1000 / (athlete.cs * z.high))}–{formatPace(1000 / (athlete.cs * z.low))}/km
              </small>
            </button>
          )
        })}
        <button className={current?.kind === 'model' ? 'on' : ''} onClick={() => onApply(MODEL_TARGET)} title="Pas de cible : intensité de course du modèle (durabilité)">
          <span>
            <i className="zone-swatch" style={{ background: MODEL_COLOR }} />
            Allure de course
          </span>
          <small>modèle (VC, fatigue…)</small>
        </button>
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
        {extra}
        <button className="ghost" onClick={onCancel}>Fermer</button>
      </div>
    </div>
  )
}

/** Liste des portions (zones contiguës), temps prévus et export en entraînement. */
export function ZonesCard({ race, athlete, track, sim, onChange }: { race: Race; athlete: Athlete; track: Track; sim: SimResult; onChange: (r: Race) => void }) {
  const parts = partition(race.zones, track.totalDist)
  const runs = zoneRuns(track, sim, parts)
  const setZones = (zones: PaceZone[]) => onChange({ ...race, zones })
  const exportWorkout = () => {
    const steps = zoneSteps(track, sim, parts, athlete)
    download(`${race.name.replace(/[^\w-]+/g, '_')}_allures.fit`, buildWorkoutFit(race.name.slice(0, 32), steps, Date.now(), { target: athlete.workoutTarget, athlete }), 'application/vnd.ant.fit')
  }
  const addBoundaries = () => {
    const existing = race.checkpoints
    const added = parts
      .slice(0, -1)
      .map((z, i) => ({ d: z.to, name: `Fin cycle ${i + 1}` }))
      .filter((p) => p.d > 50 && p.d < track.totalDist - 50 && existing.every((c) => Math.abs(c.dist - p.d) > 50))
      .map((p) => ({ id: crypto.randomUUID(), dist: Math.round(p.d), name: p.name, kind: 'split' as const, stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }))
    onChange({ ...race, checkpoints: [...existing, ...added].sort((a, b) => a.dist - b.dist) })
  }
  return (
    <Card
      title="Zones d'allure"
      actions={
        <>
          <button onClick={addBoundaries} title="Ajoute un point de passage à chaque fin de cycle">Points aux fins de cycle</button>
          <button className="ghost" onClick={() => confirm('Effacer toutes les zones ?') && setZones([])}>Tout effacer</button>
          <button className="primary" onClick={exportWorkout} title="Entraînement Garmin : une étape par portion, avec une fourchette d'allure">⌚ Entraînement .fit</button>
        </>
      }
    >
      <div className="scroll">
        <table className="table compact">
          <thead>
            <tr><th>#</th><th>De (km)</th><th>À (km)</th><th>Cible</th><th>Temps prévu</th><th>Allure moyenne prévue</th><th /></tr>
          </thead>
          <tbody>
            {parts.map((z, i) => {
              const own = runs.filter((r) => r.zone?.id === z.id)
              const dist = own.reduce((a, r) => a + (r.to - r.from), 0)
              const time = own.reduce((a, r) => a + r.time, 0)
              return (
                <tr key={z.id}>
                  <td>{i + 1}</td>
                  <td>{i === 0 ? '0.0' : <Num value={z.from / 1000} width={64} onChange={(v) => setZones(moveBoundary(parts, i - 1, v * 1000))} />}</td>
                  <td>{i === parts.length - 1 ? (z.to / 1000).toFixed(1) : <Num value={z.to / 1000} width={64} onChange={(v) => setZones(moveBoundary(parts, i, v * 1000))} />}</td>
                  <td><i className="zone-swatch" style={{ background: zoneColor(z, athlete) }} />{zoneText(z, athlete)}</td>
                  <td>{time > 0 ? formatDuration(time) : '—'}</td>
                  <td>{dist > 0 && time > 0 ? `${formatPace(time / (dist / 1000))}/km` : '—'}</td>
                  <td>
                    {parts.length > 1 && (
                      <button className="ghost" onClick={() => setZones(mergeInto(parts, i, i > 0 ? -1 : 1))} title="Supprimer cette fin de cycle (fusion avec la portion voisine)">✕</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Hint>
        Sur le profil : clique pour ajouter une fin de cycle, glisse une limite pour la déplacer, clique sur une portion de la barre de zones
        pour changer sa zone. Chaque portion devient une étape de l'entraînement .fit (à copier dans <code>GARMIN/NewFiles</code>).
      </Hint>
    </Card>
  )
}
