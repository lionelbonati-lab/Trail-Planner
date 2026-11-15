import { FileDown, Spline, Trash2, Upload } from 'lucide-react'
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
  /** Parcours sur la montre (id), mise sur la montre et lien assistance copié. */
  onWatchId?: string | null
  onWatch?: (r: Race) => void
  onShare?: (r: Race) => void
}

export function LibraryPanel({ races, athlete, onOpen, onAdd, onDraw, onUpdate, onDelete, onWatchId = null, onWatch, onShare }: Props) {
  const routes = races.filter((r) => r.kind === 'route')
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const allTags = [...new Set(routes.flatMap((r) => r.tags))].sort()
  const shown = filterRoutes(routes, query, activeTags).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="grid">
      <Card
        fold="open"
        title="Bibliothèque de parcours"
        actions={
          <>
            <button onClick={onDraw} title="Dessine un parcours sur la carte, sur les sentiers"><Spline /> Tracer sur la carte</button>
            <label className="button primary">
              <Upload /> Importer un GPX
              <input type="file" accept=".gpx,application/gpx+xml" multiple hidden onChange={(e) => { onAdd(e.target.files); e.target.value = '' }} />
            </label>
          </>
        }
      >
        <Hint>
          Tes parcours d'entraînement réutilisables (boucle du jeudi, côte de référence, piste…) : zones d'allure, points de repère,
          envoi à la montre. Depuis un parcours, « Vers une course » crée une course (ou remplace le tracé d'une course) pour y préparer
          ravitos et assistance. Une course peut aussi être ajoutée à la bibliothèque depuis sa page.
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
          <p className="muted">Aucun parcours. Trace-en un sur la carte, importe un GPX ou ajoute une course à la bibliothèque.</p>
        ) : (
          <div className="scroll">
            <table className="table list-table">
              <thead>
                <tr><th>Parcours</th><th className="hide-sm">Distance</th><th className="hide-sm">D+</th><th className="hide-sm">Étiquettes</th><th /></tr>
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
                    links={onWatch && onShare ? { onWatchId, onWatch, onShare } : null}
                  />
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="muted">Aucun parcours ne correspond.</p>}
          </div>
        )}
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
  links,
}: {
  route: Race
  athlete: Athlete
  onOpen: (id: string) => void
  onUpdate: (r: Race) => void
  onDelete: (id: string) => void
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
          <div className="only-sm muted small">
            {info ? `${(info.dist / 1000).toFixed(1)} km · ${Math.round(info.dPlus)} m D+` : ''}
            {route.tags.length > 0 && ` · ${route.tags.join(', ')}`}
          </div>
        </td>
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
            <button className="ghost" onClick={() => confirm(`Supprimer « ${route.name} » de la bibliothèque ? Les courses créées depuis ce parcours sont conservées.`) && onDelete(route.id)} title="Supprimer" aria-label="Supprimer"><Trash2 /></button>
          </span>
        </td>
      </tr>
    </>
  )
}
