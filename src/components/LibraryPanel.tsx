import { Spline, Trash2, Upload, Watch } from 'lucide-react'
import { useMemo, useState } from 'react'
import { download } from '../lib/exportGpx'
import { parseGpx } from '../lib/gpx'
import { filterRoutes, parseTags } from '../lib/library'
import { computePlan } from '../lib/plan'
import type { Athlete, Race } from '../lib/types'
import { buildWorkoutFit } from '../lib/workoutFit'
import { zoneSteps } from '../lib/zones'
import { Card, Hint } from './ui'

interface Props {
  races: Race[]
  athlete: Athlete
  onOpen: (id: string) => void
  onAdd: (files: FileList | null) => void
  onDraw: () => void
  onUpdate: (r: Race) => void
  onDelete: (id: string) => void
  onPlan: (route: Race, start: string) => void
}

/** Demain 8 h, au format des champs date-heure. */
function tomorrow8(): string {
  const d = new Date(Date.now() + 86400000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T08:00`
}

export function LibraryPanel({ races, athlete, onOpen, onAdd, onDraw, onUpdate, onDelete, onPlan }: Props) {
  const routes = races.filter((r) => r.kind === 'route')
  const sessions = races.filter((r) => r.kind === 'session').sort((a, b) => b.env.start.localeCompare(a.env.start))
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const allTags = [...new Set(routes.flatMap((r) => r.tags))].sort()
  const shown = filterRoutes(routes, query, activeTags).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="grid">
      <Card
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
          Tes parcours d'entraînement réutilisables (boucle du jeudi, côte de référence, piste…). Prépare leurs zones d'allure une fois,
          puis « Planifier » crée une séance datée : le parcours reste intact comme modèle. Une course existante peut aussi être ajoutée
          à la bibliothèque depuis sa page.
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
            <table className="table">
              <thead>
                <tr><th>Parcours</th><th>Distance</th><th>D+</th><th>Étiquettes</th><th>Zones</th><th>Séances</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <RouteRow
                    key={r.id}
                    route={r}
                    athlete={athlete}
                    sessions={sessions.filter((s) => s.templateId === r.id)}
                    onOpen={onOpen}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    onPlan={onPlan}
                  />
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="muted">Aucun parcours ne correspond.</p>}
          </div>
        )}
      </Card>

      <Card title="Séances planifiées">
        {sessions.length === 0 ? (
          <p className="muted">Aucune séance. Utilise « Planifier » sur un parcours de la bibliothèque.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Séance</th><th>Parcours</th><th>Zones</th><th /></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => onOpen(s.id)}>
                  <td>{s.env.start.replace('T', ' ')}</td>
                  <td><strong>{s.name}</strong></td>
                  <td className="muted">{routes.find((r) => r.id === s.templateId)?.name ?? '—'}</td>
                  <td>{s.zones.length || ''}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="ghost" onClick={() => confirm('Supprimer cette séance ?') && onDelete(s.id)} title="Supprimer" aria-label="Supprimer"><Trash2 /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

function RouteRow({
  route,
  athlete,
  sessions,
  onOpen,
  onUpdate,
  onDelete,
  onPlan,
}: {
  route: Race
  athlete: Athlete
  sessions: Race[]
  onOpen: (id: string) => void
  onUpdate: (r: Race) => void
  onDelete: (id: string) => void
  onPlan: (route: Race, start: string) => void
}) {
  const [planning, setPlanning] = useState<string | null>(null)
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
  const last = sessions[0]
  return (
    <>
      <tr className="clickable" onClick={() => onOpen(route.id)}>
        <td><strong>{route.name}</strong></td>
        <td>{info ? `${(info.dist / 1000).toFixed(1)} km` : '—'}</td>
        <td>{info ? `${Math.round(info.dPlus)} m` : '—'}</td>
        <td onClick={(e) => e.stopPropagation()}>
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
        <td>{route.zones.length || ''}</td>
        <td className="muted small">{sessions.length ? `${sessions.length} · dernière ${last.env.start.slice(0, 10)}` : ''}</td>
        <td onClick={(e) => e.stopPropagation()} className="row-actions">
          <button className="primary" onClick={() => setPlanning(planning === null ? tomorrow8() : null)}>Planifier</button>
          {route.zones.length > 0 && <button onClick={exportWorkout} title="Entraînement Garmin d'après les zones d'allure"><Watch /> .fit</button>}
          <button className="ghost" onClick={() => confirm(`Supprimer « ${route.name} » de la bibliothèque ? Les séances déjà planifiées sont conservées.`) && onDelete(route.id)} title="Supprimer" aria-label="Supprimer"><Trash2 /></button>
        </td>
      </tr>
      {planning !== null && (
        <tr className="plan-row">
          <td colSpan={7}>
            <div className="row">
              <span>Nouvelle séance sur ce parcours le</span>
              <input type="datetime-local" value={planning} onChange={(e) => setPlanning(e.target.value)} />
              <button className="primary" onClick={() => { onPlan(route, planning); setPlanning(null) }}>Créer la séance</button>
              <button className="ghost" onClick={() => setPlanning(null)}>Annuler</button>
              {route.zones.length > 0 && <span className="muted small">Les {route.zones.length} zone(s) d'allure du parcours sont reprises.</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
