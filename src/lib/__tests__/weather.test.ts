import { describe, expect, it } from 'vitest'
import { fetchRaceWeather } from '../weather'

function fakeFetch(calls: string[]) {
  return (async (url: string) => {
    calls.push(url)
    const n = url.includes('start_date=') ? 2 : 1
    const daily = {
      temperature_2m_max: Array(n).fill(20),
      temperature_2m_min: Array(n).fill(8),
      precipitation_sum: Array(n).fill(1),
      wind_speed_10m_max: Array(n).fill(25),
      precipitation_probability_max: Array(n).fill(40),
    }
    return new Response(JSON.stringify({ elevation: 1012, daily }))
  }) as unknown as typeof fetch
}

describe('météo', () => {
  const now = new Date('2026-11-12T12:00:00Z')
  it('prévision si la course est dans 15 jours', async () => {
    const calls: string[] = []
    const r = await fetchRaceWeather(46.65, 6.32, new Date('2026-11-20T07:00:00Z'), 30 * 3600, now, fakeFetch(calls))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('api.open-meteo.com/v1/forecast')
    expect(calls[0]).toContain('start_date=2026-11-20&end_date=2026-11-21')
    expect(r).toMatchObject({ source: 'forecast', tMax: 20, tMin: 8, elevation: 1012, precipProb: 40 })
  })
  it('normales sur 5 ans si la course est lointaine', async () => {
    const calls: string[] = []
    const r = await fetchRaceWeather(45.9, 6.87, new Date('2027-08-28T16:00:00Z'), 40 * 3600, now, fakeFetch(calls))
    expect(calls).toHaveLength(5)
    expect(calls.every((c) => c.includes('archive-api.open-meteo.com'))).toBe(true)
    expect(calls[0]).toContain('start_date=2026-08-28&end_date=2026-08-30')
    expect(calls[4]).toContain('start_date=2022-08-28')
    expect(r.source).toBe('normals')
    expect(r.note).toBe('Normales 2022–2026 au 28/08–30/08')
  })
})
