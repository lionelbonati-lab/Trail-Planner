// Assistance : points où elle est autorisée, liens de navigation Google Maps vers un point
// (accès assistance s'il est placé, sinon point du parcours) et trajet entre plusieurs points.
import type { Checkpoint, GeoPoint } from './types'

/** Identifiant du point d'arrivée ajouté au calcul (voir withFinish). */
export const FINISH_ID = '__finish'

/** Assistance autorisée : réglage du point, sinon les ravitos et l'arrivée. */
export function assistAllowed(cp: Checkpoint): boolean {
  return cp.assist ?? (cp.kind === 'ravito' || cp.id === FINISH_ID)
}

const coord = (p: GeoPoint) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`

/** Navigation en voiture vers un point, depuis la position du téléphone. */
export function navUrl(p: GeoPoint): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coord(p)}&travelmode=driving`
}

/** Étapes par lien : Google Maps sur téléphone n'en accepte pas plus de 3 (plus la destination). */
export const MAPS_STOPS_PER_LINK = 3

export interface TripLeg {
  /** Indices (dans la liste donnée) du premier point visité et de la destination de ce trajet. */
  from: number
  to: number
  url: string
}

/**
 * Trajet entre les points, dans l'ordre : un lien Google Maps par tranche de 4 points (3 étapes
 * et la destination). Le premier part de la position du téléphone, les suivants du dernier
 * point du trajet précédent.
 */
export function tripLegs(points: GeoPoint[]): TripLeg[] {
  const legs: TripLeg[] = []
  for (let start = 0; start < points.length; ) {
    const end = Math.min(points.length - 1, start + MAPS_STOPS_PER_LINK)
    const stops = points.slice(start, end)
    let url = 'https://www.google.com/maps/dir/?api=1'
    if (start > 0) url += `&origin=${coord(points[start - 1])}`
    url += `&destination=${coord(points[end])}`
    if (stops.length) url += `&waypoints=${stops.map(coord).join('%7C')}`
    url += '&travelmode=driving'
    legs.push({ from: start, to: end, url })
    start = end + 1
  }
  return legs
}
