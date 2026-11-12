import { averageIntensity } from '../lib/model'
import { formatPace } from '../lib/time'
import type { Athlete, DescentPoint, Durability, VamPoint } from '../lib/types'
import { Card, Hint, Num, PaceField } from './ui'

export function AthletePanel({ athlete, onChange }: { athlete: Athlete; onChange: (a: Athlete) => void }) {
  const set = <K extends keyof Athlete>(k: K, v: Athlete[K]) => onChange({ ...athlete, [k]: v })
  const setDur = (patch: Partial<Durability>) => set('durability', { ...athlete.durability, ...patch })
  const d = athlete.durability

  return (
    <div className="grid two">
      <Card title="Profil physiologique">
        <div className="fields">
          <label className="field">
            <span className="field-label">Nom</span>
            <input type="text" value={athlete.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <PaceField label="Vitesse critique (VC)" speed={athlete.cs} onChange={(v) => set('cs', v)} />
          <Num label="D′" value={athlete.dPrime} onChange={(v) => set('dPrime', v)} unit="m" min={0} />
          <Num
            label="Seuil de marche"
            value={athlete.walkThreshold}
            onChange={(v) => set('walkThreshold', v)}
            unit="% de pente"
            min={0}
            max={60}
          />
        </div>
        <Hint>
          VC = {(athlete.cs * 3.6).toFixed(2)} km/h. Au-delà du seuil de marche, le calcul utilise ta vitesse
          ascensionnelle ; en dessous, la course en côte suit le coût énergétique de Minetti.
        </Hint>
      </Card>

      <Card title="Durabilité et intensité">
        <div className="seg">
          <button className={d.mode === 'log' ? 'on' : ''} onClick={() => setDur({ mode: 'log' })}>
            Courbe log
          </button>
          <button className={d.mode === 'linear' ? 'on' : ''} onClick={() => setDur({ mode: 'linear' })}>
            Perte linéaire
          </button>
        </div>
        {d.mode === 'log' ? (
          <>
            <div className="fields">
              <Num label="%VC tenable 1 h" value={d.pct1h} scale={100} onChange={(v) => setDur({ pct1h: v })} unit="%" />
              <Num label="Durabilité k" value={d.k} scale={100} onChange={(v) => setDur({ k: v })} unit="% / ln(h)" />
              <Num label="Plancher" value={d.minPct} scale={100} onChange={(v) => setDur({ minPct: v })} unit="%" />
            </div>
            <Hint>
              %VC moyen sur une durée T : %VC₁ₕ − k·ln(T). Plus k est petit, plus tu es durable. Repère : un
              marathon de 3 h se court vers 85–90 % de la VC.
            </Hint>
          </>
        ) : (
          <>
            <div className="fields">
              <Num label="%VC de départ" value={d.basePct} scale={100} onChange={(v) => setDur({ basePct: v })} unit="%" />
              <Num label="Début de la perte" value={d.onsetH} onChange={(v) => setDur({ onsetH: v })} unit="h" />
              <Num label="Perte" value={d.lossPerH} scale={100} onChange={(v) => setDur({ lossPerH: v })} unit="% / h" />
              <Num label="Plancher" value={d.minPct} scale={100} onChange={(v) => setDur({ minPct: v })} unit="%" />
            </div>
          </>
        )}
        <IntensityTable athlete={athlete} />
      </Card>

      <Card title="Vitesse ascensionnelle selon la pente">
        <Hint>VAM tenue à l'intensité VC (environ 30–40 min à fond) ; elle est ensuite réduite par le %VC du moment.</Hint>
        <PointTable<VamPoint>
          rows={athlete.vam}
          cols={[
            { key: 'grade', label: 'Pente', unit: '%' },
            { key: 'vam', label: 'VAM', unit: 'm/h' },
          ]}
          onChange={(rows) => set('vam', rows)}
          blank={{ grade: 25, vam: 1000 }}
        />
      </Card>

      <Card title="Descente : vitesse par rapport au plat">
        <Hint>Coefficient appliqué à ta vitesse à plat du moment (1,10 = 10 % plus vite). La technicité s'ajoute par-dessus.</Hint>
        <PointTable<DescentPoint>
          rows={athlete.descent}
          cols={[
            { key: 'grade', label: 'Pente', unit: '%' },
            { key: 'factor', label: 'Coef.', unit: '×' },
          ]}
          onChange={(rows) => set('descent', rows)}
          blank={{ grade: -35, factor: 0.65 }}
        />
      </Card>
    </div>
  )
}

function IntensityTable({ athlete }: { athlete: Athlete }) {
  const durations = [1, 3, 6, 10, 15, 24, 36]
  return (
    <table className="table compact">
      <thead>
        <tr>
          <th>Durée</th>
          {durations.map((h) => (
            <th key={h}>{h} h</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>%VC</td>
          {durations.map((h) => (
            <td key={h}>{Math.round(averageIntensity(h, athlete.durability) * 100)}</td>
          ))}
        </tr>
        <tr>
          <td>Plat</td>
          {durations.map((h) => (
            <td key={h}>{formatPace(1000 / (athlete.cs * averageIntensity(h, athlete.durability)))}</td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

interface Col<T> {
  key: keyof T & string
  label: string
  unit: string
}

function PointTable<T extends object>({
  rows,
  cols,
  onChange,
  blank,
}: {
  rows: T[]
  cols: Col<T>[]
  onChange: (rows: T[]) => void
  blank: T
}) {
  return (
    <table className="table compact">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key}>
              {c.label} ({c.unit})
            </th>
          ))}
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c.key}>
                <Num
                  value={r[c.key] as number}
                  width={80}
                  onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: v } : x)))}
                />
              </td>
            ))}
            <td>
              <button className="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Supprimer">
                ✕
              </button>
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={cols.length + 1}>
            <button className="ghost" onClick={() => onChange([...rows, { ...blank }])}>
              + Ajouter une ligne
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  )
}
