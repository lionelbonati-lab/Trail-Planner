import { describe, expect, it } from 'vitest'
import { activityFromRaw } from '../activity'
import { DEFAULT_ATHLETE, normalizeAthlete } from '../defaults'
import { epPayload } from '../endurancepro'
import type { RawPoint } from '../gpx'
import { analyzeSession } from '../insights'
import { epVamThresholds, vamRef, vamZoneIndex, vamZonesFromCs, vamZonesOf } from '../vam'

const A = normalizeAthlete({ ...DEFAULT_ATHLETE, cs: 4 })

describe('zones de vitesse ascensionnelle', () => {
  it('référence : meilleure VAM à VC du profil de pente', () => {
    expect(vamRef(A)).toEqual({ vam: 1100, grade: 20 })
    expect(vamRef({ vam: [] })).toBeNull()
  })

  it('mêmes % que les zones de VC, appliqués à la VAM à VC (arrondis à 10 m/h)', () => {
    const z = vamZonesFromCs(A)
    expect(z).toHaveLength(7)
    expect(z[0]).toEqual({ name: 'Zone 1', low: 660, high: 770 })
    expect(z[2]).toEqual({ name: 'Zone 3', low: 880, high: 970 })
    expect(z[4].low).toBe(1060)
    expect(z[6].high).toBe(1650)
    expect(vamZonesOf(A)).toEqual(z)
  })

  it('mode perso : valeurs saisies en m/h', () => {
    const custom = [
      { name: 'Facile', low: 400, high: 600 },
      { name: 'Tempo', low: 600, high: 800 },
    ]
    expect(vamZonesOf({ ...A, vamZoneMode: 'custom', vamZones: custom })).toEqual(custom)
    // Perso sans zones saisies : on garde les zones calculées.
    expect(vamZonesOf({ ...A, vamZoneMode: 'custom', vamZones: [] })).toHaveLength(7)
  })

  it('zone d’une VAM : bornes basses incluses, extrêmes rattachés aux zones extrêmes', () => {
    const z = vamZonesFromCs(A)
    expect(vamZoneIndex(880, z)).toBe(2)
    expect(vamZoneIndex(300, z)).toBe(0)
    expect(vamZoneIndex(2500, z)).toBe(6)
  })

  it('seuils EndurancePro : début de Z1 puis fin de Z1 à Z4, dans les plages de la montre', () => {
    expect(epVamThresholds(A)).toEqual([660, 770, 880, 970, 1060])
    expect(epPayload(A, null)).toContain('|vz=660,770,880,970,1060|')
    // VAM très faible ou très forte : ramenée dans les plages des réglages, toujours croissante.
    expect(epVamThresholds({ ...A, vam: [{ grade: 20, vam: 300 }] })).toEqual([180, 210, 300, 500, 700])
    expect(epVamThresholds({ ...A, vam: [{ grade: 20, vam: 3000 }] })).toEqual([1000, 1400, 1600, 1800, 2000])
    // Moins de 4 zones : rien n'est envoyé.
    const few = { ...A, vamZoneMode: 'custom' as const, vamZones: [{ name: 'Z1', low: 400, high: 800 }] }
    expect(epVamThresholds(few)).toBeNull()
    expect(epPayload(few, null)).not.toContain('vz=')
  })
})

/** Montée régulière à `grade` % et `vam` m/h pendant `climb` s, puis plat pendant `flat` s. */
function climbThenFlat(grade: number, vam: number, climb: number, flat: number) {
  const raw: RawPoint[] = []
  let t = Date.parse('2026-11-10T08:00:00Z')
  let x = 0
  let ele = 500
  raw.push({ lat: 45, lon: 6, ele, time: t })
  const vClimb = vam / 3600 / (grade / 100)
  for (let s = 0; s < climb + flat; s += 2) {
    const up = s < climb
    x += (up ? vClimb : 3) * 2
    if (up) ele += (vam / 3600) * 2
    t += 2000
    raw.push({ lat: 45 + x / 111195, lon: 6, ele, time: t })
  }
  return activityFromRaw('montée', raw, [])
}

describe('temps par zone VAM d’une séance', () => {
  it('ne compte que les montées, dans la zone de leur VAM', () => {
    const ins = analyzeSession(climbThenFlat(20, 920, 1200, 600), A)
    const times = ins.vamZoneTimes!
    const total = times.reduce((s, z) => s + z.seconds, 0)
    expect(total / 60).toBeGreaterThan(18)
    expect(total / 60).toBeLessThan(21)
    // Le lissage de l'altitude adoucit le pied et le sommet de la montée (zones plus basses).
    expect(times[2].seconds / total).toBeGreaterThan(0.7)
    expect(times.slice(3).every((z) => z.seconds === 0)).toBe(true)
  })

  it('séance à plat : pas de temps par zone VAM', () => {
    expect(analyzeSession(climbThenFlat(20, 920, 0, 1200), A).vamZoneTimes).toBeNull()
  })
})
