import { ChevronDown } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
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
}: {
  title?: ReactNode
  children: ReactNode
  actions?: ReactNode
  className?: string
  fold?: 'open' | 'closed' | false
}) {
  // Seul un cadre à titre texte se plie (titre éditable, cadre sans titre : toujours ouvert).
  const foldable = typeof title === 'string' && fold !== false
  const [folded, setFolded] = useState(foldable && fold === 'closed')
  const toggle = () => setFolded(!folded)
  return (
    <section className={`card ${foldable ? 'foldable' : ''} ${folded ? 'folded' : ''} ${className ?? ''}`}>
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
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>
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
