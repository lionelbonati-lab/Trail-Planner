import { ChevronDown, Info, X } from 'lucide-react'
import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { formatPace, parseDuration } from '../lib/time'

interface NumProps {
  label?: ReactNode
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  unit?: string
  /** Facteur d'affichage (ex. 100 pour afficher un ratio en %). */
  scale?: number
  title?: string
  width?: number
}

/** Champ numérique qui garde la saisie en cours (virgule acceptée). */
export function Num({ label, value, onChange, step = 1, min, max, unit, scale = 1, title, width }: NumProps) {
  const shown = round(value * scale)
  const [text, setText] = useState(String(shown))
  useEffect(() => {
    setText((t) => (parseNum(t) === shown ? t : String(shown)))
  }, [shown])
  const input = (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      title={title}
      style={width ? { width } : undefined}
      onChange={(e) => {
        setText(e.target.value)
        const v = parseNum(e.target.value)
        if (v === null) return
        if (min !== undefined && v < min) return
        if (max !== undefined && v > max) return
        onChange(v / scale)
      }}
      onBlur={() => setText(String(shown))}
      data-step={step}
    />
  )
  if (!label) return unit ? <span className="num">{input}<span className="unit">{unit}</span></span> : input
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="num">
        {input}
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  )
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

function parseNum(s: string): number | null {
  const v = parseFloat(s.replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

/** Champ d'allure en min/km, valeur stockée en m/s. */
export function PaceField({ label, speed, onChange }: { label: ReactNode; speed: number; onChange: (mps: number) => void }) {
  const shown = formatPace(1000 / speed)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="num">
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const s = parseDuration(e.target.value)
            if (s && s > 120 && s < 1800) onChange(1000 / s)
          }}
          onBlur={() => setText(shown)}
        />
        <span className="unit">/km</span>
      </span>
    </label>
  )
}

export function Toggle({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/**
 * Cadre. Sur téléphone, un cadre à titre se plie et se déplie d'un toucher sur son titre, et chaque
 * page s'ouvre cadres pliés (pas de page à rallonge) : `fold` = « closed » (par défaut), « open » pour
 * le contenu principal d'une page, ou false pour un cadre toujours ouvert. L'état n'est gardé que le
 * temps de la page. Sur ordinateur, les cadres restent ouverts.
 */
export function Card({
  title,
  children,
  actions,
  className,
  fold = 'closed',
  foldDesktop = false,
}: {
  title?: ReactNode
  children: ReactNode
  actions?: ReactNode
  className?: string
  fold?: 'open' | 'closed' | false
  /** Pliable aussi sur ordinateur (cadre de réglages secondaires), plié à l'ouverture. */
  foldDesktop?: boolean
}) {
  // Seul un cadre à titre texte se plie (titre éditable, cadre sans titre : toujours ouvert).
  const foldable = typeof title === 'string' && fold !== false
  const [folded, setFolded] = useState(foldable && fold === 'closed')
  const toggle = () => setFolded(!folded)
  // Explication en tête du cadre : son (i) va dans l'en-tête, à côté du titre.
  const kids = Children.toArray(children)
  const headHint = title && isValidElement(kids[0]) && kids[0].type === Hint ? kids[0] : null
  return (
    <section className={`card ${foldable ? 'foldable' : ''} ${foldable && foldDesktop ? 'fold-desktop' : ''} ${folded ? 'folded' : ''} ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-head">
          {title &&
            (foldable ? (
              <button type="button" className="card-fold" onClick={toggle} aria-expanded={!folded}>
                <h2>{title}</h2>
                <ChevronDown className="fold-chevron" aria-hidden />
              </button>
            ) : (
              <h2>{title}</h2>
            ))}
          {headHint}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{headHint ? kids.slice(1) : children}</div>
    </section>
  )
}

/** Une seule bulle d'explication ouverte à la fois : l'ouverture d'une bulle ferme les autres. */
const HINT_OPEN = 'tp-hint-open'

/**
 * Explication repliée derrière une icône (i), à sa place dans la page : un toucher ouvre une bulle
 * par-dessus la page, fermée par son X (ou un toucher à côté, Échap).
 */
export function Hint({ children, label = 'Explications' }: { children: ReactNode; label?: string }) {
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const open = pos !== null
  // Sous l'icône, dans la largeur de l'écran (16 px de marge) ; au-dessus si la place manque en bas.
  const place = (height = 0) => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const vw = document.documentElement.clientWidth
    const width = Math.min(340, vw - 32)
    const left = Math.max(16, Math.min(r.left - 12, vw - width - 16)) + window.scrollX
    const below = r.bottom + 6
    const top = height && below + height > window.innerHeight - 8 && r.top - height - 6 > 8 ? r.top - height - 6 : below
    setPos({ top: top + window.scrollY, left, width })
  }
  const toggle = () => {
    if (open) return setPos(null)
    window.dispatchEvent(new CustomEvent(HINT_OPEN, { detail: id }))
    place()
  }
  const height = useRef(0)
  useLayoutEffect(() => {
    const h = bubble.current?.offsetHeight ?? 0
    if (open && h && h !== height.current) {
      height.current = h
      place(h)
    }
    if (!open) height.current = 0
  })
  useEffect(() => {
    if (!open) return
    const close = () => setPos(null)
    const onOther = (e: Event) => (e as CustomEvent<string>).detail !== id && close()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!bubble.current?.contains(t) && !btn.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      btn.current?.focus()
    }
    const onResize = () => place(height.current)
    window.addEventListener(HINT_OPEN, onOther)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener(HINT_OPEN, onOther)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- abonnements le temps que la bulle est ouverte
  }, [open, id])
  return (
    <>
      <button ref={btn} type="button" className={`hint-btn no-print ${open ? 'on' : ''}`} aria-label={label} title={label} aria-expanded={open} onClick={toggle}>
        <Info />
      </button>
      {open &&
        createPortal(
          <div ref={bubble} className="hint-bubble" role="dialog" aria-label={label} style={{ top: pos.top, left: pos.left, width: pos.width }}>
            <button type="button" className="ghost hint-close" aria-label="Fermer" onClick={() => setPos(null)}>
              <X />
            </button>
            <div className="hint-body">{children}</div>
          </div>,
          document.body,
        )}
    </>
  )
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}
