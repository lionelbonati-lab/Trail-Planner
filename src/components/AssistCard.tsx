// Plan de course : où l'assistance peut venir, et où elle se gare. Chaque point peut avoir un
// accès (parking, salle du ravito) placé sur la carte : c'est la destination du lien GPS de la
// page assistance ; sans accès, le lien mène au point du parcours.
import { MapPin, Navigation, X } from 'lucide-react'
import { assistAllowed, FINISH_ID, navUrl } from '../lib/assist'
import { indexAt } from '../lib/gpx'
import { formatClock } from '../lib/time'
import type { Checkpoint, Race, SplitRow, Track } from '../lib/types'
import { Card, Hint } from './ui'

interface Props {
  race: Race
  track: Track
  splits: SplitRow[]
  /** Point dont on place l'accès sur la carte, ou null. */
  picking: string | null
  onPick: (id: string | null) => void
  onCheckpoint: (id: string, patch: Partial<Checkpoint>) => void
  onRace: (patch: Partial<Race>) => void
}

export function AssistCard({ race, track, splits, picking, onPick, onCheckpoint, onRace }: Props) {
  const long = splits.length ? splits[splits.length - 1].arrival > 20 * 3600 : false
  return (
    <Card title="Assistance" className="span2">
      <Hint>
        Coche les points où ton assistance a le droit de venir (règlement de la course) : ils forment son trajet sur la page assistance.
        Place un <strong>accès</strong> (parking, salle du ravito) pour que son lien GPS l'y mène ; sinon il mène au point du parcours.
      </Hint>
      <div className="scroll">
        <table className="table compact">
          <thead>
            <tr><th>Point</th><th>Km</th><th>Heure</th><th>Assistance</th><th>Accès assistance</th><th>GPS</th></tr>
          </thead>
          <tbody>
            {splits.map((s) => {
              const cp = s.cp
              const finish = cp.id === FINISH_ID
              const access = finish ? race.finishAccess : cp.access
              const trail = track.points[indexAt(track.points, s.to)]
              const allowed = assistAllowed(cp)
              return (
                <tr key={cp.id} className={allowed ? '' : 'muted'}>
                  <td>{cp.name}</td>
                  <td>{(s.to / 1000).toFixed(1)}</td>
                  <td>{formatClock(s.arrivalClock, race.env.timeZone, long)}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={allowed}
                      disabled={finish}
                      onChange={(e) => onCheckpoint(cp.id, { assist: e.target.checked })}
                      aria-label={`Assistance autorisée à ${cp.name}`}
                      title={finish ? 'Toujours proposée pour l’arrivée' : undefined}
                    />
                  </td>
                  <td className="nowrap">
                    {picking === cp.id ? (
                      <span className="row tight">
                        <span className="warn-text">Clique sur la carte…</span>
                        <button className="ghost" onClick={() => onPick(null)}>Annuler</button>
                      </span>
                    ) : access ? (
                      <span className="row tight">
                        <span className="ok-text"><MapPin className="inline" /> placé</span>
                        <button className="ghost" onClick={() => onPick(cp.id)}>Déplacer</button>
                        <button
                          className="ghost"
                          onClick={() => (finish ? onRace({ finishAccess: undefined }) : onCheckpoint(cp.id, { access: undefined }))}
                          aria-label={`Retirer l'accès de ${cp.name}`}
                        >
                          <X />
                        </button>
                      </span>
                    ) : (
                      <button className="ghost" onClick={() => onPick(cp.id)} disabled={!allowed}>
                        <MapPin /> Placer sur la carte
                      </button>
                    )}
                  </td>
                  <td>
                    <a href={navUrl(access ?? { lat: trail.lat, lon: trail.lon })} target="_blank" rel="noreferrer" title="Itinéraire Google Maps (ce que verra ton assistance)">
                      <Navigation className="inline" /> Y aller
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
