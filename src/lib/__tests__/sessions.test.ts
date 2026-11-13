import FitParser from 'fit-file-parser'
import { describe, expect, it } from 'vitest'
import { activityFromRaw } from '../activity'
import { DEFAULT_ATHLETE, DEFAULT_ENV } from '../defaults'
import type { RawPoint } from '../gpx'
import { allOutIntensity, describeSteps, SESSIONS_BY_KEY } from '../sessions'
import { buildWorkoutFit } from '../workoutFit'

const A = { ...DEFAULT_ATHLETE, cs: 4, dPrime: 200 }
const techF = (g: number) => DEFAULT_ENV.tech.factors[(Math.abs(g) > 25 && g < 0 ? 4 : Math.abs(g) > 18 && g < 0 ? 3 : Math.abs(g) > 10 && g < 0 ? 2 : g > 40 ? 4 : g > 30 ? 3 : 1) - 1]

/** Activité synthétique : segments [durée s, vitesse horizontale m/s, pente %], aller-retour sur une ligne. */
function synth(segments: [number, number, number][]): ReturnType<typeof activityFromRaw> {
  const raw: RawPoint[] = []
  let t = Date.parse('2026-10-01T08:00:00Z')
  let x = 0
  let ele = 1000
  let dir = 1
  raw.push({ lat: 45, lon: 6, ele, time: t })
  for (const [dur, v, g] of segments) {
    if (g !== 0) dir = g > 0 ? 1 : -1 // monte vers le nord, redescend vers le sud
    for (let s = 0; s < dur; s += 2) {
      x += dir * v * 2
      ele += (v * 2 * g) / 100
      t += 2000
      raw.push({ lat: 45 + x / 111195, lon: 6, ele, time: t })
    }
  }
  return activityFromRaw('synth', raw)
}

describe('entraînement FIT', () => {
  it('relu par un décodeur indépendant (étapes, cibles, répétition)', async () => {
    const steps = SESSIONS_BY_KEY.hillTempo.steps(A)
    const fit = buildWorkoutFit('Navettes tempo', steps)
    const d: any = await new Promise((res, rej) => new FitParser({ mode: 'list' }).parse(fit.buffer as ArrayBuffer, (e: any, x: any) => (e ? rej(e) : res(x))))
    // Le décodeur ne conserve que la dernière étape lue.
    expect(d.workout).toMatchObject({ wkt_name: 'Navettes tempo', sport: 'running', sub_sport: 'trail', num_valid_steps: 5 })
    expect(d.workout_step).toMatchObject({ wkt_step_name: 'Retour au calme', duration_type: 'time', duration_value: 600000, intensity: 'cooldown', target_type: 'open' })
    const flat = buildWorkoutFit('Seuil', SESSIONS_BY_KEY.flatTest.steps(A))
    const f: any = await new Promise((res, rej) => new FitParser({ mode: 'list' }).parse(flat.buffer as ArrayBuffer, (e: any, x: any) => (e ? rej(e) : res(x))))
    expect(f.workout.num_valid_steps).toBe(3)
    expect(describeSteps(steps)[1]).toMatch(/^5 × \[ Montée tempo : 10 min/)
    expect(describeSteps(SESSIONS_BY_KEY.cs3712.steps(A))[1]).toBe('3 min à fond : 3 min')
    expect(describeSteps(SESSIONS_BY_KEY.long.steps(A))[1]).toMatch(/^Endurance : 2h30 — /)
  })
})

describe('analyses de séances', () => {
  it('seuil plat : retrouve la VC', () => {
    const v20 = A.cs + A.dPrime / 1200
    const act = synth([[1200, 2.8, 0], [1200, v20, 0], [900, 2.6, 0]])
    const r = SESSIONS_BY_KEY.flatTest.analyze(act, { ...A, cs: 3.5 })
    expect(r.metrics.cs!).toBeCloseTo(A.cs, 1)
  })
  it('test 3/7/12 : retrouve VC et D′', () => {
    const v = (s: number) => A.cs + A.dPrime / s
    const act = synth([[600, 2.8, 0], [180, v(180), 0], [1200, 2.2, 0], [420, v(420), 0], [1200, 2.2, 0], [720, v(720), 0], [600, 2.5, 0]])
    const r = SESSIONS_BY_KEY.cs3712.analyze(act, A)
    expect(r.metrics.cs!).toBeCloseTo(A.cs, 1)
    expect(r.metrics.dPrime!).toBeGreaterThan(150)
    expect(r.metrics.dPrime!).toBeLessThan(260)
  })
  it('seuil en côte : retrouve la VAM à intensité VC', () => {
    const vamCs = 1000
    const vam20 = vamCs * allOutIntensity(A, 1200)
    const g = 18
    const act = synth([[1200, 2.6, 0], [1300, vam20 / 3600 / (g / 100), g], [600, 2.5, -8]])
    const r = SESSIONS_BY_KEY.hillTest.analyze(act, A)
    expect(Math.abs(r.metrics.vam!.vam - vamCs)).toBeLessThan(60)
    expect(Math.abs(r.metrics.vam!.grade - g)).toBeLessThan(1.5)
  })
  it('navettes tempo : retrouve la VAM à intensité VC', () => {
    const vamCs = 1000
    const g = 15
    const up = (vamCs * 0.88) / 3600 / (g / 100)
    const segs: [number, number, number][] = [[1200, 2.6, 0]]
    for (let i = 0; i < 5; i++) segs.push([600, up, g], [300, 2 * up, -g])
    const r = SESSIONS_BY_KEY.hillTempo.analyze(synth(segs), A)
    expect(Math.abs(r.metrics.vam!.vam - vamCs)).toBeLessThan(60)
    expect(r.lines[0]).toMatch(/^5 montées/)
  })
  it('descentes : retrouve le coefficient', () => {
    const g = -15
    const factor = 1.1
    const down = A.cs * 0.9 * factor * techF(g)
    const segs: [number, number, number][] = [[1200, 2.6, 0]]
    for (let i = 0; i < 4; i++) segs.push([300, down, g], [600, (down * 0.9 * 300) / 600 / 0.9, -g])
    const r = SESSIONS_BY_KEY.descents.analyze(synth(segs), A)
    expect(r.metrics.descent!.factor).toBeCloseTo(factor, 1)
  })
})
