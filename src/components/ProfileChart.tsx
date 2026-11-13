import { useEffect, useMemo, useRef, useState } from 'react'
import { formatClock, formatDuration } from '../lib/time'
import type { SimPoint, SplitRow } from '../lib/types'

interface Props {
  points: SimPoint[]
  splits: SplitRow[]
  timeZone: string
  startMs: number
  height?: number
  width?: number
  /** Clic sur le profil : distance (m). */
  onPick?: (dist: number) => void
  /** Version impression : pas d'interaction, étiquettes compactes. */
  print?: boolean
  /** D′ de l'athlète : affiche le D′ restant au survol. */
  dPrime?: number
  /** Survol : distance (m) ou null, pour synchroniser la carte. */
  onHover?: (dist: number | null) => void
  /** Glisser sur le profil : portion sélectionnée [from, to] (m). */
  onSelect?: (from: number, to: number) => void
  /** Zones d'allure à afficher (bandes colorées). */
  zones?: { from: number; to: number; label: string; color: string }[]
}

const TECH_COLORS = ['transparent', '#f5c542', '#f08a24', '#d9452b', '#7a1f6b']

function niceStep(range: number, target: number): number {
  const raw = range / target
  const p = 10 ** Math.floor(Math.log10(raw))
  const n = raw / p
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p
}

/** Largeur mesurée d'un conteneur (pour un rendu SVG à l'échelle 1, texte net). */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export function ProfileChart({ points, splits, timeZone, startMs, height = 260, width, onPick, print, dPrime, onHover, onSelect, zones }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ x0: number; from: number; to: number } | null>(null)
  const [wrapRef, measured] = useWidth(1000)
  const [hover, setHover] = useState<SimPoint | null>(null)

  const m = { l: 46, r: 12, t: print ? 84 : 46, b: 34 }
  const W = width ?? measured
  const H = height
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b

  const geo = useMemo(() => {
    const total = points[points.length - 1]?.dist ?? 1
    let min = Infinity
    let max = -Infinity
    for (const p of points) {
      if (p.ele < min) min = p.ele
      if (p.ele > max) max = p.ele
    }
    const yStep = niceStep(max - min || 100, 4)
    const yMin = Math.floor(min / yStep) * yStep
    const yMax = Math.ceil(max / yStep) * yStep
    const x = (d: number) => m.l + (d / total) * iw
    const y = (e: number) => m.t + ih - ((e - yMin) / (yMax - yMin || 1)) * ih
    const stride = Math.max(1, Math.floor(points.length / 1500))
    const sampled = points.filter((_, i) => i % stride === 0 || i === points.length - 1)
    const line = sampled.map((p, i) => `${i ? 'L' : 'M'}${x(p.dist).toFixed(1)},${y(p.ele).toFixed(1)}`).join('')
    const area = `${line}L${x(total).toFixed(1)},${m.t + ih}L${m.l},${m.t + ih}Z`

    // Bandes de nuit et de technicité.
    const bands = (pred: (p: SimPoint) => number) => {
      const out: { from: number; to: number; v: number }[] = []
      for (const p of points) {
        const v = pred(p)
        const last = out[out.length - 1]
        if (last && last.v === v) last.to = p.dist
        else out.push({ from: p.dist, to: p.dist, v })
      }
      return out
    }
    const night = bands((p) => (p.night ? 1 : 0)).filter((b) => b.v === 1)
    const tech = bands((p) => p.tech).filter((b) => b.v > 1)

    const xStep = niceStep(total / 1000, print ? 14 : 12)
    const xTicks: number[] = []
    for (let k = 0; k <= total / 1000 + 1e-6; k += xStep) xTicks.push(k)
    const yTicks: number[] = []
    for (let e = yMin; e <= yMax + 1e-6; e += yStep) yTicks.push(e)
    return { total, x, y, line, area, night, tech, xTicks, yTicks }
  }, [points, iw, ih, m.l, m.t, print])

  const pick = (clientX: number): SimPoint | null => {
    const svg = svgRef.current
    if (!svg || !points.length) return null
    const rect = svg.getBoundingClientRect()
    const vx = ((clientX - rect.left) / rect.width) * W
    const d = ((vx - m.l) / iw) * geo.total
    if (d < 0 || d > geo.total) return null
    let lo = 0
    let hi = points.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (points[mid].dist < d) lo = mid + 1
      else hi = mid
    }
    return points[lo]
  }

  // Étiquettes : on saute celles qui chevaucheraient la précédente (ravitos prioritaires).
  const labelGap = 16
  const shown = new Set<string>()
  {
    const xs = splits.map((s) => geo.x(s.to))
    const prio = splits.map((s, i) => ({ s, i })).sort((a, b) => Number(b.s.cp.kind === 'ravito') - Number(a.s.cp.kind === 'ravito'))
    const taken: number[] = []
    for (const { s, i } of prio) {
      if (taken.every((x) => Math.abs(x - xs[i]) >= labelGap)) {
        taken.push(xs[i])
        shown.add(s.cp.id)
      }
    }
  }

  return (
    <div ref={wrapRef} className="profile-wrap">
    <svg
      ref={svgRef}
      className={`profile ${print ? 'print' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block', touchAction: onSelect ? 'pan-y' : undefined }}
      // Glisser horizontalement sélectionne une portion ; le défilement vertical reste possible au doigt.
      onPointerDown={
        print || (!onPick && !onSelect)
          ? undefined
          : (e) => {
              const p = pick(e.clientX)
              if (!p) return
              ;(e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId)
              setDrag({ x0: e.clientX, from: p.dist, to: p.dist })
            }
      }
      onPointerMove={
        print
          ? undefined
          : (e) => {
              const p = pick(e.clientX)
              setHover(p)
              onHover?.(p ? p.dist : null)
              if (drag && p) setDrag({ ...drag, to: p.dist })
            }
      }
      onPointerUp={(e) => {
        if (!drag) return
        const moved = Math.abs(e.clientX - drag.x0) > 6
        const p = pick(e.clientX)
        setDrag(null)
        if (moved && onSelect) {
          const to = p ? p.dist : drag.to
          onSelect(Math.min(drag.from, to), Math.max(drag.from, to))
        } else if (!moved && onPick && p) onPick(p.dist)
      }}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => {
        setHover(null)
        onHover?.(null)
      }}
    >
      {zones?.map((z, i) => (
        <g key={`z${i}`} className="zone-band">
          <rect x={geo.x(z.from)} y={m.t} width={Math.max(1, geo.x(z.to) - geo.x(z.from))} height={ih} fill={z.color} />
          {geo.x(z.to) - geo.x(z.from) > 40 && (
            <text x={geo.x(z.from) + 4} y={m.t + ih - 6} className="zone-label">{z.label}</text>
          )}
        </g>
      ))}
      {drag && Math.abs(geo.x(drag.to) - geo.x(drag.from)) > 2 && (
        <rect
          x={geo.x(Math.min(drag.from, drag.to))}
          y={m.t}
          width={Math.abs(geo.x(drag.to) - geo.x(drag.from))}
          height={ih}
          className="selection"
        />
      )}
      {geo.night.map((b, i) => (
        <rect key={i} x={geo.x(b.from)} y={m.t} width={Math.max(1, geo.x(b.to) - geo.x(b.from))} height={ih} className="night" />
      ))}
      {geo.yTicks.map((e) => (
        <g key={e}>
          <line x1={m.l} x2={W - m.r} y1={geo.y(e)} y2={geo.y(e)} className="grid" />
          <text x={m.l - 6} y={geo.y(e) + 4} textAnchor="end" className="tick">{e}</text>
        </g>
      ))}
      {geo.xTicks.map((k) => (
        <text key={k} x={geo.x(k * 1000)} y={H - m.b + 16} textAnchor="middle" className="tick">{k}</text>
      ))}
      <text x={W - m.r} y={H - 4} textAnchor="end" className="tick">km</text>
      <path d={geo.area} className="area" />
      <path d={geo.line} className="line" />
      {geo.tech.map((b, i) => (
        <rect key={i} x={geo.x(b.from)} y={m.t + ih + 2} width={Math.max(1, geo.x(b.to) - geo.x(b.from))} height={5} fill={TECH_COLORS[b.v - 1]} />
      ))}
      {splits.map((s) => {
        const xx = geo.x(s.to)
        const showLabel = shown.has(s.cp.id)
        const ele = points[Math.min(points.length - 1, Math.round((s.to / geo.total) * (points.length - 1)))]?.ele ?? 0
        return (
          <g key={s.cp.id} className={`cp cp-${s.cp.kind}`}>
            <line x1={xx} x2={xx} y1={m.t - 4} y2={geo.y(ele)} />
            <circle cx={xx} cy={geo.y(ele)} r={s.cp.kind === 'ravito' ? 4 : 2.5} />
            {showLabel && (
              <text x={xx} y={m.t - 8} transform={`rotate(-40 ${xx} ${m.t - 8})`} className="cp-label">
                {s.cp.name.slice(0, 18)} {formatClock(s.arrivalClock, timeZone)}
              </text>
            )}
          </g>
        )
      })}
      {hover && !print && (
        <g className="hover">
          <line x1={geo.x(hover.dist)} x2={geo.x(hover.dist)} y1={m.t} y2={m.t + ih} />
          <text x={Math.min(geo.x(hover.dist) + 6, W - 380)} y={m.t + 14}>
            {(hover.dist / 1000).toFixed(1)} km · {Math.round(hover.ele)} m · {formatDuration(hover.t)} ·{' '}
            {formatClock(new Date(startMs + hover.t * 1000), timeZone)} · {Math.round(hover.temp)}°C
            {hover.precip > 0.1 ? ` · ${hover.precip.toFixed(1)} mm/h` : ''}
            {dPrime ? ` · D′ ${Math.round((hover.wbal / dPrime) * 100)} %` : ''}
          </text>
        </g>
      )}
    </svg>
    </div>
  )
}
