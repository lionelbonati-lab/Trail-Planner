import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShareView } from '../../components/SharePage'
import { Card } from '../../components/ui'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan, scenarioWindows } from '../plan'
import { buildSnapshot } from '../share'
import { utcToZonedInput, zonedToUtc } from '../time'
import { watchPlan } from '../watch'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 10000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>500</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('départ libre (entraînement)', () => {
  const race = { ...newRace('Footing', gpx()), freeStart: true }
  race.checkpoints = [{ id: 'a', dist: 5000, name: 'Mi-parcours', kind: 'info', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
  const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, name: 'Lionel' })
  const plan = computePlan(race, athlete)!
  const snap = buildSnapshot('uid', race, athlete, plan.track, plan.sim, scenarioWindows(plan.track, athlete, plan.opts))
  const halfway = plan.sim.splits[0].arrival

  it('heure locale d’un instant : aller-retour avec zonedToUtc', () => {
    const ms = Date.parse('2026-07-01T05:30:00Z')
    expect(utcToZonedInput(ms, 'Europe/Paris')).toBe('2026-07-01T07:30')
    expect(zonedToUtc(utcToZonedInput(ms, 'Europe/Paris'), 'Europe/Paris').getTime()).toBe(ms)
  })

  it('montre : départ 0 (« Départ libre »), partage marqué', () => {
    expect(watchPlan(race, athlete, plan.track, plan.sim).split('\n')[2]).toMatch(/^S\|0\|/)
    expect(snap.freeStart).toBe(true)
  })

  it('page assistance : heures pour un départ maintenant, puis calées sur le départ donné par la montre', () => {
    const now = Date.parse('2026-11-14T08:00:00Z')
    const before = renderToStaticMarkup(<ShareView snap={snap} report={null} nowMs={now} />)
    expect(before).toContain('départ libre (heures pour un départ maintenant)')
    // Europe/Paris : 09:00 + temps prévu jusqu'au point.
    const at = (startMs: number) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(startMs + halfway * 1000))
    expect(before).toContain(at(now))
    const s = Math.round(now / 1000) - 600
    const after = renderToStaticMarkup(<ShareView snap={snap} report={{ t: s + 300, s, d: 1000 }} nowMs={now} />)
    expect(after).toContain('parti à 08:50')
    expect(after).toContain(at(s * 1000))
  })
})

describe('cadres pliables sur téléphone', () => {
  it('cadre secondaire plié d’office, titre en bouton ; cadre à titre libre toujours ouvert', () => {
    const closed = renderToStaticMarkup(<Card title="Plan nutrition" fold="closed"><p>contenu</p></Card>)
    expect(closed).toContain('foldable')
    expect(closed).toContain('folded')
    expect(closed).toContain('aria-expanded="false"')
    const open = renderToStaticMarkup(<Card title="Temps de passage"><p>contenu</p></Card>)
    expect(open).toContain('aria-expanded="true"')
    expect(open).not.toContain(' folded')
    const fixed = renderToStaticMarkup(<Card title={<input />}><p>contenu</p></Card>)
    expect(fixed).not.toContain('card-fold')
  })
})
