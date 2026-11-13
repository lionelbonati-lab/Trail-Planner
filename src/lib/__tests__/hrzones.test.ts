import FitParser from 'fit-file-parser'
import { describe, expect, it } from 'vitest'
import { activityFromRaw, readActivity } from '../activity'
import { computeCs } from '../cs'
import { DEFAULT_ATHLETE, DEFAULT_ZONES, hrZonesFromMax, normalizeAthlete } from '../defaults'
import { FIT_EPOCH, FitWriter } from '../fit'
import { decodeFit } from '../fitDecode'
import type { RawPoint } from '../gpx'
import { analyzeSession } from '../insights'
import { describeSteps, SESSIONS_BY_KEY, zoneSpeed } from '../sessions'
import { buildWorkoutFit } from '../workoutFit'
import { colorForIndex, GARMIN_ZONE_COLORS, stepHrRange } from '../zones'

const A = normalizeAthlete({ ...DEFAULT_ATHLETE, cs: 4, dPrime: 200, hrMax: 190, hrZones: hrZonesFromMax(190) })

const parseFit = (fit: Uint8Array): Promise<any> =>
  new Promise((res, rej) => new FitParser({ mode: 'list' }).parse(fit.buffer as ArrayBuffer, (e: any, x: any) => (e ? rej(e) : res(x))))

describe('zones du bilan VC', () => {
  it('les 3 tests du bilan redonnent VC 4,04 m/s et D′ 210 m', () => {
    const r = computeCs([
      { time: 180, dist: 925 },
      { time: 420, dist: 1930 },
      { time: 720, dist: 3110 },
    ])!
    expect(r.cs).toBeCloseTo(4.0417, 3)
    expect(r.dPrime).toBeCloseTo(210, 0)
    expect(r.r2).toBeGreaterThan(0.999)
  })

  it('7 zones contiguës, avec utilisation et durée tenable', () => {
    expect(DEFAULT_ZONES).toHaveLength(7)
    for (let k = 1; k < DEFAULT_ZONES.length; k++) expect(DEFAULT_ZONES[k].low).toBe(DEFAULT_ZONES[k - 1].high)
    expect(DEFAULT_ZONES.map((z) => [z.low, z.high])[4]).toEqual([0.96, 1.05])
    expect(DEFAULT_ZONES.every((z) => z.use && z.sustain)).toBe(true)
  })

  it('les anciennes zones par défaut sont remplacées, les zones personnalisées gardées', () => {
    const old = [[0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 0.96], [0.96, 1.05]].map(([low, high], i) => ({ name: `Zone ${i + 1}`, low, high }))
    expect(normalizeAthlete({ zones: old }).zones).toHaveLength(7)
    const mine = [{ name: 'Facile', low: 0.6, high: 0.75 }]
    expect(normalizeAthlete({ zones: mine }).zones).toEqual(mine)
  })

  it('couleurs Garmin pour 7 zones, personnalisables', () => {
    expect(GARMIN_ZONE_COLORS).toHaveLength(7)
    expect(colorForIndex(6, A)).toBe(GARMIN_ZONE_COLORS[6])
    const custom = { ...A, zones: A.zones.map((z, i) => (i === 5 ? { ...z, color: '#123456' } : z)) }
    expect(colorForIndex(5, custom)).toBe('#123456')
  })

  it('zoneSpeed couvre les zones 6 et 7', () => {
    expect(zoneSpeed(A, 6)).toEqual([4 * 1.05, 4 * 1.15])
    expect(zoneSpeed(A, 7)[0]).toBeCloseTo(4 * 1.15)
  })
})

describe('zones cardiaques', () => {
  it('zones Garmin depuis la FC max', () => {
    expect(hrZonesFromMax(190).map((z) => [z.low, z.high])).toEqual([[95, 114], [114, 133], [133, 152], [152, 171], [171, 190]])
  })

  it('FC lue dans les extensions GPX et les records FIT', () => {
    const pt = (k: number, ext: string) =>
      `<trkpt lat="${45 + k * 0.001}" lon="6"><ele>400</ele><time>${new Date(Date.parse('2026-11-10T17:00:00Z') + k * 30000).toISOString()}</time>${ext}</trkpt>`
    const pts = Array.from({ length: 12 }, (_, k) =>
      pt(k, k === 0 ? '<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>132</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>'
        : k === 1 ? '<extensions><ns3:TrackPointExtension><ns3:hr>141</ns3:hr></ns3:TrackPointExtension></extensions>' : ''),
    )
    const act = readActivity('s.gpx', new TextEncoder().encode(`<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`))
    expect(Array.from(act.hr.slice(0, 2))).toEqual([132, 141])
    expect(Number.isNaN(act.hr[2])).toBe(true)

    const w = new FitWriter()
    const ts = Math.round(Date.parse('2026-11-10T17:00:00Z') / 1000) - FIT_EPOCH
    const fields = [
      { num: 253, type: 'uint32' as const },
      { num: 0, type: 'sint32' as const },
      { num: 1, type: 'sint32' as const },
      { num: 2, type: 'uint16' as const },
      { num: 3, type: 'uint8' as const },
    ]
    const semi = (deg: number) => Math.round((deg * 2 ** 31) / 180)
    w.message(20, fields, [ts, semi(45), semi(6), (400 + 500) * 5, 150])
    w.message(20, fields, [ts + 10, semi(45.0003), semi(6), (400 + 500) * 5, 0xff])
    const { records } = decodeFit(w.finish())
    expect(records[0].hr).toBe(150)
    expect(records[1].hr).toBeUndefined()
  })

  it('temps par zone cardiaque et FC moyenne des tours', () => {
    const raw: RawPoint[] = []
    let t = Date.parse('2026-11-10T17:00:00Z')
    const laps = []
    let x = 0
    raw.push({ lat: 45, lon: 6, ele: 400, time: t, hr: 120 })
    for (const [dur, v, hr] of [[600, 3, 120], [600, 4, 160]] as const) {
      laps.push({ start: t, elapsed: dur, timer: dur, distance: v * dur })
      for (let s = 0; s < dur; s += 2) {
        x += v * 2
        t += 2000
        raw.push({ lat: 45 + x / 111195, lon: 6, ele: 400, time: t, hr })
      }
    }
    const ins = analyzeSession(activityFromRaw('fc', raw, laps), A)
    const times = ins.hrZoneTimes!
    expect(times[1].seconds).toBeCloseTo(600, -1) // 120 bpm : zone 2
    expect(times[3].seconds).toBeCloseTo(600, -1) // 160 bpm : zone 4
    expect(ins.laps.map((l) => l.hr)).toEqual([120, 160])
  })

  it('sans FC enregistrée : pas de temps par zone cardiaque', () => {
    const raw: RawPoint[] = [0, 1, 2, 3].map((k) => ({ lat: 45 + (k * 10) / 111195, lon: 6, ele: 400, time: k * 4000 }))
    expect(analyzeSession(activityFromRaw('x', raw), A).hrZoneTimes).toBeNull()
  })

  it('plage FC des étapes : zone visée, à fond = libre, étape courte = libre', () => {
    expect(stepHrRange({ kind: 'active', name: 'Endurance', seconds: 3600, zones: [2, 2] }, A)).toEqual([114, 133])
    expect(stepHrRange({ kind: 'warmup', name: 'Échauffement', seconds: 1200, zones: [1, 2] }, A)).toEqual([95, 133])
    expect(stepHrRange({ kind: 'active', name: 'Z7', seconds: 300, zones: [7, 7] }, A)).toEqual([171, 190])
    expect(stepHrRange({ kind: 'active', name: 'À fond', seconds: 720, zones: 'max' }, A)).toBeNull()
    expect(stepHrRange({ kind: 'warmup', name: 'Accélération', seconds: 25, speed: zoneSpeed(A, 5) }, A)).toBeNull()
    // Sans zone : déduite de la vitesse (milieu de la zone 3).
    expect(stepHrRange({ kind: 'active', name: 'Tempo', seconds: 1200, speed: zoneSpeed(A, 3) }, A)).toEqual([133, 152])
  })

  it('entraînement FIT avec cible cardiaque (bpm + 100)', async () => {
    const fit = buildWorkoutFit('Endurance FC', [{ kind: 'active', name: 'Endurance', seconds: 3600, zones: [2, 2] }], Date.now(), { target: 'hr', athlete: A })
    const d = await parseFit(fit)
    expect(d.workout_step).toMatchObject({ wkt_step_name: 'Endurance', target_type: 'heart_rate', duration_type: 'time' })
    const step = d.workout_step
    const low = step.custom_target_heart_rate_low ?? step.custom_target_value_low
    const high = step.custom_target_heart_rate_high ?? step.custom_target_value_high
    expect([low, high]).toEqual([214, 233])
  })

  it('séances : cibles FC dans la description, test VC sans cible', () => {
    const hrA = { ...A, workoutTarget: 'hr' as const }
    const long = describeSteps(SESSIONS_BY_KEY.long.steps(hrA), hrA)
    expect(long.some((l) => l.includes('Endurance') && l.includes('114–133 bpm'))).toBe(true)
    const test = SESSIONS_BY_KEY.csTest.steps(hrA, SESSIONS_BY_KEY.csTest.variants![0])
    const desc = describeSteps(test, hrA)
    expect(desc.find((l) => l.includes('à fond'))).not.toMatch(/bpm/)
    // Allure par défaut.
    expect(describeSteps(SESSIONS_BY_KEY.long.steps(A), A).some((l) => l.includes('/km'))).toBe(true)
  })
})
