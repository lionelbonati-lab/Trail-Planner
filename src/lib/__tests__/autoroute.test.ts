import { describe, expect, it } from 'vitest'
import { destination, distanceForDuration, loopPoints, loopScore, rankBearings, reliefDensity, TERRAINS } from '../autoroute'
import { haversine } from '../gpx'
import type { Fetcher } from '../routing'

const S = { lat: 47.42, lon: 7.15 }

describe('création automatique de boucle', () => {
  it('destination : distance et direction respectées', () => {
    const p = destination(S.lat, S.lon, 90, 1000)
    expect(haversine(S.lat, S.lon, p.lat, p.lon)).toBeCloseTo(1000, 0)
    expect(p.lat).toBeCloseTo(S.lat, 3)
    expect(p.lon).toBeGreaterThan(S.lon)
  })

  it('trois points en boucle : périmètre à vol d’oiseau ≈ distance / 1,3', () => {
    const pts = loopPoints(S, 13000, 0)
    const ring = [S, ...pts, S]
    let per = 0
    for (let i = 1; i < ring.length; i++) per += haversine(ring[i - 1].lat, ring[i - 1].lon, ring[i].lat, ring[i].lon)
    expect(per).toBeCloseTo(10000, -2)
    // Direction nord : le point du milieu est au nord du départ.
    expect(pts[1].lat).toBeGreaterThan(S.lat)
  })

  it('relief : D+ par km estimé d’après l’altitude des points', () => {
    expect(reliefDensity([500, 500, 500, 500], 10000)).toBe(0)
    // 500 → 800 → 500 sur 10 km : ≈ 300 m × 1,5 / 10 km = 45 m/km.
    expect(reliefDensity([500, 800, 800, 500], 10000)).toBeCloseTo(45, 6)
  })

  it('directions classées selon le terrain voulu (une seule requête d’altitude)', async () => {
    let calls = 0
    // Montagne au nord : l'altitude monte avec la latitude.
    const fetcher: Fetcher = async (url) => {
      calls++
      const lats = new URL(url).searchParams.get('latitude')!.split(',').map(Number)
      return new Response(JSON.stringify({ elevation: lats.map((l) => 500 + Math.max(0, l - S.lat) * 40000) }), { status: 200 })
    }
    const mountain = await rankBearings(S, 15000, 'mountain', 0, fetcher)
    const flat = await rankBearings(S, 15000, 'flat', 0, fetcher)
    expect(calls).toBe(2)
    expect(mountain).toHaveLength(8)
    expect([0, 45, 315]).toContain(mountain[0].bearing)
    expect([135, 180, 225]).toContain(flat[0].bearing)
    expect(flat[0].density).toBeLessThan(mountain[0].density)
  })

  it('durée → distance avec le km-effort du terrain', () => {
    // 1 h à 3 m/s : 10,8 km à plat (cible 4 m/km → /1,04), 6,75 km en montagne (/1,6).
    expect(distanceForDuration(3600, 4, 0.75, 'flat') / 1000).toBeCloseTo(10.38, 1)
    expect(distanceForDuration(3600, 4, 0.75, 'mountain') / 1000).toBeCloseTo(6.75, 2)
  })

  it('score : distance juste et terrain respecté avant tout', () => {
    const good = loopScore({ error: 0.02, density: 25, offroad: 0, terrain: 'hilly' })
    const tooFlat = loopScore({ error: 0.02, density: 5, offroad: 0, terrain: 'hilly' })
    const tooLong = loopScore({ error: 0.25, density: 25, offroad: 0, terrain: 'hilly' })
    const offroad = loopScore({ error: 0.02, density: 25, offroad: 1, terrain: 'hilly' })
    expect(good).toBeLessThan(tooFlat)
    expect(good).toBeLessThan(tooLong)
    expect(good).toBeLessThan(offroad)
    expect(TERRAINS.mountain.min).toBe(TERRAINS.hilly.max)
  })
})
