// Zones d'allure : libellés, et entraînement Garmin découpé par distance d'après le plan.
import { zoneIndex } from './model'
import type { SimpleStep } from './sessions'
import { formatPace } from './time'
import type { Athlete, PaceZone, SimResult, Track } from './types'

/** Description courte d'une zone (« Tempo · 88 % VC », « Allure 4'30/km »…). */
export function zoneText(z: PaceZone, a: Athlete): string {
  if (z.kind === 'model') return 'Allure de course (modèle)'
  if (z.kind === 'intensity') {
    const pct = `${Math.round(z.value * 100)} % VC`
    return `${z.label ? `${z.label} · ` : ''}${pct} (${formatPace(1000 / (a.cs * z.value))}/km sur le plat)`
  }
  if (z.kind === 'flatPace') return `Allure plat ${formatPace(z.value)}/km (${Math.round((1000 / z.value / a.cs) * 100)} % VC)`
  return `Allure imposée ${formatPace(z.value)}/km`
}

export interface ZoneRun {
  from: number
  to: number
  zone: PaceZone | null
  /** Temps prévu sur la portion (s). */
  time: number
}

/** Portions successives du parcours (zone ou allure libre), avec leur temps prévu. */
export function zoneRuns(track: Track, sim: SimResult, zones: PaceZone[]): ZoneRun[] {
  const idx = zoneIndex(track, zones)
  const pts = track.points
  const runs: ZoneRun[] = []
  // Pas k = du point k−1 au point k ; une portion regroupe des pas consécutifs de même zone.
  let first = 1
  for (let k = 2; k <= pts.length; k++) {
    if (k === pts.length || idx[k] !== idx[first]) {
      const from = pts[first - 1].dist
      const to = pts[k - 1].dist
      if (to - from >= 50) {
        runs.push({ from, to, zone: idx[first] >= 0 ? zones[idx[first]] : null, time: sim.points[k - 1].t - sim.points[first - 1].t })
      } else if (runs.length) {
        runs[runs.length - 1].to = to // bout trop court : rattaché à la portion précédente
      }
      first = k
    }
  }
  return runs
}

/** Étapes d'entraînement par distance : fourchette ±5 % autour de l'allure prévue dans chaque zone. */
export function zoneSteps(track: Track, sim: SimResult, zones: PaceZone[], a: Athlete): SimpleStep[] {
  return zoneRuns(track, sim, zones).map((r) => {
    const dist = r.to - r.from
    const v = r.time > 0 ? dist / r.time : 0
    const where = `km ${(r.from / 1000).toFixed(1)} → ${(r.to / 1000).toFixed(1)}`
    if (!r.zone || r.zone.kind === 'model' || v <= 0) return { kind: 'active', name: 'Libre', seconds: null, meters: dist, notes: where }
    const k = zoneIndexOfIntensity(zoneIntensity(r.zone, a), a) + 1
    return {
      kind: 'active',
      name: (r.zone.label || (r.zone.kind === 'pace' ? 'Allure imposée' : 'Allure cible')).slice(0, 30),
      seconds: null,
      meters: dist,
      speed: [v * 0.95, v * 1.05],
      zones: [k, k],
      notes: `${where} · ≈ ${formatPace(1000 / v)}/km (${zoneText(r.zone, a)})`.slice(0, 63),
    }
  })
}

/** Durée en dessous de laquelle une étape reste sans cible cardiaque : la FC n'a pas le temps de suivre. */
export const HR_MIN_STEP = 120

/**
 * Plage de fréquence cardiaque (bpm) d'une étape d'entraînement : zones VC visées → zones cardiaques
 * de même numéro (Z6 et Z7 → la zone cardiaque la plus haute). Null = sans cible (effort à fond,
 * étape courte, ni zone ni vitesse).
 */
export function stepHrRange(s: SimpleStep, a: Athlete): [number, number] | null {
  if (s.zones === 'max' || !a.hrZones?.length) return null
  if (s.seconds && s.seconds < HR_MIN_STEP) return null
  let z = s.zones ?? null
  if (!z && s.speed && a.cs > 0) {
    const k = zoneIndexOfIntensity((s.speed[0] + s.speed[1]) / 2 / a.cs, a) + 1
    z = [k, k]
  }
  if (!z) return null
  const n = a.hrZones.length
  const lo = a.hrZones[Math.max(1, Math.min(z[0], n)) - 1]
  const hi = a.hrZones[Math.max(1, Math.min(z[1], n)) - 1]
  return [Math.round(Math.min(lo.low, hi.low)), Math.round(Math.max(lo.high, hi.high))]
}

// --- Couleurs Garmin --------------------------------------------------------------

/**
 * Couleurs des zones Garmin : 1 gris, 2 bleu, 3 vert, 4 orange, 5 rouge ;
 * 6 et 7 comme les zones de puissance (violet, prune) — modifiables par zone dans le profil.
 */
export const GARMIN_ZONE_COLORS = ['#9e9e9e', '#2b8ae0', '#43a047', '#f39c12', '#e53935', '#8e44ad', '#5b2a6e']
export const MODEL_COLOR = '#d6d3cc'

export function zoneIntensity(z: PaceZone, a: Athlete): number {
  if (z.kind === 'model') return 0
  return z.kind === 'intensity' ? z.value : 1000 / z.value / a.cs
}

/** Indice (0…) de la zone d'entraînement du profil correspondant à une intensité (fraction de VC). */
export function zoneIndexOfIntensity(i: number, a: Athlete): number {
  const zones = a.zones
  if (!zones.length) return 0
  for (let k = 0; k < zones.length; k++) if (i >= zones[k].low && i < zones[k].high) return k
  if (i < zones[0].low) return 0
  // Entre deux zones ou au-dessus : la plus proche par la borne basse.
  let best = 0
  for (let k = 0; k < zones.length; k++) if (i >= zones[k].low) best = k
  return best
}

/** Couleur de la zone k (0…) : celle choisie dans le profil, sinon la couleur Garmin. */
export function colorForIndex(k: number, a?: Athlete): string {
  return a?.zones[k]?.color || GARMIN_ZONE_COLORS[Math.min(k, GARMIN_ZONE_COLORS.length - 1)]
}

/** Couleur Garmin d'une zone d'allure (par son nom, sinon par son intensité). */
export function zoneColor(z: PaceZone, a: Athlete): string {
  if (z.kind === 'model') return MODEL_COLOR
  const byName = a.zones.findIndex((x) => x.name === z.label)
  return colorForIndex(byName >= 0 ? byName : zoneIndexOfIntensity(zoneIntensity(z, a), a), a)
}

/** Nom court affiché sur la barre de zones. */
export function zoneShort(z: PaceZone, a: Athlete): string {
  if (z.kind === 'model') return 'Course'
  if (z.label) return z.label
  return zoneText(z, a).split(' (')[0]
}

// --- Découpage du parcours en portions contiguës ----------------------------------

const MIN_LEN = 20
type Target = Pick<PaceZone, 'kind' | 'value' | 'label'>

export const MODEL_TARGET: Target = { kind: 'model', value: 0, label: '' }

const seg = (from: number, to: number, t: Target): PaceZone => ({ id: crypto.randomUUID(), from, to, kind: t.kind, value: t.value, label: t.label })

/** Zone 1 du profil (portions avant/après une zone placée). */
export function zone1Target(a: Athlete): Target {
  const z = a.zones[0]
  return z ? { kind: 'intensity', value: (z.low + z.high) / 2, label: z.name } : MODEL_TARGET
}

/**
 * Remet les zones en portions contiguës couvrant [0, total] : tri, coupe des
 * chevauchements (la dernière définie l'emporte), trous comblés par l'allure modèle.
 */
export function partition(zones: PaceZone[], total: number): PaceZone[] {
  if (!zones.length) return []
  // Peinture successive : chaque zone recouvre ce qui précède sur son intervalle.
  let out: PaceZone[] = [seg(0, total, MODEL_TARGET)]
  for (const z of zones) {
    const from = Math.max(0, Math.min(total, z.from))
    const to = Math.max(0, Math.min(total, z.to))
    if (to - from < 1) continue
    out = paint(out, from, to, z)
  }
  return out.filter((z) => z.to - z.from >= 1)
}

function paint(parts: PaceZone[], from: number, to: number, z: PaceZone): PaceZone[] {
  const res: PaceZone[] = []
  for (const p of parts) {
    if (p.to <= from || p.from >= to) {
      res.push(p)
      continue
    }
    if (p.from < from) res.push({ ...p, to: from })
    if (p.to > to) res.push({ ...p, id: crypto.randomUUID(), from: to })
  }
  res.push({ ...z, from, to })
  return res.sort((x, y) => x.from - y.from)
}

/** Applique une cible sur [from, to] ; si aucune zone n'existe, l'avant et l'après deviennent des zones (zone 1). */
export function applyRange(zones: PaceZone[], total: number, from: number, to: number, t: Target, fill: Target): PaceZone[] {
  const base = zones.length ? partition(zones, total) : [seg(0, total, fill)]
  const a = Math.max(0, Math.min(from, to))
  const b = Math.min(total, Math.max(from, to))
  return paint(base, a, b, seg(a, b, t)).filter((z) => z.to - z.from >= 1)
}

/** Fin de cycle : coupe la portion qui contient d en deux portions de même cible. */
export function splitAt(zones: PaceZone[], total: number, d: number): PaceZone[] {
  const base = zones.length ? partition(zones, total) : [seg(0, total, MODEL_TARGET)]
  const i = base.findIndex((z) => d > z.from + MIN_LEN && d < z.to - MIN_LEN)
  if (i < 0) return base
  const z = base[i]
  return [...base.slice(0, i), { ...z, to: d }, { ...z, id: crypto.randomUUID(), from: d }, ...base.slice(i + 1)]
}

/** Déplace la limite entre la portion i et la suivante. */
export function moveBoundary(parts: PaceZone[], i: number, d: number): PaceZone[] {
  if (i < 0 || i >= parts.length - 1) return parts
  const lo = parts[i].from + MIN_LEN
  const hi = parts[i + 1].to - MIN_LEN
  const x = Math.round(Math.max(lo, Math.min(hi, d)))
  return parts.map((z, k) => (k === i ? { ...z, to: x } : k === i + 1 ? { ...z, from: x } : z))
}

/** Supprime la portion i en l'intégrant à sa voisine (précédente ou suivante). */
export function mergeInto(parts: PaceZone[], i: number, dir: -1 | 1): PaceZone[] {
  const j = i + dir
  if (i < 0 || i >= parts.length || j < 0 || j >= parts.length) return parts
  const from = Math.min(parts[i].from, parts[j].from)
  const to = Math.max(parts[i].to, parts[j].to)
  return parts.filter((_, k) => k !== i).map((z) => (z.id === parts[j].id ? { ...z, from, to } : z))
}

export function setTarget(parts: PaceZone[], i: number, t: Target): PaceZone[] {
  return parts.map((z, k) => (k === i ? { ...z, kind: t.kind, value: t.value, label: t.label } : z))
}
