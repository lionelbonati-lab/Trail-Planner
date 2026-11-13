// Entraînement structuré au format FIT (type « workout »), à copier sur la montre
// dans GARMIN/NewFiles : il apparaît ensuite dans les entraînements.
import { FIT_EPOCH, FitWriter, type FieldDef } from './fit'
import { isRepeat, type SimpleStep, type Step } from './sessions'
import type { Athlete } from './types'
import { stepHrRange } from './zones'

const INTENSITY: Record<SimpleStep['kind'], number> = { active: 0, rest: 1, warmup: 2, cooldown: 3, recovery: 4 }
const DURATION_TIME = 0
const DURATION_DISTANCE = 1
const DURATION_OPEN = 5
const DURATION_REPEAT = 6
const TARGET_SPEED = 0
const TARGET_HR = 1
const TARGET_OPEN = 2
/** FC personnalisée : au-delà de 100, la valeur est en bpm + 100 (en dessous, % de FC max). */
const HR_OFFSET = 100
const INVALID_ENUM = 0xff

const STEP_FIELDS: FieldDef[] = [
  { num: 254, type: 'uint16' }, // message_index
  { num: 0, type: 'string', size: 32 }, // wkt_step_name
  { num: 1, type: 'enum' }, // duration_type
  { num: 2, type: 'uint32' }, // duration_value
  { num: 3, type: 'enum' }, // target_type
  { num: 4, type: 'uint32' }, // target_value
  { num: 5, type: 'uint32' }, // custom_target_value_low
  { num: 6, type: 'uint32' }, // custom_target_value_high
  { num: 7, type: 'enum' }, // intensity
  { num: 8, type: 'string', size: 64 }, // notes
]

/**
 * Cible des étapes : allure (fourchette de vitesse) ou fréquence cardiaque (zones cardiaques
 * de l'athlète, voir stepHrRange).
 */
export interface WorkoutTarget {
  target: 'pace' | 'hr'
  athlete: Athlete
}

export function buildWorkoutFit(name: string, steps: Step[], now = Date.now(), opts?: WorkoutTarget): Uint8Array {
  // Aplatit les répétitions : les étapes répétées puis une étape « répéter depuis l'étape i ».
  const flat: (number | string)[][] = []
  const push = (s: SimpleStep) => {
    const hr = opts?.target === 'hr' ? stepHrRange(s, opts.athlete) : null
    const speed = opts?.target === 'hr' ? null : s.speed
    const [type, low, high] = hr
      ? [TARGET_HR, hr[0] + HR_OFFSET, hr[1] + HR_OFFSET]
      : speed
        ? [TARGET_SPEED, Math.round(speed[0] * 1000), Math.round(speed[1] * 1000)]
        : [TARGET_OPEN, 0, 0]
    flat.push([
      flat.length,
      s.name,
      s.meters ? DURATION_DISTANCE : s.seconds ? DURATION_TIME : DURATION_OPEN,
      s.meters ? Math.round(s.meters * 100) : s.seconds ? Math.round(s.seconds * 1000) : 0,
      type,
      0,
      low,
      high,
      INTENSITY[s.kind],
      s.notes ?? '',
    ])
  }
  for (const s of steps) {
    if (isRepeat(s)) {
      const first = flat.length
      s.steps.forEach(push)
      flat.push([flat.length, '', DURATION_REPEAT, first, INVALID_ENUM, s.repeat, 0, 0, INVALID_ENUM, ''])
    } else push(s)
  }

  const w = new FitWriter()
  const ts = Math.round(now / 1000) - FIT_EPOCH
  // file_id : type 5 = entraînement.
  w.message(
    0,
    [
      { num: 0, type: 'enum' },
      { num: 1, type: 'uint16' },
      { num: 2, type: 'uint16' },
      { num: 3, type: 'uint32z' },
      { num: 4, type: 'uint32' },
    ],
    [5, 255, 0, 1, ts],
  )
  // workout : sport 1 = course, sous-sport 3 = trail.
  w.message(
    26,
    [
      { num: 4, type: 'enum' },
      { num: 11, type: 'enum' },
      { num: 6, type: 'uint16' },
      { num: 8, type: 'string', size: 32 },
    ],
    [1, 3, flat.length, name],
  )
  for (const values of flat) w.message(27, STEP_FIELDS, values)
  return w.finish()
}
