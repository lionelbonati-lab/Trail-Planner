import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace } from '../defaults'
import { plannedAt } from '../live'
import { computePlan } from '../plan'
import { watchPlan } from '../watch'
import { parsePasses, parseWatchPlan, plannedAtWatch, watchStatus } from '../watchLive'

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
})
