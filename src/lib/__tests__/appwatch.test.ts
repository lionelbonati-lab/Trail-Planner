import { describe, expect, it } from 'vitest'
import { APP_ACTIVITY_IDLE_MS, appWatchAction } from '../watchLive'

// Relevés de l'appli montre (Trail Planner Companion) : `v` = identifiant du parcours lancé sur la montre.
const now = Date.parse('2026-11-21T12:00:00Z')
const s = now / 1000 - 3600
const rep = (over: Partial<{ t: number; d: number; v: string | number }> = {}) => ({ t: now / 1000 - 120, s, d: 8000, v: 'A', ...over })
const known = (id: string) => ['A', 'B'].includes(id)
const total = (id: string) => (id === 'A' ? 20000 : undefined)

describe('⌚ et parcours lancé depuis l’appli montre', () => {
  it('activité en cours : le parcours devient la course sur la montre', () => {
    expect(appWatchAction({ watchId: 'w' }, rep(), now, known, total)).toEqual({ adopt: 'A' })
    // Déjà sur la montre (adopté) et toujours en cours : rien à faire.
    expect(appWatchAction({ watchId: 'w', watchRaceId: 'A', watchRaceApp: true }, rep(), now, known, total)).toBeNull()
  })

  it('activité finie : plus rien sur la montre (arrivée, ou plus de relevé depuis 2 h)', () => {
    const adopted = { watchId: 'w', watchRaceId: 'A', watchRaceAt: new Date((s - 60) * 1000).toISOString(), watchRaceApp: true }
    expect(appWatchAction(adopted, rep({ d: 19800 }), now, known, total)).toEqual({ clear: true })
    expect(appWatchAction(adopted, rep(), now + APP_ACTIVITY_IDLE_MS + 60_000, known, total)).toEqual({ clear: true })
    // Une fois retiré, le même vieux relevé ne le remet pas.
    expect(appWatchAction({ watchId: 'w', watchRaceAt: adopted.watchRaceAt }, rep({ d: 19800 }), now, known, total)).toBeNull()
  })

  it('course choisie sur le web : jamais retirée par la fin d’une activité', () => {
    const web = { watchId: 'w', watchRaceId: 'A', watchRaceAt: new Date((s - 600) * 1000).toISOString() }
    expect(appWatchAction(web, rep({ d: 19800 }), now, known, total)).toBeNull()
  })

  it('bug corrigé : retirer la course du web ne réactive pas le parcours de l’appli arrêté', () => {
    // Parcours B choisi sur le web après l'activité A de l'appli (arrêtée), puis retiré : heure du choix gardée.
    const removed = { watchId: 'w', watchRaceAt: new Date(now - 60_000).toISOString() }
    expect(appWatchAction(removed, rep(), now, known, total)).toBeNull()
    // Ancien comportement (heure effacée) : la vieille activité finie ne le remet pas non plus.
    expect(appWatchAction({ watchId: 'w' }, rep({ t: now / 1000 - 3 * 3600 }), now, known, total)).toBeNull()
  })

  it('choix fait à la main pendant l’activité : prioritaire', () => {
    const manual = { watchId: 'w', watchRaceId: 'B', watchRaceAt: new Date(now - 600_000).toISOString() }
    expect(appWatchAction(manual, rep(), now, known, total)).toBeNull()
  })
})
