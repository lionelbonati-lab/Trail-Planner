// Abonnements du téléphone (push.ts) : la confirmation du serveur suit le champ quiet, écrit ici.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const writes: [string, string, Record<string, unknown>?][] = []
let token = 'tok-1'
const store = new Map<string, string>()

vi.mock('../cloud', () => ({ app: {}, db: {}, auth: { currentUser: { uid: 'u1' } } }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  setDoc: async (path: string, data: Record<string, unknown>) => void writes.push(['set', path, data]),
  deleteDoc: async (path: string) => void writes.push(['delete', path]),
}))
vi.mock('firebase/messaging', () => ({ getMessaging: () => ({}), isSupported: async () => true, getToken: async () => token }))

let push: typeof import('../push')

beforeAll(async () => {
  vi.stubEnv('PROD', true)
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'cle-publique')
  const Notification = { permission: 'granted', requestPermission: async () => 'granted' }
  vi.stubGlobal('Notification', Notification)
  vi.stubGlobal('window', { PushManager: class {}, Notification })
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({}) } })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  push = await import('../push')
})

beforeEach(() => {
  writes.length = 0
  store.clear()
  token = 'tok-1'
})

const sets = () => writes.filter((w) => w[0] === 'set')

describe('abonnements du téléphone', () => {
  it('« Me prévenir » : abonnement sans quiet (confirmation) ; jeton renouvelé : quiet, ancien effacé', async () => {
    await push.subscribePush('share:lien1')
    expect(sets()).toHaveLength(1)
    expect(sets()[0][2]).toMatchObject({ token: 'tok-1', target: 'share:lien1', ref: 'lien1' })
    expect(sets()[0][2]).not.toHaveProperty('quiet')
    const first = sets()[0][1]
    // Même jeton : rien à refaire.
    writes.length = 0
    await push.refreshPush('share:lien1')
    expect(writes).toEqual([])
    // Nouveau jeton donné par le navigateur : réabonnement silencieux.
    token = 'tok-2'
    await push.refreshPush('share:lien1')
    expect(sets()).toHaveLength(1)
    expect(sets()[0][2]).toMatchObject({ token: 'tok-2', quiet: true })
    expect(writes).toContainEqual(['delete', first])
  })

  it('coureur : chaque appui réécrit l\'abonnement (confirmation) sans l\'effacer ; connexion : quiet', async () => {
    expect(await push.setOwnerPush(true)).toBe(true)
    expect(await push.setOwnerPush(true)).toBe(true)
    expect(sets()).toHaveLength(2)
    expect(sets().every((w) => !('quiet' in w[2]!))).toBe(true)
    expect(writes.filter((w) => w[0] === 'delete')).toEqual([])
    // Abonnement refait à la connexion : rien si inchangé ; nouveau jeton : quiet, ancien effacé.
    writes.length = 0
    await push.setOwnerPush(true, true)
    expect(writes).toEqual([])
    const old = `users/u1/push/${(await import('../pushRules')).tokenKey('tok-1')}`
    token = 'tok-2'
    await push.setOwnerPush(true, true)
    expect(sets()).toHaveLength(1)
    expect(sets()[0][2]).toMatchObject({ token: 'tok-2', quiet: true })
    expect(writes).toContainEqual(['delete', old])
  })
})
