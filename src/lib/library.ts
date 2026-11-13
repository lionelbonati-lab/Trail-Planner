// Bibliothèque de parcours d'entraînement : parcours modèles et séances datées.
import type { Race } from './types'

/** Copie d'une course ou d'une séance en parcours modèle (sans suivi ni partage). */
export function toRoute(r: Race): Race {
  return {
    ...structuredClone(r),
    id: crypto.randomUUID(),
    kind: 'route',
    templateId: null,
    live: null,
    shareId: null,
    updatedAt: new Date().toISOString(),
  }
}

/** Séance datée créée depuis un parcours modèle : le modèle reste intact. */
export function planSession(route: Race, start: string): Race {
  const date = new Date(`${start}:00`)
  const label = Number.isNaN(date.getTime())
    ? start
    : date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  return {
    ...structuredClone(route),
    id: crypto.randomUUID(),
    kind: 'session',
    templateId: route.id,
    name: `${route.name} · ${label}`,
    env: { ...structuredClone(route.env), start },
    weather: null,
    live: null,
    shareId: null,
    updatedAt: new Date().toISOString(),
  }
}

/** Étiquettes saisies séparées par des virgules : nettoyées, sans doublon. */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

/** Recherche dans le nom et les étiquettes ; toutes les étiquettes demandées doivent être présentes. */
export function filterRoutes(routes: Race[], query: string, tags: string[]): Race[] {
  const q = query.trim().toLowerCase()
  return routes.filter(
    (r) => (!q || r.name.toLowerCase().includes(q) || r.tags.some((t) => t.includes(q))) && tags.every((t) => r.tags.includes(t)),
  )
}
