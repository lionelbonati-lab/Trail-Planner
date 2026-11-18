import { Users, Watch } from 'lucide-react'
import type { Race } from '../lib/types'

/** Ligne d'une course ou d'un parcours : ⌚ sur la montre (second appui : retirée), 👥 lien assistance copié. */
export function ListLinkButtons({
  race,
  onWatchId,
  onWatch,
  onShare,
}: {
  race: Race
  /** Course ou parcours actuellement sur la montre (id). */
  onWatchId: string | null
  onWatch: (r: Race) => void
  onShare: (r: Race) => void
}) {
  const active = onWatchId === race.id
  return (
    <>
      <button
        className={`ghost ${active ? 'on-watch' : ''}`}
        onClick={() => onWatch(race)}
        title={active ? 'Sur la montre (toucher pour la retirer)' : 'Mettre sur la montre'}
        aria-label={active ? 'Retirer de la montre' : 'Mettre sur la montre'}
        aria-pressed={active}
      >
        <Watch />
      </button>
      <button className="ghost" onClick={() => onShare(race)} title="Copier le lien assistance" aria-label="Copier le lien assistance">
        <Users />
      </button>
    </>
  )
}
