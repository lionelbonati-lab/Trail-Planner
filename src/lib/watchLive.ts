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
  /** Passages : « indice:instant Unix » (« indice:arrivée:départ » pour un ravito quitté) séparés par des virgules. */
  p?: string
  /**
   * Version du relevé (1) ; 2 : sortie libre, rien sur la montre (voir freeRun.ts) ; l'appli montre Trail
   * Planner Companion y met l'id du parcours choisi dans sa liste quand ce n'est pas la course envoyée à la
   * montre (voir reportCourse).
   */
  v?: number | string
}

/**
 * Course enregistrée par la montre : l'id du parcours choisi dans l'appli montre, ou null pour la course
 * envoyée à la montre (champ Trail Planner, appli sur cette course).
 */
export function reportCourse(report: WatchReport | null): string | null {
  return report && typeof report.v === 'string' && report.v ? report.v : null
}

export interface WatchPlan {
  total: number
  curve: [number, number][]
  /** base : base de vie (9e champ « b »), départ noté plus loin qu'à un ravito. */
  cps: { dist: number; planned: number; stop: number; name: string; base?: boolean }[]
}

export function parseWatchPlan(text: string): WatchPlan | null {
  const lines = text.split('\n')
  if (lines[0] !== 'TP1') return null
  const plan: WatchPlan = { total: 0, curve: [], cps: [] }
  for (const line of lines.slice(1)) {
    const p = line.split('|')
    if (p[0] === 'S') plan.total = Number(p[2])
    else if (p[0] === 'K') plan.curve = p[1].split(',').map((x) => x.split(':').map(Number) as [number, number])
    else if (p[0] === 'C') plan.cps.push({ dist: Number(p[1]), planned: Number(p[2]), stop: Number(p[6] ?? 0), name: p[5], ...(p[8] === 'b' ? { base: true } : {}) })
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

/** Départs des ravitos notés par la montre (troisième valeur d'un passage) : indice -> instant. */
export function parseDepartures(p: string | undefined): Map<number, number> {
  const out = new Map<number, number>()
  for (const part of (p ?? '').split(',')) {
    const [i, , t] = part.split(':').map(Number)
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
  /** Départs des ravitos (s Unix), pour les points passés seulement. */
  departed: Map<number, number>
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

/** Relevé plus ancien : on ne sait plus si le coureur est encore au ravito (s). */
export const AT_STOP_FRESH_S = 20 * 60

/** Au-delà, un passage noté devant la position du coureur est ignoré (m). */
export const PASS_AHEAD_M = 300

/** Temps d'arrêt prévus aux points situés strictement entre `from` et `to` (m). */
function stopsBetween(plan: WatchPlan, from: number, to: number): number {
  return plan.cps.reduce((a, cp) => a + (cp.dist > from && cp.dist < to ? cp.stop : 0), 0)
}

/** Temps de déplacement prévu jusqu'à d (s), sans les arrêts. */
function movingAt(plan: WatchPlan, d: number): number {
  return plannedAtWatch(plan, d) - plan.cps.reduce((a, cp) => a + (cp.dist < d ? cp.stop : 0), 0)
}

/**
 * État du coureur d'après le relevé de la montre. Écart au plan : à la position du relevé. Heures
 * estimées recalculées à chaque relevé : à partir de la position et de l'heure du relevé (ou du
 * dernier passage s'il est plus récent), rythme réel jusque-là (amorti et borné) appliqué à la
 * suite, arrêts prévus non étirés. Un point pas encore passé n'est jamais estimé avant maintenant :
 * si le prochain est « en retard » sur son estimation, toute la suite est décalée d'autant.
 */
export function watchStatus(report: WatchReport, plan: WatchPlan, nowSec: number): WatchStatus {
  const elapsed = report.t - report.s
  const planned = plannedAtWatch(plan, report.d)
  // Passage noté pour un point encore loin devant la position du relevé (tour Lap pris pour un
  // passage, distance sans tracé GPS qui dérive…) : pas crédible, ignoré.
  const passed = new Map([...parsePasses(report.p)].filter(([i]) => i < plan.cps.length && plan.cps[i].dist <= report.d + PASS_AHEAD_M))
  const ref = [...passed.keys()].reduce((a, i) => Math.max(a, i), -1)
  const departed = new Map([...parseDepartures(report.p)].filter(([i, t]) => passed.has(i) && t >= passed.get(i)!))
  // Point d'ancrage des estimations : départ, dernier passage (arrêt compris) ou relevé plus récent.
  let ratio = 1
  let t0 = report.s
  let d0 = 0
  // Encore au ravito (arrêt prévu ou base de vie, pas de départ noté, position à moins de 150 m après,
  // 300 m après une base de vie, relevé de moins de 20 min) : départ estimé à la fin de l'arrêt prévu,
  // et jamais avant maintenant (un arrêt qui s'allonge décale toute la suite).
  let atStop = false
  if (ref >= 0) {
    const cp = plan.cps[ref]
    ratio = ratioOf(passed.get(ref)! - report.s, cp.planned)
    atStop = (cp.stop > 0 || !!cp.base) && !departed.has(ref) && report.d < cp.dist + (cp.base ? 300 : 150) && nowSec - report.t < AT_STOP_FRESH_S
    // Départ réel du ravito s'il est noté, sinon arrivée + arrêt prévu.
    t0 = departed.get(ref) ?? passed.get(ref)! + cp.stop
    if (atStop) t0 = Math.max(t0, nowSec)
    d0 = cp.dist
  }
  if (!atStop && report.d > 200 && report.d > d0 + 100 && report.t >= t0 && report.d < plan.total) {
    ratio = ratioOf(elapsed, planned)
    t0 = report.t
    d0 = report.d
  }
  const eta = (d: number) => t0 + Math.max(0, movingAt(plan, d) - movingAt(plan, d0)) * ratio + stopsBetween(plan, d0, d)
  const raw = plan.cps.map((cp, i) => passed.get(i) ?? (i > ref ? eta(cp.dist) : report.s + cp.planned))
  let finishEta = eta(plan.total)
  // Pas encore passé au prochain point alors que son heure estimée est dépassée : on décale la suite.
  const nextI = raw.findIndex((_, i) => i > ref && !passed.has(i))
  const lag = nextI >= 0 ? Math.max(0, nowSec - raw[nextI]) : 0
  const etas = raw.map((e, i) => (i > ref && !passed.has(i) ? e + lag : e))
  if (report.d < plan.total) finishEta = Math.max(finishEta + lag, nowSec)
  return {
    age: nowSec - report.t,
    elapsed,
    dist: report.d,
    delta: report.d > 200 ? elapsed - planned : 0,
    etas,
    passed,
    departed,
    finishEta,
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


/** Sans relevé depuis ce délai, l'activité de l'appli montre est tenue pour finie (ms). */
export const APP_ACTIVITY_IDLE_MS = 2 * 3600_000

/** Activité d'un relevé finie : arrivée atteinte (à 300 m près) ou plus de relevé depuis 2 h. */
export function activityEnded(report: WatchReport, nowMs: number, totalDist?: number): boolean {
  if (totalDist !== undefined && totalDist > 0 && report.d >= totalDist - 300) return true
  return nowMs - report.t * 1000 > APP_ACTIVITY_IDLE_MS
}

/**
 * ⌚ d'un parcours lancé depuis l'appli montre (Trail Planner Companion) : il devient la course sur la
 * montre pendant son activité (adopt), et plus rien n'est sur la montre une fois l'activité finie (clear).
 * Un choix fait à la main sur le web (⌚ mis ou retiré) depuis le départ de l'activité reste prioritaire.
 */
export function appWatchAction(
  athlete: { watchId?: string; watchRaceId?: string; watchRaceAt?: string; watchRaceApp?: boolean },
  report: WatchReport | null,
  nowMs: number,
  known: (id: string) => boolean,
  totalOf: (id: string) => number | undefined,
): { adopt: string } | { clear: true } | null {
  if (!report || !athlete.watchId) return null
  const id = reportCourse(report)
  // Parcours mis sur la montre par l'appli : retiré à la fin de son activité.
  if (athlete.watchRaceApp && athlete.watchRaceId && (id === null || id === athlete.watchRaceId)) {
    return activityEnded(report, nowMs, totalOf(athlete.watchRaceId)) ? { clear: true } : null
  }
  if (!id || id === athlete.watchRaceId || !known(id)) return null
  if (athlete.watchRaceAt && report.s * 1000 < Date.parse(athlete.watchRaceAt)) return null
  if (activityEnded(report, nowMs, totalOf(id))) return null
  return { adopt: id }
}
