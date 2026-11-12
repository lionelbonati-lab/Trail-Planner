import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { DEFAULT_ATHLETE, DEFAULT_ENV, DEFAULT_KME } from '../defaults'
import { parseGpx } from '../gpx'
import { simulate } from '../model'
import { peaksAndValleys } from '../splits'
import { formatDuration } from '../time'

// Vérification manuelle sur des GPX réels (fournis via TP_GPX=chemin1,chemin2).
const files = (process.env.TP_GPX ?? '').split(',').filter((f) => f && existsSync(f))

describe.skipIf(files.length === 0)('GPX réels', () => {
  for (const f of files) {
    it(f, () => {
      const t0 = performance.now()
      const track = parseGpx(readFileSync(f, 'utf8'))
      const parse = performance.now() - t0
      const base = { kme: DEFAULT_KME, env: { ...DEFAULT_ENV, start: '2026-08-28T18:00' }, checkpoints: [], techOverrides: [] }
      const res = (['physio', 'gap', 'kme'] as const).map((mode) => {
        const t1 = performance.now()
        const r = simulate(track, DEFAULT_ATHLETE, { ...base, mode })
        return `${mode}=${formatDuration(r.totalTime)} (${(performance.now() - t1).toFixed(0)} ms)`
      })
      const r = simulate(track, DEFAULT_ATHLETE, { ...base, mode: 'physio' })
      console.log(
        track.name,
        `\n  ${(track.totalDist / 1000).toFixed(1)} km, D+ ${track.dPlus.toFixed(0)}, D- ${track.dMinus.toFixed(0)}, ${track.points.length} pts, parse ${parse.toFixed(0)} ms`,
        `\n  ${res.join(' | ')}  km-e ${r.totalKme.toFixed(1)}`,
        `\n  nuit ${(r.points.filter((p) => p.night).length / r.points.length * 100).toFixed(0)} % ; alt max ${Math.max(...track.points.map((p) => p.ele)).toFixed(0)}`,
        `\n  sommets(150m): ${peaksAndValleys(track, 150).length}`,
      )
    })
  }
})
