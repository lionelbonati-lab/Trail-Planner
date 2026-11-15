// Assistance d'un point de passage, dans les temps de passage d'une course : la coche « l'assistance
// peut venir » (règlement de la course) et son accès (parking, salle du ravito) placé sur la carte,
// destination du lien GPS de la page assistance ; sans accès, le lien mène au point du parcours.
import { MapPin, X } from 'lucide-react'

interface Props {
  name: string
  /** Assistance autorisée à ce point. */
  allowed: boolean
  /** Arrivée : l'assistance y est toujours proposée. */
  finish: boolean
  /** Accès placé sur la carte. */
  placed: boolean
  /** Pose de l'accès de ce point en cours (prochain clic sur la carte). */
  picking: boolean
  onAllow: (v: boolean) => void
  /** Démarre (true) ou annule (false) la pose de l'accès sur la carte. */
  onPick: (start: boolean) => void
  onClear: () => void
  /** Libellés visibles (cartes sur téléphone) ; sinon icônes seules (tableau). */
  labels?: boolean
}

export function AssistControls({ name, allowed, finish, placed, picking, onAllow, onPick, onClear, labels = false }: Props) {
  return (
    <span className="assist-ctl">
      <label className="assist-check" title={finish ? 'Assistance toujours proposée à l’arrivée' : 'L’assistance a le droit de venir à ce point'}>
        <input
          type="checkbox"
          checked={allowed}
          disabled={finish}
          onChange={(e) => onAllow(e.target.checked)}
          aria-label={`Assistance autorisée à ${name}`}
        />
        {labels && <span>Assistance</span>}
      </label>
      {picking ? (
        <button className="ghost warn-text" onClick={() => onPick(false)} title="Annuler la pose de l’accès">
          Clique sur la carte… <X />
        </button>
      ) : (
        <>
          <button
            className={`ghost ${placed ? 'ok-text' : ''}`}
            onClick={() => onPick(true)}
            disabled={!allowed}
            title={placed ? 'Accès assistance placé : cliquer pour le déplacer' : 'Placer sur la carte l’accès de l’assistance (parking, salle du ravito)'}
            aria-label={placed ? `Déplacer l’accès assistance de ${name}` : `Placer l’accès assistance de ${name}`}
          >
            <MapPin />
            {labels && (placed ? ' Accès placé' : ' Placer l’accès')}
          </button>
          {placed && (
            <button className="ghost" onClick={onClear} title="Retirer l’accès" aria-label={`Retirer l’accès assistance de ${name}`}>
              <X />
            </button>
          )}
        </>
      )}
    </span>
  )
}
