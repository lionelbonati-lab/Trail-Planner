// Bibliothèque de parcours d'entraînement, et passage d'un parcours à une course.
import { parseGpx } from './gpx'
import type { Race } from './types'

/** Copie d'une course en parcours modèle (sans suivi ni partage). */
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

/**
 * Nouvelle course à partir d'un parcours : copie indépendante (tracé, points de repère, réglages),
 * sans zones d'allure (une course se calcule à l'intensité de course) ni départ libre.
 */
export function raceFromRoute(route: Race, name: string): Race {
  return {
    ...structuredClone(route),
    id: crypto.randomUUID(),
    kind: 'race',
    name: name.trim() || route.name,
    templateId: route.id,
    zones: [],
    freeStart: false,
    weather: null,
    live: null,
    shareId: null,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Tracé d'une course remplacé par celui d'un parcours : ses points de passage (ravitos…) et
 * réglages sont gardés, sauf les points au-delà de la nouvelle distance ; technicité et météo,
 * liées à l'ancien tracé, sont recalculées.
 */
export function replaceRaceTrack(race: Race, route: Race): Race {
  const total = parseGpx(route.gpxText, route.smoothing).totalDist
  return {
    ...race,
    gpxText: route.gpxText,
    drawn: route.drawn ? structuredClone(route.drawn) : null,
    smoothing: route.smoothing,
    checkpoints: race.checkpoints.filter((c) => c.dist < total - 1),
    techOverrides: [],
    osmTech: [],
    weather: null,
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
