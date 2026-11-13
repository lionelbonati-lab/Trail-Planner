import { describe, expect, it } from 'vitest'
import { activityFromRaw } from '../activity'
import type { RawPoint } from '../gpx'
import { cardiacDrift } from '../insights'

/** Sortie à plat à vitesse constante, FC donnée par `hr(minute)`, un point toutes les 2 s. */
function steady(minutes: number, speed: number, hr: (min: number) => number) {
  const raw: RawPoint[] = []
  let t = Date.parse('2026-11-10T07:00:00Z')
  let x = 0
  for (let s = 0; s <= minutes * 60; s += 2) {
    raw.push({ lat: 45 + x / 111195, lon: 6, ele: 400, time: t, hr: hr(s / 60) })
    x += speed * 2
    t += 2000
  }
  return activityFromRaw('sortie longue', raw, [])
}

describe('durabilité : découplage cardiaque', () => {
  it('FC stable 1 h puis en hausse à allure égale : dérive vers 1 h, ampleur et vitesse', () => {
    // 3 m/s (10,8 km/h) ; 140 bpm jusqu'à 60 min, puis +7 bpm par heure.
    const d = cardiacDrift(steady(150, 3, (m) => 140 + Math.max(0, m - 60) * (7 / 60)))!
    expect(d).not.toBeNull()
    expect(d.baseline).toBeCloseTo(140 / 10.8, 1)
    expect(d.onsetH!).toBeGreaterThan(0.8)
    expect(d.onsetH!).toBeLessThan(1.25)
    expect(d.perHour).toBeCloseTo(0.05, 2)
    // 20 dernières minutes : ≈ 149,6 bpm pour 140 au départ.
    expect(d.decoupling).toBeGreaterThan(0.06)
    expect(d.decoupling).toBeLessThan(0.075)
  })

  it('FC stable : pas de dérive', () => {
    const d = cardiacDrift(steady(120, 3, (m) => 142 + Math.sin(m) * 1.5))!
    expect(Math.abs(d.decoupling)).toBeLessThan(0.01)
    expect(d.onsetH).toBeNull()
  })

  it('trop court ou sans FC : rien', () => {
    expect(cardiacDrift(steady(45, 3, () => 140))).toBeNull()
    expect(cardiacDrift(steady(120, 3, () => NaN))).toBeNull()
  })
})
