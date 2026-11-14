// Conversions d'heures, d'allures et de fuseaux horaires.

/** Décalage (ms) entre le fuseau `timeZone` et UTC à l'instant `date`. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  )
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** "YYYY-MM-DDTHH:mm" exprimé dans `timeZone` vers un instant UTC. */
export function zonedToUtc(local: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) return new Date(NaN)
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  const off1 = tzOffsetMs(new Date(guess), timeZone)
  const off2 = tzOffsetMs(new Date(guess - off1), timeZone)
  return new Date(guess - off2)
}

/** Date et heure locales (« AAAA-MM-JJTHH:MM », comme un champ datetime-local) d'un instant dans un fuseau. */
export function utcToZonedInput(ms: number, timeZone: string): string {
  return new Date(ms + tzOffsetMs(new Date(ms), timeZone)).toISOString().slice(0, 16)
}

export function formatClock(date: Date, timeZone: string, withDay = false): string {
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(withDay ? { weekday: 'short' } : {}),
  }).format(date)
}

/** Durée (s) → "h:mm" ou "h:mm:ss". */
export function formatDuration(sec: number, withSeconds = false): string {
  if (!Number.isFinite(sec)) return '—'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const mm = String(m).padStart(2, '0')
  return withSeconds ? `${h}:${mm}:${String(ss).padStart(2, '0')}` : `${h}h${mm}`
}

/** Allure (s/km) → "m'ss". */
export function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '—'
  const s = Math.round(secPerKm)
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}`
}

/** "4:05", "4'05", "4.05" → secondes. "1:02:30" → secondes. */
export function parseDuration(text: string): number | null {
  const t = text.trim().replace(/['’h]/g, ':').replace(/"/g, '')
  if (!t) return null
  const parts = t.split(/[:.]/).filter((x) => x !== '').map(Number)
  if (parts.some((x) => Number.isNaN(x))) return null
  return parts.reduce((acc, x) => acc * 60 + x, 0)
}

export function paceToSpeed(secPerKm: number): number {
  return 1000 / secPerKm
}

export function speedToPace(mps: number): number {
  return 1000 / mps
}
