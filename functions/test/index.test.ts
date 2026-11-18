// Fonctions Cloud des notifications, avec une base Firestore et un envoi FCM factices.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../../src/lib/defaults'
import { encodeForFirestore } from '../../src/lib/firestoreCodec'
import { computePlan, scenarioWindows } from '../../src/lib/plan'
import { buildSnapshot } from '../../src/lib/share'
import { parseWatchPlan } from '../../src/lib/watchLive'

type Data = Record<string, unknown>
const store = new Map<string, Data>()
const sent: { token: string; data: Record<string, string> }[] = []
let invalid = new Set<string>()

function docRef(path: string) {
  return {
    path,
    id: path.split('/').pop()!,
    get: async () => snapOf(path),
    set: async (d: Data) => void store.set(path, d),
    delete: async () => void store.delete(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}
function snapOf(path: string) {
  const d = store.get(path)
  return { id: path.split('/').pop()!, exists: !!d, data: () => d, ref: docRef(path) }
}
function collectionRef(path: string, filters: [string, string, unknown][] = []) {
  const docs = () =>
    [...store.keys()]
      .filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
      .map(snapOf)
      .filter((s) => filters.every(([f, op, v]) => (op === 'in' ? (v as unknown[]).includes(s.data()![f]) : s.data()![f] === v)))
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (f: string, op: string, v: unknown) => collectionRef(path, [...filters, [f, op, v]]),
    get: async () => ({ docs: docs() }),
  }
}
const db = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) =>
    fn({ get: (r: { get: () => unknown }) => r.get(), set: (r: { set: (d: Data) => void }, d: Data) => r.set(d) }),
}

vi.mock('firebase-admin/app', () => ({ initializeApp: () => ({}) }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => db }))
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({
    sendEach: async (msgs: { token: string; data: Record<string, string> }[]) => {
      sent.push(...msgs.filter((m) => !invalid.has(m.token)))
      return { responses: msgs.map((m) => (invalid.has(m.token) ? { error: { code: 'messaging/registration-token-not-registered' } } : {})) }
    },
  }),
}))
vi.mock('firebase-functions/v2', () => ({ setGlobalOptions: () => undefined }))
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_path: string, fn: unknown) => fn }))

type Handler = (e: unknown) => Promise<void>
const fns = (await import('../src/index')) as unknown as { onWatchReport: Handler; onShareUpdate: Handler }

function gpx(): string {
  const pts: string[] = []
  for (let d = 0; d <= 20000; d += 20) pts.push(`<trkpt lat="${45 + d / 111195}" lon="6"><ele>${500 + (d < 10000 ? d / 20 : (20000 - d) / 20)}</ele></trkpt>`)
  return `<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`
}

const event = (before: Data | null, after: Data | null, params: Record<string, string>) => ({
  params,
  data: { before: { exists: !!before, data: () => before ?? undefined }, after: { exists: !!after, data: () => after ?? undefined } },
})

describe('fonctions Cloud : notifications', () => {
  const code = 'abcdef0123456789'
  const race = newRace('Trail test', gpx())
  race.checkpoints = [{ id: 'a', dist: 5000, name: 'Ravito A', kind: 'ravito', stopMin: 3, cutoff: '', water: 0, carbs: 0, notes: '', auto: false }]
  const athlete = normalizeAthlete({ ...DEFAULT_ATHLETE, name: 'Lionel', watchId: code, watchRaceId: race.id })
  const plan = computePlan(race, athlete)!
  const snap = buildSnapshot('uid1', race, athlete, plan.track, plan.sim, scenarioWindows(plan.track, athlete, plan.opts))
  const w = parseWatchPlan(snap.w)!
  const nowS = Math.round(Date.now() / 1000)
  const s = nowS - Math.round(w.cps[0].planned) - 600

  beforeEach(() => {
    store.clear()
    sent.length = 0
    invalid = new Set()
    // Lien assistance de la course et document du code montre (lien permanent).
    store.set('shares/lien1', encodeForFirestore(snap) as Data)
    store.set(`shares/${code}`, encodeForFirestore(snap) as Data)
    store.set('push/x1', { token: 'tok-aide', target: 'share:lien1', ref: 'lien1', at: 1 })
    store.set('push/x2', { token: 'tok-perm', target: `suivi:${code}`, ref: code, at: 1 })
    store.set('push/x3', { token: 'tok-aide', target: `suivi:${code}`, ref: code, at: 1 })
    store.set('users/uid1/push/k', { token: 'tok-coureur', at: 1 })
  })

  it('passage relevé par la montre : assistance et lien permanent prévenus une fois, lien ouvert au toucher', async () => {
    const pass = s + Math.round(w.cps[0].planned) + 300
    const report = { t: nowS, s, d: 5300, p: `0:${pass}` }
    await fns.onWatchReport(event({ t: nowS - 300, s, d: 4800 }, report, { code }))
    const pass0 = sent.filter((m) => m.data.tag.endsWith('-pass-0'))
    expect(pass0.map((m) => [m.token, m.data.path]).sort()).toEqual([
      ['tok-aide', '#/share/lien1'],
      ['tok-perm', `#/suivi/${code}`],
    ])
    expect(pass0[0].data.title).toBe('Lionel · Ravito A')
    // Même relevé réécrit : rien de plus.
    sent.length = 0
    await fns.onWatchReport(event(report, { ...report, t: nowS + 60 }, { code }))
    expect(sent.filter((m) => m.data.tag.endsWith('-pass-0'))).toEqual([])
  })

  it('arrivée : debrief prêt une seule fois pour le coureur, jeton périmé supprimé', async () => {
    invalid = new Set(['tok-perm'])
    const fin = w.cps.length - 1
    const at = nowS - 60
    const report = { t: nowS, s: at - Math.round(w.cps[fin].planned), d: snap.totalDist, p: `0:${at - 3000},${fin}:${at}` }
    await fns.onWatchReport(event(null, report, { code }))
    const debrief = sent.filter((m) => m.data.tag.endsWith('-debrief'))
    expect(debrief).toHaveLength(1)
    expect(debrief[0]).toMatchObject({ token: 'tok-coureur', data: { path: `#/debrief/${race.id}` } })
    expect(store.has('push/x2')).toBe(false)
    expect(store.has('push/x1')).toBe(true)
  })

  it('mode course du téléphone : passage noté et publié', async () => {
    const startedAt = new Date((nowS - 2000) * 1000).toISOString()
    const a = new Date((nowS - 60) * 1000).toISOString()
    const before = { ...snap, live: { startedAt, lastUpdate: null } }
    const after = { ...before, live: { startedAt, lastUpdate: a }, rows: snap.rows.map((r, i) => (i === 0 ? { ...r, actual: a } : r)) }
    store.set('shares/lien1', encodeForFirestore(after) as Data)
    await fns.onShareUpdate(event(encodeForFirestore(before) as Data, encodeForFirestore(after) as Data, { id: 'lien1' }))
    expect(sent.map((m) => [m.token, m.data.title])).toEqual([['tok-aide', 'Lionel · Ravito A']])
  })
})
