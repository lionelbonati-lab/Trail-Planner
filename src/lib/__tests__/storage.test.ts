import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gunzipBase64, gzipBase64 } from '../storage'

describe('compression GPX', () => {
  it('aller-retour sans perte (accents compris)', async () => {
    const text = '<gpx><name>Trail de Calabri – côte éàü</name>' + '<trkpt lat="47.1" lon="7.2"><ele>462</ele></trkpt>'.repeat(5000) + '</gpx>'
    const b64 = await gzipBase64(text)
    expect(b64.length).toBeLessThan(text.length / 10)
    expect(await gunzipBase64(b64)).toBe(text)
  })
  const real = (process.env.TP_GPX ?? '').split(',').filter((f) => f && existsSync(f))
  it.skipIf(!real.length)('GPX réels sous la limite Firestore', async () => {
    for (const f of real) {
      const t = readFileSync(f, 'utf8')
      const b64 = await gzipBase64(t)
      console.log(f.split('/').pop(), t.length, '→', b64.length)
      expect(await gunzipBase64(b64)).toBe(t)
    }
  })
})
