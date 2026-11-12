import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { normalizeAthlete, normalizeRace } from './defaults'
import type { Athlete, Race } from './types'

/**
 * Stockage : local (navigateur) par défaut ; Supabase dès que
 * VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont définis et que
 * l'utilisateur est connecté.
 */
export interface Store {
  kind: 'local' | 'cloud'
  loadAthlete(): Promise<Athlete>
  saveAthlete(a: Athlete): Promise<void>
  listRaces(): Promise<Race[]>
  saveRace(r: Race): Promise<void>
  deleteRace(id: string): Promise<void>
}

const LS_ATHLETE = 'tp.athlete'
const LS_RACES = 'tp.races'

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.warn('Stockage local indisponible', e)
  }
}

export const localStore: Store = {
  kind: 'local',
  async loadAthlete() {
    return normalizeAthlete(lsGet<Partial<Athlete> | null>(LS_ATHLETE, null))
  },
  async saveAthlete(a) {
    lsSet(LS_ATHLETE, a)
  },
  async listRaces() {
    return lsGet<Race[]>(LS_RACES, []).map(normalizeRace)
  },
  async saveRace(r) {
    const all = lsGet<Race[]>(LS_RACES, [])
    const i = all.findIndex((x) => x.id === r.id)
    if (i >= 0) all[i] = r
    else all.push(r)
    lsSet(LS_RACES, all)
  },
  async deleteRace(id) {
    lsSet(
      LS_RACES,
      lsGet<Race[]>(LS_RACES, []).filter((x) => x.id !== id),
    )
  },
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null

export function cloudStore(client: SupabaseClient, user: User): Store {
  return {
    kind: 'cloud',
    async loadAthlete() {
      const { data, error } = await client
        .from('athletes')
        .select('data')
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) throw error
      return normalizeAthlete(data?.data ?? null)
    },
    async saveAthlete(a) {
      const { error } = await client
        .from('athletes')
        .upsert({ user_id: user.id, data: a, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    async listRaces() {
      const { data, error } = await client
        .from('races')
        .select('data')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => normalizeRace(row.data as Race))
    },
    async saveRace(r) {
      const { error } = await client
        .from('races')
        .upsert({ id: r.id, user_id: user.id, data: r, updated_at: r.updatedAt })
      if (error) throw error
    },
    async deleteRace(id) {
      const { error } = await client.from('races').delete().eq('id', id)
      if (error) throw error
    },
  }
}

/** Sauvegarde complète en JSON (pour export / import manuel). */
export interface Backup {
  version: 1
  athlete: Athlete
  races: Race[]
}
