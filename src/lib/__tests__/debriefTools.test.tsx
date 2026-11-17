import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DebriefPage } from '../../components/DebriefPage'
import { SortiesCard } from '../../components/DebriefSorties'
import { compareReports, debriefCsv, debriefPoints, debriefReport, debriefsToAnnounce, debriefsToNotify, debriefText, debriefTimes, upsertFile } from '../debrief'
import { importActivity } from '../debriefImport'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan } from '../plan'
import type { Debrief } from '../types'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

/** Enregistrement horodaté : 3 m/s, arrêt de 6 min au km 5, points toutes les 5 s. */
function recording(t0: number): string {
  const pts: string[] = []
  let t = t0
  const at = (d: number) => `<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele><time>${new Date(t).toISOString()}</time></trkpt>`
  for (let d = 0; d <= 20000; d += 15) {
    pts.push(at(d))
    if (d === 4995) for (let k = 0; k < 72; k++) {
      t += 5000
      pts.push(at(d))
    }
    t += 5000
  }
  return `<gpx><trk><name>Sortie test</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('debrief : import, comparaison, exports, annonces', () => {
  const race = newRace('Trail test', gpx())
  race.checkpoints = [
    { id: 'a', dist: 5000, name: 'Ravito A', kind: 'ravito', stopMin: 5, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
    { id: 'b', dist: 10000, name: 'Sommet B', kind: 'split', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
  ]
  const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, name: 'Lionel' })
  const plan = computePlan(race, athlete)!
  const points = debriefPoints(race, plan.sim)
  const s0 = Date.parse('2026-06-06T04:00:00Z')
  const iso = (ms: number) => new Date(ms).toISOString()

  it('import FIT / GPX : passages au plus près, arrêt au ravito détecté, sortie créée', () => {
    const res = importActivity(race, athlete, 'sortie.gpx', new TextEncoder().encode(recording(s0)))
    const d = res.race.debriefs![0]
    expect(res.id).toBe(d.id)
    expect(d.file!.start).toBe(s0)
    const t = debriefTimes(d)
    expect(t.source.get('a')).toBe('file')
    // Arrivée au km 5 vers 5000 / 3 s, reparti 6 min plus tard (à 20 s près : fenêtre de détection).
    expect(Math.abs((t.arr.get('a')! - s0) / 1000 - 5000 / 3)).toBeLessThan(25)
    expect(Math.abs((t.dep.get('a')! - t.arr.get('a')!) / 1000 - 360)).toBeLessThan(30)
    expect(Math.abs((t.arr.get('b')! - s0) / 1000 - (10000 / 3 + 360))).toBeLessThan(15)
    expect(t.arr.has('__finish')).toBe(true)
    expect(res.message).toMatch(/3 passages sur 3 trouvés dans « Sortie test », 1 arrêt aux ravitos détecté/)
    // Enregistrement sans rapport avec le parcours : refusé.
    const far = recording(s0).replace(/lon="6"/g, 'lon="7"')
    expect(() => importActivity(race, athlete, 'ailleurs.gpx', new TextEncoder().encode(far))).toThrow(/Aucun point/)
  })

  it('import : complète la sortie du même départ sans écraser le mode course', () => {
    const live: Debrief = { id: 'x', createdAt: iso(s0), points, live: { startedAt: iso(s0 + 60000), passages: { a: iso(s0 + 1700000) } } }
    const file = { name: 'f', start: s0, passes: { a: s0 + 1680000, b: s0 + 3700000 }, departures: { a: s0 + 2000000 } }
    const { list, id } = upsertFile([live], file, points)
    expect(id).toBe('x')
    const t = debriefTimes(list[0])
    expect(t.arr.get('a')).toBe(s0 + 1700000)
    expect(t.source.get('a')).toBe('live')
    expect(t.arr.get('b')).toBe(s0 + 3700000)
    expect(t.source.get('b')).toBe('file')
    expect(t.dep.get('a')).toBe(s0 + 2000000)
    // Le lendemain : nouvelle sortie ; sortie désignée : complétée quoi qu'il arrive.
    expect(upsertFile([live], { ...file, start: s0 + 86400000 }, points).list).toHaveLength(2)
    expect(upsertFile([live], { ...file, start: s0 + 86400000 }, points, 'x').list).toHaveLength(1)
  })

  const run = (id: string, start: number, k: number, note?: string): Debrief => {
    const [a, b, f] = points
    return {
      id,
      createdAt: iso(start),
      points,
      live: {
        startedAt: iso(start),
        passages: { a: iso(start + a.planned * k * 1000), b: iso(start + (b.planned * k + 120) * 1000), __finish: iso(start + f.planned * k * 1000) },
        departures: { a: iso(start + (a.planned * k + 240) * 1000) },
      },
      ...(note ? { notes: { b: note }, note: 'Bonne sortie ; à refaire' } : {}),
    }
  }

  it('comparaison : temps écoulé à chaque point, tronçons et arrivée', () => {
    const fast = debriefReport(run('f', s0, 1))
    const slow = debriefReport(run('s', s0 - 7 * 86400000, 1.1))
    const c = compareReports(fast, slow)
    const [a, , f] = points
    expect(c.points.get('a')!.diff).toBe(Math.round(a.planned * 1 - a.planned * 1.1))
    expect(c.points.get('a')!.other).toBe(Math.round(a.planned * 1.1))
    expect(c.total!.diff).toBe(fast.total! - slow.total!)
    expect(c.total!.diff).toBeLessThan(0)
    expect(c.points.get('__finish')!.diff).toBe(Math.round(f.planned - f.planned * 1.1))
    expect(c.legs.get('b')!.diff).toBe(fast.legs[1].actual! - slow.legs[1].actual!)
  })

  it('exports : tableur (CSV pour Excel) et résumé texte', () => {
    const d = run('f', s0, 1, 'Montée, ça\u00a0tire ; "dur"')
    const csv = debriefCsv('Trail test', d, 'Europe/Paris')
    expect(csv.startsWith('\ufeffDebrief;Trail test;Départ;')).toBe(true)
    expect(csv).toContain('\r\nPoint;km;Prévu;Réel;Écart (min);Reparti;Marge barrière (min);Source;Note\r\n')
    expect(csv).toContain('Ravito A;5,0;')
    expect(csv).toContain(';mode course;')
    // Note avec « ; » et guillemets : cellule entre guillemets.
    expect(csv).toContain('"Montée, ça\u00a0tire ; ""dur"""')
    expect(csv).toContain('\r\nTronçon;km;D+ (m);D- (m);Prévu;Réel;')
    expect(csv).toContain('\r\nRavito;Arrêt prévu;Arrêt réel;Écart (min)\r\nRavito A;0:05:00;0:04:00;-1\r\n')
    expect(csv).toContain('Bilan;Bonne sortie ; à refaire'.replace('Bonne sortie ; à refaire', '"Bonne sortie ; à refaire"'))
    const txt = debriefText('Trail test', d, 'Europe/Paris')
    expect(txt).toMatch(/^Debrief · Trail test — samedi 6 juin 2026, départ 06:00\nArrivée \d\d:\d\d en \d+h\d\d \(prévu \d+h\d\d, à l'heure\)/)
    expect(txt).toContain('• Sommet B (km 10,0) : ')
    expect(txt).toContain('+2 min — Montée')
    expect(txt).toContain('reparti ')
    expect(txt).toContain('Bilan : Bonne sortie ; à refaire')
  })

  it('annonces : sortie terminée proposée 7 jours, notification dans les 12 h, une fois', () => {
    const d = run('f', s0, 1)
    const finish = debriefReport(d).finish!
    const races = [{ id: 'r', debriefs: [d] }]
    expect(debriefsToAnnounce(races, finish + 3600000).map((x) => x.debrief.id)).toEqual(['f'])
    expect(debriefsToAnnounce([{ id: 'r', debriefs: [{ ...d, seen: true }] }], finish + 3600000)).toEqual([])
    expect(debriefsToAnnounce(races, s0 + 8 * 86400000)).toEqual([])
    expect(debriefsToNotify(races, [], finish + 600000).map((x) => x.debrief.id)).toEqual(['f'])
    expect(debriefsToNotify(races, ['f'], finish + 600000)).toEqual([])
    expect(debriefsToNotify(races, [], finish + 13 * 3600000)).toEqual([])
  })

  it('page debrief et carte des sorties : exports, comparaison, graphique d’évolution', () => {
    const debriefs = [run('f', s0, 1), run('s', s0 - 7 * 86400000, 1.1), run('m', s0 - 14 * 86400000, 1.05)]
    const r2 = { ...race, debriefs }
    const page = renderToStaticMarkup(<DebriefPage race={r2} athlete={athlete} debriefId="f" onChange={() => {}} onAthleteChange={() => {}} onBack={() => {}} />)
    expect(page).toContain('PDF / imprimer')
    expect(page).toContain('Tableur (CSV)')
    expect(page).toContain('Copier le résumé')
    expect(page).toContain("Compléter avec l&#x27;enregistrement")
    expect(page).toContain('Comparer avec une autre sortie')
    const card = renderToStaticMarkup(<SortiesCard race={r2} athlete={athlete} onChange={() => {}} onDebrief={() => {}} />)
    expect(card).toContain('Sorties et debriefs (3)')
    expect(card).toContain('Comparaison des sorties')
    expect(card).toContain('Évolution du temps d&#x27;arrivée')
    expect(card.match(/class="series-1 dot"/g)).toHaveLength(3)
    // Meilleur temps en gras à chaque point : la sortie la plus rapide.
    expect(card.match(/<td class="best">/g)!.length).toBe(points.length)
    expect(card).toContain("Importer l&#x27;activité (FIT / GPX)")
    const empty = renderToStaticMarkup(<SortiesCard race={race} athlete={athlete} onChange={() => {}} onDebrief={() => {}} />)
    expect(empty).toContain('Pas encore de sortie sur ce parcours.')
    expect(empty).not.toContain('Comparaison des sorties')
  })
})
