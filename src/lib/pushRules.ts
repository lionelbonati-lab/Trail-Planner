// Notifications envoyées par le serveur (Cloud Functions) même appli fermée : passages aux points,
// retard sur le plan, barrière horaire menacée, debrief prêt pour le coureur. Logique pure, partagée
// par le serveur (functions/) et les tests ; le serveur ne fait que lire, appeler et envoyer.
import { reportFor, runnerCourse, type ShareSnapshot } from './share'
import { parsePasses, parseWatchPlan, watchStatus, type WatchReport } from './watchLive'

/** Alerte de retard à chaque palier de 15 min de retard sur le plan. */
export const LATE_STEP_S = 15 * 60
/** Barrière horaire : alerte quand la marge estimée passe sous 30 min. */
export const BARRIER_WARN_S = 30 * 60
/** Deux départs à moins de 30 min : la même sortie (montre et mode course du téléphone). */
const SAME_RUN_S = 30 * 60

export type NoticeKind = 'pass' | 'late' | 'barrier' | 'finish'

export interface Notice {
  kind: NoticeKind
  title: string
  body: string
  /** Étiquette de la notification : une même étiquette remplace la précédente sur le téléphone. */
  tag: string
  /** Pour le coureur (debrief prêt), pas pour l'assistance. */
  owner?: boolean
}

/** Ce qui a déjà été notifié pour une sortie (document push_state, lu et écrit par le serveur seul). */
export interface PushState {
  /** Départ de la sortie (s Unix). */
  s: number
  /** Points déjà notifiés (indices des lignes). */
  passes: number[]
  /** Palier de retard déjà notifié (0 : aucun). */
  late: number
  /** Barrières déjà signalées (indices des lignes). */
  barriers: number[]
}

const clock = (ms: number, tz: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: tz || 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))

/** « 3h12 » ou « 48 min ». */
export function shortDuration(sec: number): string {
  const m = Math.round(Math.abs(sec) / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`
}

/** « +7 min sur le plan », « −3 min sur le plan », « à l'heure prévue ». */
export function gapText(sec: number): string {
  const m = Math.round(sec / 60)
  return m === 0 ? "à l'heure prévue" : `${m > 0 ? '+' : '−'}${shortDuration(sec)} sur le plan`
}

const km = (m: number) => (m / 1000).toFixed(1).replace('.', ',')

/** État de la sortie : repris s'il s'agit de la même (départ à moins de 30 min), sinon remis à zéro. */
function stateFor(prev: PushState | null, s: number): PushState {
  return prev && Math.abs(prev.s - s) < SAME_RUN_S ? { ...prev, passes: [...prev.passes], barriers: [...prev.barriers] } : { s, passes: [], late: 0, barriers: [] }
}

/** Notification de passage (et, à l'arrivée, celle du debrief pour le coureur). */
function passNotices(snap: ShareSnapshot, i: number, at: number, delta: number, startMs: number): Notice[] {
  const row = snap.rows[i]
  const who = snap.athleteName || 'Coureur'
  const tz = snap.timeZone
  const key = `${snap.courseId ?? snap.raceName}`
  const out: Notice[] = [
    {
      kind: 'pass',
      title: `${who} · ${row.name}`,
      body: `Passé à ${clock(at, tz)} · km ${km(row.dist)} · ${gapText(delta)}`,
      tag: `tp-${key}-pass-${i}`,
    },
  ]
  if (i === snap.rows.length - 1) {
    out.push({
      kind: 'finish',
      owner: true,
      title: `Debrief prêt · ${snap.raceName}`,
      body: `Arrivée à ${clock(at, tz)} en ${shortDuration((at - startMs) / 1000)} (${gapText(delta)}). Touche pour voir le debrief.`,
      tag: `tp-${key}-debrief`,
    })
  }
  return out
}

/**
 * Relevé de la montre pour une course (document du lien) : nouveaux passages (absents du relevé
 * précédent et pas encore notifiés), palier de retard franchi, barrière horaire menacée. `prevReport` :
 * relevé d'avant cette écriture ; `prev` : ce qui a déjà été notifié.
 */
export function watchNotices(
  snap: ShareSnapshot,
  report: WatchReport,
  prevReport: WatchReport | null,
  prev: PushState | null,
  nowMs: number,
): { notices: Notice[]; state: PushState } | null {
  if (!snap.rows?.length || !snap.w || !(report.s > 0)) return null
  if (!reportFor(snap, report, nowMs)) return null
  const plan = parseWatchPlan(snap.w)
  if (!plan || plan.cps.length !== snap.rows.length) return null
  const state = stateFor(prev, report.s)
  const status = watchStatus(report, plan, report.t)
  const notices: Notice[] = []
  const startMs = report.s * 1000
  const planStart = Date.parse(snap.start)
  // Passages : nouveaux par rapport au relevé précédent de la même activité.
  const before = prevReport && prevReport.s === report.s ? parsePasses(prevReport.p) : new Map<number, number>()
  for (const [i, t] of [...status.passed].sort((a, b) => a[0] - b[0])) {
    if (before.has(i) || state.passes.includes(i) || !snap.rows[i]) continue
    state.passes.push(i)
    const planned = (Date.parse(snap.rows[i].planned) - planStart) / 1000
    notices.push(...passNotices(snap, i, t * 1000, t - report.s - planned, startMs))
  }
  const finished = status.passed.has(snap.rows.length - 1)
  if (!finished && report.d > 200) {
    // Retard : une alerte par palier de 15 min franchi ; un retard rattrapé rabaisse le palier.
    const level = Math.max(0, Math.floor(status.delta / LATE_STEP_S))
    if (level > state.late) {
      notices.push({
        kind: 'late',
        title: `${snap.athleteName || 'Coureur'} : ${gapText(status.delta)}`,
        body: `Km ${km(report.d)} à ${clock(report.t * 1000, snap.timeZone)} · arrivée estimée ${clock(status.finishEta * 1000, snap.timeZone)}`,
        tag: `tp-${snap.courseId ?? snap.raceName}-late`,
      })
    }
    state.late = level
    // Barrière : la prochaine barrière pas encore passée, recalée sur le vrai départ comme la page.
    const officialMs = Date.parse(snap.plannedStart ?? snap.start)
    const shift = Math.abs(startMs - officialMs) >= 30_000 ? startMs - officialMs : 0
    const next = snap.rows.findIndex((r, i) => !!r.cutoff && !status.passed.has(i) && r.dist > report.d)
    if (next >= 0 && !state.barriers.includes(next)) {
      const cut = Date.parse(snap.rows[next].cutoff!) + shift
      const margin = (cut - status.etas[next] * 1000) / 1000
      if (margin < BARRIER_WARN_S) {
        state.barriers.push(next)
        notices.push({
          kind: 'barrier',
          title: `${snap.athleteName || 'Coureur'} · barrière ${snap.rows[next].name}`,
          body:
            margin >= 0
              ? `Marge estimée ${shortDuration(margin)} (barrière ${clock(cut, snap.timeZone)}, arrivée estimée ${clock(status.etas[next] * 1000, snap.timeZone)})`
              : `Hors délai estimé de ${shortDuration(margin)} (barrière ${clock(cut, snap.timeZone)})`,
          tag: `tp-${snap.courseId ?? snap.raceName}-barrier-${next}`,
        })
      }
    }
  }
  return { notices, state }
}

/**
 * Mode course du téléphone (passages notés dans l'appli, publiés avec le lien) : passages nouveaux par
 * rapport à la version précédente du lien et pas encore notifiés.
 */
export function liveNotices(before: ShareSnapshot | null, snap: ShareSnapshot, prev: PushState | null): { notices: Notice[]; state: PushState } | null {
  if (!snap.live || !snap.rows?.length) return null
  const startMs = Date.parse(snap.live.startedAt)
  const state = stateFor(prev, Math.round(startMs / 1000))
  const sameRun = before?.live?.startedAt === snap.live.startedAt
  const notices: Notice[] = []
  snap.rows.forEach((r, i) => {
    if (!r.actual || state.passes.includes(i)) return
    if (sameRun && before?.rows?.[i]?.actual) return
    state.passes.push(i)
    const at = Date.parse(r.actual)
    notices.push(...passNotices(snap, i, at, (at - Date.parse(r.planned)) / 1000, startMs))
  })
  return { notices, state }
}

/**
 * Cibles des abonnements d'un document de lien : sa page assistance et, s'il est la course que montre le
 * lien permanent du coureur (`runner` : code montre), celui-ci.
 */
export function pushTargets(shareId: string, runner: string | null): string[] {
  return [`share:${shareId}`, ...(runner ? [`suivi:${runner}`] : [])]
}

/**
 * Document que montre le lien permanent du code montre (comme RunnerPage) : le document du code pour la
 * course envoyée à la montre, sinon `<code>-<id>`. Null : rien à montrer.
 */
export function runnerDoc(
  code: string,
  base: Pick<ShareSnapshot, 'courseId' | 'wl' | 'kind' | 'plannedStart' | 'start' | 'last'> | null,
  report: WatchReport | null,
  nowMs: number,
): string | null {
  const target = runnerCourse(base, report, nowMs)
  return target ? (target.id === base?.courseId ? code : `${code}-${target.id}`) : null
}

/** Identifiant court et stable d'un jeton (nom de document Firestore). */
export function tokenKey(token: string): string {
  let h = 5381
  for (let i = 0; i < token.length; i++) h = ((h * 33) ^ token.charCodeAt(i)) >>> 0
  return `${h.toString(36)}${token.length.toString(36)}${token.slice(-12).replace(/[^\w-]/g, '')}`
}
