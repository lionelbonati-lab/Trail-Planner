import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { formatClock, formatDuration, formatPace, zonedToUtc } from '../lib/time'
import type { Athlete, Race, SimResult, Track } from '../lib/types'
import { bagText, type Leg } from '../lib/nutrition'
import { ProfileChart } from './ProfileChart'

export type PrintFormat = 'a4' | 'strip' | 'crew'

const PAGE: Record<PrintFormat, string> = {
  a4: 'A4 landscape',
  strip: 'A4 portrait',
  crew: 'A4 portrait',
}

interface Props {
  format: PrintFormat
  race: Race
  track: Track
  sim: SimResult
  athlete: Athlete
  /** Fenêtre de passage (s depuis le départ) : bonne journée → journée difficile. */
  windowOf: (cpId: string) => { early: number; late: number } | null
  /** Plan nutrition par tronçon. */
  legs: Leg[]
  onDone: () => void
}

/** Rend la feuille demandée dans un conteneur dédié, lance l'impression, puis se retire. */
export function PrintSheets({ format, race, track, sim, athlete, windowOf, legs, onDone }: Props) {
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    document.body.classList.add('printing')
    const done = () => {
      document.body.classList.remove('printing')
      doneRef.current()
    }
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 300)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', done)
      document.body.classList.remove('printing')
    }
  }, [format])

  const startMs = zonedToUtc(race.env.start, race.env.timeZone).getTime()
  const tz = race.env.timeZone
  const longRace = sim.totalTime > 20 * 3600
  const startLabel = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date(startMs))

  return createPortal(
    <div className={`print-root print-${format}`}>
      <style>{`@page { size: ${PAGE[format]}; margin: 8mm; }`}</style>
      <button className="print-close no-print" onClick={onDone}>Fermer l'aperçu</button>

      {format === 'a4' && (
        <div className="sheet">
          <header className="sheet-head">
            <div>
              <h1>{race.name}</h1>
              <div>{startLabel} · {athlete.name}</div>
            </div>
            <div className="sheet-kpis">
              <span>{(track.totalDist / 1000).toFixed(1)} km</span>
              <span>+{Math.round(track.dPlus)} / −{Math.round(track.dMinus)} m</span>
              <span>{sim.totalKme.toFixed(0)} km-e</span>
              <span><strong>{formatDuration(sim.totalTime)}</strong></span>
              <span>Arrivée {formatClock(new Date(startMs + sim.totalTime * 1000), tz, true)}</span>
            </div>
          </header>
          <ProfileChart points={sim.points} splits={sim.splits} timeZone={tz} startMs={startMs} width={1100} height={280} print />
          <table className="ptable">
            <thead>
              <tr>
                <th>Point</th><th>Km</th><th>Tronçon</th><th>D+</th><th>D−</th><th>Temps</th><th>Allure</th><th>Cumul</th><th>Heure</th><th>Arrêt</th><th>Barrière</th><th>Eau</th><th>Glu.</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {sim.splits.map((s) => (
                <tr key={s.cp.id} className={`${s.cp.kind === 'ravito' ? 'ravito' : ''} ${s.night ? 'night' : ''}`}>
                  <td className="name">{s.cp.name}</td>
                  <td>{(s.to / 1000).toFixed(1)}</td>
                  <td>{(s.dist / 1000).toFixed(1)}</td>
                  <td>{Math.round(s.dPlus)}</td>
                  <td>{Math.round(s.dMinus)}</td>
                  <td>{formatDuration(s.moveTime)}</td>
                  <td>{formatPace(s.avgPace)}</td>
                  <td><strong>{formatDuration(s.arrival)}</strong></td>
                  <td><strong>{formatClock(s.arrivalClock, tz, longRace)}</strong></td>
                  <td>{s.cp.stopMin ? `${s.cp.stopMin}′` : ''}</td>
                  <td>{s.cp.cutoff ? `${s.cp.cutoff.slice(11, 16)} (${s.cutoffMargin !== null && s.cutoffMargin >= 0 ? '+' : '−'}${formatDuration(Math.abs(s.cutoffMargin ?? 0))})` : ''}</td>
                  <td>{s.cp.water ? `${s.cp.water} L` : ''}</td>
                  <td>{s.cp.carbs ? `${s.cp.carbs} g` : ''}</td>
                  <td className="notes">{s.cp.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {legs.length > 1 && (
            <table className="ptable bags">
              <thead>
                <tr><th>Tronçon</th><th>Durée</th><th>Eau</th><th>Glucides</th><th>Sodium</th><th>À emporter</th></tr>
              </thead>
              <tbody>
                {legs.map((l) => (
                  <tr key={`${l.from}-${l.to}`}>
                    <td className="name">{l.from} → {l.to}</td>
                    <td>{formatDuration(l.duration)}</td>
                    <td>{l.water} L</td>
                    <td>{l.carbs} g</td>
                    <td>{l.sodium} mg</td>
                    <td className="notes">{bagText(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {format === 'strip' && (
        <div className="strips">
          {[0, 1].map((copy) => (
            <div className="strip" key={copy}>
              <div className="strip-head">
                <strong>{race.name}</strong>
                <span>Départ {formatClock(new Date(startMs), tz)} · {formatDuration(sim.totalTime)}</span>
              </div>
              <table>
                <thead>
                  <tr><th>Km</th><th>Point</th><th>D+</th><th>Cumul</th><th>Heure</th></tr>
                </thead>
                <tbody>
                  {sim.splits.map((s) => (
                    <tr key={s.cp.id} className={s.cp.kind === 'ravito' ? 'ravito' : ''}>
                      <td>{(s.to / 1000).toFixed(1)}</td>
                      <td>{s.cp.name.slice(0, 16)}</td>
                      <td>{Math.round(s.dPlus)}</td>
                      <td>{formatDuration(s.arrival)}</td>
                      <td>{formatClock(s.arrivalClock, tz)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {format === 'crew' && (
        <div className="sheet">
          <header className="sheet-head">
            <div>
              <h1>Assistance · {race.name}</h1>
              <div>{athlete.name} · départ {startLabel}</div>
            </div>
            <div className="sheet-kpis"><span>Arrivée prévue {formatClock(new Date(startMs + sim.totalTime * 1000), tz, true)}</span></div>
          </header>
          <p className="crew-hint">Fenêtre de passage : « au plus tôt » = bonne journée, « au plus tard » = journée difficile (VC −5 %, fatigue plus marquée, arrêts plus longs).</p>
          <table className="ptable crew">
            <thead>
              <tr><th>Ravito</th><th>Km</th><th>Au plus tôt</th><th>Prévu</th><th>Au plus tard</th><th>Barrière</th><th>Arrêt</th><th>À préparer</th></tr>
            </thead>
            <tbody>
              {sim.splits
                .filter((s) => s.cp.kind === 'ravito' || s.cp.id === '__finish' || s.cp.kind === 'cutoff')
                .map((s) => (
                  <tr key={s.cp.id}>
                    <td className="name">{s.cp.name}</td>
                    <td>{(s.to / 1000).toFixed(1)}</td>
                    <td>{formatClock(new Date(startMs + (windowOf(s.cp.id)?.early ?? s.arrival * 0.92) * 1000), tz, longRace)}</td>
                    <td><strong>{formatClock(s.arrivalClock, tz, longRace)}</strong></td>
                    <td>{formatClock(new Date(startMs + (windowOf(s.cp.id)?.late ?? s.arrival * 1.12) * 1000), tz, longRace)}</td>
                    <td>{s.cp.cutoff ? s.cp.cutoff.slice(11, 16) : ''}</td>
                    <td>{s.cp.stopMin ? `${s.cp.stopMin} min` : ''}</td>
                    <td className="notes">
                      {(() => {
                        const leg = legs.find((l) => l.fromId === s.cp.id)
                        return [leg ? bagText(leg) : '', s.cp.notes].filter(Boolean).join(' · ')
                      })()}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>,
    document.body,
  )
}
