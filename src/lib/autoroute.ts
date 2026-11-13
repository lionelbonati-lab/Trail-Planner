// Création automatique d'une boucle : des points placés en cercle autour du départ, dans la
// direction dont le relief (altitude du modèle de terrain) correspond au terrain voulu, puis
// reliés par les chemins. La boucle retenue est celle dont la distance (ou la durée simulée)
// et le dénivelé par km collent le mieux à la demande.
import type { Fetcher } from './routing'
import { fillElevation } from './routing'

export type Terrain = 'flat' | 'hilly' | 'mountain'

/** Dénivelé positif visé, en m par km : fourchette acceptée et valeur cible. */
export const TERRAINS: Record<Terrain, { label: string; min: number; max: number; target: number }> = {
  flat: { label: 'Plat', min: 0, max: 12, target: 4 },
  hilly: { label: 'Vallonné', min: 12, max: 35, target: 22 },
  mountain: { label: 'Montagne', min: 35, max: 200, target: 60 },
}

/** Allongement typique d'un itinéraire sur chemins par rapport aux lignes droites. */
const TORTUOSITY = 1.3

/** Point à `dist` m dans la direction `bearing` (degrés, 0 = nord). */
export function destination(lat: number, lon: number, bearing: number, dist: number): { lat: number; lon: number } {
  const R = 6371000
  const d = dist / R
  const t = (bearing * Math.PI) / 180
  const p1 = (lat * Math.PI) / 180
  const l1 = (lon * Math.PI) / 180
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t))
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return { lat: (p2 * 180) / Math.PI, lon: (((l2 * 180) / Math.PI + 540) % 360) - 180 }
}

/**
 * Trois points d'une boucle d'environ `dist` m partant de `start` vers `bearing` : ils sont posés
 * au quart, à la moitié et aux trois quarts d'un cercle qui passe par le départ.
 */
export function loopPoints(start: { lat: number; lon: number }, dist: number, bearing: number): { lat: number; lon: number }[] {
  const r = dist / (4 * Math.SQRT2 * TORTUOSITY)
  const c = destination(start.lat, start.lon, bearing, r)
  // Le départ est sur le cercle à l'opposé de la direction ; on tourne dans le sens horaire.
  return [90, 180, 270].map((a) => destination(c.lat, c.lon, bearing + 180 + a, r))
}

/** D+ par km estimé d'une boucle d'après l'altitude de ses points (départ compris). */
export function reliefDensity(eles: number[], dist: number): number {
  let sum = 0
  for (let i = 1; i <= eles.length; i++) sum += Math.abs(eles[i % eles.length] - eles[i - 1])
  // Montées et descentes entre les points, plus les ondulations du chemin (≈ ×1,5).
  return ((sum / 2) * 1.5) / Math.max(1, dist / 1000)
}

/**
 * Directions à essayer, de la plus prometteuse à la moins prometteuse pour le terrain voulu,
 * d'après l'altitude de leurs points (une seule requête au modèle de terrain). `offset` décale
 * les directions pour d'autres propositions.
 */
export async function rankBearings(
  start: { lat: number; lon: number },
  dist: number,
  terrain: Terrain,
  offset = 0,
  fetcher: Fetcher = fetch,
): Promise<{ bearing: number; points: { lat: number; lon: number }[]; density: number }[]> {
  const bearings = Array.from({ length: 8 }, (_, k) => (k * 45 + offset) % 360)
  const plans = bearings.map((bearing) => ({ bearing, points: loopPoints(start, dist, bearing) }))
  const all = [start, ...plans.flatMap((p) => p.points)].map((p) => ({ ...p, ele: null as number | null }))
  const withEle = await fillElevation(all, fetcher)
  const e0 = withEle[0].ele ?? 0
  return plans
    .map((p, k) => {
      const eles = [e0, ...withEle.slice(1 + k * 3, 4 + k * 3).map((x) => x.ele ?? e0)]
      return { ...p, density: reliefDensity(eles, dist) }
    })
    .sort((a, b) => terrainRank(a.density, terrain) - terrainRank(b.density, terrain))
}

/**
 * Classement d'une direction (plus petit = meilleur) : le moins de relief possible en plat,
 * au plus près de la cible en vallonné, au moins la cible en montagne (davantage ne gêne pas).
 */
export function terrainRank(density: number, terrain: Terrain): number {
  const t = TERRAINS[terrain]
  if (terrain === 'flat') return density
  if (terrain === 'hilly') return Math.abs(density - t.target)
  return Math.max(0, t.target - density) + Math.max(0, density - t.max) - density * 0.01
}

/** Distance visée pour une durée, à l'intensité donnée (km-effort : 100 m de D+ = 1 km). */
export function distanceForDuration(seconds: number, cs: number, intensity: number, terrain: Terrain): number {
  return (seconds * cs * intensity) / (1 + TERRAINS[terrain].target / 100)
}

/**
 * Écart d'une boucle calculée à la demande (plus petit = meilleur) : écart de distance ou de
 * durée (en %), sortie de la fourchette de dénivelé du terrain, tronçons hors sentier.
 */
export function loopScore(o: { error: number; density: number; offroad: number; terrain: Terrain }): number {
  const t = TERRAINS[o.terrain]
  const terrainGap = o.density < t.min ? t.min - o.density : o.density > t.max ? o.density - t.max : 0
  return Math.abs(o.error) * 100 + terrainGap * 2 + o.offroad * 25
}
