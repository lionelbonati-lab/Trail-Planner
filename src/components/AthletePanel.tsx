import { averageIntensity } from '../lib/model'
import { formatPace } from '../lib/time'
import { DEFAULT_ZONES, hrZonesFromMax } from '../lib/defaults'
import { colorForIndex } from '../lib/zones'
import type { Athlete, DescentPoint, Durability, HrZone, Product, TrainingZone, VamPoint } from '../lib/types'
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

      <Card title="Zones d'entraînement" className="span2">
        <Hint>
          Les 7 zones de ton bilan VC, en pourcentage de ta VC, avec les couleurs Garmin (Z6 et Z7 : couleurs des zones de
          puissance, modifiables). Elles servent aux cibles des séances et au choix d'une zone sur le profil d'un parcours.
        </Hint>
        <table className="table compact">
          <thead>
            <tr><th>Zone</th><th>De (% VC)</th><th>À (% VC)</th><th>Allure</th><th>Vitesse</th><th>Utilisation</th><th>Durée tenable</th><th /></tr>
          </thead>
          <tbody>
            {athlete.zones.map((z, i) => {
              const setZ = (patch: Partial<TrainingZone>) => set('zones', athlete.zones.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              return (
                <tr key={i}>
                  <td className="nowrap">
                    <input type="color" className="zone-color" value={colorForIndex(i, athlete)} onChange={(e) => setZ({ color: e.target.value })} title="Couleur de la zone" aria-label={`Couleur de ${z.name}`} />
                    <input type="text" value={z.name} onChange={(e) => setZ({ name: e.target.value })} style={{ width: 90 }} />
                  </td>
                  <td><Num value={z.low} scale={100} width={64} min={20} max={200} onChange={(v) => setZ({ low: v })} /></td>
                  <td><Num value={z.high} scale={100} width={64} min={20} max={200} onChange={(v) => setZ({ high: v })} /></td>
                  <td>{formatPace(1000 / (athlete.cs * z.high))} – {formatPace(1000 / (athlete.cs * z.low))}/km</td>
                  <td className="muted">{(athlete.cs * z.low * 3.6).toFixed(2)} – {(athlete.cs * z.high * 3.6).toFixed(2)} km/h</td>
                  <td><input type="text" value={z.use ?? ''} onChange={(e) => setZ({ use: e.target.value })} style={{ width: 170 }} /></td>
                  <td><input type="text" value={z.sustain ?? ''} onChange={(e) => setZ({ sustain: e.target.value })} style={{ width: 130 }} /></td>
                  <td><button className="ghost" onClick={() => set('zones', athlete.zones.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="row">
          <button className="ghost" onClick={() => set('zones', [...athlete.zones, { name: `Zone ${athlete.zones.length + 1}`, low: 1, high: 1.1 }])}>+ Ajouter une zone</button>
          <button className="ghost" onClick={() => set('zones', DEFAULT_ZONES.map((z) => ({ ...z })))}>Zones du bilan VC</button>
          {athlete.zones.some((z) => z.color) && (
            <button className="ghost" onClick={() => set('zones', athlete.zones.map(({ color: _c, ...z }) => z))}>Couleurs Garmin</button>
          )}
        </div>
      </Card>

      <Card title="Zones cardiaques" className="span2">
        <Hint>
          Pour t'entraîner à la fréquence cardiaque : ces zones servent à l'analyse des séances importées (temps par zone, FC moyenne
          des tours) et, si tu le choisis, aux cibles des séances envoyées sur la montre. Par défaut, les zones Garmin en % de la FC max ;
          reprends celles de ton test ou de Garmin Connect si tu les connais.
        </Hint>
        <div className="fields">
          <Num label="FC max" value={athlete.hrMax} onChange={(v) => set('hrMax', v)} unit="bpm" min={100} max={240} />
          <button className="ghost" onClick={() => set('hrZones', hrZonesFromMax(athlete.hrMax))}>Calculer depuis la FC max</button>
        </div>
        <table className="table compact">
          <thead>
            <tr><th>Zone</th><th>De (bpm)</th><th>À (bpm)</th><th>% FC max</th><th>Zones VC correspondantes</th><th /></tr>
          </thead>
          <tbody>
            {athlete.hrZones.map((z, i) => {
              const setH = (patch: Partial<HrZone>) => set('hrZones', athlete.hrZones.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              const vc = vcZonesForHr(i, athlete)
              return (
                <tr key={i}>
                  <td className="nowrap"><i className="zone-swatch" style={{ background: colorForIndex(i) }} /><input type="text" value={z.name} onChange={(e) => setH({ name: e.target.value })} style={{ width: 90 }} /></td>
                  <td><Num value={z.low} width={60} min={40} max={240} onChange={(v) => setH({ low: v })} /></td>
                  <td><Num value={z.high} width={60} min={40} max={240} onChange={(v) => setH({ high: v })} /></td>
                  <td className="muted">{Math.round((z.low / athlete.hrMax) * 100)} – {Math.round((z.high / athlete.hrMax) * 100)} %</td>
                  <td className="muted">{vc}</td>
                  <td><button className="ghost" onClick={() => set('hrZones', athlete.hrZones.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="row">
          <button className="ghost" onClick={() => {
            const last = athlete.hrZones[athlete.hrZones.length - 1]
            set('hrZones', [...athlete.hrZones, { name: `Zone ${athlete.hrZones.length + 1}`, low: last?.high ?? 120, high: (last?.high ?? 120) + 10 }])
          }}>+ Ajouter une zone</button>
        </div>
        <h3>Cible des séances envoyées sur la montre</h3>
        <div className="seg">
          <button className={athlete.workoutTarget === 'pace' ? 'on' : ''} onClick={() => set('workoutTarget', 'pace')}>Allure</button>
          <button className={athlete.workoutTarget === 'hr' ? 'on' : ''} onClick={() => set('workoutTarget', 'hr')}>Fréquence cardiaque</button>
        </div>
        <Hint>
          {athlete.workoutTarget === 'hr'
            ? 'Chaque étape garde sa durée ou sa distance, mais la montre te guide sur la plage de FC de la zone correspondante (Z6 et Z7 → zone cardiaque la plus haute). Les tests VC restent sans cible : ils se courent à fond.'
            : 'Chaque étape est guidée par une plage d\'allure (± 5 % autour de la vitesse cible).'}
        </Hint>
      </Card>

      <Card title="Produits de nutrition" className="span2">
        <Hint>
          Tes produits habituels et la part des glucides que chacun apporte : le plan nutrition de chaque course en déduit
          le nombre de gels, flasques ou barres à emporter entre deux ravitos.
        </Hint>
        <table className="table compact">
          <thead>
            <tr><th>Produit</th><th>Glucides (g)</th><th>Sodium (mg)</th><th>Part des glucides (%)</th><th /></tr>
          </thead>
          <tbody>
            {athlete.products.map((p, i) => {
              const setP = (patch: Partial<Product>) => set('products', athlete.products.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              return (
                <tr key={p.id}>
                  <td><input type="text" value={p.name} onChange={(e) => setP({ name: e.target.value })} /></td>
                  <td><Num value={p.carbs} width={70} min={0} onChange={(v) => setP({ carbs: v })} /></td>
                  <td><Num value={p.sodium} width={70} min={0} onChange={(v) => setP({ sodium: v })} /></td>
                  <td><Num value={p.share} scale={100} width={70} min={0} max={100} onChange={(v) => setP({ share: v })} /></td>
                  <td><button className="ghost" onClick={() => set('products', athlete.products.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={5}>
                <button className="ghost" onClick={() => set('products', [...athlete.products, { id: crypto.randomUUID(), name: 'Nouveau produit', carbs: 25, sodium: 0, share: 0 }])}>
                  + Ajouter un produit
                </button>
                {Math.abs(athlete.products.reduce((a, p) => a + p.share, 0) - 1) > 0.01 && (
                  <span className="warn-text"> La somme des parts fait {Math.round(athlete.products.reduce((a, p) => a + p.share, 0) * 100)} % (elle est ramenée à 100 %).</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  )
}

/** Zones VC associées à une zone cardiaque pour la cible « FC » (Z6 et Z7 → zone cardiaque la plus haute). */
function vcZonesForHr(i: number, a: Athlete): string {
  const last = a.hrZones.length - 1
  const names = a.zones.filter((_, k) => Math.min(k, last) === i).map((z) => z.name.replace(/^Zone\s*/i, 'Z'))
  return names.join(', ') || '—'
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
