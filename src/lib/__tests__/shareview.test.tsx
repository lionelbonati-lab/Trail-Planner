import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShareView } from '../../components/SharePage'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan, scenarioWindows } from '../plan'
import { buildSnapshot } from '../share'
import { estimatedDist, ESTIMATE_MAX_S, plannedAtWatch, parseWatchPlan } from '../watchLive'

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
    // Tracé simplifié pour la carte : la ligne droite du parcours de test tient en deux points.
    expect(snap.route).toEqual([[0, 45, 6], [Math.round(plan.track.totalDist), expect.closeTo(45.17986, 4), 6]])
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

  it('navigation : lien par point (accès assistance s’il est placé) et trajet entre les points cochés', () => {
    const r2 = { ...race, checkpoints: race.checkpoints.map((c) => (c.id === 'a' ? { ...c, access: { lat: 45.05, lon: 6.012 } } : c)) }
    const p2 = computePlan(r2, athlete)!
    const s2 = buildSnapshot('uid', r2, athlete, p2.track, p2.sim, scenarioWindows(p2.track, athlete, p2.opts))
    const [a, b, finish] = s2.rows
    expect(a).toMatchObject({ assist: true, access: true, lat: 45.05, lon: 6.012 })
    expect(b).toMatchObject({ assist: false, access: false, lon: 6 })
    expect(b.lat).toBeCloseTo(45 + 10000 / 111195, 4)
    expect(finish).toMatchObject({ name: 'Arrivée', assist: true })
    const html = renderToStaticMarkup(<ShareView snap={s2} report={null} />)
    expect(html).toContain('Trajet de l&#x27;assistance')
    expect(html).toContain('Y aller (accès assistance)')
    // Ravito A (accès) puis arrivée : une étape et la destination, depuis la position du téléphone.
    expect(html).toContain(`https://www.google.com/maps/dir/?api=1&amp;destination=${finish.lat!.toFixed(5)},${finish.lon!.toFixed(5)}&amp;waypoints=45.05000,6.01200&amp;travelmode=driving`)
  })

  it('position estimée entre deux relevés : au rythme mesuré, arrêt au ravito compris, une heure au plus', () => {
    const w = parseWatchPlan(snap.w)!
    const s = Math.round(Date.parse(snap.start) / 1000)
    // Au plan exact au km 3 : 10 min plus tard, on est là où le plan met 10 min de plus.
    const t = s + Math.round(plannedAtWatch(w, 3000))
    const r = { t, s, d: 3000 }
    const at10 = estimatedDist(r, w, t + 600)!
    expect(plannedAtWatch(w, at10) - plannedAtWatch(w, 3000)).toBeCloseTo(600, -1)
    // Juste avant le ravito A (km 5, 3 min d'arrêt) : l'estimation y reste le temps de l'arrêt.
    const tA = s + Math.round(plannedAtWatch(w, 4990))
    const atStop = estimatedDist({ t: tA, s, d: 4990 }, w, tA + 120)!
    expect(atStop).toBeGreaterThan(4990)
    expect(atStop).toBeLessThanOrEqual(5001)
    // 20 % plus lent que le plan : on avance moins vite (amorti).
    const slow = { t: s + Math.round(plannedAtWatch(w, 3000) * 1.2), s, d: 3000 }
    expect(estimatedDist(slow, w, slow.t + 600)!).toBeLessThan(at10)
    // Plus d'une heure sans relevé : pas d'estimation.
    expect(estimatedDist(r, w, t + ESTIMATE_MAX_S + 60)).toBeNull()
    // Rendu : position estimée annoncée, encart LiveTrack.
    const html = renderToStaticMarkup(<ShareView snap={snap} report={r} nowMs={(t + 600) * 1000} />)
    expect(html).toMatch(/≈ km \d+,\d maintenant \(estimé/)
    expect(html).toContain('Garmin LiveTrack')
  })

  it('relevé trop ancien : ignoré', () => {
    const s = Math.round(Date.parse(snap.start) / 1000)
    const html = renderToStaticMarkup(<ShareView snap={snap} report={{ t: s + 600, s, d: 2000 }} nowMs={(s + 600 + 4 * 3600) * 1000} />)
    expect(html).not.toContain('Montre · en course depuis')
  })
})
