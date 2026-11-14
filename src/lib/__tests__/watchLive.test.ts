import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace } from '../defaults'
import { plannedAt } from '../live'
import { computePlan } from '../plan'
import { watchPlan } from '../watch'
import { parsePasses, parseWatchPlan, plannedAtWatch, watchStartMs, watchStatus } from '../watchLive'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('suivi depuis la montre', () => {
  const race = newRace('T', gpx())
  race.checkpoints = [
    { id: 'a', dist: 5000, name: 'A', kind: 'ravito', stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
    { id: 'b', dist: 10000, name: 'B', kind: 'ravito', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
  ]
  const plan = computePlan(race, DEFAULT_ATHLETE)!
  const w = parseWatchPlan(watchPlan(race, DEFAULT_ATHLETE, plan.track, plan.sim))!

  it('plan compact relu, temps prévu cohérent avec l’app', () => {
    expect(w.cps.map((c) => c.name)).toEqual(['A', 'B', 'Arrivée'])
    for (const d of [0, 3000, 5100, 7500, 12000, 19900]) expect(Math.abs(plannedAtWatch(w, d) - plannedAt(plan.sim, d))).toBeLessThan(60)
  })

  it('passages, retard et heures estimées', () => {
    const s = 1_800_000_000
    const late = 1.2
    const d = 7000
    const t = s + Math.round(plannedAtWatch(w, d) * late)
    const passA = s + Math.round(w.cps[0].planned * late)
    const st = watchStatus({ t, s, d, p: `0:${passA}`, bat: 64 }, w, t + 120)
    expect(st.age).toBe(120)
    expect(st.delta).toBeGreaterThan(0)
    expect(st.passed.get(0)).toBe(passA)
    expect(st.etas[0]).toBe(passA)
    expect(st.etas[1]).toBeGreaterThan(s + w.cps[1].planned)
    expect(st.finishEta).toBeGreaterThan(s + plan.sim.totalTime)
    expect(parsePasses('0:10,x:3,2:30').size).toBe(2)
  })

  it('heures estimées recalculées à chaque passage seulement, d’après ce qui a été fait', () => {
    const s = 1_800_000_000
    // Avant le premier passage : heures prévues, quelle que soit la position.
    const before = watchStatus({ t: s + 1500, s, d: 3000, p: '' }, w, s + 1500)
    expect(before.etas).toEqual(w.cps.map((cp) => s + cp.planned))
    // Passage en A avec 20 % de retard : la suite est recalculée (retard amorti à 14 %, arrêt non étiré).
    const passA = s + Math.round(w.cps[0].planned * 1.2)
    const st1 = watchStatus({ t: passA + 600, s, d: 6500, p: `0:${passA}` }, w, passA + 600)
    const exp = passA + w.cps[0].stop + (w.cps[1].planned - w.cps[0].planned - w.cps[0].stop) * (1 + 0.7 * 0.2)
    expect(st1.etas[1]).toBeCloseTo(exp, 0)
    // Relevé suivant plus loin, sans nouveau passage : estimations inchangées (l'écart, lui, bouge).
    const st2 = watchStatus({ t: passA + 1800, s, d: 8500, p: `0:${passA}` }, w, passA + 1800)
    expect(st2.etas).toEqual(st1.etas)
    expect(st2.delta).not.toBe(st1.delta)
    // Passage en B en avance : nouvelles estimations pour l'arrivée.
    const passB = s + Math.round(w.cps[1].planned * 0.95)
    const st3 = watchStatus({ t: passB + 60, s, d: 10100, p: `0:${passA},1:${passB}` }, w, passB + 60)
    expect(st3.etas[2]).toBeLessThan(st1.etas[2])
    expect(st3.finishEta).toBeCloseTo(st3.etas[2], 0)
  })

  it('départ libre : départ de la montre tant que l’activité dure (relevé de moins de 12 h)', () => {
    const s = 1_800_000_000
    expect(watchStartMs({ t: s + 4 * 3600, s, d: 0 }, s + 9 * 3600)).toBe(s * 1000)
    expect(watchStartMs({ t: s + 600, s, d: 0 }, s + 13 * 3600)).toBeNull()
    expect(watchStartMs(null, s)).toBeNull()
  })
})
