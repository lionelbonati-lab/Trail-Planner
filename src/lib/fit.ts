// Encodeur FIT minimal pour un parcours Garmin (« course ») :
// file_id, course, lap, event, records (trace horodatée selon le plan) et
// course_points (ravitos, sommets…), importable dans Garmin Connect puis
// utilisable pour créer une stratégie PacePro.
import { indexAt } from './gpx'
import { zonedToUtc } from './time'
import type { CheckpointKind, Race, SimResult, Track } from './types'

const FIT_EPOCH = 631065600 // 1989-12-31T00:00:00Z en secondes Unix

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01,
  0x8801, 0x4400,
]

export function fitCrc(bytes: Uint8Array, crc = 0): number {
  for (const b of bytes) {
    let tmp = CRC_TABLE[crc & 0xf]
    crc = (crc >> 4) & 0x0fff
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf]
    tmp = CRC_TABLE[crc & 0xf]
    crc = (crc >> 4) & 0x0fff
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf]
  }
  return crc
}

type BaseType = 'enum' | 'uint8' | 'uint16' | 'sint32' | 'uint32' | 'uint32z' | 'string'

const BASE: Record<BaseType, { id: number; size: number }> = {
  enum: { id: 0x00, size: 1 },
  uint8: { id: 0x02, size: 1 },
  uint16: { id: 0x84, size: 2 },
  sint32: { id: 0x85, size: 4 },
  uint32: { id: 0x86, size: 4 },
  uint32z: { id: 0x8c, size: 4 },
  string: { id: 0x07, size: 0 },
}

interface FieldDef {
  num: number
  type: BaseType
  /** Taille en octets (chaînes uniquement). */
  size?: number
}

class FitWriter {
  private chunks: number[] = []
  private local = 0
  private defs = new Map<string, number>()

  private u8(v: number) {
    this.chunks.push(v & 0xff)
  }

  private write(type: BaseType, v: number | string, size: number) {
    const b = this.chunks
    switch (type) {
      case 'enum':
      case 'uint8':
        b.push(Number(v) & 0xff)
        break
      case 'uint16':
        b.push(Number(v) & 0xff, (Number(v) >> 8) & 0xff)
        break
      case 'sint32':
      case 'uint32':
      case 'uint32z': {
        const n = Number(v) >>> 0
        b.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff)
        break
      }
      case 'string': {
        const enc = new TextEncoder().encode(String(v))
        // Coupe proprement sans casser un caractère UTF-8, garde le zéro final.
        let len = Math.min(enc.length, size - 1)
        while (len > 0 && (enc[len] & 0xc0) === 0x80) len--
        for (let i = 0; i < size; i++) b.push(i < len ? enc[i] : 0)
        break
      }
    }
  }

  /** Écrit un message ; la définition est émise la première fois pour cette forme. */
  message(global: number, fields: FieldDef[], values: (number | string)[]) {
    const key = `${global}:${fields.map((f) => `${f.num}/${f.type}/${f.size ?? 0}`).join(',')}`
    let local = this.defs.get(key)
    if (local === undefined) {
      local = this.local++ % 16
      // Une définition réutilisant un numéro local remplace l'ancienne.
      for (const [k, v] of this.defs) if (v === local) this.defs.delete(k)
      this.defs.set(key, local)
      this.u8(0x40 | local)
      this.u8(0) // réservé
      this.u8(0) // little endian
      this.u8(global & 0xff)
      this.u8(global >> 8)
      this.u8(fields.length)
      for (const f of fields) {
        this.u8(f.num)
        this.u8(f.type === 'string' ? (f.size ?? 16) : BASE[f.type].size)
        this.u8(BASE[f.type].id)
      }
    }
    this.u8(local)
    fields.forEach((f, i) => this.write(f.type, values[i], f.size ?? 16))
  }

  finish(): Uint8Array {
    const data = new Uint8Array(this.chunks)
    const header = new Uint8Array(14)
    const dv = new DataView(header.buffer)
    header[0] = 14
    header[1] = 0x20 // protocole 2.0
    dv.setUint16(2, 2132, true) // version du profil
    dv.setUint32(4, data.length, true)
    header.set([0x2e, 0x46, 0x49, 0x54], 8) // ".FIT"
    dv.setUint16(12, fitCrc(header.subarray(0, 12)), true)
    const out = new Uint8Array(14 + data.length + 2)
    out.set(header, 0)
    out.set(data, 14)
    const crc = fitCrc(data, fitCrc(header))
    out[out.length - 2] = crc & 0xff
    out[out.length - 1] = crc >> 8
    return out
  }
}

const semi = (deg: number) => Math.round((deg * 2 ** 31) / 180)
const altFit = (m: number) => Math.max(0, Math.min(0xfffe, Math.round((m + 500) * 5)))

/** Type de point de parcours Garmin (énumération course_point du profil FIT). */
export function coursePointType(kind: CheckpointKind, name: string): number {
  if (kind === 'ravito') return 28 // aid_station
  if (kind === 'cutoff') return 35 // checkpoint
  if (/^sommet/i.test(name)) return 1 // summit
  if (/^point bas/i.test(name)) return 2 // valley
  return 0 // generic
}

export function buildCourseFit(race: Race, track: Track, sim: SimResult): Uint8Array {
  const startUnix = zonedToUtc(race.env.start, race.env.timeZone).getTime() / 1000
  const base = Number.isFinite(startUnix) ? startUnix : Date.now() / 1000
  const ts = (t: number) => Math.round(base + t) - FIT_EPOCH
  const pts = track.points
  const first = pts[0]
  const last = pts[pts.length - 1]
  const w = new FitWriter()

  // file_id : type 6 = course, fabricant 255 = développement.
  w.message(
    0,
    [
      { num: 0, type: 'enum' },
      { num: 1, type: 'uint16' },
      { num: 2, type: 'uint16' },
      { num: 3, type: 'uint32z' },
      { num: 4, type: 'uint32' },
    ],
    [6, 255, 0, 1, ts(0)],
  )
  // course : sport 1 = course à pied.
  w.message(
    31,
    [
      { num: 4, type: 'enum' },
      { num: 5, type: 'string', size: 32 },
    ],
    [1, race.name],
  )
  // lap : résumé du parcours.
  w.message(
    19,
    [
      { num: 253, type: 'uint32' },
      { num: 2, type: 'uint32' },
      { num: 3, type: 'sint32' },
      { num: 4, type: 'sint32' },
      { num: 5, type: 'sint32' },
      { num: 6, type: 'sint32' },
      { num: 7, type: 'uint32' },
      { num: 8, type: 'uint32' },
      { num: 9, type: 'uint32' },
      { num: 21, type: 'uint16' },
      { num: 22, type: 'uint16' },
    ],
    [
      ts(0),
      ts(0),
      semi(first.lat),
      semi(first.lon),
      semi(last.lat),
      semi(last.lon),
      Math.round(sim.totalTime * 1000),
      Math.round(sim.totalTime * 1000),
      Math.round(track.totalDist * 100),
      Math.round(track.dPlus),
      Math.round(track.dMinus),
    ],
  )
  const eventFields: FieldDef[] = [
    { num: 253, type: 'uint32' },
    { num: 0, type: 'enum' },
    { num: 1, type: 'enum' },
    { num: 4, type: 'uint8' },
  ]
  w.message(21, eventFields, [ts(0), 0, 0, 0]) // timer start

  const recFields: FieldDef[] = [
    { num: 253, type: 'uint32' },
    { num: 0, type: 'sint32' },
    { num: 1, type: 'sint32' },
    { num: 2, type: 'uint16' },
    { num: 5, type: 'uint32' },
  ]
  pts.forEach((p, i) => {
    w.message(20, recFields, [ts(sim.points[i]?.t ?? 0), semi(p.lat), semi(p.lon), altFit(p.ele), Math.round(p.dist * 100)])
  })

  const cpFields: FieldDef[] = [
    { num: 254, type: 'uint16' },
    { num: 1, type: 'uint32' },
    { num: 2, type: 'sint32' },
    { num: 3, type: 'sint32' },
    { num: 4, type: 'uint32' },
    { num: 5, type: 'enum' },
    { num: 6, type: 'string', size: 16 },
  ]
  sim.splits.forEach((s, i) => {
    const p = pts[indexAt(pts, s.to)]
    w.message(32, cpFields, [
      i,
      ts(s.arrival),
      semi(p.lat),
      semi(p.lon),
      Math.round(s.to * 100),
      coursePointType(s.cp.kind, s.cp.name),
      s.cp.name,
    ])
  })

  w.message(21, eventFields, [ts(sim.totalTime), 0, 4, 0]) // timer stop_all
  return w.finish()
}
