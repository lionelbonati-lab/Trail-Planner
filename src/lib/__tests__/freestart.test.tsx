import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShareView } from '../../components/SharePage'
import { Card } from '../../components/ui'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan, isFreeStart, scenarioWindows } from '../plan'
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
    // Relevé vieux de 4 h (téléphone sans réseau) : heures prévues toujours calées sur ce départ.
    const later = renderToStaticMarkup(<ShareView snap={snap} report={{ t: s + 300, s, d: 1000 }} nowMs={now + 4 * 3600000} />)
    expect(later).toContain('parti à 08:50')
    expect(later).toContain(at(s * 1000))
  })
})

describe('parcours : pas d’heure de départ', () => {
  const route = { ...newRace('Boucle', gpx()), kind: 'route' as const }
  const athlete = normalizeAthlete(DEFAULT_ATHLETE)
  const plan = computePlan(route, athlete)!

  it('toujours en départ libre : montre sans heure, partage marqué ; une course ne l’est que si cochée', () => {
    expect(isFreeStart(route)).toBe(true)
    expect(isFreeStart(newRace('Trail', ''))).toBe(false)
    expect(isFreeStart({ ...newRace('Trail', ''), freeStart: true })).toBe(true)
    expect(watchPlan(route, athlete, plan.track, plan.sim).split('\n')[2]).toMatch(/^S\|0\|/)
    const snap = buildSnapshot('uid', route, athlete, plan.track, plan.sim, scenarioWindows(plan.track, athlete, plan.opts))
    expect(snap.freeStart).toBe(true)
  })
})

describe('équivalences du km-effort : celles du profil', () => {
  it('km-e des tronçons et mode « Km-effort » suivent le profil, pas la course', () => {
    const pts: string[] = []
    for (let d = 0; d <= 10000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d <= 5000 ? d / 10 : (10000 - d) / 10)}</ele></trkpt>`)
    const race = { ...newRace('Bosse', `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`), kme: { upPer1km: 50, downPer1km: 50 } }
    // Valeurs saisies (équivalences automatiques décochées).
    const base = { ...normalizeAthlete(DEFAULT_ATHLETE), kmeAuto: false }
    expect(base.kme).toEqual({ upPer1km: 100, downPer1km: 0 })
    const kmeOf = (a: typeof base) => computePlan(race, a)!.sim.splits.reduce((t, s) => t + s.kme, 0)
    // 10 km et 500 m de D+ / D− (lissage de l'altitude : un peu moins).
    expect(kmeOf(base)).toBeGreaterThan(14.6)
    expect(kmeOf(base)).toBeLessThan(15.01)
    const steep = { ...base, kme: { upPer1km: 50, downPer1km: 0 } }
    expect(kmeOf(steep) - kmeOf(base)).toBeGreaterThan(4.6)
    const down = { ...base, kme: { upPer1km: 100, downPer1km: 250 } }
    expect(kmeOf(down) - kmeOf(base)).toBeGreaterThan(1.8)
    // Mode de calcul « Km-effort » : temps plus long quand le D+ compte davantage.
    const t = (a: typeof base) => computePlan({ ...race, mode: 'kme' }, a)!.sim.totalTime
    expect(t(steep)).toBeGreaterThan(t(base) * 1.2)
  })
})

describe('cadres pliables sur téléphone', () => {
  it('page ouverte cadres pliés, titre en bouton ; contenu principal ouvert ; titre libre toujours ouvert', () => {
    const closed = renderToStaticMarkup(<Card title="Temps de passage"><p>contenu</p></Card>)
    expect(closed).toContain('foldable')
    expect(closed).toContain('folded')
    expect(closed).toContain('aria-expanded="false"')
    const open = renderToStaticMarkup(<Card title="Mes courses" fold="open"><p>contenu</p></Card>)
    expect(open).toContain('aria-expanded="true"')
    expect(open).not.toContain(' folded')
    for (const fixed of [<Card key="a" title={<input />}><p>contenu</p></Card>, <Card key="b" title="Mode course" fold={false}><p>contenu</p></Card>]) {
      const html = renderToStaticMarkup(fixed)
      expect(html).not.toContain('card-fold')
      expect(html).not.toContain('folded')
    }
  })
})
