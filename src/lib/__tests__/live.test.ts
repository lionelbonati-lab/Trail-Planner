import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace } from '../defaults'
import { liveStatus, locate, plannedAt } from '../live'
import { computePlan, scenarioWindows } from '../plan'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('suivi en direct', () => {
  const race = newRace('Test', gpx())
  race.checkpoints = [
    { id: 'a', dist: 5000, name: 'A', kind: 'ravito', stopMin: 2, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
    { id: 'b', dist: 10000, name: 'B', kind: 'ravito', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
  ]
  const plan = computePlan(race, DEFAULT_ATHLETE)!
  const t0 = Date.parse('2026-06-06T04:00:00Z')

  it('sans passage : estimations = plan', () => {
    const st = liveStatus({ startedAt: new Date(t0).toISOString(), passages: {} }, plan.sim, t0 + 600000, () => null)
    expect(st.lastIdx).toBe(-1)
    expect(st.elapsed).toBe(600)
    expect(st.finishEta).toBeCloseTo(plan.sim.totalTime, 0)
  })

  it('retard au point A : prolongé (amorti) sur la suite', () => {
    const planA = plan.sim.splits[0].arrival
    const late = planA * 1.2
    const st = liveStatus({ startedAt: new Date(t0).toISOString(), passages: { a: new Date(t0 + late * 1000).toISOString() } }, plan.sim, t0 + late * 1000, () => null)
    expect(st.lastIdx).toBe(0)
    expect(st.delta).toBeCloseTo(planA * 0.2, 0)
    expect(st.ratio).toBeCloseTo(1.14, 2)
    const planB = plan.sim.splits[1].arrival
    expect(st.rows[1].eta).toBeGreaterThan(planB + planA * 0.2)
    expect(st.finishEta).toBeGreaterThan(plan.sim.totalTime)
  })

  it('position GPS projetée et temps prévu à cette distance', () => {
    const d = locate(plan.track, 45 + 7000 / 111195, 6.0001, 5000)
    expect(Math.abs(d - 7000)).toBeLessThan(40)
    expect(plannedAt(plan.sim, d)).toBeGreaterThan(plan.sim.splits[0].arrival)
  })

  it('fenêtres de passage ordonnées', () => {
    const w = scenarioWindows(plan.track, DEFAULT_ATHLETE, plan.opts)('b')!
    expect(w.early).toBeLessThan(plan.sim.splits[1].arrival)
    expect(w.late).toBeGreaterThan(plan.sim.splits[1].arrival)
  })
})
