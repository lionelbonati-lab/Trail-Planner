import { describe, expect, it } from 'vitest'
import { parseGpx } from '../gpx'
import { fetchOsmTech, overpassQuery, techFromWays, wayLevel } from '../osm'
import { fetchWeatherSeries } from '../weather'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 6000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>500</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}
const lat = (d: number) => 45 + d / 111195

describe('OpenStreetMap', () => {
  it('niveaux SAC, visibilité, marches', () => {
    expect(wayLevel({ highway: 'path', sac_scale: 'demanding_mountain_hiking' })).toEqual({ level: 3, label: 'sentier T3' })
    expect(wayLevel({ highway: 'path' }).level).toBe(1)
    expect(wayLevel({ highway: 'path', sac_scale: 'mountain_hiking', trail_visibility: 'bad' }).level).toBe(3)
    expect(wayLevel({ highway: 'steps' }).level).toBe(3)
    expect(wayLevel({ highway: 'path', sac_scale: 'difficult_alpine_hiking', trail_visibility: 'no' }).level).toBe(5)
  })
  it('associe la trace aux chemins voisins (à 10 m) et ignore les chemins éloignés', () => {
    const track = parseGpx(gpx(), 0)
    const ways = [
      { tags: { highway: 'path', sac_scale: 'alpine_hiking' }, geometry: [{ lat: lat(1000), lon: 6.0001 }, { lat: lat(2000), lon: 6.0001 }] },
      { tags: { highway: 'path', sac_scale: 'alpine_hiking' }, geometry: [{ lat: lat(3000), lon: 6.002 }, { lat: lat(4000), lon: 6.002 }] },
    ]
    const iv = techFromWays(track, ways)
    expect(iv).toHaveLength(1)
    expect(iv[0].level).toBe(4)
    expect(iv[0].from).toBeGreaterThan(900)
    expect(iv[0].to).toBeLessThan(2100)
  })
  it('requête Overpass et réponse', async () => {
    const track = parseGpx(gpx(), 0)
    expect(overpassQuery(track)).toMatch(/^\[out:json\]\[timeout:90\];way\(around:25,45\.00000,6\.00000,/)
    const fetcher = (async () =>
      new Response(JSON.stringify({ elements: [{ type: 'way', tags: { highway: 'path', sac_scale: 'mountain_hiking' }, geometry: [{ lat: lat(0), lon: 6 }, { lat: lat(6000), lon: 6 }] }] }))) as unknown as typeof fetch
    const iv = await fetchOsmTech(track, fetcher)
    expect(iv[0]).toMatchObject({ level: 2, label: 'sentier T2' })
  })
})

describe('météo heure par heure', () => {
  it('plusieurs points, série horaire en UTC', async () => {
    const calls: string[] = []
    const fetcher = (async (url: string) => {
      calls.push(url)
      const one = (e: number) => ({ elevation: e, hourly: { time: ['2026-11-20T00:00', '2026-11-20T01:00'], temperature_2m: [5, 6], precipitation: [0, 1.2], wind_speed_10m: [10, 12] } })
      return new Response(JSON.stringify([one(500), one(800), one(1000)]))
    }) as unknown as typeof fetch
    const pts = [0, 5000, 10000].map((d) => ({ dist: d, lat: lat(d), lon: 6 }))
    const s = await fetchWeatherSeries(pts, 10000, new Date('2026-11-20T00:00:00Z'), 3600, new Date('2026-11-12T00:00:00Z'), fetcher)
    expect(calls[0]).toContain('latitude=45.0000,45.0450,45.0899')
    expect(s!.start).toBe('2026-11-20T00:00:00Z')
    expect(s!.points).toHaveLength(3)
    expect(s!.points[1].precip[1]).toBe(1.2)
    const far = await fetchWeatherSeries(pts, 10000, new Date('2027-06-01T00:00:00Z'), 3600, new Date('2026-11-12T00:00:00Z'), fetcher)
    expect(far).toBeNull()
  })
})
