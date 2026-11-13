// Évolution des valeurs du profil au fil des tests et des séances d'étalonnage.
import { csFromTrials } from './sessions'
import type { Athlete } from './types'

export interface ProgressPoint {
  /** Date (ms). */
  t: number
  value: number
  source: string
  detail?: string
}

export interface ProgressSeries {
  key: 'cs' | 'vam' | 'durability' | 'descent'
  title: string
  unit: string
  /** Plus haut = mieux ? */
  higherIsBetter: boolean
  format: (v: number) => string
  points: ProgressPoint[]
}

const byDate = (a: ProgressPoint, b: ProgressPoint) => a.t - b.t

/**
 * VC donnée par les tests 3′/7′/12′ au fil du temps : à chaque test, VC calculée avec les tests
 * connus à cette date (le plus récent de chaque durée, sur 6 semaines), qu'elle ait été appliquée
 * au profil ou non. Un point par jour.
 */
function csFromTrialHistory(a: Athlete): ProgressPoint[] {
  const trials = [...a.csTrials].sort((x, y) => x.date.localeCompare(y.date))
  const byDay = new Map<string, ProgressPoint>()
  trials.forEach((t, i) => {
    const fit = csFromTrials(trials.slice(0, i + 1))
    if (!fit) return
    const day = t.date.slice(0, 10)
    byDay.set(day, {
      t: Date.parse(day),
      value: fit.cs * 3.6,
      source: 'Tests 3′/7′/12′',
      detail: fit.used.map((u) => `${Math.round(u.seconds / 60)}′ ${u.dist} m`).join(', '),
    })
  })
  return [...byDay.values()]
}

export function progressSeries(a: Athlete): ProgressSeries[] {
  const cs: ProgressPoint[] = [
    ...a.history.map((h) => ({ t: Date.parse(h.date), value: h.cs * 3.6, source: 'Calcul à la main' })),
    ...csFromTrialHistory(a),
  ]
  const vam: ProgressPoint[] = []
  const dur: ProgressPoint[] = []
  const descent: ProgressPoint[] = []
  for (const r of a.activities) {
    const m = r.metrics
    if (!m) continue
    const t = Date.parse(r.date)
    // Les tests VC sont déjà comptés par leurs essais (csTrials).
    if (m.cs && r.session !== 'csTest') cs.push({ t, value: m.cs * 3.6, source: r.name })
    if (m.vam) vam.push({ t, value: m.vam.vam, source: r.name, detail: `à ${m.vam.grade} %` })
    if (m.k !== undefined) dur.push({ t, value: m.k * 100, source: r.name })
    if (m.descent) descent.push({ t, value: m.descent.factor, source: r.name, detail: `à ${m.descent.grade} %` })
  }
  return [
    { key: 'cs', title: 'Vitesse critique', unit: 'km/h', higherIsBetter: true, format: (v) => `${v.toFixed(2)} km/h`, points: cs.sort(byDate) },
    { key: 'vam', title: 'Vitesse ascensionnelle (à ta VC)', unit: 'm/h', higherIsBetter: true, format: (v) => `${Math.round(v)} m/h`, points: vam.sort(byDate) },
    { key: 'durability', title: 'Durabilité (k, plus bas = mieux)', unit: '', higherIsBetter: false, format: (v) => `k ${v.toFixed(1)}`, points: dur.sort(byDate) },
    { key: 'descent', title: 'Coefficient de descente', unit: '×', higherIsBetter: true, format: (v) => `×${v.toFixed(2)}`, points: descent.sort(byDate) },
  ]
}
