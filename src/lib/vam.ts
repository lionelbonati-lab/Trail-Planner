// Zones de vitesse ascensionnelle (VAM, m/h). Dans le modèle, la VAM est proportionnelle à
// l'intensité (VAM à VC × %VC) : les zones VAM reprennent donc les % des zones de VC, appliqués
// à la VAM tenue à VC. Le mode perso garde des valeurs saisies en m/h.
import { interp } from './model'
import type { Athlete, VamZone } from './types'

/** Pente minimale (%) des montées comptées dans le temps par zone VAM. */
export const VAM_MIN_GRADE = 10

/** VAM à VC de référence : la meilleure du tableau « VAM selon la pente », et sa pente. */
export function vamRef(a: Pick<Athlete, 'vam'>): { vam: number; grade: number } | null {
  const pts = a.vam.filter((p) => p.grade > 0 && p.vam > 0)
  if (!pts.length) return null
  const best = pts.reduce((x, y) => (y.vam > x.vam ? y : x))
  return { vam: best.vam, grade: best.grade }
}

const round10 = (v: number) => Math.round(v / 10) * 10

/** Zones VAM déduites des zones de VC et de la VAM à VC (m/h, arrondies à 10). */
export function vamZonesFromCs(a: Pick<Athlete, 'vam' | 'zones'>): VamZone[] {
  const ref = vamRef(a)
  if (!ref) return []
  return a.zones.map((z) => ({ name: z.name, low: round10(z.low * ref.vam), high: round10(z.high * ref.vam) }))
}

/** Zones VAM du coureur selon le mode choisi. */
export function vamZonesOf(a: Pick<Athlete, 'vam' | 'zones' | 'vamZoneMode' | 'vamZones'>): VamZone[] {
  return a.vamZoneMode === 'custom' && a.vamZones.length ? a.vamZones : vamZonesFromCs(a)
}

/** Zone d'une VAM : sous la première, elle compte dans la première ; au-delà de la dernière, dans la dernière. */
export function vamZoneIndex(vam: number, zones: VamZone[]): number {
  const k = zones.findIndex((z) => vam >= z.low && vam < z.high)
  if (k >= 0) return k
  const lowest = zones.reduce((m, z, i) => (z.low < zones[m].low ? i : m), 0)
  const highest = zones.reduce((m, z, i) => (z.high > zones[m].high ? i : m), 0)
  return vam < zones[lowest].low ? lowest : highest
}

/** Plages des réglages VAM d'EndurancePro (min de Z1, puis max de Z1 à Z4), en m/h. */
const EP_VAM_RANGES: [number, number][] = [
  [0, 1000],
  [100, 1400],
  [300, 1600],
  [500, 1800],
  [700, 2000],
]

/**
 * Seuils VAM pour EndurancePro, qui colore 5 zones (gris, bleu, vert, orange, rouge) : début
 * de Z1, puis fin de Z1, Z2, Z3 et Z4 (au-delà : rouge, comme Z5 et plus). Arrondis à 10 m/h,
 * ramenés dans les plages des réglages de la montre et croissants. Null s'il y a moins de 4 zones.
 */
export function epVamThresholds(a: Pick<Athlete, 'vam' | 'zones' | 'vamZoneMode' | 'vamZones'>): number[] | null {
  const zones = [...vamZonesOf(a)].sort((x, y) => x.low - y.low)
  if (zones.length < 4) return null
  const raw = [zones[0].low, ...zones.slice(0, 4).map((z) => z.high)]
  const out: number[] = []
  raw.forEach((v, i) => {
    const [lo, hi] = EP_VAM_RANGES[i]
    const prev = i ? out[i - 1] + 10 : lo
    out.push(Math.min(hi, Math.max(lo, prev, round10(v))))
  })
  return out.every((v, i) => !i || v > out[i - 1]) ? out : null
}

/** VAM à VC (m/h) sur une pente donnée, d'après le tableau du profil. */
export function interpVam(a: Pick<Athlete, 'vam'>, grade: number): number {
  return interp(a.vam, grade, (p) => p.grade, (p) => p.vam)
}
