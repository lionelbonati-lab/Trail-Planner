import { Minus, Navigation, Plus } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { isRavitoKind } from '../lib/splits'
import type { CheckpointKind } from '../lib/types'

/** Point du profil : point de passage (page assistance, plan de course). */
export interface ProfileRow {
  id: string
  name: string
  kind: string
  dist: number
  assist?: boolean
  dropbag?: boolean
  /** Passage réel (page assistance). */
  actual?: string | null
  /** D+ cumulé jusqu'au point (m). */
  up?: number
  /** Écart au plan au passage (s, positif : retard), affiché sous le point (debrief). */
  delta?: number | null
}

/** Portion du parcours (m) avec une valeur (technicité, nuit). */
export interface Band {
  from: number
  to: number
  v: number
}

const TECH_COLORS = ['#f5c542', '#f08a24', '#d9452b', '#7a1f6b']

/**
 * Profil du parcours, comme sur la page assistance : altitudes dans une colonne fixe, points et
 * étiquettes (assistance, base de vie, dropbag), distance et D+ entre deux points et entre deux
 * ravitos, zoom et défilement sur les courses longues ; technicité, nuit et curseur en option.
 */
function profileGain(profile: [number, number][], d: number): number {
  let up = 0
  for (let i = 1; i < profile.length && profile[i - 1][0] < d; i++) up += Math.max(0, profile[i][1] - profile[i - 1][1])
  return up
}

/** Écart court sous un point : « +7′ », « −1h05 », « 0′ ». */
function deltaLabel(sec: number): string {
  const m = Math.round(sec / 60)
  const abs = Math.abs(m)
  return `${m > 0 ? '+' : m < 0 ? '−' : ''}${abs >= 60 ? `${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, '0')}` : `${abs}′`}`
}

/** Échelle minimale du profil (px par km) : au-delà de la largeur de l'écran, il défile. */
const PX_PER_KM = 12
/** Zoom du profil : jusqu'à 16 fois l'échelle par défaut (≈ 200 px par km). */
const ZOOM_MAX = 16
/** Après un glissement à la main, le profil reprend le suivi du coureur au bout de ce délai. */
const FOLLOW_RESUME_MS = 30000

export function CourseProfile({
  profile,
  rows,
  position,
  tech,
  night,
  onHover,
  readout,
  atId = null,
}: {
  profile: [number, number][]
  rows: ProfileRow[]
  position: number | null
  /** Technicité (2 à 4) par portion : bande jaune → violet sous le profil. */
  tech?: Band[]
  /** Portions de nuit : fond grisé. */
  night?: Band[]
  /** Survol ou glissement du doigt : distance (m), ou null en sortie (carte synchronisée). */
  onHover?: (dist: number | null) => void
  /** Texte affiché au curseur (km, altitude, heure…). */
  readout?: (dist: number) => string
  /** Point où se trouve le coureur (ravito en cours) : halo, pas grisé. */
  atId?: string | null
}) {
  const [hover, setHover] = useState<number | null>(null)
  // Rendu à l'échelle 1 (largeur mesurée) : texte lisible aussi sur téléphone.
  const wrap = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const clipId = `done-${useId().replace(/:/g, '')}`
  const [Wc, setWc] = useState(900)
  useEffect(() => {
    const el = wrap.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWc(Math.max(300, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const total = profile[profile.length - 1]?.[0] || 1
  // Course longue (UTMB…) : profil plus large que l'écran, à faire défiler.
  // Marge gauche : colonne fixe des altitudes, posée par-dessus le profil.
  const ML = 46
  // Zoom (boutons, pincement à deux doigts, Ctrl + molette) : échelle par défaut × zoom, au moins
  // la largeur de l'écran.
  const [zoom, setZoom] = useState(1)
  const fitZoom = (Wc - ML - 8) / ((total / 1000) * PX_PER_KM)
  const minZoom = Math.min(1, fitZoom)
  const W = Math.max(Wc, Math.round((total / 1000) * PX_PER_KM * zoom) + ML + 8)
  const scrolls = W > Wc + 1
  const x = (d: number) => ML + (d / total) * (W - ML - 8)
  // Point gardé sous le doigt (ou au centre) pendant le zoom : distance (m) et position à l'écran (px).
  const anchor = useRef<{ dist: number; px: number } | null>(null)
  const distAtScreen = (px: number) => {
    const left = scroller.current?.scrollLeft ?? 0
    return Math.max(0, Math.min(total, ((left + px - ML) / (W - ML - 8)) * total))
  }
  const zoomTo = (z: number, px = Wc / 2) => {
    const nz = Math.max(minZoom, Math.min(ZOOM_MAX, z))
    if (Math.abs(nz - zoom) < 1e-3) return
    if (!anchor.current) anchor.current = { dist: distAtScreen(px), px }
    setZoom(nz)
  }
  useLayoutEffect(() => {
    const el = scroller.current
    const a = anchor.current
    if (!el || !a) return
    el.scrollLeft = Math.max(0, x(a.dist) - a.px)
    anchor.current = null
  })
  // Ctrl + molette (ou pincement du pavé tactile) : zoom du profil, pas de la page.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const stop = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault()
    }
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [])
  const pinch = useRef<{ d0: number; z0: number; px: number } | null>(null)
  const touchGap = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  // Point suivi : position de la montre, sinon dernier point passé.
  const lastDone = [...rows].reverse().find((r) => r.actual)
  const follow = position ?? (lastDone ? lastDone.dist : null)
  // Glissement à la main : on arrête de suivre le coureur, puis on reprend après un moment.
  const [free, setFree] = useState(false)
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null)
  const grab = () => {
    if (!scrolls) return
    setFree(true)
    if (resume.current) clearTimeout(resume.current)
    resume.current = setTimeout(() => setFree(false), FOLLOW_RESUME_MS)
  }
  useEffect(() => () => {
    if (resume.current) clearTimeout(resume.current)
  }, [])
  const followX = follow === null ? null : x(follow)
  useEffect(() => {
    const el = scroller.current
    if (!el || !scrolls || free || followX === null) return
    // Le coureur au tiers gauche : on voit surtout ce qui l'attend.
    const left = Math.max(0, followX - Wc / 3)
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: 'smooth' })
    else el.scrollLeft = left
  }, [followX, scrolls, free, Wc])
  if (profile.length < 2) return null
  const T = 92
  const H = T + 120
  const eles = profile.map((p) => p[1])
  const lo = Math.min(...eles)
  const hi = Math.max(...eles)
  const y = (e: number) => H - 8 - ((e - lo) / (hi - lo || 1)) * (H - T - 16)
  const line = profile.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')
  const eleAt = (d: number) => profile.reduce((best, p) => (Math.abs(p[0] - d) < Math.abs(best[0] - d) ? p : best))[1]
  // Sous le profil : distance et D+ de chaque tronçon (entre deux points), puis entre deux ravitos
  // (départ et arrivée compris). Texte sur deux lignes, abrégé ou omis si le tronçon est trop court.
  const BAND = 30
  const SH = H + 8 + 2 * BAND
  const upAt = (r: ProfileRow) => r.up ?? profileGain(profile, r.dist)
  type Leg = { from: number; to: number; km: number; up: number }
  const legsOf = (pts: ProfileRow[]): Leg[] =>
    pts.map((r, i) => {
      const p = pts[i - 1]
      return { from: p?.dist ?? 0, to: r.dist, km: (r.dist - (p?.dist ?? 0)) / 1000, up: Math.max(0, Math.round(upAt(r) - (p ? upAt(p) : 0))) }
    })
  const pointLegs = legsOf(rows)
  const ravitoLegs = legsOf(rows.filter((r, i) => isRavitoKind(r.kind as CheckpointKind) || i === rows.length - 1))
  const legLines = (l: Leg, w: number): [string, string] | null => {
    const fits = (a: string, b: string) => Math.max(a.length, b.length) * 6 + 6 <= w
    const kmTxt = l.km.toFixed(1).replace('.', ',')
    for (const [a, b] of [[`${kmTxt} km`, `D+ ${l.up} m`], [`${Math.round(l.km)} km`, `+${l.up}`]] as [string, string][]) if (fits(a, b)) return [a, b]
    return null
  }
  // Lignes d'altitude : 3 ou 4 paliers ronds ; sur un profil qui défile, la cote est répétée.
  const eleStep = [10, 20, 50, 100, 200, 250, 500, 1000].find((st) => (hi - lo) / st <= 4) ?? 1000
  const eleLines: number[] = []
  for (let e = Math.ceil(lo / eleStep) * eleStep; e <= hi; e += eleStep) eleLines.push(e)
  // Repères kilométriques espacés d'au moins 50 px.
  const kmStep = [1, 2, 5, 10, 20, 50, 100].find((k) => (k * (W - 16) * 1000) / total >= 50) ?? 100
  const kmTicks: number[] = []
  for (let k = kmStep; k * 1000 < total - (kmStep * 1000) / 3; k += kmStep) kmTicks.push(k)
  // Étiquettes inclinées à 40° : vers la droite, ou vers la gauche si elles déborderaient du bord.
  // On saute celles qui chevaucheraient une autre (assistance, dropbag, ravitos d'abord).
  const short = (n: string) => (n.length > 20 ? `${n.slice(0, 19)}…` : n)
  const reach = (n: string) => short(n).length * 7 * Math.cos((40 * Math.PI) / 180)
  const rank = (r: ProfileRow) => (r.assist ? 4 : 0) + (r.kind === 'base' ? 3 : 0) + (r.dropbag ? 2 : 0) + (isRavitoKind(r.kind as CheckpointKind) ? 1 : 0)
  const shown = new Map<string, boolean>()
  const taken: { x: number; flip: boolean; reach: number }[] = []
  for (const r of [...rows].sort((a, b) => rank(b) - rank(a))) {
    const xx = x(r.dist)
    const ext = reach(r.name)
    const flip = xx + ext > W - 4
    const clash = taken.some((t) => {
      if (Math.abs(t.x - xx) < 15) return true
      // Deux étiquettes qui convergent (droite à gauche, gauche à droite) se croisent à mi-chemin.
      const [left, right] = t.x < xx ? [t, { flip, reach: ext, x: xx }] : [{ flip, reach: ext, x: xx }, t]
      return !left.flip && right.flip && right.x - left.x < 2 * Math.min(left.reach, right.reach)
    })
    if (!clash) {
      taken.push({ x: xx, flip, reach: ext })
      shown.set(r.id, flip)
    }
  }
  const hasAssist = rows.some((r) => r.assist)
  const hasBag = rows.some((r) => r.dropbag)
  const hasBase = rows.some((r) => r.kind === 'base')
  return (
    <div className="assist-profile" ref={wrap}>
      <div
        ref={scroller}
        className={`assist-profile-zoom ${scrolls ? 'assist-profile-scroll' : ''}`}
        onTouchStart={(e) => {
          grab()
          if (e.touches.length === 2) {
            const rect = e.currentTarget.getBoundingClientRect()
            const px = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
            pinch.current = { d0: touchGap(e.touches), z0: zoom, px }
            anchor.current = { dist: distAtScreen(px), px }
          }
        }}
        onTouchMove={(e) => {
          const p = pinch.current
          if (!p || e.touches.length !== 2) return
          const nz = Math.max(minZoom, Math.min(ZOOM_MAX, (p.z0 * touchGap(e.touches)) / (p.d0 || 1)))
          if (!anchor.current) anchor.current = { dist: distAtScreen(p.px), px: p.px }
          setZoom(nz)
        }}
        onTouchEnd={(e) => {
          if (e.touches.length < 2) pinch.current = null
        }}
        onPointerDown={grab}
        onWheel={(e) => {
          grab()
          if (e.ctrlKey) {
            const rect = e.currentTarget.getBoundingClientRect()
            zoomTo(zoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX - rect.left)
          }
        }}
      >
      <svg
        className="profile"
        viewBox={`0 0 ${W} ${SH}`}
        onPointerMove={(e) => {
          if (!onHover && !readout) return
          const rect = e.currentTarget.getBoundingClientRect()
          const vx = ((e.clientX - rect.left) / rect.width) * W
          const d = Math.max(0, Math.min(total, ((vx - ML) / (W - ML - 8)) * total))
          setHover(d)
          onHover?.(d)
        }}
        onPointerLeave={() => {
          setHover(null)
          onHover?.(null)
        }}
        style={scrolls ? { width: W, height: SH, display: 'block' } : { width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Profil du parcours"
      >
        {night?.map((b, i) => (
          <rect key={`n${i}`} x={x(b.from)} y={T - 4} width={Math.max(1, x(b.to) - x(b.from))} height={H - 8 - (T - 4)} className="night-band" />
        ))}
        {eleLines.map((e) => (
          <line key={`g${e}`} x1={0} x2={W} y1={y(e)} y2={y(e)} className="grid" />
        ))}
        <path d={`${line}L${x(total)},${H - 8}L${x(0)},${H - 8}Z`} className="area" />
        <path d={line} className="line" />
        {/* Partie déjà parcourue : profil grisé jusqu'au coureur. */}
        {follow !== null && follow > 0 && (
          <g className="done-part">
            <clipPath id={clipId}>
              <rect x={0} y={0} width={x(Math.min(follow, total))} height={H} />
            </clipPath>
            <g clipPath={`url(#${clipId})`}>
              <path d={`${line}L${x(total)},${H - 8}L${x(0)},${H - 8}Z`} className="done-area" />
              <path d={line} className="done-line" />
            </g>
          </g>
        )}
        {tech?.filter((b) => b.v > 1).map((b, i) => (
          <rect key={`t${i}`} x={x(b.from)} y={H - 7} width={Math.max(1, x(b.to) - x(b.from))} height={6} fill={TECH_COLORS[Math.min(4, b.v) - 1]}>
            <title>{`Technicité ${b.v} / 4`}</title>
          </rect>
        ))}
        {kmTicks.map((k) => (
          <text key={k} x={x(k * 1000)} y={H - 12} textAnchor="middle" className="tick km-tick">{k}</text>
        ))}
        {rows.map((r) => {
          const xx = x(r.dist)
          const yy = y(eleAt(r.dist))
          const label = shown.has(r.id)
          const flip = !!shown.get(r.id)
          return (
            <g key={r.id} className={['mp-pt', r.assist && 'mp-assist', r.dropbag && 'mp-bag', r.id !== atId && (r.actual || (follow !== null && r.dist <= follow)) && 'mp-passed', r.id === atId && 'mp-at'].filter(Boolean).join(' ')}>
              <title>{`${r.name} · km ${(r.dist / 1000).toFixed(1)}${r.assist ? ' · assistance autorisée' : ''}${r.kind === 'base' ? ' · base de vie' : ''}${r.dropbag ? ' · dropbag' : ''}`}</title>
              {label && <line className="mp-stem" x1={xx} x2={xx} y1={T - 4} y2={yy} />}
              {r.id === atId && <circle className="at-halo" cx={xx} cy={yy} r={13} />}
              {r.assist && <circle className="assist-ring" cx={xx} cy={yy} r={7} />}
              {r.kind === 'base' ? (
                <rect x={xx - 5} y={yy - 5} width={10} height={10} rx={1.5} className={r.actual ? 'done-dot' : 'base-mark'} />
              ) : (
                <circle cx={xx} cy={yy} r={isRavitoKind(r.kind as CheckpointKind) ? 4 : 2.5} className={r.actual ? 'done-dot' : isRavitoKind(r.kind as CheckpointKind) ? 'ravito-dot' : 'cp-dot'} />
              )}
              {r.dropbag && <rect className="bag-mark" x={xx - 4} y={T - 12} width={8} height={8} rx={1.5} />}
              {r.delta !== undefined && r.delta !== null && (
                <text x={xx} y={yy + 16} textAnchor="middle" className={`cp-delta ${Math.abs(r.delta) < 60 ? '' : r.delta > 0 ? 'late' : 'early'}`}>
                  {deltaLabel(r.delta)}
                </text>
              )}
              {label && (
                <text
                  x={xx + (flip ? -2 : 2)}
                  y={T - 16}
                  textAnchor={flip ? 'end' : 'start'}
                  transform={`rotate(${flip ? 40 : -40} ${xx + (flip ? -2 : 2)} ${T - 16})`}
                  className={`cp-label ${r.assist ? 'strong' : ''}`}
                >
                  {short(r.name)}
                </text>
              )}
            </g>
          )
        })}
        {[pointLegs, ravitoLegs].map((legs, band) => {
          const top = H + 8 + band * BAND
          return (
            <g key={`band${band}`} className={`leg-band ${band ? 'leg-ravito' : ''}`}>
              <rect x={0} y={top} width={W} height={BAND - 2} className="leg-bg" />
              {/* Déjà parcouru : fond grisé jusqu'au coureur, comme le profil ; texte grisé des tronçons faits. */}
              {follow !== null && follow > 0 && <rect x={0} y={top} width={x(Math.min(follow, total))} height={BAND - 2} className="leg-done-bg" />}
              {legs.map((l, i) => {
                const x0 = x(l.from)
                const x1 = x(l.to)
                const txt = legLines(l, x1 - x0)
                return (
                  <g key={i} className={follow !== null && l.to <= follow + 1 ? 'leg-done' : undefined}>
                    <title>{`${l.km.toFixed(1).replace('.', ',')} km · D+ ${l.up} m`}</title>
                    {i > 0 && <line x1={x0} x2={x0} y1={top} y2={top + BAND - 2} className="leg-sep" />}
                    {txt && (
                      <text x={(x0 + x1) / 2} y={top + 12} textAnchor="middle" className="leg-text">
                        <tspan x={(x0 + x1) / 2}>{txt[0]}</tspan>
                        <tspan x={(x0 + x1) / 2} dy={12}>{txt[1]}</tspan>
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
        {hover !== null && (
          <g className="hover-cursor">
            <line x1={x(hover)} x2={x(hover)} y1={T - 4} y2={H - 8} />
            <circle cx={x(hover)} cy={y(eleAt(hover))} r={4} />
            {readout && (
              <text x={x(hover) > W - 220 ? x(hover) - 6 : x(hover) + 6} y={T + 8} textAnchor={x(hover) > W - 220 ? 'end' : 'start'} className="hover-text">
                {readout(hover)}
              </text>
            )}
          </g>
        )}
        {position !== null && (
          <g className="me">
            <line x1={x(position)} x2={x(position)} y1={T - 4} y2={H - 8} />
            <circle cx={x(position)} cy={y(eleAt(position))} r={6} />
          </g>
        )}
      </svg>
      </div>
      {/* Altitudes : colonne fixe à gauche, le profil défile dessous. */}
      <svg className="profile ele-axis" width={ML} height={H} viewBox={`0 0 ${ML} ${H}`} aria-hidden>
        <rect x={0} y={0} width={ML} height={H} className="ele-axis-bg" />
        {eleLines.map((e) => (
          <text key={e} x={ML - 5} y={y(e) + 3.5} textAnchor="end" className="tick ele-tick">{e} m</text>
        ))}
      </svg>
      <div className="zoom-btns" role="group" aria-label="Zoom du profil">
        <button className="ghost small" onClick={() => { grab(); zoomTo(zoom / 2) }} disabled={zoom <= minZoom + 1e-3} aria-label="Dézoomer le profil" title="Dézoomer">
          <Minus />
        </button>
        <button className="ghost small" onClick={() => { grab(); zoomTo(zoom * 2) }} disabled={zoom >= ZOOM_MAX - 1e-3} aria-label="Zoomer le profil" title="Zoomer">
          <Plus />
        </button>
      </div>
      {scrolls && free && follow !== null && (
        <button className="ghost small follow-btn" onClick={() => setFree(false)}>
          <Navigation className="inline" /> Suivre le coureur
        </button>
      )}
      <div className="mp-legend muted small">
        <span><i className="lg-leg" /> Entre deux points</span>
        <span><i className="lg-leg-ravito" /> Entre deux ravitos</span>
        {hasAssist && <span><i className="lg-assist" /> Assistance autorisée</span>}
        {hasBase && <span><i className="lg-base" /> Base de vie</span>}
        {hasBag && <span><i className="lg-bag" /> Dropbag</span>}
        {tech?.some((b) => b.v > 1) && <span><i className="lg-tech" /> Technicité</span>}
        {night?.length ? <span><i className="lg-night" /> Nuit</span> : null}
      </div>
    </div>
  )
}
