import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShareView } from '../../components/SharePage'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan, scenarioWindows } from '../plan'
import { buildSnapshot } from '../share'
import { plannedAtWatch, parseWatchPlan } from '../watchLive'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('page assistance', () => {
  const race = newRace('Trail test', gpx())
  race.checkpoints = [
    { id: 'a', dist: 5000, name: 'Ravito A', kind: 'ravito', stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
    { id: 'b', dist: 10000, name: 'Sommet B', kind: 'split', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
  ]
  const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, name: 'Lionel', watchId: 'abcdef0123456789', watchRaceId: race.id })
  const plan = computePlan(race, athlete)!
  const snap = buildSnapshot('uid', race, athlete, plan.track, plan.sim, scenarioWindows(plan.track, athlete, plan.opts))

  it('sans relevé de montre : plan seul', () => {
    expect(snap.liveRef).toBe('abcdef0123456789')
    const html = renderToStaticMarkup(<ShareView snap={snap} report={null} />)
    expect(html).toContain('Le suivi en direct apparaîtra ici')
    expect(html).toContain('Ravito A')
  })

  it('avec relevé de montre : position, écart, passage réel, batterie', () => {
    const w = parseWatchPlan(snap.w)!
    const s = Math.round(Date.parse(snap.start) / 1000)
    const d = 7000
    const t = s + Math.round(plannedAtWatch(w, d) * 1.1)
    const passA = s + Math.round(w.cps[0].planned * 1.1)
    const html = renderToStaticMarkup(
      <ShareView snap={snap} report={{ t, s, d, p: `0:${passA}`, bat: 72, lat: 45.06, lon: 6 }} nowMs={(t + 180) * 1000} />,
    )
    expect(html).toContain('Montre · en course depuis')
    expect(html).toContain('km 7.0')
    expect(html).toMatch(/\+\d+ min sur le plan/)
    expect(html).toContain('batterie 72 %')
    expect(html).toContain('il y a 3 min')
    expect(html).toContain('Prochain : <strong>Sommet B</strong>')
    expect(html).toContain('class="me"')
  })

  it('relevé trop ancien : ignoré', () => {
    const s = Math.round(Date.parse(snap.start) / 1000)
    const html = renderToStaticMarkup(<ShareView snap={snap} report={{ t: s + 600, s, d: 2000 }} nowMs={(s + 600 + 4 * 3600) * 1000} />)
    expect(html).not.toContain('Montre · en course depuis')
  })
})
