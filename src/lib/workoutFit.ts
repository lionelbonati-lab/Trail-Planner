// Entraînement structuré au format FIT (type « workout »), à copier sur la montre
// dans GARMIN/NewFiles : il apparaît ensuite dans les entraînements.
import { FIT_EPOCH, FitWriter, type FieldDef } from './fit'
import { isRepeat, type SimpleStep, type Step } from './sessions'

const INTENSITY: Record<SimpleStep['kind'], number> = { active: 0, rest: 1, warmup: 2, cooldown: 3, recovery: 4 }
const DURATION_TIME = 0
const DURATION_OPEN = 5
const DURATION_REPEAT = 6
const TARGET_SPEED = 0
const TARGET_OPEN = 2
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

export function buildWorkoutFit(name: string, steps: Step[], now = Date.now()): Uint8Array {
  // Aplatit les répétitions : les étapes répétées puis une étape « répéter depuis l'étape i ».
  const flat: (number | string)[][] = []
  const push = (s: SimpleStep) => {
    const speed = s.speed
    flat.push([
      flat.length,
      s.name,
      s.seconds ? DURATION_TIME : DURATION_OPEN,
      s.seconds ? Math.round(s.seconds * 1000) : 0,
      speed ? TARGET_SPEED : TARGET_OPEN,
      0,
      speed ? Math.round(speed[0] * 1000) : 0,
      speed ? Math.round(speed[1] * 1000) : 0,
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
