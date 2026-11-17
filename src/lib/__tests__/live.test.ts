import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace } from '../defaults'
import { awayFrom, inferredDeparture, liveStatus, locate, plannedAt } from '../live'
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

  it('« Reparti » du ravito : la suite part du départ réel, pas de l’arrivée + arrêt prévu', () => {
    const planA = plan.sim.splits[0].arrival
    const arrive = new Date(t0 + planA * 1000).toISOString()
    const base = liveStatus({ startedAt: new Date(t0).toISOString(), passages: { a: arrive } }, plan.sim, t0 + planA * 1000, () => null)
    // Reparti 10 min après l'arrivée (2 min prévues) : 8 min de plus sur la suite.
    const left = new Date(t0 + (planA + 600) * 1000).toISOString()
    const st = liveStatus({ startedAt: new Date(t0).toISOString(), passages: { a: arrive }, departures: { a: left } }, plan.sim, t0 + (planA + 600) * 1000, () => null)
    expect(st.rows[1].eta - base.rows[1].eta).toBeCloseTo(480, 0)
  })

  it('au ravito sans « Reparti » : un arrêt plus long que prévu décale la suite', () => {
    const planA = plan.sim.splits[0].arrival
    const live = { startedAt: new Date(t0).toISOString(), passages: { a: new Date(t0 + planA * 1000).toISOString() } }
    const inStop = liveStatus(live, plan.sim, t0 + (planA + 60) * 1000, () => null)
    // 2 min prévues, 12 min sur place : 10 min de plus sur la suite.
    const over = liveStatus(live, plan.sim, t0 + (planA + 720) * 1000, () => null)
    expect(over.rows[1].eta - inStop.rows[1].eta).toBeCloseTo(600, 0)
  })

  it('« Reparti » oublié : départ déduit de la position (chemin fait depuis, au rythme du coureur)', () => {
    const arr = t0 + 3600000
    const now = arr + 30 * 60000
    // 10 min de chemin prévu depuis le ravito, rythme 1,2 : parti 12 min avant maintenant.
    expect(inferredDeparture(arr, 600, 1.2, now)).toBe(now - 720000)
    // Jamais avant l'arrivée ni après maintenant.
    expect(inferredDeparture(arr, 7200, 1, now)).toBe(arr)
    expect(inferredDeparture(arr, -50, 1, now)).toBe(now)
    expect(awayFrom('base')).toBe(300)
    expect(awayFrom('ravito')).toBe(150)
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

import { bagText, nutritionPlan } from '../nutrition'
import { DEFAULT_PRODUCTS } from '../defaults'
describe('nutrition', () => {
  it('tronçons départ → ravitos → arrivée, quantités proportionnelles à la durée', () => {
    const race = newRace('N', gpx())
    race.checkpoints = [{ id: 'a', dist: 10000, name: 'A', kind: 'ravito', stopMin: 5, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const legs = nutritionPlan(race, plan.sim, DEFAULT_PRODUCTS)
    expect(legs.map((l) => `${l.from}>${l.to}`)).toEqual(['Départ>A', 'A>Arrivée'])
    const h = legs[0].duration / 3600
    expect(legs[0].carbs).toBe(Math.round(h * race.carbsPerH))
    expect(legs[0].sodium).toBe(Math.round(h * race.sodiumPerH))
    const carried = legs[0].products.reduce((a, x) => a + x.count * x.product.carbs, 0)
    expect(carried).toBeGreaterThanOrEqual(legs[0].carbs - 10)
    expect(legs[1].duration).toBeCloseTo(plan.sim.totalTime - plan.sim.splits[0].departure, 0)
    // 500 ml ou moins : une seule flasque, d'isotonique.
    expect(legs[0].water).toBeLessThanOrEqual(0.5)
    expect(bagText(legs[0])).toMatch(/^[\d.]+ L : 1 flasque Isotonique, \d+ × Gel/)
  })
})

import { pastClockToMs } from '../time'
describe('heure saisie en mode course', () => {
  // 14 nov. 2026, 10:12 à Paris (UTC+1).
  const now = Date.parse('2026-11-14T09:12:00Z')
  it('heure du jour, fuseau de la course', () => {
    expect(new Date(pastClockToMs('9:30', 'Europe/Paris', now)!).toISOString()).toBe('2026-11-14T08:30:00.000Z')
    expect(new Date(pastClockToMs('10h05', 'Europe/Paris', now)!).toISOString()).toBe('2026-11-14T09:05:00.000Z')
  })
  it('plus d’une heure dans le futur : la veille ; format invalide : null', () => {
    expect(new Date(pastClockToMs('23:50', 'Europe/Paris', now)!).toISOString()).toBe('2026-11-13T22:50:00.000Z')
    expect(pastClockToMs('25:00', 'Europe/Paris', now)).toBeNull()
    expect(pastClockToMs('dix heures', 'Europe/Paris', now)).toBeNull()
  })
})
