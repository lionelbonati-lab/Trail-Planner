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

/** Rythme réel par rapport au plan (> 1 : plus lent), amorti et borné. */
function ratioOf(actual: number, planned: number): number {
  const raw = planned > 600 ? Math.min(1.6, Math.max(0.7, actual / planned)) : 1
  return 1 + DAMPING * (raw - 1)
}

/** Rythme réel à la position du relevé (position estimée entre deux relevés). */
function paceRatio(report: WatchReport, planned: number): number {
  return ratioOf(report.t - report.s, planned)
}

/**
 * État du coureur d'après le relevé de la montre. Écart au plan : à la position du relevé. Heures
 * estimées (comme sur la montre) : recalculées à chaque passage d'après ce qui a déjà été fait — rythme
 * réel au dernier point passé (amorti et borné) appliqué à la suite, arrêts prévus non étirés — et fixes
 * entre deux passages ; avant le premier passage, heures prévues.
 */
export function watchStatus(report: WatchReport, plan: WatchPlan, nowSec: number): WatchStatus {
  const elapsed = report.t - report.s
  const planned = plannedAtWatch(plan, report.d)
  const passed = parsePasses(report.p)
  const ref = [...passed.keys()].filter((i) => i < plan.cps.length).reduce((a, i) => Math.max(a, i), -1)
  let ratio = 1
  let t0 = report.s
  let base = 0
  if (ref >= 0) {
    const cp = plan.cps[ref]
    ratio = ratioOf(passed.get(ref)! - report.s, cp.planned)
    t0 = passed.get(ref)! + cp.stop
    base = cp.planned + cp.stop
  }
  const eta = (plannedTime: number) => t0 + Math.max(0, plannedTime - base) * ratio
  const finish = plan.curve[plan.curve.length - 1][1] + plan.cps.reduce((a, cp) => a + (cp.dist < plan.total ? cp.stop : 0), 0)
  return {
    age: nowSec - report.t,
    elapsed,
    dist: report.d,
    delta: report.d > 200 ? elapsed - planned : 0,
    etas: plan.cps.map((cp, i) => passed.get(i) ?? (i > ref ? eta(cp.planned) : report.s + cp.planned)),
    passed,
    finishEta: eta(finish),
  }
}

/** Relevé de moins de 12 h : il appartient à l'activité en cours (même sans réseau depuis un moment). */
export const ACTIVITY_REPORT_S = 12 * 3600

/**
 * Départ réel de l'activité en cours donné par la montre (ms), ou null : base fixe des heures prévues
 * en départ libre pendant toute l'activité.
 */
export function watchStartMs(report: WatchReport | null, nowSec: number): number | null {
  return report && report.s > 0 && nowSec - report.t < ACTIVITY_REPORT_S ? report.s * 1000 : null
}

/** Au-delà de ce délai sans relevé, on n'estime plus la position (s). */
export const ESTIMATE_MAX_S = 3600

/**
 * Distance estimée maintenant, entre deux relevés (la montre n'en envoie qu'un toutes les 5 min
 * au mieux) : on avance le long du plan au rythme mesuré, arrêts aux ravitos compris (le temps
 * d'arrêt prévu s'écoule au point). Null si le dernier relevé date de plus d'une heure.
 */
export function estimatedDist(report: WatchReport, plan: WatchPlan, nowSec: number): number | null {
  const since = nowSec - report.t
  if (since > ESTIMATE_MAX_S) return null
  if (since <= 0 || report.d >= plan.total) return Math.min(report.d, plan.total)
  const planned = plannedAtWatch(plan, report.d)
  const target = planned + since / paceRatio(report, planned)
  let lo = report.d
  let hi = plan.total
  if (plannedAtWatch(plan, hi) <= target) return hi
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (plannedAtWatch(plan, mid) < target) lo = mid
    else hi = mid
  }
  return lo
}

