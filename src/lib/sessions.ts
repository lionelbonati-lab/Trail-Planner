// Séances d'étalonnage : déroulé (cibles tirées du profil), export en entraînement
// Garmin, et analyse dédiée de l'enregistrement pour mettre le profil à jour.
import { analyzeActivity, calibrateOnActivity, timesAt, type Activity } from './activity'
import { computeCs } from './cs'
import { DEFAULT_ENV, DEFAULT_ZONES } from './defaults'
import { autoTech, interp } from './model'
import { peaksAndValleys } from './splits'
import { formatDuration, formatPace } from './time'
import { stepHrRange } from './zones'
import type { ActivityRecord, Athlete, CsTrial, DescentPoint, SessionMetrics, VamPoint } from './types'

export type SessionKey = 'long' | 'hillTempo' | 'hillTest' | 'flatTest' | 'csTest' | 'descents'

export type StepKind = 'warmup' | 'active' | 'recovery' | 'rest' | 'cooldown'

export interface SimpleStep {
  kind: StepKind
  name: string
  /** Durée (s), ou null = jusqu'à l'appui sur « Lap » (sauf si `meters` est donné). */
  seconds: number | null
  /** Distance (m) : prioritaire sur la durée. */
  meters?: number
  /** Fourchette de vitesse (m/s), ou rien = cible libre. */
  speed?: [number, number]
  /**
   * Zones VC visées (numéros 1…, bornes incluses), pour la cible cardiaque ; « max » = effort à
   * fond, sans cible. À défaut, déduites de la vitesse.
   */
  zones?: [number, number] | 'max'
  notes?: string
}

export interface RepeatStep {
  repeat: number
  steps: SimpleStep[]
}

export type Step = SimpleStep | RepeatStep

export const isRepeat = (s: Step): s is RepeatStep => 'repeat' in s

export interface SessionResult {
  /** Résumé lisible. */
  lines: string[]
  metrics: SessionMetrics
  /** Profil mis à jour proposé, et description des changements. */
  athlete: Athlete
  changes: string[]
  record: ActivityRecord
  /** Toujours conservé, même sans appliquer la mise à jour (ex. résultat d'un test VC). */
  persist?: Partial<Athlete>
}

/** Variante d'une séance (ex. test VC de 3, 7 ou 12 min). */
export interface SessionVariant {
  key: string
  label: string
  seconds: number
}

export interface SessionDef {
  key: SessionKey
  title: string
  measures: string
  terrain: string
  tips: string[]
  variants?: SessionVariant[]
  steps: (a: Athlete, variant?: SessionVariant) => Step[]
  analyze: (act: Activity, a: Athlete, variant?: SessionVariant) => SessionResult
}

const MIN = 60
const TEMPO = 0.88 // intensité visée en navettes tempo (fraction de VC)
const DESCENT_INTENSITY = 0.9 // intensité « soutenue » en descente

const pace = (mps: number) => `${formatPace(1000 / mps)}/km`

/** Fourchette de vitesse (m/s) d'une zone d'entraînement du profil (numéro 1…). */
export function zoneSpeed(a: Athlete, zone: number): [number, number] {
  const list = a.zones?.length ? a.zones : DEFAULT_ZONES
  const z = list[Math.max(1, Math.min(zone, list.length)) - 1]
  return [a.cs * z.low, a.cs * z.high]
}

/** Échauffement de l'entraîneur (séances de test) : zones 1-2, gammes, 3 accélérations. */
export function coachWarmup(a: Athlete): Step[] {
  return [
    { kind: 'warmup', name: 'Échauffement Z1', seconds: 10 * MIN, speed: zoneSpeed(a, 1), notes: 'Facile 2/10' },
    { kind: 'warmup', name: 'Échauffement Z2', seconds: 10 * MIN, speed: zoneSpeed(a, 2), notes: 'Modéré 4/10' },
    { kind: 'warmup', name: 'Gammes Z1', seconds: 5 * MIN, speed: zoneSpeed(a, 1), notes: 'Montées de genoux, talons-fesses, jambes tendues, foulées bondissantes' },
    {
      repeat: 3,
      steps: [
        { kind: 'warmup', name: 'Accélération Z5', seconds: 25, speed: zoneSpeed(a, 5) },
        { kind: 'recovery', name: 'Récupération Z1', seconds: 35, speed: zoneSpeed(a, 1) },
      ],
    },
    { kind: 'warmup', name: 'Échauffement Z1', seconds: 2 * MIN, speed: zoneSpeed(a, 1) },
  ]
}

/** Intensité d'un effort maximal de `seconds` (fraction de VC), d'après VC et D′. */
export function allOutIntensity(a: Athlete, seconds: number): number {
  return (a.cs + a.dPrime / seconds) / a.cs
}

/** VAM visée à une intensité donnée, pour une pente « typique » de 15 %. */
function vamAt(a: Athlete, intensity: number, grade = 15): number {
  return Math.round(interp(a.vam, grade, (p) => p.grade, (p) => p.vam) * intensity)
}

const techFactor = (grade: number) => DEFAULT_ENV.tech.factors[autoTech(grade) - 1] ?? 1

/** Remplace dans une table les points proches (±4 %) par la nouvelle mesure. */
function mergePoint<T extends { grade: number }>(table: T[], point: T): T[] {
  return [...table.filter((p) => Math.abs(p.grade - point.grade) > 4), point].sort((x, y) => x.grade - y.grade)
}

interface Series {
  d: number[]
  e: number[]
  t: number[]
}

function series(act: Activity): Series {
  const pts = act.track.points
  return { d: pts.map((p) => p.dist), e: pts.map((p) => p.ele), t: pts.map((p) => timesAt(act, p.dist).elapsed) }
}

export interface Window {
  /** Vitesse horizontale (m/s) ou VAM (m/h) selon le mode. */
  value: number
  from: number
  dist: number
  dz: number
  dt: number
  grade: number
}

/** Meilleure fenêtre d'au moins `seconds` (vitesse ou VAM), sur une pente acceptée. */
export function bestWindow(act: Activity, seconds: number, mode: 'speed' | 'vam', accept: (grade: number) => boolean): Window | null {
  const { d, e, t } = series(act)
  let best: Window | null = null
  let j = 0
  for (let i = 0; i < d.length; i++) {
    if (j < i) j = i
    while (j < d.length && t[j] - t[i] < seconds) j++
    if (j >= d.length) break
    const dt = t[j] - t[i]
    const dd = d[j] - d[i]
    const dz = e[j] - e[i]
    const grade = dd > 0 ? (dz / dd) * 100 : 0
    if (!accept(grade)) continue
    const value = mode === 'speed' ? dd / dt : (dz / dt) * 3600
    if (!best || value > best.value) best = { value, from: d[i], dist: dd, dz, dt, grade }
  }
  return best
}

export interface Leg {
  from: number
  to: number
  dz: number
  dt: number
  grade: number
}

/** Montées et descentes successives (entre sommets et points bas d'au moins `prominence` m),
 * débarrassées des portions plates à leurs extrémités (échauffement, replat). */
export function legs(act: Activity, prominence = 30): Leg[] {
  const pts = act.track.points
  const marks = [0, ...peaksAndValleys(act.track, prominence).map((p) => p.dist), act.track.totalDist]
  const idx = (d: number) => Math.min(pts.length - 1, Math.max(0, Math.round(d / 20)))
  const out: Leg[] = []
  for (let i = 1; i < marks.length; i++) {
    let ia = idx(marks[i - 1])
    let ib = idx(marks[i])
    if (ib <= ia) continue
    const e0 = pts[ia].ele
    const e1 = pts[ib].ele
    const up = e1 > e0
    // Début : dernier point encore au niveau de départ ; fin : premier point au niveau d'arrivée.
    while (ia < ib - 1 && (up ? pts[ia + 1].ele <= e0 + 3 : pts[ia + 1].ele >= e0 - 3)) ia++
    while (ib > ia + 1 && (up ? pts[ib - 1].ele >= e1 - 3 : pts[ib - 1].ele <= e1 + 3)) ib--
    const a = pts[ia].dist
    const b = pts[ib].dist
    const dz = pts[ib].ele - pts[ia].ele
    const dt = timesAt(act, b).moving - timesAt(act, a).moving
    if (b > a && dt > 0) out.push({ from: a, to: b, dz, dt, grade: (dz / (b - a)) * 100 })
  }
  return out
}

function baseRecord(act: Activity, a: Athlete, key: SessionKey, metrics: SessionMetrics, calibrate: boolean): ActivityRecord {
  const rec = analyzeActivity(act, a, DEFAULT_ENV).record
  return { ...rec, name: `${SESSIONS_BY_KEY[key].title} · ${rec.name}`, session: key, metrics, useForCalibration: calibrate }
}

/**
 * Distance de l'effort de `seconds` : tour de la montre de cette durée (étape
 * « Corps de séance »), sinon meilleure fenêtre sur le plat ramenée à la durée exacte.
 */
export function effortDistance(act: Activity, seconds: number): { dist: number; source: 'lap' | 'gps' } | null {
  const tol = Math.max(3, seconds * 0.02)
  const lap = act.laps.filter((l) => Math.abs(l.timer - seconds) <= tol && l.distance > 0).sort((x, y) => y.distance - x.distance)[0]
  if (lap) return { dist: (lap.distance * seconds) / lap.timer, source: 'lap' }
  const w = bestWindow(act, seconds, 'speed', (g) => Math.abs(g) < 3)
  return w ? { dist: (w.dist * seconds) / w.dt, source: 'gps' } : null
}

/** VC et D′ à partir des tests récents : le plus récent de chaque durée, sur 6 semaines au plus. */
export function csFromTrials(trials: CsTrial[]): { cs: number; dPrime: number; r2: number | null; used: CsTrial[] } | null {
  const sorted = [...trials].sort((x, y) => y.date.localeCompare(x.date))
  if (!sorted.length) return null
  const newest = Date.parse(sorted[0].date)
  const used: CsTrial[] = []
  for (const t of sorted) {
    if (newest - Date.parse(t.date) > 42 * 86400000) continue
    if (!used.some((u) => u.seconds === t.seconds)) used.push(t)
  }
  if (used.length < 2) return null
  const r = computeCs(used.map((t) => ({ dist: t.dist, time: t.seconds })))
  if (!r || r.cs <= 0) return null
  return { cs: r.cs, dPrime: Math.max(0, r.dPrime), r2: used.length > 2 ? r.r2 : null, used: used.sort((x, y) => x.seconds - y.seconds) }
}

// --- Catalogue -----------------------------------------------------------------

export const SESSIONS: SessionDef[] = [
  {
    key: 'long',
    title: 'Sortie longue en endurance',
    measures: 'Durabilité (baisse de l’intensité au fil des heures), vitesse ascensionnelle et descente en endurance.',
    terrain: 'Parcours vallonné, idéalement proche de ta course cible. 2 h 30 à 3 h 30.',
    tips: ['Allure facile et régulière, sans chercher la performance.', 'Évite les longs arrêts : ils faussent la mesure de la durabilité.'],
    steps: (a) => [
      { kind: 'warmup', name: 'Échauffement Z1', seconds: 15 * MIN, speed: zoneSpeed(a, 1) },
      { kind: 'active', name: 'Endurance', seconds: 150 * MIN, zones: [2, 2], notes: 'Allure facile (conversation). Montées raides en marchant.' },
      { kind: 'cooldown', name: 'Retour au calme', seconds: null },
    ],
    analyze: (act, a) => {
      const rec = analyzeActivity(act, a, DEFAULT_ENV).record
      const cal = calibrateOnActivity(a, [rec], act, rec, DEFAULT_ENV)
      const d = cal.athlete.durability
      const metrics: SessionMetrics = d.mode === 'log' ? { k: d.k, pct1h: d.pct1h } : { lossPerH: d.lossPerH }
      const up = rec.grades.filter((g) => g.lo >= 10).sort((x, y) => y.dist - x.dist)[0]
      if (up && up.dist >= 400) metrics.vam = { grade: Math.round((up.dz / up.dist) * 1000) / 10, vam: Math.round(up.normalized) }
      const down = rec.grades.find((g) => g.lo === -13 && g.dist >= 400)
      if (down) metrics.descent = { grade: Math.round((down.dz / down.dist) * 1000) / 10, factor: Math.round(down.normalized * 100) / 100 }
      return {
        lines: [
          `${(rec.dist / 1000).toFixed(1)} km, +${Math.round(rec.dPlus)} m en ${formatDuration(rec.elapsed)} (${formatDuration(rec.moving)} en mouvement).`,
          `Prévu par ton profil actuel : ${formatDuration(rec.predicted)}.`,
        ],
        metrics,
        athlete: cal.athlete,
        changes: cal.changes,
        record: { ...baseRecord(act, a, 'long', metrics, true), grades: rec.grades, intensity: rec.intensity },
      }
    },
  },
  {
    key: 'hillTempo',
    title: 'Navettes tempo en côte',
    measures: 'Vitesse ascensionnelle à allure tempo (ramenée à ta VC) et régularité d’une répétition à l’autre.',
    terrain: 'Une côte régulière de 10 à 20 %, assez longue pour 10 min de montée.',
    tips: ['Tempo : effort soutenu mais contrôlé, tu pourrais tenir 1 h à 1 h 30.', 'Redescends en trottinant, puis appuie sur « Lap » pour la répétition suivante.'],
    steps: (a) => [
      { kind: 'warmup', name: 'Échauffement Z1-Z2', seconds: 20 * MIN, speed: [zoneSpeed(a, 1)[0], zoneSpeed(a, 2)[1]], zones: [1, 2] },
      {
        repeat: 5,
        steps: [
          { kind: 'active', name: 'Montée tempo', seconds: 10 * MIN, zones: [4, 4], notes: `VAM visée ≈ ${vamAt(a, TEMPO)} m/h à 15 %` },
          { kind: 'recovery', name: 'Descente au trot', seconds: null, notes: 'Appuie sur Lap en bas.' },
        ],
      },
      { kind: 'cooldown', name: 'Retour au calme', seconds: 10 * MIN },
    ],
    analyze: (act, a) => {
      const climbs = legs(act).filter((l) => l.dz > 40 && l.dt >= 4 * MIN && l.grade >= 6)
      if (!climbs.length) throw new Error('Aucune montée d’au moins 4 min trouvée dans cette activité.')
      const vams = climbs.map((l) => (l.dz / l.dt) * 3600)
      const dz = climbs.reduce((s, l) => s + l.dz, 0)
      const dist = climbs.reduce((s, l) => s + (l.to - l.from), 0)
      const grade = Math.round((dz / dist) * 1000) / 10
      const vamObs = dz / (climbs.reduce((s, l) => s + l.dt, 0) / 3600)
      const vamCs = Math.round(vamObs / (TEMPO * techFactor(grade)))
      const drift = vams.length > 1 ? vams[vams.length - 1] / vams[0] - 1 : 0
      const metrics: SessionMetrics = { vam: { grade, vam: vamCs } }
      return {
        lines: [
          `${climbs.length} montées, pente moyenne ${grade} % : ${vams.map((v) => Math.round(v)).join(' · ')} m/h.`,
          `VAM moyenne ${Math.round(vamObs)} m/h à allure tempo, soit ≈ ${vamCs} m/h à ta VC.`,
          vams.length > 1 ? `Dernière montée ${drift >= 0 ? '+' : ''}${Math.round(drift * 100)} % par rapport à la première.` : '',
        ].filter(Boolean),
        metrics,
        athlete: { ...a, vam: mergePoint<VamPoint>(a.vam, { grade, vam: vamCs }) },
        changes: [`Vitesse ascensionnelle à ${grade} % : ${Math.round(interp(a.vam, grade, (p) => p.grade, (p) => p.vam))} → ${vamCs} m/h (à intensité VC).`],
        record: baseRecord(act, a, 'hillTempo', metrics, false),
      }
    },
  },
  {
    key: 'hillTest',
    title: 'Seuil en côte (test 20 min)',
    measures: 'Vitesse ascensionnelle maximale sur 20 min, ramenée à ta VC grâce à ton D′.',
    terrain: 'Une montée régulière de 10 à 25 % d’au moins 20 min.',
    tips: ['Effort maximal mais régulier : la meilleure fenêtre de 20 min est retenue.', 'Course ou marche rapide, selon ce qui est le plus efficace pour toi.'],
    steps: (a) => [
      { kind: 'warmup', name: 'Échauffement Z1-Z2', seconds: 20 * MIN, speed: [zoneSpeed(a, 1)[0], zoneSpeed(a, 2)[1]], zones: [1, 2] },
      { kind: 'active', name: 'Montée à fond', seconds: 20 * MIN, zones: 'max', notes: `Repère : ≈ ${vamAt(a, allOutIntensity(a, 1200))} m/h à 15 %` },
      { kind: 'cooldown', name: 'Retour au calme', seconds: 15 * MIN },
    ],
    analyze: (act, a) => {
      const w = bestWindow(act, 1200, 'vam', (g) => g >= 5)
      if (!w) throw new Error('Aucune montée continue de 20 min trouvée.')
      const grade = Math.round(w.grade * 10) / 10
      const intensity = allOutIntensity(a, 1200)
      const vamCs = Math.round(w.value / (intensity * techFactor(grade)))
      const metrics: SessionMetrics = { vam: { grade, vam: vamCs } }
      return {
        lines: [
          `Meilleures 20 min : +${Math.round(w.dz)} m sur ${(w.dist / 1000).toFixed(2)} km (${grade} %), soit ${Math.round(w.value)} m/h.`,
          `Un effort de 20 min se tient à ≈ ${Math.round(intensity * 100)} % de ta VC : VAM à ta VC ≈ ${vamCs} m/h.`,
        ],
        metrics,
        athlete: { ...a, vam: mergePoint<VamPoint>(a.vam, { grade, vam: vamCs }) },
        changes: [`Vitesse ascensionnelle à ${grade} % : ${Math.round(interp(a.vam, grade, (p) => p.grade, (p) => p.vam))} → ${vamCs} m/h (à intensité VC).`],
        record: baseRecord(act, a, 'hillTest', metrics, false),
      }
    },
  },
  {
    key: 'flatTest',
    title: 'Seuil plat (test 20 min)',
    measures: 'Vitesse critique : vitesse moyenne sur 20 min à fond, moins la part apportée par le D′.',
    terrain: 'Plat et roulant : piste, route ou chemin stabilisé.',
    tips: ['Départ prudent, accélère dans les 5 dernières minutes.', 'La meilleure fenêtre de 20 min sur le plat est retenue.'],
    steps: (a) => {
      const v = a.cs + a.dPrime / 1200
      return [
        ...coachWarmup(a),
        { kind: 'active', name: '20 min à fond', seconds: 20 * MIN, speed: [v * 0.97, v * 1.03], zones: 'max', notes: `Repère : ${pace(v)}` },
        { kind: 'cooldown', name: 'Récupération Z1', seconds: 10 * MIN, speed: zoneSpeed(a, 1) },
      ]
    },
    analyze: (act, a) => {
      const w = bestWindow(act, 1200, 'speed', (g) => Math.abs(g) < 2.5)
      if (!w) throw new Error('Aucune portion plate de 20 min trouvée.')
      const cs = w.value - a.dPrime / 1200
      const metrics: SessionMetrics = { cs }
      return {
        lines: [
          `Meilleures 20 min sur le plat : ${(w.dist / 1000).toFixed(2)} km à ${pace(w.value)}.`,
          `VC estimée : ${pace(cs)} (${(cs * 3.6).toFixed(2)} km/h), avec ton D′ de ${Math.round(a.dPrime)} m.`,
        ],
        metrics,
        athlete: { ...a, cs },
        changes: [`VC : ${pace(a.cs)} → ${pace(cs)}`],
        record: baseRecord(act, a, 'flatTest', metrics, false),
      }
    },
  },
  {
    key: 'csTest',
    title: 'Test VC 3′ / 7′ / 12′',
    measures: 'Vitesse critique et D′ : trois séances à des jours différents, un effort à fond chacune ; la distance parcourue de chaque effort donne VC et D′ (régression distance-temps).',
    terrain: 'Piste : pars du départ du tour de 400 m pour compter facilement la distance.',
    tips: [
      'ALL OUT : sans retenue, mais pas sans contrôle.',
      'La distance est lue dans le tour « Corps de séance » de ta montre ; tu peux la corriger (tours de piste comptés).',
      'VC et D′ se calculent dès deux tests ; les trois donnent le résultat le plus fiable.',
    ],
    variants: [
      { key: '3', label: '3′', seconds: 180 },
      { key: '7', label: '7′', seconds: 420 },
      { key: '12', label: '12′', seconds: 720 },
    ],
    steps: (a, v) => {
      const seconds = v?.seconds ?? 180
      return [
        ...coachWarmup(a),
        { kind: 'active', name: `${Math.round(seconds / 60)}' à fond`, seconds, zones: 'max', notes: 'Effort maximal 10/10 : sans retenue, mais pas sans contrôle' },
        { kind: 'cooldown', name: 'Récupération Z1', seconds: 10 * MIN, speed: zoneSpeed(a, 1) },
      ]
    },
    analyze: (act, a, v) => {
      const seconds = v?.seconds ?? 180
      const effort = effortDistance(act, seconds)
      if (!effort) throw new Error(`Effort de ${Math.round(seconds / 60)} min introuvable dans cette activité.`)
      const trial: CsTrial = { id: crypto.randomUUID(), date: new Date(act.start).toISOString(), seconds, dist: Math.round(effort.dist), source: effort.source }
      const trials = [trial, ...a.csTrials.filter((t) => !(t.seconds === seconds && t.date.slice(0, 10) === trial.date.slice(0, 10)))]
      const fit = csFromTrials(trials)
      const metrics: SessionMetrics = fit ? { cs: fit.cs, dPrime: fit.dPrime } : {}
      const lines = [
        `Test ${Math.round(seconds / 60)}′ : ${trial.dist} m à ${pace(trial.dist / seconds)} (${effort.source === 'lap' ? 'tour de la montre' : 'meilleure fenêtre GPS'}).`,
        fit
          ? `Avec ${fit.used.map((t) => `${Math.round(t.seconds / 60)}′ (${t.date.slice(5, 10).split('-').reverse().join('/')})`).join(', ')} : VC ${pace(fit.cs)} (${(fit.cs * 3.6).toFixed(2)} km/h), D′ ${Math.round(fit.dPrime)} m${fit.r2 !== null ? `, R² ${fit.r2.toFixed(3)}` : ''}.`
          : 'Encore un test d’une autre durée (7′ ou 12′) pour calculer VC et D′.',
      ]
      return {
        lines,
        metrics,
        athlete: fit ? { ...a, csTrials: trials, cs: fit.cs, dPrime: fit.dPrime } : { ...a, csTrials: trials },
        changes: fit ? [`VC : ${pace(a.cs)} → ${pace(fit.cs)}`, `D′ : ${Math.round(a.dPrime)} → ${Math.round(fit.dPrime)} m`] : [`Test ${Math.round(seconds / 60)}′ enregistré.`],
        record: baseRecord(act, a, 'csTest', metrics, false),
        persist: { csTrials: trials },
      }
    },
  },
  {
    key: 'descents',
    title: 'Descentes soutenues',
    measures: 'Coefficients de descente (vitesse en descente par rapport au plat), à pente connue.',
    terrain: 'Une descente de 10 à 25 %, représentative de tes courses (technicité comprise).',
    tips: ['Allure soutenue mais maîtrisée, comme en course.', 'Remonte en marchant, puis appuie sur « Lap ».'],
    steps: (a) => [
      { kind: 'warmup', name: 'Échauffement Z1-Z2', seconds: 20 * MIN, speed: [zoneSpeed(a, 1)[0], zoneSpeed(a, 2)[1]], zones: [1, 2] },
      {
        repeat: 4,
        steps: [
          { kind: 'active', name: 'Descente soutenue', seconds: 5 * MIN, notes: 'Comme en course, sans prise de risque.' },
          { kind: 'recovery', name: 'Remontée en marchant', seconds: null, notes: 'Appuie sur Lap en haut.' },
        ],
      },
      { kind: 'cooldown', name: 'Retour au calme', seconds: 10 * MIN },
    ],
    analyze: (act, a) => {
      const downs = legs(act).filter((l) => l.dz < -40 && l.dt >= 2 * MIN && l.grade <= -5)
      if (!downs.length) throw new Error('Aucune descente d’au moins 2 min trouvée.')
      const dist = downs.reduce((s, l) => s + (l.to - l.from), 0)
      const dt = downs.reduce((s, l) => s + l.dt, 0)
      const grade = Math.round((downs.reduce((s, l) => s + l.dz, 0) / dist) * 1000) / 10
      const factor = Math.round((dist / dt / (a.cs * DESCENT_INTENSITY * techFactor(grade))) * 100) / 100
      const metrics: SessionMetrics = { descent: { grade, factor } }
      const current = interp(a.descent, grade, (p) => p.grade, (p) => p.factor)
      return {
        lines: [
          `${downs.length} descentes, pente moyenne ${grade} %, à ${pace(dist / dt)}.`,
          `Coefficient de descente ≈ ×${factor.toFixed(2)} (profil actuel ×${current.toFixed(2)}).`,
        ],
        metrics,
        athlete: { ...a, descent: mergePoint<DescentPoint>(a.descent, { grade, factor }) },
        changes: [`Descente à ${grade} % : ×${current.toFixed(2)} → ×${factor.toFixed(2)}`],
        record: baseRecord(act, a, 'descents', metrics, false),
      }
    },
  },
]

export const SESSIONS_BY_KEY = Object.fromEntries(SESSIONS.map((s) => [s.key, s])) as Record<SessionKey, SessionDef>

/**
 * Séances proposées dans l'onglet Test VC : le test VC (protocole de l'entraîneur) seulement.
 * Sortie longue, navettes tempo, tests de 20 min et descentes ne sont plus proposés ; leurs
 * définitions restent pour relire les résultats déjà enregistrés.
 */
export const OFFERED_SESSIONS = SESSIONS.filter((s) => s.key === 'csTest')

/** Déroulé lisible d'une séance. */
export function describeSteps(steps: Step[], a?: Athlete): string[] {
  const hr = a?.workoutTarget === 'hr'
  const target = (s: SimpleStep) => {
    if (hr && a) {
      const r = stepHrRange(s, a)
      return r ? ` (${r[0]}–${r[1]} bpm)` : ''
    }
    return s.speed ? ` (${formatPace(1000 / s.speed[1])}–${formatPace(1000 / s.speed[0])}/km)` : ''
  }
  const one = (s: SimpleStep) =>
    `${s.name} : ${s.meters ? `${(s.meters / 1000).toFixed(2)} km` : s.seconds ? (s.seconds < 60 ? `${s.seconds}"` : s.seconds < 3600 ? `${Math.round(s.seconds / 60)} min` : formatDuration(s.seconds)) : 'jusqu’à « Lap »'}` +
    target(s) +
    (s.notes ? ` — ${s.notes}` : '')
  return steps.flatMap((s) => (isRepeat(s) ? [`${s.repeat} × [ ${s.steps.map(one).join(' ; ')} ]`] : [one(s)]))
}
