// Météo via Open-Meteo (gratuit, sans clé, CORS autorisé).
// - Course dans les 15 prochains jours : prévision.
// - Au-delà (ou dans le passé) : normales = moyenne des 5 dernières années aux mêmes dates.
import type { WeatherSeries } from './types'

export interface WeatherResult {
  source: 'forecast' | 'normals'
  /** Température max moyenne des jours de course (°C). */
  tMax: number
  /** Température min moyenne des jours de course (°C). */
  tMin: number
  /** Altitude du point de la grille météo (m). */
  elevation: number
  /** Probabilité de pluie max (%), prévision uniquement. */
  precipProb: number | null
  /** Cumul de pluie moyen par jour (mm). */
  precipMm: number | null
  /** Vent max (km/h). */
  windMax: number | null
  note: string
}

const FORECAST_DAYS = 15

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

function maxOf(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  return v.length ? Math.max(...v) : null
}

async function getJson(url: string, fetcher: typeof fetch): Promise<any> {
  const r = await fetcher(url)
  if (!r.ok) throw new Error(`Open-Meteo : HTTP ${r.status}`)
  const j = await r.json()
  if (j.error) throw new Error(`Open-Meteo : ${j.reason ?? 'erreur'}`)
  return j
}

const fmtDate = (s: string) => s.split('-').reverse().slice(0, 2).join('/')

/**
 * @param startUtc  départ (instant UTC)
 * @param durationS durée prévue de la course (s)
 */
export async function fetchRaceWeather(
  lat: number,
  lon: number,
  startUtc: Date,
  durationS: number,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<WeatherResult> {
  const endUtc = new Date(startUtc.getTime() + Math.max(durationS, 3600) * 1000)
  const d0 = ymd(startUtc)
  const d1 = ymd(endUtc)
  const daysAhead = (startUtc.getTime() - now.getTime()) / 86400000
  const loc = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=auto`
  const daily = 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max'

  if (daysAhead > -1 && endUtc.getTime() - now.getTime() < FORECAST_DAYS * 86400000) {
    const j = await getJson(
      `https://api.open-meteo.com/v1/forecast?${loc}&daily=${daily},precipitation_probability_max&start_date=${d0}&end_date=${d1}`,
      fetcher,
    )
    const tMax = avg(j.daily.temperature_2m_max)
    const tMin = avg(j.daily.temperature_2m_min)
    if (tMax === null || tMin === null) throw new Error('Prévision indisponible pour ces dates.')
    const precipProb = maxOf(j.daily.precipitation_probability_max)
    const precipMm = avg(j.daily.precipitation_sum)
    const windMax = maxOf(j.daily.wind_speed_10m_max)
    return {
      source: 'forecast',
      tMax,
      tMin,
      elevation: j.elevation,
      precipProb,
      precipMm,
      windMax,
      note: `Prévision du ${fmtDate(ymd(now))} pour le ${fmtDate(d0)}${d1 !== d0 ? `–${fmtDate(d1)}` : ''}`,
    }
  }

  // Normales : mêmes dates sur les 5 dernières années disponibles
  // (l'archive a quelques jours de retard : on écarte les dates trop récentes).
  const startYear = startUtc.getUTCFullYear()
  const years: number[] = []
  for (let k = 1; years.length < 5 && k < 15; k++) {
    const end = new Date(endUtc)
    end.setUTCFullYear(endUtc.getUTCFullYear() - k)
    if (end.getTime() < now.getTime() - 7 * 86400000) years.push(startYear - k)
  }
  const shift = (s: string, y: number) => {
    const md = s.slice(5) === '02-29' ? '02-28' : s.slice(5)
    return `${Number(s.slice(0, 4)) + (y - startYear)}-${md}`
  }
  const results = await Promise.all(
    years.map((y) =>
      getJson(
        `https://archive-api.open-meteo.com/v1/archive?${loc}&daily=${daily}&start_date=${shift(d0, y)}&end_date=${shift(d1, y)}`,
        fetcher,
      ),
    ),
  )
  const tMax = avg(results.flatMap((j) => j.daily.temperature_2m_max))
  const tMin = avg(results.flatMap((j) => j.daily.temperature_2m_min))
  if (tMax === null || tMin === null) throw new Error('Normales indisponibles pour ces dates.')
  return {
    source: 'normals',
    tMax,
    tMin,
    elevation: results[0].elevation,
    precipProb: null,
    precipMm: avg(results.flatMap((j) => j.daily.precipitation_sum)),
    windMax: avg(results.map((j) => maxOf(j.daily.wind_speed_10m_max))),
    note: `Normales ${years[years.length - 1]}–${years[0]} au ${fmtDate(d0)}${d1 !== d0 ? `–${fmtDate(d1)}` : ''}`,
  }
}

/**
 * Météo heure par heure en plusieurs points du parcours (prévision uniquement,
 * jusqu'à 16 jours). Renvoie null si la course est hors de portée de la prévision.
 */
export async function fetchWeatherSeries(
  points: { dist: number; lat: number; lon: number }[],
  totalDist: number,
  startUtc: Date,
  durationS: number,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<WeatherSeries | null> {
  const endUtc = new Date(startUtc.getTime() + Math.max(durationS, 3600) * 1000)
  if (endUtc.getTime() - now.getTime() > FORECAST_DAYS * 86400000 || endUtc.getTime() < now.getTime() - 86400000) return null
  // Un point tous les 5 km au moins, 15 au plus.
  const n = Math.min(15, Math.max(2, Math.ceil(totalDist / 5000) + 1))
  const samples = Array.from({ length: n }, (_, i) => {
    const d = (totalDist * i) / (n - 1)
    return points.reduce((best, p) => (Math.abs(p.dist - d) < Math.abs(best.dist - d) ? p : best))
  })
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${samples.map((p) => p.lat.toFixed(4)).join(',')}` +
    `&longitude=${samples.map((p) => p.lon.toFixed(4)).join(',')}` +
    `&hourly=temperature_2m,precipitation,wind_speed_10m&timezone=GMT` +
    `&start_date=${ymd(startUtc)}&end_date=${ymd(endUtc)}`
  const j = await getJson(url, fetcher)
  const list = Array.isArray(j) ? j : [j]
  if (list.length !== samples.length) throw new Error('Open-Meteo : réponse inattendue.')
  return {
    fetchedAt: now.toISOString(),
    start: `${list[0].hourly.time[0]}:00Z`,
    points: list.map((r, i) => ({
      dist: samples[i].dist,
      elevation: r.elevation,
      temp: r.hourly.temperature_2m.map((x: number | null) => x ?? NaN),
      precip: r.hourly.precipitation.map((x: number | null) => x ?? 0),
      wind: r.hourly.wind_speed_10m.map((x: number | null) => x ?? 0),
    })),
  }
}
