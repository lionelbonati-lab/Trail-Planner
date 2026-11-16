import { Copy, FileDown, FileUp, Flag, Spline, Trash2, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { download } from '../lib/exportGpx'
import { parseGpx } from '../lib/gpx'
import { filterRoutes, parseTags } from '../lib/library'
import { computePlan } from '../lib/plan'
import type { Athlete, Race } from '../lib/types'
import { buildWorkoutFit } from '../lib/workoutFit'
import { zoneSteps } from '../lib/zones'
import { ListLinkButtons } from './ListLinkButtons'
import { Card, Hint } from './ui'

interface Props {
  races: Race[]
  athlete: Athlete
  onOpen: (id: string) => void
  onAdd: (files: FileList | null) => void
  onDraw: () => void
  onUpdate: (r: Race) => void
  onDelete: (id: string) => void
  /** Copie (ex. tester une autre stratégie). */
  onDuplicate: (r: Race) => void
  /** Sauvegarde JSON et courses enregistrées sans compte. */
  backup: { onExport: () => void; onImport: (f: FileList | null) => void; storeKind: 'local' | 'cloud'; localCount: number; onPushLocal: () => void; onDiscardLocal: () => void }
  /** Parcours sur la montre (id), mise sur la montre et lien assistance copié. */
  onWatchId?: string | null
  onWatch?: (r: Race) => void
  onShare?: (r: Race) => void
}

export function LibraryPanel({ races, athlete, onOpen, onAdd, onDraw, onUpdate, onDelete, onDuplicate, backup, onWatchId = null, onWatch, onShare }: Props) {
  // Courses et parcours d'entraînement dans une seule liste ; un bouton n'affiche que les courses.
  const routes = races
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [racesOnly, setRacesOnly] = useState(false)
  const allTags = [...new Set(routes.flatMap((r) => r.tags))].sort()
  const shown = filterRoutes(racesOnly ? routes.filter((r) => r.kind === 'race') : routes, query, activeTags).sort((a, b) =>
    // Courses d'abord, par date de départ ; puis les parcours par nom.
    a.kind !== b.kind ? (a.kind === 'race' ? -1 : 1) : a.kind === 'race' ? a.env.start.localeCompare(b.env.start) : a.name.localeCompare(b.name),
  )

  return (
    <div className="grid">
      {backup.localCount > 0 && (
        <div className="banner info">
          <span>
            Ce navigateur contient {backup.localCount} parcours enregistré{backup.localCount > 1 ? 's' : ''} sans compte.
          </span>
          <span className="row tight">
            <button className="primary" onClick={backup.onPushLocal}>Les ajouter à mon compte</button>
            <button className="ghost" onClick={backup.onDiscardLocal}>Les effacer</button>
          </span>
        </div>
      )}
      <Card
        fold="open"
        title="Parcours"
        actions={
          <>
            <button className={racesOnly ? 'on-watch' : ''} onClick={() => setRacesOnly(!racesOnly)} aria-pressed={racesOnly} title="N'afficher que les courses">
              <Flag /> Courses{racesOnly ? ' seulement' : ''}
            </button>
            <button onClick={onDraw} title="Dessine un parcours sur la carte, sur les sentiers"><Spline /> Créer un parcours</button>
            <label className="button primary">
              <Upload /> Importer un GPX
              <input type="file" accept=".gpx,application/gpx+xml" multiple hidden onChange={(e) => { onAdd(e.target.files); e.target.value = '' }} />
            </label>
          </>
        }
      >
        <Hint>
          Tes courses et tes parcours d'entraînement (boucle du jeudi, côte de référence…) : points de passage, nutrition, assistance,
          envoi à la montre. Le bouton « Course » en haut d'un parcours en fait une course, avec sa date et son heure de départ.
          « Créer un parcours » ouvre l'éditeur, le même que pour modifier un parcours.
        </Hint>
        {routes.length > 0 && (
          <div className="row library-filters">
            <input type="search" placeholder="Rechercher un parcours…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 260 }} />
            {allTags.map((t) => (
              <button
                key={t}
                className={`tag ${activeTags.includes(t) ? 'on' : ''}`}
                onClick={() => setActiveTags(activeTags.includes(t) ? activeTags.filter((x) => x !== t) : [...activeTags, t])}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {routes.length === 0 ? (
          <p className="muted">Aucun parcours. Crée-en un sur la carte ou importe un GPX (course ou entraînement).</p>
        ) : (
          <div className="scroll">
            <table className="table list-table">
              <thead>
                <tr><th>Parcours</th><th className="hide-sm">Départ</th><th className="hide-sm">Distance</th><th className="hide-sm">D+</th><th className="hide-sm">Étiquettes</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <RouteRow
                    key={r.id}
                    route={r}
                    athlete={athlete}
                    onOpen={onOpen}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    onDuplicate={onDuplicate}
                    links={onWatch && onShare ? { onWatchId, onWatch, onShare } : null}
                  />
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="muted">{racesOnly ? 'Aucune course.' : 'Aucun parcours ne correspond.'}</p>}
          </div>
        )}
      </Card>
      <Card title="Sauvegarde">
        <p className="muted">
          Données stockées {backup.storeKind === 'cloud' ? 'dans ton compte (synchronisées)' : 'dans ce navigateur uniquement'}.
        </p>
        <div className="row">
          <button onClick={backup.onExport}><FileDown /> Exporter (JSON)</button>
          <label className="button">
            <FileUp /> Importer (JSON)
            <input type="file" accept=".json,application/json" hidden onChange={(e) => { backup.onImport(e.target.files); e.target.value = '' }} />
          </label>
        </div>
      </Card>

    </div>
  )
}

function RouteRow({
  route,
  athlete,
  onOpen,
  onUpdate,
  onDelete,
  onDuplicate,
  links,
}: {
  route: Race
  athlete: Athlete
  onOpen: (id: string) => void
  onUpdate: (r: Race) => void
  onDelete: (id: string) => void
  onDuplicate: (r: Race) => void
  links: { onWatchId: string | null; onWatch: (r: Race) => void; onShare: (r: Race) => void } | null
}) {
  const [tagText, setTagText] = useState<string | null>(null)
  const info = useMemo(() => {
    try {
      const t = parseGpx(route.gpxText, route.smoothing)
      return { dist: t.totalDist, dPlus: t.dPlus }
    } catch {
      return null
    }
  }, [route.gpxText, route.smoothing])
  const exportWorkout = () => {
    const plan = computePlan(route, athlete)
    if (!plan) return
    download(`${route.name.replace(/[^\w-]+/g, '_')}_allures.fit`, buildWorkoutFit(route.name.slice(0, 32), zoneSteps(plan.track, plan.sim, route.zones, athlete), Date.now(), { target: athlete.workoutTarget, athlete }), 'application/vnd.ant.fit')
  }
  return (
    <>
      <tr className="clickable" onClick={() => onOpen(route.id)}>
        <td>
          <strong>{route.name}</strong>
          {route.kind === 'race' && <span className="badge race-badge">Course</span>}
          <div className="only-sm muted small">
            {route.kind === 'race' ? `${route.env.start.replace('T', ' ')} · ` : ''}
            {info ? `${(info.dist / 1000).toFixed(1)} km · ${Math.round(info.dPlus)} m D+` : ''}
            {route.tags.length > 0 && ` · ${route.tags.join(', ')}`}
          </div>
        </td>
        <td className="hide-sm">{route.kind === 'race' ? route.env.start.replace('T', ' ') : <span className="muted">libre</span>}</td>
        <td className="hide-sm">{info ? `${(info.dist / 1000).toFixed(1)} km` : '—'}</td>
        <td className="hide-sm">{info ? `${Math.round(info.dPlus)} m` : '—'}</td>
        <td className="hide-sm" onClick={(e) => e.stopPropagation()}>
          {tagText === null ? (
            <span className="tags" onClick={() => setTagText(route.tags.join(', '))} title="Modifier les étiquettes">
              {route.tags.length ? route.tags.map((t) => <span key={t} className="tag">{t}</span>) : <span className="muted small">+ étiquettes</span>}
            </span>
          ) : (
            <input
              type="text"
              autoFocus
              value={tagText}
              placeholder="côte, plat, piste…"
              onChange={(e) => setTagText(e.target.value)}
              onBlur={() => {
                onUpdate({ ...route, tags: parseTags(tagText) })
                setTagText(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          )}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <span className="list-actions">
            {links && <ListLinkButtons race={route} {...links} />}
            {route.zones.length > 0 && <button className="ghost" onClick={exportWorkout} title="Entraînement Garmin (.fit) d'après les zones d'allure" aria-label="Entraînement Garmin (.fit)"><FileDown /></button>}
            <button className="ghost" onClick={() => onDuplicate(route)} title="Dupliquer (ex. tester une autre stratégie)" aria-label="Dupliquer"><Copy /></button>
            <button className="ghost" onClick={() => confirm(`Supprimer « ${route.name} » ?`) && onDelete(route.id)} title="Supprimer" aria-label="Supprimer"><Trash2 /></button>
          </span>
        </td>
      </tr>
    </>
  )
}
