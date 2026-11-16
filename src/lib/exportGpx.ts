import { indexAt } from './gpx'
import { isFreeStart } from './plan'
import { formatClock, formatDuration, zonedToUtc } from './time'
import type { Race, SimResult, Track } from './types'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Type Garmin d'un point (symbole GPX et type de point de parcours) : Garmin Connect en tire l'icône
 * du point de parcours sur la montre (ravito → poste de secours / ravitaillement).
 */
export function garminPoint(kind: string): { sym: string; type: string } {
  switch (kind) {
    case 'ravito':
    case 'base':
      return { sym: 'Food', type: 'Aid Station' }
    case 'cutoff':
      return { sym: 'Danger Area', type: 'Danger' }
    case 'chrono':
      return { sym: 'Flag, Green', type: 'Checkpoint' }
    default:
      return { sym: 'Flag, Blue', type: 'Generic' }
  }
}

/**
 * GPX de parcours pour Garmin Connect : trace horodatée selon le plan
 * (partenaire virtuel) et waypoints nommés avec l'heure de passage prévue.
 * Une fois importé comme parcours, Connect permet d'en créer une stratégie PacePro.
 */
export function buildCourseGpx(race: Race, track: Track, sim: SimResult): string {
  const startMs = zonedToUtc(race.env.start, race.env.timeZone).getTime()
  const tz = race.env.timeZone
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push(
    '<gpx version="1.1" creator="Trail Planner" xmlns="http://www.topografix.com/GPX/1/1">',
  )
  lines.push(`  <metadata><name>${esc(race.name)}</name></metadata>`)

  // Nom du point = temps de passage prévu (heure, ou temps depuis le départ en départ libre), lu sur la
  // montre dans « À venir » ; le nom du point passe dans la description.
  const free = isFreeStart(race)
  for (const row of sim.splits) {
    const p = track.points[indexAt(track.points, row.to)]
    const label = free ? formatDuration(row.arrival) : formatClock(row.arrivalClock, tz)
    const { sym, type } = garminPoint(row.cp.kind)
    const desc = [
      row.cp.name,
      `Km ${(row.to / 1000).toFixed(1)}`,
      `Passage ${formatClock(row.arrivalClock, tz)} (${formatDuration(row.arrival)})`,
      row.cp.stopMin ? `Arrêt ${row.cp.stopMin} min` : '',
      row.cp.notes,
    ]
      .filter(Boolean)
      .join(' · ')
    lines.push(`  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">`)
    lines.push(`    <ele>${p.ele.toFixed(1)}</ele>`)
    lines.push(`    <name>${esc(label)}</name>`)
    lines.push(`    <desc>${esc(desc)}</desc>`)
    lines.push(`    <sym>${sym}</sym>`)
    lines.push(`    <type>${type}</type>`)
    lines.push('  </wpt>')
  }

  lines.push(`  <trk><name>${esc(race.name)}</name><trkseg>`)
  track.points.forEach((p, i) => {
    const t = sim.points[i]?.t ?? 0
    const time = Number.isNaN(startMs) ? '' : `<time>${new Date(startMs + t * 1000).toISOString()}</time>`
    lines.push(
      `    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele.toFixed(1)}</ele>${time}</trkpt>`,
    )
  })
  lines.push('  </trkseg></trk>')
  lines.push('</gpx>')
  return lines.join('\n')
}

export function download(filename: string, content: string | Uint8Array, type = 'application/gpx+xml') {
  const blob = new Blob([content as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
