import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShareView } from '../../components/SharePage'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { computePlan, scenarioWindows } from '../plan'
import { buildSnapshot, timeAtDist } from '../share'
import { formatDuration } from '../time'
import { estimatedDist, ESTIMATE_MAX_S, plannedAtWatch, parseWatchPlan } from '../watchLive'

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

describe('page assistance', () => {
  const race = newRace('Trail test', gpx())
  race.checkpoints = [
    { id: 'a', dist: 5000, name: 'Ravito A', kind: 'ravito', stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
    { id: 'b', dist: 10000, name: 'Sommet B', kind: 'split', stopMin: 0, cutoff: '', water: 0, carbs: 0, notes: '', auto: false },
  ]
  const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, name: 'Lionel', watchId: 'abcdef0123456789', watchRaceId: race.id })
  const plan = computePlan(race, athlete)!
  const snap = buildSnapshot('uid', race, athlete, plan.track, plan.sim, scenarioWindows(plan.track, athlete, plan.opts))
  // Page ouverte peu avant le départ (sinon le lien est déjà arrêté : course de test passée).
  const pre = Date.parse(snap.start) - 600000

  it('sans relevé de montre : plan seul', () => {
    expect(snap.liveRef).toBe('abcdef0123456789')
    // Tracé simplifié pour la carte : la ligne droite du parcours de test tient en deux points.
    expect(snap.route).toEqual([[0, 45, 6], [Math.round(plan.track.totalDist), expect.closeTo(45.17986, 4), 6]])
    const html = renderToStaticMarkup(<ShareView snap={snap} report={null} nowMs={pre} />)
    expect(html).toContain('Le suivi en direct apparaîtra ici')
    expect(html).toContain('Ravito A')
  })

  it('avec relevé de montre : position, écart, passage réel, batterie', () => {
    const w = parseWatchPlan(snap.w)!
    const s = Math.round(Date.parse(snap.start) / 1000)
    const d = 7000
    const t = s + Math.round(plannedAtWatch(w, d) * 1.1)
    const passA = s + Math.round(w.cps[0].planned * 1.1)
    const html = renderToStaticMarkup(
      <ShareView snap={snap} report={{ t, s, d, p: `0:${passA}`, bat: 72, lat: 45.06, lon: 6 }} nowMs={(t + 180) * 1000} />,
    )
    expect(html).toContain('Montre · en course depuis')
    expect(html).toContain('km 7.0')
    expect(html).toMatch(/\+\d+ min sur le plan/)
    expect(html).toContain('batterie 72 %')
    expect(html).toContain('il y a 3 min')
    expect(html).toContain('Prochain : <strong>Sommet B</strong>')
    expect(html).toContain('class="me"')
    // Partie déjà parcourue grisée sur le profil.
    expect(html).toContain('class="done-area"')
    // Points dépassés grisés aussi.
    expect(html).toMatch(/class="mp-pt[^"]*mp-passed"/)
  })

  it('profil : nom des points, assistance autorisée et dropbags', () => {
    const r2 = { ...race, checkpoints: race.checkpoints.map((c) => (c.id === 'a' ? { ...c, dropbag: true } : c)) }
    const p2 = computePlan(r2, athlete)!
    const s2 = buildSnapshot('uid', r2, athlete, p2.track, p2.sim, scenarioWindows(p2.track, athlete, p2.opts))
    expect(s2.rows[0].dropbag).toBe(true)
    expect(s2.rows[1].dropbag).toBeUndefined()
    const html = renderToStaticMarkup(<ShareView snap={s2} report={null} nowMs={pre} />)
    const svg = html.slice(html.indexOf('assist-profile'), html.indexOf('mp-legend'))
    for (const r of s2.rows) expect(svg).toContain(`>${r.name}</text>`)
    expect(svg.match(/class="assist-ring"/g)).toHaveLength(s2.rows.filter((r) => r.assist).length)
    expect(svg.match(/class="bag-mark"/g)).toHaveLength(1)
    expect(html).toContain('Assistance autorisée')
    expect(html).toContain('Dropbag')
    // Base de vie : carré rouge sur le point, et dans la légende.
    const base = { ...s2, rows: s2.rows.map((r, i) => (i === 0 ? { ...r, kind: 'base' } : r)) }
    const hb = renderToStaticMarkup(<ShareView snap={base} report={null} nowMs={pre} />)
    expect(hb.match(/class="base-mark"/g)).toHaveLength(1)
    expect(hb).toContain('Base de vie')
  })

  it('profil : défile sur une course longue, pas sur une courte', () => {
    const short = renderToStaticMarkup(<ShareView snap={snap} report={null} nowMs={pre} />)
    expect(short).not.toContain('assist-profile-scroll')
    const long = { ...snap, profile: snap.profile.map(([d, e]) => [d * 20, e] as [number, number]), rows: snap.rows.map((r) => ({ ...r, dist: r.dist * 20 })) }
    const html = renderToStaticMarkup(<ShareView snap={long} report={null} nowMs={pre} />)
    expect(html).toContain('assist-profile-scroll')
  })

  it('navigation : lien par point (accès assistance s’il est placé) et trajet entre les points cochés', () => {
    const r2 = { ...race, checkpoints: race.checkpoints.map((c) => (c.id === 'a' ? { ...c, access: { lat: 45.05, lon: 6.012 } } : c)) }
    const p2 = computePlan(r2, athlete)!
    const s2 = buildSnapshot('uid', r2, athlete, p2.track, p2.sim, scenarioWindows(p2.track, athlete, p2.opts))
    const [a, b, finish] = s2.rows
    expect(a).toMatchObject({ assist: true, access: true, lat: 45.05, lon: 6.012 })
    expect(b).toMatchObject({ assist: false, access: false, lon: 6 })
    expect(b.lat).toBeCloseTo(45 + 10000 / 111195, 4)
    expect(finish).toMatchObject({ name: 'Arrivée', assist: true })
    // Onglet Suivi (par défaut) : liens par point, carte fermée (case à cocher), pas de trajets.
    const suivi = renderToStaticMarkup(<ShareView snap={s2} report={null} nowMs={pre} />)
    expect(suivi).toContain('Y aller (accès assistance)')
    expect(suivi).toContain('Carte en direct')
    expect(suivi).not.toContain('share-map-loading')
    expect(suivi).not.toContain('Trajet de l&#x27;assistance')
    // Onglet Trajets : tous les points cochables ; ceux d'assistance cochés d'office.
    const html = renderToStaticMarkup(<ShareView snap={s2} report={null} nowMs={pre} initialTab="trajets" />)
    expect(html).toContain('Trajet de l&#x27;assistance')
    expect(html).toContain('Sommet B')
    expect(html).toContain('assistance non autorisée')
    // Ravito A (accès) puis arrivée : une étape et la destination, depuis la position du téléphone.
    expect(html).toContain(`https://www.google.com/maps/dir/?api=1&amp;destination=${finish.lat!.toFixed(5)},${finish.lon!.toFixed(5)}&amp;waypoints=45.05000,6.01200&amp;travelmode=driving`)
  })

  it('position estimée entre deux relevés : au rythme mesuré, arrêt au ravito compris, une heure au plus', () => {
    const w = parseWatchPlan(snap.w)!
    const s = Math.round(Date.parse(snap.start) / 1000)
    // Au plan exact au km 3 : 10 min plus tard, on est là où le plan met 10 min de plus.
    const t = s + Math.round(plannedAtWatch(w, 3000))
    const r = { t, s, d: 3000 }
    const at10 = estimatedDist(r, w, t + 600)!
    expect(plannedAtWatch(w, at10) - plannedAtWatch(w, 3000)).toBeCloseTo(600, -1)
    // Juste avant le ravito A (km 5, 3 min d'arrêt) : l'estimation y reste le temps de l'arrêt.
    const tA = s + Math.round(plannedAtWatch(w, 4990))
    const atStop = estimatedDist({ t: tA, s, d: 4990 }, w, tA + 120)!
    expect(atStop).toBeGreaterThan(4990)
    expect(atStop).toBeLessThanOrEqual(5001)
    // 20 % plus lent que le plan : on avance moins vite (amorti).
    const slow = { t: s + Math.round(plannedAtWatch(w, 3000) * 1.2), s, d: 3000 }
    expect(estimatedDist(slow, w, slow.t + 600)!).toBeLessThan(at10)
    // Plus d'une heure sans relevé : pas d'estimation.
    expect(estimatedDist(r, w, t + ESTIMATE_MAX_S + 60)).toBeNull()
    // Rendu : position estimée annoncée, encart LiveTrack.
    const html = renderToStaticMarkup(<ShareView snap={snap} report={r} nowMs={(t + 600) * 1000} />)
    expect(html).toMatch(/≈ km \d+,\d maintenant \(estimé/)
    expect(html).toContain('Garmin LiveTrack')
  })

  it('tronçons sous le profil : distance et D+ entre deux points et entre deux ravitos', () => {
    // Montée de 500 m jusqu'au km 10 : A (km 5) à +250 m, B (km 10) à +500 m.
    const [a, b] = snap.rows
    expect(a.up).toBeCloseTo(250, -1)
    expect(b.up).toBeCloseTo(500, -1)
    const html = renderToStaticMarkup(<ShareView snap={snap} report={null} nowMs={pre} />)
    expect(html).not.toContain('<th>Tronçon</th>')
    const svg = html.slice(html.indexOf('assist-profile'), html.indexOf('mp-legend'))
    expect(svg.match(/<g class="leg-band ?"/g)).toHaveLength(1)
    expect(svg).toContain('leg-band leg-ravito')
    expect(svg).toMatch(/>5,0 km<\/tspan><tspan[^>]*>D\+ 2[45]\d m</)
    // Arrivée : 15 km depuis le ravito A, D+ 250 m (la descente ne compte pas).
    expect(svg).toMatch(/>15,0 km<\/tspan><tspan[^>]*>D\+ 2[45]\d m</)
    expect(html).toContain('Entre deux ravitos')
  })

  it('départ réel décalé : heures prévues et barrières recalées, estimations de la montre affichées', () => {
    const r2 = { ...race, checkpoints: race.checkpoints.map((c) => (c.id === 'a' ? { ...c, cutoff: race.env.start.slice(0, 11) + '23:00' } : c)) }
    const p2 = computePlan(r2, athlete)!
    const s2 = buildSnapshot('uid', r2, athlete, p2.track, p2.sim, scenarioWindows(p2.track, athlete, p2.opts))
    const official = Date.parse(s2.start)
    expect(s2.plannedStart).toBe(s2.start)
    // La montre est partie 30 min après le départ officiel.
    const s = Math.round(official / 1000) + 1800
    const t = s + 600
    const html = renderToStaticMarkup(<ShareView snap={s2} report={{ t, s, d: 1500 }} nowMs={t * 1000} />)
    const clk = (iso: string, add: number) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: s2.timeZone }).format(new Date(Date.parse(iso) + add))
    expect(html).toContain('heures et barrières recalées')
    expect(html).toContain(clk(s2.rows[0].planned, 1800000))
    expect(html).toContain(clk(s2.rows[0].cutoff!, 1800000))
    expect(html).not.toContain(`<td>${clk(s2.rows[0].cutoff!, 0)}</td>`)
    // Colonne Réel / estimé : heures estimées d'après la montre, sans saisie du mode course.
    expect(html).toMatch(/~\d{2}:\d{2}/)
  })

  it('relevé d’une autre activité : ignoré (avant l’envoi à la montre, ou au-delà de l’arrivée)', () => {
    const s = Math.round(Date.parse(snap.start) / 1000)
    const report = { t: s + 3600, s, d: 8000 }
    const live = renderToStaticMarkup(<ShareView snap={snap} report={report} nowMs={(s + 3700) * 1000} />)
    expect(live).toContain('done-area')
    // Course envoyée à la montre après ce relevé : relevé de l'activité précédente.
    const sent = { ...snap, watchSince: new Date((s + 3650) * 1000).toISOString() }
    const html = renderToStaticMarkup(<ShareView snap={sent} report={report} nowMs={(s + 3700) * 1000} />)
    expect(html).not.toContain('done-area')
    expect(html).not.toContain('mp-passed')
    // Distance au-delà de l'arrivée (autre parcours, plus long).
    const far = renderToStaticMarkup(<ShareView snap={snap} report={{ ...report, d: snap.totalDist + 5000 }} nowMs={(s + 3700) * 1000} />)
    expect(far).not.toContain('done-area')
  })

  it('tableau : icône du type de point, avance ou retard sur l’heure prévue', () => {
    const s = Math.round(Date.parse(snap.start) / 1000)
    const w = parseWatchPlan(snap.w)!
    // Passage au ravito A 12 min après l'heure prévue.
    const passA = s + w.cps[0].planned + 720
    const html = renderToStaticMarkup(<ShareView snap={snap} report={{ t: passA + 60, s, d: 5200, p: `0:${passA}` }} nowMs={(passA + 60) * 1000} />)
    expect(html).toContain('kind-icon kind-ravito')
    expect(html).toContain('kind-icon kind-finish')
    expect(html).toMatch(/class="delay late ">\+1[12] min</)
    // Points suivants : retard estimé (en italique).
    expect(html).toMatch(/class="delay late est">\+\d+ min</)
  })

  it('heure de passage à une distance quelconque : entre les deux points qui l’encadrent', () => {
    const start = '2026-07-01T06:00:00.000Z'
    const t0 = Date.parse(start)
    const rows = [
      { dist: 10000, planned: '2026-07-01T07:00:00.000Z', actual: '2026-07-01T07:10:00.000Z', eta: '2026-07-01T07:10:00.000Z' },
      { dist: 20000, planned: '2026-07-01T08:00:00.000Z', actual: null, eta: '2026-07-01T08:30:00.000Z' },
    ]
    // Mi-chemin entre départ et A (au prorata de la distance) : 06:35.
    expect(timeAtDist(rows, start, t0, 5000)).toBe(t0 + 35 * 60000)
    // Mi-chemin entre A (07:10 réel) et B (08:30 estimé) : 07:50.
    expect(timeAtDist(rows, start, t0, 15000)).toBe(t0 + 110 * 60000)
    // Courbe du plan : 3/4 du temps prévu entre A et B atteint au km 15 (montée).
    expect(timeAtDist(rows, start, t0, 15000, () => 3600 + 2700)).toBe(t0 + 130 * 60000)
    // Au-delà du dernier point : son heure.
    expect(timeAtDist(rows, start, t0, 25000)).toBe(Date.parse(rows[1].eta))
  })

  it('ravito : coureur sur place encadré, puis temps réel passé une fois reparti', () => {
    const s = Math.round(Date.parse(snap.start) / 1000)
    const w = parseWatchPlan(snap.w)!
    const passA = s + w.cps[0].planned
    // 7 min après l'arrivée au ravito A (km 5), position 50 m après le point, pas encore reparti.
    const at = renderToStaticMarkup(<ShareView snap={snap} report={{ t: passA + 400, s, d: 5050, p: `0:${passA}` }} nowMs={(passA + 420) * 1000} />)
    expect(at).toMatch(/class="[^"]*at-ravito/)
    expect(at).toContain('Au ravito depuis 7 min · arrêt prévu 3 min')
    expect(at).toMatch(/Au ravito : <strong>Ravito A<\/strong> depuis 7 min/)
    expect(at).toContain('class="at-halo"')
    expect(at).toMatch(/class="mp-pt[^"]*mp-at"/)
    // Reparti après 8 min (départ noté par la montre) : arrêt réel et écart au prévu.
    const left = renderToStaticMarkup(<ShareView snap={snap} report={{ t: passA + 900, s, d: 6000, p: `0:${passA}:${passA + 480}` }} nowMs={(passA + 900) * 1000} />)
    expect(left).not.toMatch(/class="[^"]*at-ravito/)
    expect(left).not.toContain('at-halo')
    expect(left).toMatch(/Arrêt 8 min<span class="late"> \(prévu 3 min, \+5\)/)
    // Ancienne montre (sans départ) déjà loin : plus au ravito, arrêt prévu seulement.
    const old = renderToStaticMarkup(<ShareView snap={snap} report={{ t: passA + 900, s, d: 6000, p: `0:${passA}` }} nowMs={(passA + 900) * 1000} />)
    expect(old).not.toMatch(/class="[^"]*at-ravito/)
    expect(old).toContain('Arrêt prévu 3 min')
  })

  it('mode course sans montre : au ravito jusqu’au bouton « Reparti », puis temps réel', () => {
    const passA = Date.parse(snap.rows[0].planned)
    const live = { startedAt: snap.start, lastUpdate: null }
    const at = { ...snap, live, rows: snap.rows.map((r, i) => (i === 0 ? { ...r, actual: new Date(passA).toISOString() } : r)) }
    const html = renderToStaticMarkup(<ShareView snap={at} report={null} nowMs={passA + 5 * 60000} />)
    expect(html).toMatch(/class="[^"]*at-ravito/)
    // 5 min sur place pour 3 min prévues : chrono en orange.
    expect(html).toMatch(/class="stop-info at over">Au ravito depuis 5 min · arrêt prévu 3 min/)
    // Reparti (snapshot du mode course) : temps réel passé.
    const left = { ...at, rows: at.rows.map((r, i) => (i === 0 ? { ...r, left: new Date(passA + 4 * 60000).toISOString() } : r)) }
    const h2 = renderToStaticMarkup(<ShareView snap={left} report={null} nowMs={passA + 10 * 60000} />)
    expect(h2).not.toMatch(/class="[^"]*at-ravito/)
    expect(h2).toMatch(/Arrêt 4 min<span class="late"> \(prévu 3 min, \+1\)/)
  })

  it('base de vie : reparti à 300 m (montre), 150 m pour un ravito', () => {
    const base = { ...snap, rows: snap.rows.map((r, i) => (i === 0 ? { ...r, kind: 'base' } : r)) }
    const s = Math.round(Date.parse(snap.start) / 1000)
    const w = parseWatchPlan(snap.w)!
    const passA = s + w.cps[0].planned
    const report = { t: passA + 300, s, d: w.cps[0].dist + 220, p: `0:${passA}` }
    expect(renderToStaticMarkup(<ShareView snap={base} report={report} nowMs={(passA + 300) * 1000} />)).toMatch(/class="[^"]*at-ravito/)
    expect(renderToStaticMarkup(<ShareView snap={snap} report={report} nowMs={(passA + 300) * 1000} />)).not.toMatch(/class="[^"]*at-ravito/)
  })

  it('relevé trop ancien : ignoré', () => {
    const s = Math.round(Date.parse(snap.start) / 1000)
    const html = renderToStaticMarkup(<ShareView snap={snap} report={{ t: s + 600, s, d: 2000 }} nowMs={(s + 600 + 4 * 3600) * 1000} />)
    expect(html).not.toContain('Montre · en course depuis')
  })

  it('lien arrêté 1 h après l’arrivée relevée par la montre (même relevé ancien)', () => {
    const w = parseWatchPlan(snap.w)!
    const s = Math.round(Date.parse(snap.start) / 1000)
    const fin = w.cps.length - 1
    const arr = s + Math.round(w.cps[fin].planned * 0.9)
    const report = { t: arr + 60, s, d: snap.totalDist, p: `0:${s + 1500},1:${s + 3000},${fin}:${arr}` }
    const open = renderToStaticMarkup(<ShareView snap={snap} report={report} nowMs={(arr + 50 * 60) * 1000} />)
    expect(open).not.toContain('Suivi terminé')
    expect(open).toContain('Montre · en course depuis')
    const closed = renderToStaticMarkup(<ShareView snap={snap} report={report} nowMs={(arr + 61 * 60) * 1000} />)
    expect(closed).toContain('Suivi terminé')
    expect(closed).toContain('Lionel : arrivée à')
    expect(closed).toContain(`en ${formatDuration(arr - s)}`)
    expect(closed).toMatch(/1 h après l(&#x27;|')arrivée/)
    // Plus de position ni de carte, de profil ou de temps de passage.
    expect(closed).not.toContain('assist-profile')
    expect(closed).not.toContain('Ravito A')
    // Relevé devenu ancien (plus de suivi en direct) : toujours arrêté.
    expect(renderToStaticMarkup(<ShareView snap={snap} report={report} nowMs={(arr + 5 * 3600) * 1000} />)).toContain('Suivi terminé')
  })

  it('lien arrêté 1 h après l’arrivée notée en mode course', () => {
    const startedAt = snap.start
    const arr = new Date(Date.parse(startedAt) + 2 * 3600000).toISOString()
    const live = {
      ...snap,
      live: { startedAt, lastUpdate: arr },
      rows: snap.rows.map((r, i) => (i === snap.rows.length - 1 ? { ...r, actual: arr } : r)),
    }
    expect(renderToStaticMarkup(<ShareView snap={live} report={null} nowMs={Date.parse(arr) + 30 * 60000} />)).not.toContain('Suivi terminé')
    const closed = renderToStaticMarkup(<ShareView snap={live} report={null} nowMs={Date.parse(arr) + 61 * 60000} />)
    expect(closed).toContain('Suivi terminé')
    expect(closed).toContain('en 2h00')
  })

  it('sans arrivée connue : arrêté 1 h après la fin prévue (barrière de l’arrivée comprise)', () => {
    const fin = snap.rows[snap.rows.length - 1]
    const end = Math.max(Date.parse(fin.eta), fin.late ? Date.parse(fin.late) : 0)
    expect(renderToStaticMarkup(<ShareView snap={snap} report={null} nowMs={end + 59 * 60000} />)).not.toContain('Suivi terminé')
    const closed = renderToStaticMarkup(<ShareView snap={snap} report={null} nowMs={end + 61 * 60000} />)
    expect(closed).toContain('Suivi terminé')
    expect(closed).toContain('1 h après la fin prévue de la course')
    // Barrière horaire de l'arrivée plus tardive : le lien reste ouvert jusqu'à elle + 1 h.
    const cut = new Date(end + 3 * 3600000).toISOString()
    const withCut = { ...snap, rows: snap.rows.map((r, i) => (i === snap.rows.length - 1 ? { ...r, cutoff: cut } : r)) }
    expect(renderToStaticMarkup(<ShareView snap={withCut} report={null} nowMs={end + 2 * 3600000} />)).not.toContain('Suivi terminé')
    expect(renderToStaticMarkup(<ShareView snap={withCut} report={null} nowMs={end + 4 * 3600000 + 60000} />)).toContain('Suivi terminé')
  })
})
