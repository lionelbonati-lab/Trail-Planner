// Réglages publiés pour le datafield Garmin EndurancePro : il les lit en arrière-plan dans le
// document du code montre (shares/{code}, champ `ep`) : sa cible d'allure peut être une zone ou
// un % de VC (colorisation et alarme de l'allure cible inchangées).
//
//   EP1|cs=247|z=60,70,80,88,96,105,115,150|up=110|dn=330|vz=660,770,880,970,1060|zt=2
//   cs : VC en s/km · z : bornes des zones en % de VC (N+1 valeurs, 7 zones au plus)
//   up : m de D+ équivalents à 1 km à plat (allure effort d'EndurancePro)
//   dn : m de D- équivalents à 1 km à plat (allure effort montagne d'EndurancePro)
//   vz : seuils VAM en m/h (début de Z1, fin de Z1 à Z4) pour les 5 couleurs VAM de la montre
//   zt : zone cible (zone de la séance envoyée à la montre), 0 = inchangée
import type { Athlete, Race } from './types'
import { epVamThresholds } from './vam'
import { wholeRouteZone } from './zones'

/**
 * Équivalence montée d'EndurancePro (m de D+ comptés comme 1 km à plat), déduite de la VAM
 * tenue à VC : sur une pente g, monter H m prend H / VAM ; EndurancePro compte la distance
 * H / g + H × 1000 / C parcourue à VC. Égaliser les deux donne 1000 / C = VC / VAM − 1 / g,
 * moyenné sur les pentes du profil. Arrondi à 10 m, dans la plage du réglage (30 à 250 m).
 */
export function climbEquivalence(a: Athlete): number | null {
  const pts = a.vam.filter((p) => p.grade > 0 && p.vam > 0)
  if (!pts.length || !(a.cs > 0)) return null
  const k = pts.reduce((s, p) => s + a.cs / (p.vam / 3600) - 100 / p.grade, 0) / pts.length
  if (!(k > 0)) return null
  return Math.min(250, Math.max(30, Math.round(1000 / k / 10) * 10))
}

/** Plage du réglage « équivalence descente » d'EndurancePro (m de D- pour 1 km à plat). */
export const EP_DESCENT_RANGE: [number, number] = [100, 800]

/**
 * Équivalence descente d'EndurancePro (m de D- comptés comme 1 km à plat dans l'allure effort
 * montagne), déduite des coefficients de descente du profil : sur une pente g, descendre H m
 * prend H / g / (v × f) ; EndurancePro compte la distance H / g + H × 1000 / C parcourue à v.
 * Égaliser les deux donne 1000 / C = (1 / f − 1) / g, moyenné sur les pentes du profil (les
 * descentes douces, plus rapides que le plat, allègent la moyenne). Arrondi à 10 m, dans la
 * plage du réglage : 800 m (le plus faible ralentissement possible) si la descente ne te
 * ralentit pas en moyenne.
 */
export function descentEquivalence(a: Athlete): number | null {
  const pts = a.descent.filter((p) => p.grade < 0 && p.factor > 0)
  if (!pts.length) return null
  const [lo, hi] = EP_DESCENT_RANGE
  const k = pts.reduce((s, p) => s + (1 / p.factor - 1) * (100 / -p.grade), 0) / pts.length
  if (!(k > 0)) return hi
  return Math.min(hi, Math.max(lo, Math.round(1000 / k / 10) * 10))
}

/** Zones du profil triées (7 au plus) et leurs bornes en % de VC. */
function zoneBounds(a: Athlete): { order: number[]; pct: number[] } {
  const order = a.zones
    .map((_, i) => i)
    .sort((x, y) => a.zones[x].low - a.zones[y].low)
    .slice(0, 7)
  if (!order.length) return { order, pct: [] }
  const pct = [...order.map((i) => a.zones[i].low), a.zones[order[order.length - 1]].high].map((b) => Math.round(b * 100))
  return { order, pct }
}

/** Chaîne publiée pour EndurancePro. `onWatch` : course ou séance envoyée à la montre. */
export function epPayload(a: Athlete, onWatch: Race | null): string {
  const { order, pct } = zoneBounds(a)
  const up = climbEquivalence(a)
  const dn = descentEquivalence(a)
  const k = onWatch ? wholeRouteZone(onWatch.zones, a) : null
  const zt = k === null ? 0 : order.indexOf(k) + 1
  const vz = epVamThresholds(a)
  return ['EP1', `cs=${Math.round(1000 / a.cs)}`, pct.length >= 2 ? `z=${pct.join(',')}` : '', up ? `up=${up}` : '', dn ? `dn=${dn}` : '', vz ? `vz=${vz.join(',')}` : '', `zt=${zt}`]
    .filter(Boolean)
    .join('|')
}
