import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan, scenarioWindows } from '../plan'
import { gapText, liveNotices, pushTargets, runnerDoc, shortDuration, tokenKey, watchNotices } from '../pushRules'
import { buildSnapshot } from '../share'
import { parseWatchPlan } from '../watchLive'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('notifications du serveur', () => {
  const race = newRace('Trail test', gpx())
  race.checkpoints = [
    { id: 'a', dist: 5000, name: 'Ravito A', kind: 'ravito', stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
    { id: 'b', dist: 10000, name: 'Sommet B', kind: 'split', stopMin: 0, cutoff: '2026-06-06T07:40', water: 0, carbs: 0, notes: '', auto: false },
  ]
  const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, name: 'Lionel', watchId: 'abcdef0123456789', watchRaceId: race.id })
  const plan = computePlan(race, athlete)!
  const snap = buildSnapshot('uid', race, athlete, plan.track, plan.sim, scenarioWindows(plan.track, athlete, plan.opts))
  const w = parseWatchPlan(snap.w)!
  const s = Math.round(Date.parse(snap.start) / 1000)

  it('passage : un seul envoi par point, écart compté depuis le vrai départ', () => {
    const passA = s + Math.round(w.cps[0].planned) + 300
    const r1 = { t: passA + 60, s, d: 5200, p: `0:${passA}` }
    const one = watchNotices(snap, r1, { t: passA - 240, s, d: 4800 }, null, r1.t * 1000)!
    expect(one.notices.filter((n) => n.kind === 'pass')).toHaveLength(1)
    expect(one.notices[0].title).toBe('Lionel · Ravito A')
    expect(one.notices[0].body).toMatch(/^Passé à \d\d:\d\d · km 5,0 · \+5 min sur le plan$/)
    expect(one.state.passes).toEqual([0])
    // Relevé suivant : le passage est déjà connu, rien de plus.
    const again = watchNotices(snap, { ...r1, t: r1.t + 300, d: 6000 }, r1, one.state, (r1.t + 300) * 1000)!
    expect(again.notices.filter((n) => n.kind === 'pass')).toEqual([])
    // Relevé d'une autre activité (nouveau départ, le lendemain) : état remis à zéro.
    const other = watchNotices(snap, { t: s + 86400 + 3000, s: s + 86400, d: 5100, p: `0:${s + 86400 + 2900}` }, null, one.state, (s + 86400 + 3000) * 1000)!
    expect(other.notices.filter((n) => n.kind === 'pass')).toHaveLength(1)
  })

  it('retard : une alerte par palier de 15 min, et barrière menacée', () => {
    // Très lent : au km 8 avec ~40 min de retard.
    const planned8 = w.curve.find((c) => c[0] >= 8000)![1]
    const t = s + Math.round(planned8) + 2400
    const r = { t, s, d: 8000, p: `0:${s + Math.round(w.cps[0].planned) + 1500}` }
    const res = watchNotices(snap, r, null, { s, passes: [0], late: 0, barriers: [] }, t * 1000)!
    const late = res.notices.find((n) => n.kind === 'late')!
    expect(late.title).toMatch(/^Lionel : \+\d+ min sur le plan$/)
    expect(res.state.late).toBeGreaterThanOrEqual(2)
    // Même palier au relevé suivant : pas de nouvelle alerte.
    const next = watchNotices(snap, { ...r, t: t + 120, d: 8100 }, r, res.state, (t + 120) * 1000)!
    expect(next.notices.find((n) => n.kind === 'late')).toBeUndefined()
    // Barrière du sommet à 07:40 (heure de Paris) : marge sous 30 min avec ce retard.
    const bar = res.notices.find((n) => n.kind === 'barrier')
    expect(bar?.title).toBe('Lionel · barrière Sommet B')
    expect(res.state.barriers).toEqual([1])
  })

  it('arrivée : notification de passage pour l’assistance et debrief prêt pour le coureur', () => {
    const fin = w.cps.length - 1
    const at = s + Math.round(w.cps[fin].planned) - 120
    const r = { t: at + 30, s, d: snap.totalDist, p: `0:${s + 1700},1:${s + 3400},${fin}:${at}` }
    const res = watchNotices(snap, r, { t: at - 300, s, d: snap.totalDist - 800, p: `0:${s + 1700},1:${s + 3400}` }, { s, passes: [0, 1], late: 0, barriers: [] }, r.t * 1000)!
    expect(res.notices.map((n) => n.kind)).toEqual(['pass', 'finish'])
    const finish = res.notices[1]
    expect(finish.owner).toBe(true)
    expect(finish.title).toBe('Debrief prêt · Trail test')
    expect(finish.body).toMatch(/^Arrivée à \d\d:\d\d en \d+h\d\d \(−2 min sur le plan\)/)
  })

  it('mode course : passages notés sur le téléphone, sans doublon avec la montre', () => {
    const startedAt = snap.start
    const a = new Date(Date.parse(startedAt) + 1800_000).toISOString()
    const before = { ...snap, live: { startedAt, lastUpdate: null } }
    const after = { ...snap, live: { startedAt, lastUpdate: a }, rows: snap.rows.map((r, i) => (i === 0 ? { ...r, actual: a } : r)) }
    const res = liveNotices(before, after, null)!
    expect(res.notices.map((n) => n.title)).toEqual(['Lionel · Ravito A'])
    // Déjà notifié par la montre (même sortie) : rien.
    expect(liveNotices(before, after, { s: Math.round(Date.parse(startedAt) / 1000) + 60, passes: [0], late: 0, barriers: [] })!.notices).toEqual([])
    // Sans mode course : rien à faire.
    expect(liveNotices(null, snap, null)).toBeNull()
  })

  it('aides : textes, cibles des abonnements, clé de jeton stable', () => {
    expect(gapText(420)).toBe('+7 min sur le plan')
    expect(gapText(-3900)).toBe('−1h05 sur le plan')
    expect(gapText(10)).toBe("à l'heure prévue")
    expect(shortDuration(5400)).toBe('1h30')
    expect(pushTargets('abc', null)).toEqual(['share:abc'])
    expect(pushTargets('code-r1', 'code')).toEqual(['share:code-r1', 'suivi:code'])
    // Lien permanent : course envoyée à la montre (document du code) ou parcours choisi dans l'appli montre.
    const base = { courseId: 'r1', kind: 'race' as const, start: '2026-06-06T05:00:00Z' }
    const now = Date.parse('2026-06-06T06:00:00Z')
    expect(runnerDoc('code', base, { t: now / 1000 - 60, s: now / 1000 - 3600, d: 5000 }, now)).toBe('code')
    expect(runnerDoc('code', base, { t: now / 1000 - 60, s: now / 1000 - 3600, d: 5000, v: 'r2' }, now)).toBe('code-r2')
    expect(runnerDoc('code', null, null, now)).toBeNull()
    expect(tokenKey('xyz:APA91b-token')).toBe(tokenKey('xyz:APA91b-token'))
    expect(tokenKey('a')).not.toBe(tokenKey('b'))
    expect(tokenKey('f'.repeat(300))).toMatch(/^[\w-]+$/)
  })
})
