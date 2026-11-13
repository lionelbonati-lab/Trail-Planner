import FitParser from 'fit-file-parser'
import { describe, expect, it } from 'vitest'
import { activityFromRaw } from '../activity'
import { DEFAULT_ATHLETE, DEFAULT_ENV } from '../defaults'
import type { RawPoint } from '../gpx'
import { allOutIntensity, csFromTrials, describeSteps, SESSIONS_BY_KEY } from '../sessions'
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
    expect(f.workout.num_valid_steps).toBe(9) // échauffement de l’entraîneur (7) + effort + récupération
    expect(describeSteps(steps)[1]).toMatch(/^5 × \[ Montée tempo : 10 min/)
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
  it('test VC : trois séances séparées, distance lue dans le tour de la montre ou le GPS', () => {
    const v = (sec: number) => A.cs + A.dPrime / sec
    const def = SESSIONS_BY_KEY.csTest
    const [v3, v7, v12] = def.variants!
    // Séance 3′ : tour de la montre (distance « piste » exacte), GPS volontairement faux.
    const act3 = synth([[1500, 2.7, 0], [180, v(180) * 0.97, 0], [600, 2.5, 0]])
    const t0 = act3.start + 1500 * 1000
    act3.laps = [
      { start: act3.start, elapsed: 1500, timer: 1500, distance: 4000 },
      { start: t0, elapsed: 180.3, timer: 180.3, distance: v(180) * 180.3 },
      { start: t0 + 180300, elapsed: 600, timer: 600, distance: 1500 },
    ]
    const r3 = def.analyze(act3, A, v3)
    expect(r3.athlete.csTrials[0]).toMatchObject({ seconds: 180, source: 'lap' })
    expect(r3.athlete.csTrials[0].dist).toBeCloseTo(v(180) * 180, -1)
    expect(r3.metrics.cs).toBeUndefined()
    expect(r3.persist?.csTrials).toHaveLength(1)
    // Séance 7′ quelques jours plus tard (GPX, sans tours) : VC et D′ calculables.
    const a2 = { ...A, csTrials: r3.athlete.csTrials.map((t) => ({ ...t, date: '2026-09-25T08:00:00.000Z' })) }
    const r7 = def.analyze(synth([[1500, 2.7, 0], [420, v(420), 0], [600, 2.5, 0]]), a2, v7)
    expect(r7.athlete.csTrials).toHaveLength(2)
    expect(r7.athlete.csTrials[0].source).toBe('gps')
    expect(r7.metrics.cs!).toBeCloseTo(A.cs, 1)
    // Séance 12′ : trois tests, R² disponible.
    const r12 = def.analyze(synth([[1500, 2.7, 0], [720, v(720), 0], [600, 2.5, 0]]), { ...A, csTrials: r7.athlete.csTrials }, v12)
    expect(r12.metrics.cs!).toBeCloseTo(A.cs, 1)
    expect(r12.metrics.dPrime!).toBeGreaterThan(150)
    expect(r12.metrics.dPrime!).toBeLessThan(260)
    expect(r12.lines[1]).toMatch(/R² /)
  })

  it('tests VC : le plus récent de chaque durée, sur 6 semaines', () => {
    const t = (date: string, seconds: number, dist: number) => ({ id: date + seconds, date, seconds, dist, source: 'manual' as const })
    const fit = csFromTrials([
      t('2026-11-07T08:00:00Z', 720, 4 * 720 + 200),
      t('2026-10-28T08:00:00Z', 420, 4 * 420 + 200),
      t('2026-10-24T08:00:00Z', 180, 4 * 180 + 200),
      t('2026-10-01T08:00:00Z', 180, 9999), // plus ancien de la même durée : ignoré
      t('2026-08-01T08:00:00Z', 420, 1), // hors fenêtre
    ])!
    expect(fit.used.map((u) => u.seconds)).toEqual([180, 420, 720])
    expect(fit.cs).toBeCloseTo(4, 3)
    expect(fit.dPrime).toBeCloseTo(200, 0)
    expect(csFromTrials([t('2026-11-07T08:00:00Z', 720, 3000)])).toBeNull()
  })

  it('séance de test : échauffement de l’entraîneur, cibles en zones', () => {
    const steps = SESSIONS_BY_KEY.csTest.steps(A, SESSIONS_BY_KEY.csTest.variants![1])
    const d = describeSteps(steps)
    expect(d[0]).toMatch(/^Échauffement Z1 : 10 min/)
    expect(d[1]).toMatch(/^Échauffement Z2 : 10 min/)
    expect(d[2]).toMatch(/^Gammes Z1 : 5 min/)
    expect(d[3]).toMatch(/^3 × \[ Accélération Z5 : 25" .* Récupération Z1 : 35"/)
    expect(d[5]).toMatch(/^7' à fond : 7 min — Effort maximal 10\/10/)
    const z1 = (steps[0] as { speed: [number, number] }).speed
    expect(z1[0]).toBeCloseTo(A.cs * 0.6)
    expect(z1[1]).toBeCloseTo(A.cs * 0.7)
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
