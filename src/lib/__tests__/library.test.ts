import { describe, expect, it } from 'vitest'
import { newRace, normalizeRace } from '../defaults'
import { filterRoutes, parseTags, raceFromRoute, replaceRaceTrack, toRoute } from '../library'
import type { Race } from '../types'

const gpx = '<gpx><trk><trkseg><trkpt lat="45" lon="6"><ele>500</ele></trkpt><trkpt lat="45.01" lon="6"><ele>510</ele></trkpt></trkseg></trk></gpx>'

describe('bibliothèque de parcours', () => {
  it('anciennes courses : type « course » par défaut', () => {
    const old = { ...newRace('X', gpx) } as Partial<Race>
    delete old.kind
    delete old.tags
    const r = normalizeRace(old as Race)
    expect(r.kind).toBe('race')
    expect(r.tags).toEqual([])
    expect(r.templateId).toBeNull()
  })

  it('copie en parcours modèle sans suivi ni partage', () => {
    const race = { ...newRace('Boucle', gpx), shareId: 's', live: { startedAt: 'x', passages: {} } }
    const route = toRoute(race)
    expect(route.kind).toBe('route')
    expect(route.id).not.toBe(race.id)
    expect(route.shareId).toBeNull()
    expect(route.live).toBeNull()
  })

  it('anciennes séances datées : deviennent des parcours', () => {
    const old = { ...newRace('Séance', gpx), kind: 'session' } as unknown as Race
    expect(normalizeRace(old).kind).toBe('route')
  })

  it('parcours vers une nouvelle course : copie indépendante, sans zones ni départ libre', () => {
    const route = {
      ...newRace('Côte de Chaumont', gpx),
      kind: 'route' as const,
      freeStart: true,
      zones: [{ id: 'z', from: 0, to: 500, kind: 'intensity' as const, value: 0.88, label: 'Tempo' }],
      checkpoints: [{ id: 'r', dist: 600, name: 'Fontaine', kind: 'info' as const, stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }],
    }
    const race = raceFromRoute(route, 'Trail de Chaumont')
    expect(race).toMatchObject({ kind: 'race', name: 'Trail de Chaumont', templateId: route.id, zones: [], freeStart: false, shareId: null, live: null })
    expect(race.id).not.toBe(route.id)
    expect(race.checkpoints).toEqual(route.checkpoints)
    expect(race.checkpoints).not.toBe(route.checkpoints)
    expect(raceFromRoute(route, '  ').name).toBe('Côte de Chaumont')
  })

  it('tracé d’une course remplacé par un parcours : ravitos gardés dans la nouvelle distance', () => {
    const longGpx = '<gpx><trk><trkseg><trkpt lat="45" lon="6"><ele>500</ele></trkpt><trkpt lat="45.05" lon="6"><ele>510</ele></trkpt></trkseg></trk></gpx>'
    const race = {
      ...newRace('Trail', longGpx),
      techOverrides: [{ id: 't', from: 0, to: 4000, level: 3 as const }],
      checkpoints: [
        { id: 'a', dist: 800, name: 'Ravito 1', kind: 'ravito' as const, stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
        { id: 'b', dist: 4000, name: 'Ravito 2', kind: 'ravito' as const, stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
      ],
    }
    const route = { ...newRace('Boucle', gpx), kind: 'route' as const } // ≈ 1,1 km
    const next = replaceRaceTrack(race, route)
    expect(next.gpxText).toBe(gpx)
    expect(next.id).toBe(race.id)
    expect(next.kind).toBe('race')
    expect(next.checkpoints.map((c) => c.id)).toEqual(['a'])
    expect(next.techOverrides).toEqual([])
  })

  it('étiquettes et recherche', () => {
    expect(parseTags(' Côte, plat ,côte,, Piste ')).toEqual(['côte', 'plat', 'piste'])
    const routes = [
      { ...newRace('Boucle du lac', gpx), tags: ['plat'] },
      { ...newRace('Montée du Chasseral', gpx), tags: ['côte', 'long'] },
      { ...newRace('Piste de Colombier', gpx), tags: ['piste', 'plat'] },
    ]
    expect(filterRoutes(routes, 'chass', []).map((r) => r.name)).toEqual(['Montée du Chasseral'])
    expect(filterRoutes(routes, '', ['plat']).length).toBe(2)
    expect(filterRoutes(routes, '', ['plat', 'piste']).map((r) => r.name)).toEqual(['Piste de Colombier'])
    expect(filterRoutes(routes, 'côte', []).map((r) => r.name)).toEqual(['Montée du Chasseral'])
  })
})
