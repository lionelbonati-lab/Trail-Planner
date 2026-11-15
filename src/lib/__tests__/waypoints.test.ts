import { describe, expect, it } from 'vitest'
import { parseGpx, type RawPoint } from '../gpx'
import { drawnWithMarks } from '../routing'
import { waypointCheckpoints, waypointKind } from '../splits'

// Trace droite vers le nord de 10 km, avec des waypoints : départ, ravito, barrière, sommet, parking éloigné, doublon.
const lat = (d: number) => 45 + d / 111195
function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 10000; d += 20) pts.push(`<trkpt lat="${lat(d)}" lon="6"><ele>${500 + d / 20}</ele></trkpt>`)
  const w = (d: number, name: string, extra = '', dLon = 0) => `<wpt lat="${lat(d)}" lon="${6 + dLon}"><name>${name}</name>${extra}</wpt>`
  return `<gpx>${w(0, 'Départ')}${w(3000, 'Les Contamines', '<sym>Food Source</sym>')}${w(3050, 'Les Contamines bis')}${w(5000, 'Barrière horaire')}${w(7000, 'Col du Bonhomme')}${w(8000, 'Parking', '', 0.01)}${w(10000, 'Arrivée')}<trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('waypoints d’un GPX importé', () => {
  it('lecture : distance sur la trace, écart, type et symbole', () => {
    const t = parseGpx(gpx())
    expect(t.waypoints.map((w) => w.name)).toEqual(['Départ', 'Les Contamines', 'Les Contamines bis', 'Barrière horaire', 'Col du Bonhomme', 'Parking', 'Arrivée'])
    const ravito = t.waypoints[1]
    expect(Math.abs(ravito.dist - 3000)).toBeLessThan(25)
    expect(ravito.off).toBeLessThan(15)
    expect(ravito.tags).toBe('Food Source')
    expect(t.waypoints[5].off).toBeGreaterThan(700) // parking à ~790 m à l'est
  })

  it('course : ravito, barrière, point inter ; départ, arrivée, doublon et waypoint éloigné écartés', () => {
    const t = parseGpx(gpx())
    const cps = waypointCheckpoints(t, 'race')
    expect(cps.map((c) => `${c.kind}:${c.name}`)).toEqual(['ravito:Les Contamines', 'cutoff:Barrière horaire', 'split:Col du Bonhomme'])
    expect(cps[0].stopMin).toBe(3)
    expect(cps[2].stopMin).toBe(0)
    // Parcours : repères ; points déjà présents à moins de 100 m : pas de doublon.
    expect(waypointCheckpoints(t, 'route').map((c) => c.kind)).toEqual(['info', 'info', 'info'])
    expect(waypointCheckpoints(t, 'race', cps)).toEqual([])
  })

  it('genre deviné du nom ou du symbole', () => {
    expect(waypointKind({ name: 'Ravitaillement complet' }, 'race')).toBe('ravito')
    expect(waypointKind({ name: 'PC 3', tags: 'Drinking Water' }, 'race')).toBe('ravito')
    expect(waypointKind({ name: 'BH Champex' }, 'race')).toBe('cutoff')
    expect(waypointKind({ name: 'Sommet' }, 'race')).toBe('split')
    expect(waypointKind({ name: 'Ravito' }, 'route')).toBe('info')
  })

  it('traceur : waypoints en points de repère nommés du tracé', () => {
    const raw: RawPoint[] = []
    for (let d = 0; d <= 10000; d += 20) raw.push({ lat: lat(d), lon: 6, ele: 500 })
    const { idx, names } = drawnWithMarks(raw, [
      { name: 'Départ', lat: lat(0), lon: 6 },
      { name: 'Col du Bonhomme', lat: lat(7010), lon: 6 },
      { name: 'Parking', lat: lat(8000), lon: 6.01 },
    ])
    expect([...names.values()]).toEqual(['Col du Bonhomme'])
    const i = [...names.keys()][0]
    expect(idx).toContain(i)
    expect(Math.abs(i * 20 - 7000)).toBeLessThan(30)
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(raw.length - 1)
  })
})
