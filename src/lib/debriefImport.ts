// Import de l'enregistrement d'une activité (FIT / GPX) dans le debrief d'une sortie.
import { readActivity } from './activity'
import { activityPasses, debriefPoints, upsertFile } from './debrief'
import { indexAt } from './gpx'
import { computePlan } from './plan'
import { isRavitoKind } from './splits'
import type { Athlete, Race } from './types'

/**
 * Lit l'enregistrement et complète la sortie (celle indiquée, sinon celle du même départ, sinon une
 * nouvelle) : passages au plus près de chaque point, arrivée et départ des ravitos d'après les arrêts.
 */
export function importActivity(race: Race, athlete: Athlete, fileName: string, bytes: Uint8Array, targetId?: string): { race: Race; id: string; message: string } {
  const act = readActivity(fileName, bytes)
  const plan = computePlan(race, athlete)
  if (!plan) throw new Error('Impossible de lire le tracé de ce parcours.')
  const list = race.debriefs ?? []
  const target = targetId ? list.find((d) => d.id === targetId) : undefined
  const points = target?.points ?? debriefPoints(race, plan.sim)
  const pts = plan.track.points
  const { passes, departures } = activityPasses(
    act,
    points.map((p) => {
      const at = pts[indexAt(pts, p.dist)]
      return { id: p.id, lat: at.lat, lon: at.lon, stop: p.stop > 0 || isRavitoKind(p.kind), radius: p.kind === 'base' ? 300 : 150 }
    }),
  )
  const found = Object.keys(passes).length
  if (!found) throw new Error(`Aucun point de « ${race.name} » trouvé dans cet enregistrement : est-ce bien une sortie sur ce parcours ?`)
  const res = upsertFile(list, { name: act.name, start: act.start, passes, departures }, points, targetId)
  const stops = Object.keys(departures).length
  return {
    race: { ...race, debriefs: res.list },
    id: res.id,
    message: `${found} passage${found > 1 ? 's' : ''} sur ${points.length} trouvé${found > 1 ? 's' : ''} dans « ${act.name} »${stops ? `, ${stops} arrêt${stops > 1 ? 's' : ''} aux ravitos détecté${stops > 1 ? 's' : ''}` : ''}.`,
  }
}
