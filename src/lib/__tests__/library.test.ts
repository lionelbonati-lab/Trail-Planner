import { describe, expect, it } from 'vitest'
import { newRace, normalizeRace } from '../defaults'
import { filterRoutes, parseTags, planSession, toRoute } from '../library'
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

  it('séance datée : copie des zones, modèle intact', () => {
    const route = { ...newRace('Côte de Chaumont', gpx), kind: 'route' as const, zones: [{ id: 'z', from: 0, to: 500, kind: 'intensity' as const, value: 0.88, label: 'Tempo' }] }
    const s = planSession(route, '2026-11-20T08:00')
    expect(s.kind).toBe('session')
    expect(s.templateId).toBe(route.id)
    expect(s.env.start).toBe('2026-11-20T08:00')
    expect(s.zones).toEqual(route.zones)
    expect(s.zones).not.toBe(route.zones)
    expect(s.name).toMatch(/^Côte de Chaumont · /)
    expect(route.env.start).not.toBe('2026-11-20T08:00')
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
