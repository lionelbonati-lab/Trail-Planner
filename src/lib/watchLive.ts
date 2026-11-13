// Suivi envoyé par la montre (champ de données Garmin) : position le long du
// parcours, heures de passage réelles, batterie. Document Firestore live/{code montre}.
// Les heures estimées sont recalculées à partir du plan compact (format TP1, voir watch.ts),
// avec la même logique que le mode course de l'app (retard prolongé, amorti et borné).

export interface WatchReport {
  /** Instant du relevé (s Unix). */
  t: number
  /** Départ réel de l'activité (s Unix). */
  s: number
  /** Distance le long du parcours (m). */
  d: number
  lat?: number
  lon?: number
  /** Batterie de la montre (%). */
  bat?: number
  /** Passages : « indice:instant Unix » séparés par des virgules. */
  p?: string
}

export interface WatchPlan {
  total: number
  curve: [number, number][]
  cps: { dist: number; planned: number; stop: number; name: string }[]
}

export function parseWatchPlan(text: string): WatchPlan | null {
  const lines = text.split('\n')
  if (lines[0] !== 'TP1') return null
  const plan: WatchPlan = { total: 0, curve: [], cps: [] }
  for (const line of lines.slice(1)) {
    const p = line.split('|')
    if (p[0] === 'S') plan.total = Number(p[2])
    else if (p[0] === 'K') plan.curve = p[1].split(',').map((x) => x.split(':').map(Number) as [number, number])
    else if (p[0] === 'C') plan.cps.push({ dist: Number(p[1]), planned: Number(p[2]), stop: Number(p[6] ?? 0), name: p[5] })
  }
  return plan.curve.length >= 2 ? plan : null
}

/** Temps prévu (s) à la distance d : courbe interpolée + arrêts déjà faits (identique à Plan.mc). */
export function plannedAtWatch(plan: WatchPlan, d: number): number {
  const c = plan.curve
  let i = c.findIndex((x) => x[0] >= d)
  if (i <= 0) i = i === 0 ? 1 : c.length - 1
  const [d0, t0] = c[i - 1]
  const [d1, t1] = c[i]
  const f = Math.max(0, Math.min(1, d1 > d0 ? (d - d0) / (d1 - d0) : 0))
  const stops = plan.cps.reduce((a, cp) => a + (cp.dist < d ? cp.stop : 0), 0)
  return t0 + f * (t1 - t0) + stops
}

export function parsePasses(p: string | undefined): Map<number, number> {
  const out = new Map<number, number>()
  for (const part of (p ?? '').split(',')) {
    const [i, t] = part.split(':').map(Number)
    if (Number.isFinite(i) && Number.isFinite(t) && t > 0) out.set(i, t)
  }
  return out
}

export interface WatchStatus {
  /** Ancienneté du relevé (s). */
  age: number
  elapsed: number
  dist: number
  /** Avance (−) ou retard (+) sur le plan à cette position (s). */
  delta: number
  /** Heure estimée (s Unix) par point ; passage réel si connu. */
  etas: number[]
  passed: Map<number, number>
  finishEta: number
}

const DAMPING = 0.7

export function watchStatus(report: WatchReport, plan: WatchPlan, nowSec: number): WatchStatus {
  const elapsed = report.t - report.s
  const planned = plannedAtWatch(plan, report.d)
  const raw = planned > 600 ? Math.min(1.6, Math.max(0.7, elapsed / planned)) : 1
  const ratio = 1 + DAMPING * (raw - 1)
  const passed = parsePasses(report.p)
  const eta = (plannedTime: number) => report.t + Math.max(0, plannedTime - planned) * ratio
  const finish = plan.curve[plan.curve.length - 1][1] + plan.cps.reduce((a, cp) => a + (cp.dist < plan.total ? cp.stop : 0), 0)
  return {
    age: nowSec - report.t,
    elapsed,
    dist: report.d,
    delta: report.d > 200 ? elapsed - planned : 0,
    etas: plan.cps.map((cp, i) => passed.get(i) ?? eta(cp.planned)),
    passed,
    finishEta: eta(finish),
  }
}
