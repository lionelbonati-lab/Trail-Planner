import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan, scenarioWindows } from '../plan'
import { APP_REPORT_KEEP_MS, buildSnapshot, lastRace, reportFor, RUNNER_RACE_KEEP_MS, RUNNER_RECENT_MS, runnerBanner, runnerCourse, snapshotWithResult } from '../share'
import { reportCourse } from '../watchLive'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 10000; d += 50) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + d / 20}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

const now = Date.parse('2026-06-01T12:00:00Z')
const sec = (ms: number) => Math.round(ms / 1000)

describe('relevés de l’appli montre rangés par course', () => {
  it('id du parcours dans v (texte), sinon course envoyée à la montre', () => {
    expect(reportCourse({ t: 1, s: 1, d: 0, v: 'abc' })).toBe('abc')
    expect(reportCourse({ t: 1, s: 1, d: 0, v: 1 })).toBeNull()
    expect(reportCourse({ t: 1, s: 1, d: 0 })).toBeNull()
    expect(reportCourse(null)).toBeNull()
  })

  it('lien d’une course : seulement les relevés de cette course', () => {
    const report = { t: sec(now) - 600, s: sec(now) - 3600, d: 4000 }
    const watched = { courseId: 'r1', onWatch: true, totalDist: 10000 }
    const other = { courseId: 'r2', onWatch: false, totalDist: 10000 }
    // Champ Trail Planner (sans id) : la course envoyée à la montre seulement.
    expect(reportFor(watched, report, now)).toBe(report)
    expect(reportFor(other, report, now)).toBeNull()
    // Appli montre sur le parcours r2 : le lien de r2, pas celui de la course sur la montre.
    const app = { ...report, v: 'r2' }
    expect(reportFor(other, app, now)).toBe(app)
    expect(reportFor(watched, app, now)).toBeNull()
    // Ancienne sortie sur ce parcours (plus de 24 h) : ignorée tant que ce n'est pas la course sur la montre.
    expect(reportFor(other, app, now + APP_REPORT_KEEP_MS)).toBeNull()
    expect(reportFor({ ...other, onWatch: true }, app, now + APP_REPORT_KEEP_MS)).toBe(app)
    // Anciens partages (sans id de course) : comme avant.
    expect(reportFor({ totalDist: 10000 }, app, now)).toBe(app)
    // Relevé d'avant l'envoi à la montre, ou au-delà de l'arrivée.
    expect(reportFor({ ...watched, watchSince: new Date(now).toISOString() }, report, now)).toBeNull()
    expect(reportFor(watched, { ...report, d: 12000 }, now)).toBeNull()
  })

  it('snapshot : id de la course, course sur la montre, code montre si l’appli synchronise ses parcours', () => {
    const race = newRace('Trail test', gpx())
    const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, watchId: 'a'.repeat(32), epCode: '48203917', watchRaceId: 'autre' })
    const plan = computePlan(race, athlete)!
    const snap = (a: typeof athlete) => buildSnapshot('uid', race, a, plan.track, plan.sim, scenarioWindows(plan.track, a, plan.opts))
    const off = snap(athlete)
    expect(off.courseId).toBe(race.id)
    expect(off.onWatch).toBe(false)
    expect(off.liveRef).toBeNull()
    const synced = snap({ ...athlete, appSync: true })
    expect(synced.liveRef).toBe('a'.repeat(32))
    expect(synced.liveRefShort).toBe('48203917')
    expect(synced.onWatch).toBe(false)
    expect(snap({ ...athlete, watchRaceId: race.id }).onWatch).toBe(true)
  })
})

describe('lien d’assistance permanent du coureur', () => {
  const day = 24 * 3600
  const wl = ['TPL1', `r2|c|Grand trail|${sec(now) + 10 * day}|80000|4000`, `r1|c|Trail court|${sec(now) + 3 * day}|20000|900|*`, 'p1|p|Boucle|0|12000|500'].join('\n')
  const base = { courseId: 'r1', wl }

  it('entre deux sorties : la prochaine course de la liste de l’appli', () => {
    expect(runnerCourse(base, null, now)).toEqual({ id: 'r1', mode: 'next' })
    // Course passée depuis plus de 48 h : la suivante.
    expect(runnerCourse(base, null, now + 3 * day * 1000 + RUNNER_RACE_KEEP_MS + 1000)).toEqual({ id: 'r2', mode: 'next' })
    // Sans la liste de l'appli : la course datée envoyée à la montre, si elle est à venir.
    const watched = { courseId: 'r1', kind: 'race' as const, start: new Date(now + 3 * day * 1000).toISOString() }
    expect(runnerCourse(watched, null, now)).toEqual({ id: 'r1', mode: 'next' })
    // Plus rien à venir : la dernière course passée ; un parcours d'entraînement sur la montre n'est pas montré.
    expect(runnerCourse({ ...watched, start: '2026-01-10T08:00:00Z', last: 'r0' }, null, now)).toEqual({ id: 'r0', mode: 'last' })
    expect(runnerCourse({ courseId: 'p1', kind: 'route', start: new Date(now).toISOString(), wl: 'TPL1', last: 'r0' }, null, now)).toEqual({ id: 'r0', mode: 'last' })
    expect(runnerCourse({ courseId: 'p1', kind: 'route', start: new Date(now).toISOString(), wl: 'TPL1' }, null, now)).toBeNull()
  })

  it('pendant une sortie et 12 h après : la course enregistrée', () => {
    const report = { t: sec(now) - 300, s: sec(now) - 3600, d: 5000, v: 'p1' }
    expect(runnerCourse(base, report, now)).toEqual({ id: 'p1', mode: 'activity' })
    // Champ Trail Planner (sans id) : la course envoyée à la montre.
    expect(runnerCourse({ ...base, courseId: 'r9' }, { ...report, v: 1 }, now)).toEqual({ id: 'r9', mode: 'activity' })
    // Sortie terminée depuis plus de 12 h : de nouveau la prochaine course.
    expect(runnerCourse(base, report, now + RUNNER_RECENT_MS)).toEqual({ id: 'r1', mode: 'next' })
  })

  it('bandeau : en course, sortie terminée, dernière sortie, prochaine course datée', () => {
    const snap = { start: '2026-05-30T05:00:00Z', plannedStart: '2026-05-30T05:00:00Z', timeZone: 'Europe/Paris', totalDist: 20000 }
    const report = { t: sec(now) - 600, s: sec(now) - 7200, d: 8000 }
    expect(runnerBanner('activity', snap, report, now)).toBe('En course')
    expect(runnerBanner('activity', snap, { ...report, d: 19900 }, now)).toBe('Sortie terminée')
    expect(runnerBanner('activity', snap, report, now + 4 * 3600_000)).toBe('Dernière sortie')
    expect(runnerBanner('next', snap, null, Date.parse('2026-05-29T12:00:00Z'))).toBe('Prochaine course · samedi 30/05')
    expect(runnerBanner('next', snap, null, Date.parse('2026-05-30T09:00:00Z'))).toBe('Course · samedi 30/05')
    expect(runnerBanner('last', snap, null, now)).toBe('Dernière sortie · samedi 30/05')
    expect(runnerBanner('next', { ...snap, freeStart: true }, null, Date.parse('2026-05-29T12:00:00Z'))).toBe('Prochaine course')
  })

  it('dernière course : la plus récente des courses passées, avec le résultat du debrief', () => {
    const races = [
      { id: 'a', kind: 'race' as const, env: { start: '2026-04-12T08:00' } },
      { id: 'b', kind: 'race' as const, env: { start: '2026-05-30T07:00' } },
      { id: 'c', kind: 'route' as const, env: { start: '2026-05-31T07:00' } },
      { id: 'd', kind: 'race' as const, env: { start: '2026-06-01T07:00' } },
    ]
    expect(lastRace(races, '2026-06-01')?.id).toBe('b')
    expect(lastRace(races, '2026-04-01')).toBeNull()
    const race = newRace('Trail test', gpx())
    race.checkpoints = [{ id: 'k', dist: 5000, name: 'Ravito', kind: 'ravito', stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
    const athlete = normalizeAthlete(DEFAULT_ATHLETE)
    const plan = computePlan(race, athlete)!
    const snap = buildSnapshot('uid', race, athlete, plan.track, plan.sim, scenarioWindows(plan.track, athlete, plan.opts))
    const start = Date.parse('2026-05-30T05:02:00Z')
    const finishId = snap.rows[snap.rows.length - 1].id
    const result = {
      start,
      rows: [
        { point: { id: 'k' }, actual: start + 1800_000, left: start + 2000_000 },
        { point: { id: finishId }, actual: start + 3900_000, left: null },
      ],
    }
    const done = snapshotWithResult(snap, result as Parameters<typeof snapshotWithResult>[1])
    expect(done.start).toBe(new Date(start).toISOString())
    expect(done.rows[0].actual).toBe(new Date(start + 1800_000).toISOString())
    expect(done.rows[0].left).toBe(new Date(start + 2000_000).toISOString())
    expect(done.rows[done.rows.length - 1].actual).toBe(new Date(start + 3900_000).toISOString())
    expect(snapshotWithResult(snap, null)).toBe(snap)
  })
})
