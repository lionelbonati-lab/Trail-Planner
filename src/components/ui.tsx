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

export function Card({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>
}
