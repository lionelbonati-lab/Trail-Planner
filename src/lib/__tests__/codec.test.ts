import { describe, expect, it } from 'vitest'
import { activityFromRaw, analyzeActivity } from '../activity'
import { DEFAULT_ATHLETE, DEFAULT_ENV, newRace, normalizeAthlete } from '../defaults'
import { decodeFromFirestore, encodeForFirestore, hasNestedArray } from '../firestoreCodec'
import type { RawPoint } from '../gpx'
import { computePlan, scenarioWindows } from '../plan'
import { buildSnapshot } from '../share'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}
const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

describe('encodage Firestore', () => {
  it('tableaux imbriqués et undefined', () => {
    const v = { a: [[1, 2], [3, [4, 5]]], b: undefined, c: [{ d: [[6]] }], e: [1, 2] }
    const enc = encodeForFirestore(v)
    expect(hasNestedArray(v)).toBe(true)
    expect(hasNestedArray(enc)).toBe(false)
    expect(JSON.stringify(enc)).not.toContain('undefined')
    expect(decodeFromFirestore(enc)).toEqual({ a: [[1, 2], [3, [4, 5]]], c: [{ d: [[6]] }], e: [1, 2] })
  })

  it('profil avec activité analysée, course avec météo et suivi, instantané de partage', () => {
    const race = newRace('Codec', gpx())
    race.checkpoints = [{ id: 'a', dist: 5000, name: 'A', kind: 'ravito', stopMin: 2, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
    race.weather = { fetchedAt: 'x', start: '2026-06-06T00:00:00Z', points: [{ dist: 0, elevation: 500, temp: [10, 11], precip: [0, 0], wind: [5, 5] }] }
    race.live = { startedAt: '2026-06-06T04:00:00Z', passages: { a: '2026-06-06T04:30:00Z' } }
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const t0 = Date.parse('2026-06-06T04:00:00Z')
    const raw: RawPoint[] = plan.track.points.map((p, i) => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: t0 + plan.sim.points[i].t * 1000 }))
    const an = analyzeActivity(activityFromRaw('act', raw), DEFAULT_ATHLETE, DEFAULT_ENV)
    const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, activities: [an.record] })
    const snap = buildSnapshot('uid', race, athlete, plan.track, plan.sim, scenarioWindows(plan.track, athlete, plan.opts))

    for (const doc of [{ athlete }, race, snap]) {
      const enc = encodeForFirestore(doc)
      expect(hasNestedArray(enc)).toBe(false)
      expect(decodeFromFirestore(enc)).toEqual(json(doc))
    }
    expect(hasNestedArray(athlete)).toBe(true) // c'est bien ce qui faisait échouer la sauvegarde
    expect(hasNestedArray(snap)).toBe(true) // et le partage
  })

  it('course sur la montre : suivi en direct attendu sur le code long et le code court', () => {
    const race = newRace('Montre', gpx())
    const plan = computePlan(race, DEFAULT_ATHLETE)!
    const onWatch = normalizeAthlete({ ...DEFAULT_ATHLETE, watchId: 'a'.repeat(32), epCode: '48203917', watchRaceId: race.id })
    const snap = buildSnapshot('uid', race, onWatch, plan.track, plan.sim, scenarioWindows(plan.track, onWatch, plan.opts))
    expect(snap.liveRef).toBe('a'.repeat(32))
    expect(snap.liveRefShort).toBe('48203917')
    const other = buildSnapshot('uid', race, { ...onWatch, watchRaceId: 'autre' }, plan.track, plan.sim, scenarioWindows(plan.track, onWatch, plan.opts))
    expect(other.liveRef).toBeNull()
    expect(other.liveRefShort).toBeNull()
  })
})

import { initializeApp } from 'firebase/app'
import { doc, getFirestore, writeBatch } from 'firebase/firestore'
describe('validation du SDK Firestore (sans réseau)', () => {
  it('refuse les données brutes, accepte les données encodées', () => {
    const db = getFirestore(initializeApp({ apiKey: 'test', projectId: 'demo-test', appId: 'x' }, 'codec-test'))
    const activities = [{ id: 'a', intensity: [[0.5, 0.9], [1, 0.85]] }]
    const profile = [[0, 500], [20, 510]]
    expect(() => writeBatch(db).set(doc(db, 'users/u'), { athlete: { activities } })).toThrow(/Nested arrays/)
    expect(() => writeBatch(db).set(doc(db, 'shares/s'), { profile })).toThrow(/Nested arrays/)
    expect(() => writeBatch(db).set(doc(db, 'users/u'), { athlete: encodeForFirestore({ activities }) })).not.toThrow()
    expect(() => writeBatch(db).set(doc(db, 'shares/s'), encodeForFirestore({ profile, raceId: undefined }) as object)).not.toThrow()
  })
})
