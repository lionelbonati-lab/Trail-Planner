import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace } from '../defaults'
import { plannedAt } from '../live'
import { computePlan } from '../plan'
import { watchPlan } from '../watch'
import { parseDepartures, parsePasses, parseWatchPlan, plannedAtWatch, watchStartMs, watchStatus } from '../watchLive'

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

  it('heures estimées recalculées à chaque relevé, d’après ce qui a été fait', () => {
    const s = 1_800_000_000
    // Avant le premier passage, dans les temps : heures prévues (à la minute près).
    const onTime = watchStatus({ t: s + Math.round(plannedAtWatch(w, 3000)), s, d: 3000, p: '' }, w, s + 1500)
    onTime.etas.forEach((e, i) => expect(Math.abs(e - (s + w.cps[i].planned))).toBeLessThan(60))
    // Même position avec 20 % de retard : toute la suite est décalée (sans attendre un passage).
    const t1 = s + Math.round(plannedAtWatch(w, 3000) * 1.2)
    const late = watchStatus({ t: t1, s, d: 3000, p: '' }, w, t1)
    late.etas.forEach((e, i) => expect(e).toBeGreaterThan(s + w.cps[i].planned + 60))
    // Passage en A avec 20 % de retard, relevé au point : retard amorti à 14 %, arrêt non étiré.
    const passA = s + Math.round(w.cps[0].planned * 1.2)
    const st1 = watchStatus({ t: passA, s, d: w.cps[0].dist, p: `0:${passA}` }, w, passA)
    const exp = passA + w.cps[0].stop + (w.cps[1].planned - w.cps[0].planned - w.cps[0].stop) * (1 + 0.7 * 0.2)
    expect(Math.abs(st1.etas[1] - exp)).toBeLessThan(10)
    // Relevé suivant plus loin, encore plus lent : les estimations reculent.
    const t2 = s + Math.round(plannedAtWatch(w, 8500) * 1.4)
    const st2 = watchStatus({ t: t2, s, d: 8500, p: `0:${passA}` }, w, t2)
    expect(st2.etas[0]).toBe(passA)
    expect(st2.etas[1]).toBeGreaterThan(st1.etas[1])
    // Passage en B en avance : nouvelles estimations pour l'arrivée.
    const passB = s + Math.round(w.cps[1].planned * 0.95)
    const st3 = watchStatus({ t: passB, s, d: w.cps[1].dist, p: `0:${passA},1:${passB}` }, w, passB)
    expect(st3.etas[2]).toBeLessThan(st1.etas[2])
    expect(st3.finishEta).toBeCloseTo(st3.etas[2], 0)
  })

  it('passage noté loin devant la position du coureur : ignoré', () => {
    const s = 1_800_000_000
    const cp = w.cps[1]
    const t = s + Math.round(plannedAtWatch(w, cp.dist - 1600))
    // Tour Lap à 1,6 km du point B, pris pour son passage par la montre.
    const st = watchStatus({ t, s, d: cp.dist - 1600, p: `0:${s + w.cps[0].planned},1:${t - 60}` }, w, t)
    expect(st.passed.has(0)).toBe(true)
    expect(st.passed.has(1)).toBe(false)
    expect(st.etas[1]).toBeGreaterThan(t)
    // À moins de 300 m devant : gardé (distance de la montre un peu en retard sur le point).
    const near = watchStatus({ t, s, d: cp.dist - 200, p: `1:${t - 60}` }, w, t)
    expect(near.passed.has(1)).toBe(true)
  })

  it('départ du ravito noté par la montre : lu, et base des estimations suivantes', () => {
    const s = 1_800_000_000
    const passA = s + w.cps[0].planned
    expect([...parseDepartures(`0:${passA}:${passA + 600},1:${passA + 900}`)]).toEqual([[0, passA + 600]])
    const st = watchStatus({ t: passA + 600, s, d: w.cps[0].dist, p: `0:${passA}:${passA + 600}` }, w, passA + 600)
    expect(st.departed.get(0)).toBe(passA + 600)
    // Parti 10 min après l'arrivée : la suite part de là (et non de l'arrivée + arrêt prévu).
    const ref = watchStatus({ t: passA + 600, s, d: w.cps[0].dist, p: `0:${passA}` }, w, passA + 600)
    expect(st.etas[1]).toBeGreaterThanOrEqual(ref.etas[1])
    expect(parsePasses(`0:${passA}:${passA + 600}`).get(0)).toBe(passA)
  })

  it('point pas encore passé : jamais estimé avant maintenant, la suite est décalée', () => {
    const s = 1_800_000_000
    const passA = s + w.cps[0].planned
    const st = watchStatus({ t: passA, s, d: w.cps[0].dist, p: `0:${passA}` }, w, passA)
    // Plus de relevé, et l'heure estimée de B est dépassée de 10 min.
    const now = st.etas[1] + 600
    const later = watchStatus({ t: passA, s, d: w.cps[0].dist, p: `0:${passA}` }, w, now)
    expect(later.etas[1]).toBeCloseTo(now, 0)
    expect(later.etas[2]).toBeCloseTo(st.etas[2] + 600, 0)
    expect(later.finishEta).toBeCloseTo(st.finishEta + 600, 0)
  })

  it('départ libre : départ de la montre tant que l’activité dure (relevé de moins de 12 h)', () => {
    const s = 1_800_000_000
    expect(watchStartMs({ t: s + 4 * 3600, s, d: 0 }, s + 9 * 3600)).toBe(s * 1000)
    expect(watchStartMs({ t: s + 600, s, d: 0 }, s + 13 * 3600)).toBeNull()
    expect(watchStartMs(null, s)).toBeNull()
  })
})
