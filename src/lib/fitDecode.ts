// Décodeur FIT minimal : extrait les points d'enregistrement (record) d'une
// activité de montre — position, altitude, heure. Gère les définitions locales,
// les champs développeur et les en-têtes à horodatage compressé.
import type { RawPoint } from './gpx'

const FIT_EPOCH_MS = 631065600 * 1000
const SEMI = 180 / 2 ** 31

interface Def {
  global: number
  little: boolean
  fields: { num: number; size: number; base: number }[]
  devSize: number
  size: number
}

export function isFit(bytes: Uint8Array): boolean {
  return bytes.length > 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54
}

export function decodeFitRecords(bytes: Uint8Array): RawPoint[] {
  if (!isFit(bytes)) throw new Error("Ce fichier n'est pas un fichier FIT.")
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerSize = bytes[0]
  const end = Math.min(bytes.length, headerSize + dv.getUint32(4, true))
  const defs = new Map<number, Def>()
  const out: RawPoint[] = []
  let pos = headerSize
  let lastTs = 0

  const read = (off: number, size: number, base: number, little: boolean): number | null => {
    const t = base & 0x1f
    switch (t) {
      case 0x00: // enum
      case 0x02: // uint8
      case 0x0a: // uint8z
      case 0x0d: // byte
        return size >= 1 ? dv.getUint8(off) : null
      case 0x01:
        return dv.getInt8(off)
      case 0x03: // sint16
        return size >= 2 ? dv.getInt16(off, little) : null
      case 0x04: // uint16
      case 0x0b: // uint16z
        return size >= 2 ? dv.getUint16(off, little) : null
      case 0x05: // sint32
        return size >= 4 ? dv.getInt32(off, little) : null
      case 0x06: // uint32
      case 0x0c: // uint32z
        return size >= 4 ? dv.getUint32(off, little) : null
      default:
        return null
    }
  }

  while (pos < end) {
    const h = bytes[pos++]
    if (h & 0x80) {
      // En-tête à horodatage compressé.
      const local = (h >> 5) & 0x03
      const offset = h & 0x1f
      const def = defs.get(local)
      if (!def) throw new Error('FIT invalide (définition manquante).')
      let ts = (lastTs & ~0x1f) + offset
      if (offset < (lastTs & 0x1f)) ts += 0x20
      lastTs = ts
      if (def.global === 20) handleRecord(pos, def, ts)
      pos += def.size
      continue
    }
    const local = h & 0x0f
    if (h & 0x40) {
      const little = bytes[pos + 1] === 0
      const global = little ? dv.getUint16(pos + 2, true) : dv.getUint16(pos + 2, false)
      const n = bytes[pos + 4]
      pos += 5
      const fields: Def['fields'] = []
      for (let i = 0; i < n; i++) {
        fields.push({ num: bytes[pos], size: bytes[pos + 1], base: bytes[pos + 2] })
        pos += 3
      }
      let devSize = 0
      if (h & 0x20) {
        const nd = bytes[pos++]
        for (let i = 0; i < nd; i++) {
          devSize += bytes[pos + 1]
          pos += 3
        }
      }
      const size = fields.reduce((a, f) => a + f.size, 0) + devSize
      defs.set(local, { global, little, fields, devSize, size })
      continue
    }
    const def = defs.get(local)
    if (!def) throw new Error('FIT invalide (définition manquante).')
    if (def.global === 20) handleRecord(pos, def, null)
    else {
      // Suit l'horodatage pour les en-têtes compressés.
      let off = pos
      for (const f of def.fields) {
        if (f.num === 253) {
          const v = read(off, f.size, f.base, def.little)
          if (v !== null && v !== 0xffffffff) lastTs = v
        }
        off += f.size
      }
    }
    pos += def.size
  }
  return out

  function handleRecord(start: number, def: Def, compressedTs: number | null) {
    let off = start
    let ts = compressedTs
    let lat: number | null = null
    let lon: number | null = null
    let alt: number | null = null
    let enh: number | null = null
    for (const f of def.fields) {
      const v = read(off, f.size, f.base, def.little)
      if (v !== null) {
        if (f.num === 253 && v !== 0xffffffff) ts = v
        else if (f.num === 0 && v !== 0x7fffffff) lat = v * SEMI
        else if (f.num === 1 && v !== 0x7fffffff) lon = v * SEMI
        else if (f.num === 2 && v !== 0xffff) alt = v / 5 - 500
        else if (f.num === 78 && v !== 0xffffffff) enh = v / 5 - 500
      }
      off += f.size
    }
    if (ts !== null) lastTs = ts
    if (lat === null || lon === null) return
    out.push({
      lat,
      lon,
      ele: enh ?? alt,
      ...(ts !== null ? { time: FIT_EPOCH_MS + ts * 1000 } : {}),
    })
  }
}
