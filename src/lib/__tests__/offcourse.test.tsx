import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShareView } from '../../components/SharePage'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan, scenarioWindows } from '../plan'
import { routeOffset } from '../routeGeo'
import { buildSnapshot, offText, reportOffCourse, runnerBanner } from '../share'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('position GPS comparée au tracé (page assistance)', () => {
  const race = newRace('Trail test', gpx())
  race.checkpoints = [{ id: 'a', dist: 5000, name: 'Ravito A', kind: 'ravito', stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
  const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, name: 'Lionel', watchId: 'abcdef0123456789', watchRaceId: race.id })
  const plan = computePlan(race, athlete)!
  const snap = buildSnapshot('uid', race, athlete, plan.track, plan.sim, scenarioWindows(plan.track, athlete, plan.opts))
  const s = Math.round(Date.parse(snap.start) / 1000)
  // 1 km à l'est du tracé (ligne nord-sud sur le méridien 6°), à mi-hauteur du km 5.
  const east = 6 + 1000 / (111195 * Math.cos((45.045 * Math.PI) / 180))

  it('écart au tracé et distance du point le plus proche', () => {
    const on = routeOffset(snap.route!, 45 + 5000 / 111195, 6)!
    expect(on.off).toBeLessThan(5)
    expect(on.dist).toBeCloseTo(5000, -1)
    const far = routeOffset(snap.route!, 45 + 5000 / 111195, east)!
    expect(far.off).toBeCloseTo(1000, -1)
    expect(routeOffset([[0, 45, 6]], 45, 6)).toBeNull()
    expect(offText(450)).toBe('450 m')
    expect(offText(3240)).toBe('3,2 km')
  })

  it('hors parcours ou pas encore dessus ; sur le parcours ou sans position : rien', () => {
    const base = { t: s + 1800, s, d: 0, lat: 45 + 5000 / 111195, lon: east }
    expect(reportOffCourse(snap, base)).toEqual({ off: expect.closeTo(1000, -1), notStarted: true })
    expect(reportOffCourse(snap, { ...base, d: 6000, p: `0:${s + 1500}` })?.notStarted).toBe(false)
    expect(reportOffCourse(snap, { ...base, lon: 6.001 })).toBeNull()
    expect(reportOffCourse(snap, { t: s + 1800, s, d: 4000 })).toBeNull()
    expect(runnerBanner('activity', snap, base, (s + 1900) * 1000)).toBe('Pas encore sur le parcours')
    expect(runnerBanner('activity', snap, { ...base, d: 6000, p: `0:${s + 1500}` }, (s + 1900) * 1000)).toBe('Hors parcours')
    expect(runnerBanner('activity', snap, { ...base, lon: 6 }, (s + 1900) * 1000)).toBe('En course')
  })

  it('page : « Pas encore sur le parcours » ou « Hors parcours », sans km ni position estimée', () => {
    const now = (s + 2400) * 1000
    const report = { t: s + 1800, s, d: 0, lat: 45 + 3000 / 111195, lon: east }
    const html = renderToStaticMarkup(<ShareView snap={snap} report={report} nowMs={now} />)
    expect(html).toContain('Pas encore sur le parcours · à 1,0 km du tracé')
    expect(html).not.toContain('sur le plan</div>')
    // Déjà 3 km faits sur le parcours, puis loin du tracé : dernière position connue, pas d'avancée estimée.
    const away = renderToStaticMarkup(<ShareView snap={snap} report={{ ...report, d: 3000 }} nowMs={now} />)
    expect(away).toContain('Hors parcours · à 1,0 km du tracé')
    expect(away).toContain('Dernière position sur le parcours : km 3,0')
    expect(away).not.toContain('estimé d&#x27;après son rythme')
    const onCourse = renderToStaticMarkup(<ShareView snap={snap} report={{ ...report, d: 3000, lon: 6 }} nowMs={now} />)
    expect(onCourse).toContain('km 3.0 ·')
    expect(onCourse).not.toContain('du tracé')
  })
})
