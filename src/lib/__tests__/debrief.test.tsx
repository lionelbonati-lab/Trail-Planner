import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DebriefPage } from '../../components/DebriefPage'
import {
  clockNear,
  debriefEnded,
  debriefPoints,
  debriefReport,
  debriefTimes,
  levelTarget,
  realTimeAt,
  signedGap,
  sortedDebriefs,
  upsertLive,
  upsertWatch,
} from '../debrief'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan } from '../plan'
import type { Debrief } from '../types'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('debrief de course', () => {
  const race = newRace('Trail test', gpx())
  race.checkpoints = [
    { id: 'a', dist: 5000, name: 'Ravito A', kind: 'ravito', stopMin: 5, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
    { id: 'b', dist: 10000, name: 'Sommet B', kind: 'split', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
  ]
  race.finishCutoff = '2026-06-06T12:00'
  const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, name: 'Lionel' })
  const plan = computePlan(race, athlete)!
  const points = debriefPoints(race, plan.sim)
  const [a, b, fin] = points
  const s0 = Date.parse('2026-06-06T04:00:00Z') // 06:00 à Paris
  const iso = (ms: number) => new Date(ms).toISOString()

  it('plan figé : points, tronçons, arrêts et barrière de l’arrivée', () => {
    expect(points.map((p) => p.id)).toEqual(['a', 'b', '__finish'])
    expect(a.stop).toBe(300)
    expect(b.up).toBeGreaterThan(200)
    expect(fin.down).toBeGreaterThan(400)
    expect(fin.cutoff).toBe('2026-06-06T10:00:00.000Z')
    // Parcours d'entraînement (départ libre) : pas de barrière.
    expect(debriefPoints({ ...race, kind: 'route' }, plan.sim)[2].cutoff).toBeNull()
  })

  it('mode course : debrief créé au premier passage, même sortie mise à jour, nouvelle sortie à part', () => {
    const live = { startedAt: iso(s0), passages: {} as Record<string, string> }
    expect(upsertLive([], live, () => points)).toBeNull()
    const one = upsertLive([], { ...live, passages: { a: iso(s0 + 1800000) } }, () => points)!
    expect(one).toHaveLength(1)
    expect(one[0].points).toBe(points)
    // Même passage : rien à changer ; un passage de plus : même debrief.
    expect(upsertLive(one, one[0].live!, () => points)).toBeNull()
    const two = upsertLive(one, { ...live, passages: { a: iso(s0 + 1800000), b: iso(s0 + 3600000) } }, () => points)!
    expect(two).toHaveLength(1)
    expect(Object.keys(two[0].live!.passages)).toEqual(['a', 'b'])
    // Départ corrigé d'une heure : même sortie (passage identique).
    expect(upsertLive(two, { ...two[0].live!, startedAt: iso(s0 - 3600000) }, () => points)).toHaveLength(1)
    // Le lendemain : nouvelle sortie.
    const next = upsertLive(two, { startedAt: iso(s0 + 86400000), passages: { a: iso(s0 + 86400000 + 1700000) } }, () => points)!
    expect(next).toHaveLength(2)
  })

  it('montre : passages par indice du plan, départs des ravitos, relevé plus ancien ignoré, fusion avec le mode course', () => {
    const s = s0 / 1000 + 60
    const report = { t: s + 4000, s, d: 10200, p: `0:${s + 1700}:${s + 2000},1:${s + 3900},2:${s + 3950}` }
    const list = upsertWatch([], report, () => points)!
    const w = list[0].watch!
    // L'arrivée (km 20) est notée alors que la montre n'est qu'au km 10,2 : pas crédible.
    expect(w.passes).toEqual({ a: s + 1700, b: s + 3900 })
    expect(w.departures).toEqual({ a: s + 2000 })
    expect(upsertWatch(list, { ...report, t: report.t - 600 }, () => points)).toBeNull()
    expect(upsertWatch(list, report, () => points)).toBeNull()
    // Mode course lancé une minute avant la montre : même sortie.
    const both = upsertLive(list, { startedAt: iso(s0), passages: { a: iso(s0 + 1750000) } }, () => points)!
    expect(both).toHaveLength(1)
    // Montre d'abord, puis mode course, puis corrections.
    const t = debriefTimes(both[0])
    expect(t.start).toBe(s * 1000)
    expect(t.arr.get('a')).toBe((s + 1700) * 1000)
    expect(t.source.get('a')).toBe('watch')
    const edited: Debrief = { ...both[0], edits: { passages: { a: iso(s0 + 1800000), b: null }, start: iso(s0) } }
    const te = debriefTimes(edited)
    expect(te.start).toBe(s0)
    expect(te.arr.get('a')).toBe(s0 + 1800000)
    expect(te.source.get('a')).toBe('edit')
    expect(te.arr.has('b')).toBe(false)
  })

  const run = (over: Partial<Debrief> = {}): Debrief => ({
    id: 'r1',
    createdAt: iso(s0),
    points,
    live: {
      startedAt: iso(s0),
      passages: {
        a: iso(s0 + (a.planned + 120) * 1000),
        b: iso(s0 + (b.planned + 60) * 1000),
        __finish: iso(s0 + (fin.planned - 300) * 1000),
      },
      departures: { a: iso(s0 + (a.planned + 120 + 480) * 1000) },
    },
    ...over,
  })

  it('rapport : écarts, tronçons en mouvement ou arrêt compris, arrêts, barrière, temps pour le niveau', () => {
    const r = debriefReport(run())
    expect(r.rows.map((x) => x.delta)).toEqual([120, 60, -300])
    expect(r.total).toBe(fin.planned - 300)
    expect(r.plannedTotal).toBe(fin.planned)
    // Arrivée 5 min avant l'heure prévue, barrière à 12:00.
    expect(r.rows[2].margin).toBe(Math.round((Date.parse(fin.cutoff!) - (s0 + (fin.planned - 300) * 1000)) / 1000))
    // Départ → A : 2 min de plus ; A → B : départ du ravito noté, temps en mouvement.
    expect(r.legs[0]).toMatchObject({ from: 'Départ', to: 'Ravito A', planned: a.planned, actual: a.planned + 120, withStop: false })
    expect(r.legs[1].planned).toBe(b.planned - a.planned - a.stop)
    expect(r.legs[1].actual).toBe(b.planned + 60 - (a.planned + 600))
    expect(r.stops).toEqual([{ point: a, planned: 300, actual: 480 }])
    // Niveau : 3 min d'arrêt de trop retirées du temps.
    expect(levelTarget(r)).toBe(r.total! - 180)
    // Sans départ du ravito : tronçon suivant arrêt compris.
    const noDep = debriefReport(run({ live: { ...run().live!, departures: {} } }))
    expect(noDep.legs[1]).toMatchObject({ planned: b.planned - a.planned, withStop: true })
    expect(noDep.stops[0].actual).toBeNull()
    expect(levelTarget(noDep)).toBe(noDep.total)
  })

  it('heure réelle le long du parcours, sortie terminée, ordre des sorties', () => {
    const r = debriefReport(run())
    expect(realTimeAt(r, 0)).toBe(s0)
    expect(realTimeAt(r, a.dist)).toBe(r.rows[0].actual)
    // Entre A (reparti) et B : interpolé depuis le départ du ravito.
    const mid = realTimeAt(r, (a.dist + b.dist) / 2)!
    expect(mid).toBeCloseTo((r.rows[0].left! + r.rows[1].actual!) / 2, -3)
    const open = run({ live: { startedAt: iso(s0), passages: { a: iso(s0 + 1800000) } } })
    expect(realTimeAt(debriefReport(open), b.dist)).toBeNull()
    expect(debriefEnded(run(), s0 + 3600000)).toBe(true)
    expect(debriefEnded(open, s0 + 1800000 + 3600000)).toBe(false)
    expect(debriefEnded(open, s0 + 1800000 + 4 * 3600000)).toBe(true)
    const older = run({ id: 'r0', live: { ...run().live!, startedAt: iso(s0 - 86400000) } })
    expect(sortedDebriefs({ debriefs: [older, run()] }).map((d) => d.id)).toEqual(['r1', 'r0'])
  })

  it('heure saisie : jour le plus proche de l’heure prévue (passage après minuit)', () => {
    const ref = Date.parse('2026-06-06T21:50:00Z') // 23:50 à Paris
    expect(clockNear('00:20', 'Europe/Paris', ref)).toBe(Date.parse('2026-06-06T22:20:00Z'))
    expect(clockNear('23:40', 'Europe/Paris', ref)).toBe(Date.parse('2026-06-06T21:40:00Z'))
    expect(clockNear('7h', 'Europe/Paris', ref)).toBeNull()
    expect(signedGap(420)).toBe('+7 min')
    expect(signedGap(-3900)).toBe('−1h05')
    expect(signedGap(20)).toBe("à l'heure")
  })

  it('page debrief : chiffres clés, profil avec écarts, passages, tronçons, arrêts, niveau', () => {
    const d = run()
    const html = renderToStaticMarkup(
      <DebriefPage race={{ ...race, debriefs: [d] }} athlete={athlete} debriefId="r1" onChange={() => {}} onAthleteChange={() => {}} onBack={() => {}} />,
    )
    expect(html).toContain('Debrief · Trail test')
    expect(html).toContain('Écart au plan')
    expect(html).toContain('−5 min')
    expect(html).toContain('class="cp-delta late"')
    expect(html).toContain('+2′')
    expect(html).toContain('Passages notés en mode course')
    expect(html).toContain('reparti 06:')
    expect(html).toContain('Arrêts aux ravitos')
    expect(html).toContain('+3 min')
    expect(html).toContain('marge ')
    expect(html).toContain('Recaler mon niveau')
    const missing = renderToStaticMarkup(
      <DebriefPage race={race} athlete={athlete} debriefId="x" onChange={() => {}} onAthleteChange={() => {}} onBack={() => {}} />,
    )
    expect(missing).toContain('Debrief introuvable')
  })
})
