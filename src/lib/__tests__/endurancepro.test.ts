import { describe, expect, it } from 'vitest'
import { DEFAULT_ATHLETE, newRace, normalizeAthlete } from '../defaults'
import { climbEquivalence, epPayload } from '../endurancepro'
import { wholeRoute, zoneTarget } from '../zones'

const A = normalizeAthlete({ ...DEFAULT_ATHLETE, cs: 4.0417 })

/** Lecture côté montre (même logique que epValue() dans TrailSync.mc). */
function epValue(text: string, key: string): string | null {
  const tag = `|${key}=`
  const i = text.indexOf(tag)
  if (i < 0) return null
  const rest = text.slice(i + tag.length)
  const j = rest.indexOf('|')
  return j < 0 ? rest : rest.slice(0, j)
}

describe('réglages EndurancePro', () => {
  it('format lu par la montre : VC en s/km, bornes croissantes en %, zone d’alarme', () => {
    const ep = epPayload(A, null)
    expect(ep.startsWith('EP1|')).toBe(true)
    expect(epValue(ep, 'cs')).toBe('247')
    expect(epValue(ep, 'z')).toBe('60,70,80,88,96,105,115,150')
    const z = epValue(ep, 'z')!.split(',').map(Number)
    for (let k = 1; k < z.length; k++) expect(z[k]).toBeGreaterThan(z[k - 1])
    expect(epValue(ep, 'zt')).toBe('0')
  })

  it('équivalence montée déduite de la VAM à VC (plage du réglage, pas de 10 m)', () => {
    // VAM par défaut 950/1100/1100/950 m/h à 10/20/30/45 % et VC 4,04 m/s : ≈ 110 m.
    expect(climbEquivalence(A)).toBe(110)
    // Grimpeur plus fort : équivalence plus faible (la montée « coûte » moins).
    const climber = { ...A, vam: A.vam.map((p) => ({ ...p, vam: p.vam * 1.3 })) }
    expect(climbEquivalence(climber)!).toBeGreaterThan(climbEquivalence(A)!)
    // Bornée à la plage du picker de la montre.
    expect(climbEquivalence({ ...A, vam: [{ grade: 40, vam: 3000 }] })).toBe(250)
    expect(climbEquivalence({ ...A, vam: [] })).toBeNull()
  })

  it('séance envoyée à la montre en Z2 sur tout le parcours : alarme au-dessus de Z2', () => {
    const race = { ...newRace('EF', ''), zones: wholeRoute(zoneTarget(A, 1), 10000) }
    expect(epValue(epPayload(A, race), 'zt')).toBe('2')
    // Zones placées par portions : alarme inchangée.
    const mixed = { ...race, zones: [...race.zones, { ...race.zones[0], id: 'b', from: 5000 }] }
    expect(epValue(epPayload(A, mixed), 'zt')).toBe('0')
  })

  it('zones non triées dans le profil : bornes triées et zone d’alarme suivant le même ordre', () => {
    const shuffled = { ...A, zones: [A.zones[2], A.zones[0], A.zones[1], ...A.zones.slice(3)] }
    const race = { ...newRace('Tempo', ''), zones: wholeRoute(zoneTarget(shuffled, 0), 10000) } // zone 3 du bilan
    const ep = epPayload(shuffled, race)
    expect(epValue(ep, 'z')).toBe('60,70,80,88,96,105,115,150')
    expect(epValue(ep, 'zt')).toBe('3')
  })
})
