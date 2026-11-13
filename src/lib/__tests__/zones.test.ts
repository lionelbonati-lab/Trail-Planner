import FitParser from 'fit-file-parser'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace } from '../defaults'
import { TRAINING_ZONES } from '../model'
import { computePlan } from '../plan'
import { buildWorkoutFit } from '../workoutFit'
import { zoneRuns, zoneSteps, zoneText } from '../zones'
import type { PaceZone } from '../types'

// 4 km de plat, 2 km à 10 %, 4 km de plat.
function gpx(): string {
  const pts: string[] = []
  let ele = 500
  for (let d = 0; d <= 10000; d += 10) {
    if (d > 4000 && d <= 6000) ele += 1
    pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${ele}</ele></trkpt>`)
  }
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}
const A = { ...DEFAULT_ATHLETE, cs: 4 }
const flatOnly = (r: ReturnType<typeof newRace>) => ({ ...r, env: { ...r.env, night: { ...r.env.night, enabled: false }, heat: { ...r.env.heat, enabled: false } } })

describe('zones d’allure', () => {
  const base = flatOnly(newRace('Z', gpx()))
  const t = (zones: PaceZone[]) => {
    const p = computePlan({ ...base, zones }, A)!
    const at = (d: number) => p.sim.points[Math.round(d / 20)].t
    return { p, seg: (a: number, b: number) => at(b) - at(a) }
  }

  it('intensité imposée sur le plat : allure = VC × intensité', () => {
    const { seg } = t([{ id: 'z', from: 0, to: 4000, kind: 'intensity', value: 0.88, label: 'Tempo' }])
    expect(seg(0, 4000)).toBeCloseTo(4000 / (4 * 0.88), -1)
  })
  it('allure plat équivalente : adaptée en montée', () => {
    const { seg } = t([{ id: 'z', from: 4000, to: 6000, kind: 'flatPace', value: 300, label: '' }])
    expect(seg(4000, 6000)).toBeGreaterThan(2000 / (1000 / 300) * 1.2)
  })
  it('allure imposée : exacte, même en montée', () => {
    const { seg } = t([{ id: 'z', from: 4000, to: 6000, kind: 'pace', value: 360, label: '' }])
    expect(seg(4000, 6000)).toBeCloseTo(720, -1)
  })
  it('la dernière zone définie l’emporte sur un chevauchement', () => {
    const { seg } = t([
      { id: 'a', from: 0, to: 4000, kind: 'intensity', value: 0.65, label: 'Récupération' },
      { id: 'b', from: 2000, to: 4000, kind: 'intensity', value: 1.0, label: 'VC' },
    ])
    expect(seg(2000, 4000)).toBeCloseTo(2000 / 4, -1)
    expect(seg(0, 2000)).toBeCloseTo(2000 / (4 * 0.65), -1)
  })
  it('entraînement par distance : portions, fourchettes et fichier FIT', async () => {
    const zones: PaceZone[] = [{ id: 'z', from: 1000, to: 3000, kind: 'intensity', value: TRAINING_ZONES[2].value, label: TRAINING_ZONES[2].label }]
    const { p } = t(zones)
    const runs = zoneRuns(p.track, p.sim, zones)
    expect(runs.map((r) => [Math.round(r.from), Math.round(r.to), r.zone?.label ?? null])).toEqual([[0, 1000, null], [1000, 3000, 'Tempo'], [3000, 10000, null]])
    const steps = zoneSteps(p.track, p.sim, zones, A)
    expect(steps[1].meters).toBeCloseTo(2000, 0)
    expect(steps[1].speed![0]).toBeCloseTo(4 * 0.88 * 0.95, 1)
    expect(zoneText(zones[0], A)).toBe("Tempo · 88 % VC (4'44/km sur le plat)")
    const fit = buildWorkoutFit('Sortie tempo', steps)
    const d: any = await new Promise((res, rej) => new FitParser({ mode: 'list' }).parse(fit.buffer as ArrayBuffer, (e: any, x: any) => (e ? rej(e) : res(x))))
    expect(d.workout.num_valid_steps).toBe(3)
    expect(d.workout_step).toMatchObject({ wkt_step_name: 'Libre', duration_type: 'distance', target_type: 'open' })
    expect(d.workout_step.duration_value / 100000).toBeCloseTo(7, 1) // centimètres
  })
})
