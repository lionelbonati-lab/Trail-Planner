// Position du soleil (algorithme NOAA simplifié), suffisant pour jour/nuit à la minute près.

const RAD = Math.PI / 180

/** Élévation du soleil (degrés) à l'instant `ms` (UTC) en (lat, lon). */
export function solarElevation(ms: number, lat: number, lon: number): number {
  const jd = ms / 86400000 + 2440587.5
  const n = jd - 2451545.0
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const eps = (23.439 - 0.0000004 * n) * RAD
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24
  const ha = ((gmst * 15 + lon) * RAD - ra)
  const el = Math.asin(
    Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(ha),
  )
  return el / RAD
}

/** Nuit = soleil sous −6° (fin du crépuscule civil : frontale nécessaire). */
export function isNightAt(ms: number, lat: number, lon: number): boolean {
  return solarElevation(ms, lat, lon) < -6
}
