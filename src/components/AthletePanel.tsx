import { Check, Copy, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { averageIntensity } from '../lib/model'
import { formatPace } from '../lib/time'
import { DEFAULT_ZONES } from '../lib/defaults'
import { GARMIN_PCT, HR_METHODS, hrPctOf, withHrZones } from '../lib/hr'
import { climbEquivalence, descentEquivalence, EP_DESCENT_RANGE, epPayload } from '../lib/endurancepro'
import { VAM_ZONE_COUNT, epVamThresholds, interpVam, vamRef, vamZonesFromCs, vamZonesOf } from '../lib/vam'
import { colorForIndex, wholeRouteZone } from '../lib/zones'
import type { Athlete, DescentPoint, Durability, HrZone, Product, Race, TrainingZone, VamPoint, VamZone } from '../lib/types'
import { LevelCard } from './LevelCard'
import { Card, Hint, Num, PaceField } from './ui'

export function AthletePanel({
  athlete,
  onChange,
  garmin,
  races = [],
}: {
  athlete: Athlete
  onChange: (a: Athlete) => void
  /** Courses et parcours : temps réalisé sur l'un d'eux pour estimer le niveau sans test VC. */
  races?: Race[]
  /** Connexion (la synchro passe par le compte) et course/séance envoyée à la montre. */
  garmin?: { signedIn: boolean; onWatch: Race | null }
}) {
  const set = <K extends keyof Athlete>(k: K, v: Athlete[K]) => onChange({ ...athlete, [k]: v })
  const setDur = (patch: Partial<Durability>) => set('durability', { ...athlete.durability, ...patch })
  const d = athlete.durability
  // Zones cardiaques : les bpm sont recalculés à chaque changement de méthode, de FC ou de %.
  const setHr = (patch: Partial<Athlete>) => onChange(withHrZones({ ...athlete, ...patch }))
  const { pct: hrPct, base: hrBase } = hrPctOf(athlete)

  return (
    <div className="grid two">
      <LevelCard athlete={athlete} races={races} onChange={onChange} />
      <Card title="Profil physiologique">
        <div className="fields">
          <label className="field">
            <span className="field-label">Nom</span>
            <input type="text" value={athlete.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <PaceField label="Vitesse critique (VC)" speed={athlete.cs} onChange={(v) => set('cs', v)} />
          <Num label="D′" value={athlete.dPrime} onChange={(v) => set('dPrime', v)} unit="m" min={0} />
          <Num label="Poids" value={athlete.weight} onChange={(v) => set('weight', v)} unit="kg" min={30} max={150} title="Sert au poids du sac au prorata du poids corporel" />
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
            <Hint>Début de la perte et perte par heure : le moment où ta dérive commence et son ampleur.</Hint>
          </>
        )}
        <IntensityTable athlete={athlete} />
        <DurabilityNotes athlete={athlete} />
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
                  <td><button className="ghost" onClick={() => set('zones', athlete.zones.filter((_, j) => j !== i))} aria-label="Supprimer"><Trash2 /></button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="row">
          <button className="ghost" onClick={() => set('zones', [...athlete.zones, { name: `Zone ${athlete.zones.length + 1}`, low: 1, high: 1.1 }])}>
            <Plus /> Ajouter une zone
          </button>
          <button className="ghost" onClick={() => set('zones', DEFAULT_ZONES.map((z) => ({ ...z })))}><RotateCcw /> Zones du bilan VC</button>
          {athlete.zones.some((z) => z.color) && (
            <button className="ghost" onClick={() => set('zones', athlete.zones.map(({ color: _c, ...z }) => z))}>Couleurs Garmin</button>
          )}
        </div>
      </Card>

      <VamZonesCard athlete={athlete} onChange={onChange} />

      <Card title="Zones cardiaques" className="span2">
        <Hint>
          Pour t'entraîner à la fréquence cardiaque : ces zones servent à l'analyse des séances importées (temps par zone, FC moyenne
          des tours) et, si tu le choisis, aux cibles des séances envoyées sur la montre. Elles se règlent en %, les bpm en sont déduits.
        </Hint>
        <div className="seg" role="group" aria-label="Méthode">
          {HR_METHODS.map((m) => (
            <button key={m.key} className={athlete.hrMethod === m.key ? 'on' : ''} onClick={() => setHr({ hrMethod: m.key })} title={m.title}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="fields">
          <Num label="FC max" value={athlete.hrMax} onChange={(v) => setHr({ hrMax: v })} unit="bpm" min={100} max={240} />
          {hrBase === 'reserve' && <Num label="FC repos" value={athlete.hrRest} onChange={(v) => setHr({ hrRest: v })} unit="bpm" min={25} max={120} />}
          {athlete.hrMethod === 'custom' && (
            <label className="field">
              <span className="field-label">Base des %</span>
              <span className="seg">
                <button className={athlete.hrBase === 'max' ? 'on' : ''} onClick={() => setHr({ hrBase: 'max' })}>FC max</button>
                <button className={athlete.hrBase === 'reserve' ? 'on' : ''} onClick={() => setHr({ hrBase: 'reserve' })} title="FC de réserve = FC max − FC repos">Réserve</button>
              </span>
            </label>
          )}
        </div>
        <Hint>
          {athlete.hrMethod === 'grappe'
            ? 'Échelle ESIE de F. Grappe : i1 à i5 en % de la FC max. Au-delà (i6, i7), la FC ne suit plus l\'effort : ces intensités se pilotent à l\'allure.'
            : athlete.hrMethod === 'karvonen'
              ? `Karvonen : % de la FC de réserve (FC max − FC repos = ${athlete.hrMax - athlete.hrRest} bpm), ajoutés à la FC repos.`
              : `Tes zones, en % de la ${athlete.hrBase === 'reserve' ? 'FC de réserve (ajoutés à la FC repos)' : 'FC max'}.`}
        </Hint>
        <table className="table compact">
          <thead>
            <tr><th>Zone</th><th>De (%)</th><th>À (%)</th><th>bpm</th><th>Zones VC correspondantes</th><th /></tr>
          </thead>
          <tbody>
            {hrPct.map((z, i) => {
              const custom = athlete.hrMethod === 'custom'
              const setP = (patch: Partial<HrZone>) => setHr({ hrPct: hrPct.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
              const bpm = athlete.hrZones[i]
              return (
                <tr key={i}>
                  <td className="nowrap">
                    <i className="zone-swatch" style={{ background: colorForIndex(i) }} />
                    {custom ? <input type="text" value={z.name} onChange={(e) => setP({ name: e.target.value })} style={{ width: 90 }} /> : z.name}
                  </td>
                  <td>{custom ? <Num value={z.low} scale={100} width={56} min={20} max={110} onChange={(v) => setP({ low: v })} /> : Math.round(z.low * 100)}</td>
                  <td>{custom ? <Num value={z.high} scale={100} width={56} min={20} max={110} onChange={(v) => setP({ high: v })} /> : Math.round(z.high * 100)}</td>
                  <td><strong>{bpm ? `${bpm.low} – ${bpm.high}` : '—'}</strong></td>
                  <td className="muted">{vcZonesForHr(i, athlete)}</td>
                  <td>
                    {custom && (
                      <button className="ghost" onClick={() => setHr({ hrPct: hrPct.filter((_, j) => j !== i) })} aria-label="Supprimer"><Trash2 /></button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {athlete.hrMethod === 'custom' && (
          <div className="row">
            <button className="ghost" onClick={() => {
              const last = hrPct[hrPct.length - 1]
              setHr({ hrPct: [...hrPct, { name: `Zone ${hrPct.length + 1}`, low: last?.high ?? 0.9, high: Math.min(1.1, (last?.high ?? 0.9) + 0.05) }] })
            }}>
              <Plus /> Ajouter une zone
            </button>
            <button className="ghost" onClick={() => setHr({ hrPct: GARMIN_PCT.map((z) => ({ ...z })) })}><RotateCcw /> Zones Garmin</button>
          </div>
        )}
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

      <EndurancePro athlete={athlete} onChange={onChange} signedIn={!!garmin?.signedIn} onWatch={garmin?.onWatch ?? null} />

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
                  <td><button className="ghost" onClick={() => set('products', athlete.products.filter((_, j) => j !== i))} aria-label="Supprimer"><Trash2 /></button></td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={5}>
                <button className="ghost" onClick={() => set('products', [...athlete.products, { id: crypto.randomUUID(), name: 'Nouveau produit', carbs: 25, sodium: 0, share: 0 }])}>
                  <Plus /> Ajouter un produit
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
              <button className="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Supprimer" aria-label="Supprimer">
                <Trash2 />
              </button>
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={cols.length + 1}>
            <button className="ghost" onClick={() => onChange([...rows, { ...blank }])}>
              <Plus /> Ajouter une ligne
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

/**
 * Durabilité : définition (Maunder et al., 2021 ; Meixner et al., 2025), dernier découplage
 * cardiaque mesuré, repères des études et leviers d'entraînement (synthèse courir-mieux.fr).
 */
function DurabilityNotes({ athlete }: { athlete: Athlete }) {
  const last = athlete.activities.find((r) => r.metrics?.decoupling !== undefined)
  const m = last?.metrics
  return (
    <>
      <h3>Ta durabilité</h3>
      <p className="small">
        La durabilité, c'est la façon dont tes capacités (VC, économie de course, VO₂max) se dégradent au fil d'un effort long,
        décrite par le moment où la dérive commence et son ampleur. Le profil ci-dessus la traduit en intensité tenable selon la durée ;
        sur le terrain, elle se mesure par le <strong>découplage cardiaque</strong> de tes sorties longues (onglet Analyse, avec la FC).
      </p>
      {m ? (
        <p className="small">
          Dernière mesure ({last!.date.slice(0, 10)}, {last!.name}) : découplage{' '}
          <strong>{m.decoupling! > 0 ? '+' : ''}{(m.decoupling! * 100).toFixed(1).replace('.', ',')} %</strong> sur {(m.driftHours ?? 0).toFixed(1).replace('.', ',')} h
          {m.driftOnsetH != null ? `, dérive à partir de ${Math.floor(m.driftOnsetH)} h ${String(Math.round((m.driftOnsetH % 1) * 60)).padStart(2, '0')}` : ', sans dérive nette'}.
        </p>
      ) : (
        <p className="muted small">Pas encore de mesure : analyse une sortie longue (1 h 30 et plus) enregistrée avec la FC.</p>
      )}
      <details className="small">
        <summary>Repères des études et comment l'améliorer</summary>
        <ul>
          <li>Après 1 h 30 à 2 h de course, la vitesse au seuil baisse de 3 à 7 % et le VO₂max de 3 à 7 % (Zanini, Hunter et Muniz-Pumares, 2025).</li>
          <li>En trail, un contre-la-montre refait après 90 min prend +7,7 % de temps, surtout dans les montées ; les descentes ne bougent pas (Lloria-Varella et al., 2025).</li>
          <li>La baisse varie beaucoup d'un coureur à l'autre, indépendamment du VO₂max ou du volume (Barsumyan et al., 2025).</li>
          <li>Pour la travailler : du volume sur le long terme, des sorties longues régulières, des portions à allure de course en fin de sortie longue.</li>
          <li>Basse comme haute intensité l'améliorent : la dérive apparaît 25 à 29 min plus tard après 10 semaines (Matomäki et al., 2023).</li>
          <li>Musculation : force maximale et pliométrie, 2 séances par semaine pendant 10 semaines, limitent la dégradation de l'économie de course (Zanini et al., 2025).</li>
        </ul>
      </details>
    </>
  )
}

/** Zones de vitesse ascensionnelle : % de la VAM à VC (comme les zones de VC) ou perso en m/h. */
function VamZonesCard({ athlete, onChange }: { athlete: Athlete; onChange: (a: Athlete) => void }) {
  const ref = vamRef(athlete)
  const custom = athlete.vamZoneMode === 'custom'
  const zones = vamZonesOf(athlete)
  const setMode = (mode: Athlete['vamZoneMode']) =>
    onChange({ ...athlete, vamZoneMode: mode, vamZones: mode === 'custom' && !athlete.vamZones.length ? vamZonesFromCs(athlete) : athlete.vamZones })
  const setZones = (vamZones: VamZone[]) => onChange({ ...athlete, vamZoneMode: 'custom', vamZones })
  const gentle = ref ? interpVam(athlete, VAM_GENTLE_GRADE) : 0
  const csSorted = [...athlete.zones].sort((x, y) => x.low - y.low)
  return (
    <Card title="Zones de vitesse ascensionnelle" className="span2">
      <Hint>
        Pour piloter tes montées à la VAM (m de D+ par heure) : ces zones servent à l'analyse des séances (temps par zone VAM dans
        les montées) et aux couleurs VAM d'EndurancePro sur la montre, si la synchronisation est activée.
      </Hint>
      <div className="seg" role="group" aria-label="Méthode des zones VAM">
        <button className={!custom ? 'on' : ''} onClick={() => setMode('cs')} title="Mêmes % que tes zones de VC, appliqués à ta VAM à VC">
          % de ta VAM à VC
        </button>
        <button className={custom ? 'on' : ''} onClick={() => setMode('custom')} title="Tes propres valeurs en m/h">
          Perso
        </button>
      </div>
      <Hint>
        {!ref
          ? 'Renseigne ta VAM selon la pente pour calculer ces zones.'
          : custom
            ? `Tes zones en m/h. Le % indique où elles se situent par rapport à ta VAM à VC (${ref.vam} m/h sur ${ref.grade} %).`
            : `Référence : ${ref.vam} m/h, ta meilleure VAM à VC (sur ${ref.grade} %, tableau « Vitesse ascensionnelle selon la pente »). ` +
              `5 zones comme la FC : la VAM suivant l'intensité, Z1 à Z4 reprennent les % de tes zones de VC, Z5 couvre le voisinage ` +
              `de VC et au-delà. Sur pente plus douce, la même intensité donne une VAM plus faible (${Math.round(gentle)} m/h à ` +
              `${VAM_GENTLE_GRADE} % à VC).`}
      </Hint>
      {zones.length > 0 && (
        <table className="table compact">
          <thead>
            <tr><th>Zone</th><th>De (m/h)</th><th>À (m/h)</th><th>% VAM à VC</th>{custom ? <th /> : <th>Utilisation</th>}</tr>
          </thead>
          <tbody>
            {zones.map((z, i) => {
              const setZ = (patch: Partial<VamZone>) => setZones(zones.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              const pct = (v: number) => (ref ? Math.round((v / ref.vam) * 100) : '—')
              // Dernière zone calculée : ouverte vers le haut (« et plus »).
              const open = !custom && i === zones.length - 1
              return (
                <tr key={i}>
                  <td className="nowrap">
                    <i className="zone-swatch" style={{ background: colorForIndex(i) }} />
                    {custom ? <input type="text" value={z.name} onChange={(e) => setZ({ name: e.target.value })} style={{ width: 90 }} /> : z.name}
                  </td>
                  <td>{custom ? <Num value={z.low} width={64} min={0} max={4000} onChange={(v) => setZ({ low: v })} /> : z.low}</td>
                  <td>{custom ? <Num value={z.high} width={64} min={0} max={4000} onChange={(v) => setZ({ high: v })} /> : open ? 'et plus' : z.high}</td>
                  <td className="muted">{open ? `${pct(z.low)} % et plus` : `${pct(z.low)} – ${pct(z.high)} %`}</td>
                  {custom ? (
                    <td><button className="ghost" onClick={() => setZones(zones.filter((_, j) => j !== i))} aria-label="Supprimer"><Trash2 /></button></td>
                  ) : (
                    <td className="muted">{open && csSorted.length > VAM_ZONE_COUNT ? 'Voisinage de VC et au-delà' : (csSorted[i]?.use ?? '')}</td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {custom && (
        <div className="row">
          {zones.length < VAM_ZONE_COUNT && (
            <button
              className="ghost"
              onClick={() => {
                const last = zones[zones.length - 1]
                setZones([...zones, { name: `Zone ${zones.length + 1}`, low: last?.high ?? 600, high: (last?.high ?? 600) + 100 }])
              }}
            >
              <Plus /> Ajouter une zone
            </button>
          )}
          {ref && <button className="ghost" onClick={() => setZones(vamZonesFromCs(athlete))}><RotateCcw /> Repartir des zones calculées</button>}
        </div>
      )}
    </Card>
  )
}

/** Pente douce citée en exemple dans l'aide des zones VAM (%). */
const VAM_GENTLE_GRADE = 10

/** Synchronisation du datafield Garmin EndurancePro : VC, zones, équivalence montée, zone d'alarme. */
function EndurancePro({ athlete, onChange, signedIn, onWatch }: { athlete: Athlete; onChange: (a: Athlete) => void; signedIn: boolean; onWatch: Race | null }) {
  const [copied, setCopied] = useState(false)
  const on = !!athlete.epSync
  const up = climbEquivalence(athlete)
  const dn = descentEquivalence(athlete)
  const k = onWatch && onWatch.kind !== 'race' ? wholeRouteZone(onWatch.zones, athlete) : null
  const sorted = [...athlete.zones].sort((a, b) => a.low - b.low).slice(0, 7)
  const vz = epVamThresholds(athlete)
  const toggle = (v: boolean) =>
    onChange({ ...athlete, epSync: v, watchId: athlete.watchId ?? (v ? crypto.randomUUID().replace(/-/g, '') : undefined) })
  const copy = () => {
    if (!athlete.watchId) return
    navigator.clipboard?.writeText(athlete.watchId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <Card title="Montre Garmin : EndurancePro" className="span2">
      <Hint>
        EndurancePro garde la colorisation et l'alarme de son allure cible (vert dans la cible, orange et alarme quand tu vas trop
        vite) ; la cible peut être une allure, une zone de VC ou un % de VC (réglage « Référence » du dossier Allure). Avec la
        synchronisation, il reprend tout seul ta VC, tes zones, les équivalences montée et descente (déduites de ta VAM et de tes coefficients de descente), tes zones VAM et la zone de la séance
        envoyée à la montre : à chaque mise à jour ici, la montre suit (au lancement d'une activité, puis toutes les 30 min, téléphone
        connecté).
      </Hint>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /> Synchroniser EndurancePro avec ce profil
      </label>
      {on && !signedIn && <p className="warn-text">Connecte-toi : la synchronisation passe par ton compte.</p>}
      {on && signedIn && (
        <>
          <div className="row ep-code">
            <span>Code à saisir sur la montre :</span>
            {athlete.epCode ? (
              <strong className="ep-short" aria-label={`Code ${athlete.epCode.split('').join(' ')}`}>
                {`${athlete.epCode.slice(0, 4)} ${athlete.epCode.slice(4)}`}
              </strong>
            ) : (
              <span className="muted">création du code…</span>
            )}
          </div>
          <Hint>
            Sur la montre : menu d'EndurancePro › Allure › <strong>Trail Planner</strong>, saisis les 8 chiffres puis valide (00000000
            efface le code). La ligne affiche ensuite « Synchro hh:mm » à chaque mise à jour. C'est le même code que pour le champ
            Trail Planner. Une séance envoyée à la montre avec une zone sur tout le parcours devient la cible (référence « Zone VC »).
          </Hint>
          {athlete.watchId && (
            <details className="small">
              <summary>Code long, pour les paramètres téléphone (EndurancePro installé depuis le Store)</summary>
              <div className="row">
                <code className="watch-code">{athlete.watchId}</code>
                <button className="ghost" onClick={copy}>{copied ? <><Check /> Copié</> : <><Copy /> Copier</>}</button>
              </div>
              <Hint>
                Garmin Connect › ta montre › Activités et applications › EndurancePro › Paramètres › Code Trail Planner. C'est le même
                code que pour le champ Trail Planner.
              </Hint>
            </details>
          )}
        </>
      )}
      <table className="table compact">
        <tbody>
          <tr><td>Vitesse critique</td><td><strong>{formatPace(1000 / athlete.cs)}/km</strong> <span className="muted">({(athlete.cs * 3.6).toFixed(2)} km/h)</span></td></tr>
          <tr>
            <td>Zones</td>
            <td>
              {sorted.map((z, i) => (
                <span key={i} className="ep-zone">
                  <i className="zone-swatch" style={{ background: colorForIndex(athlete.zones.indexOf(z), athlete) }} />
                  {z.name.replace(/^Zone\s*/i, 'Z')} {Math.round(z.low * 100)}–{Math.round(z.high * 100)} %
                </span>
              ))}
            </td>
          </tr>
          <tr>
            <td>Équivalence montée</td>
            <td>{up ? <><strong>{up} m</strong> de D+ = 1 km à plat <span className="muted">(d'après ta VAM à VC ; défaut EndurancePro : 100 m)</span></> : '—'}</td>
          </tr>
          <tr>
            <td>Équivalence descente</td>
            <td>
              {dn ? (
                <>
                  <strong>{dn} m</strong> de D- = 1 km à plat{' '}
                  <span className="muted">
                    (d'après tes coefficients de descente{dn >= EP_DESCENT_RANGE[1] ? ' : en moyenne, la descente te ralentit peu, valeur au plafond du réglage' : dn <= EP_DESCENT_RANGE[0] ? ' : valeur au plancher du réglage' : ''} ; défaut EndurancePro : 330 m)
                  </span>
                </>
              ) : (
                '—'
              )}
            </td>
          </tr>
          <tr>
            <td>Couleurs VAM</td>
            <td>
              {vz ? (
                <>
                  {['Z1', 'Z2', 'Z3', 'Z4'].map((name, i) => (
                    <span key={name} className="ep-zone">
                      <i className="zone-swatch" style={{ background: colorForIndex(i) }} />
                      {name} {vz[i]}–{vz[i + 1]}
                    </span>
                  ))}
                  <span className="ep-zone">
                    <i className="zone-swatch" style={{ background: colorForIndex(4) }} />
                    Z5 dès {vz[4]} m/h
                  </span>
                  <span className="muted"> (pas de couleur sous {vz[0]} m/h)</span>
                </>
              ) : (
                '—'
              )}
            </td>
          </tr>
          <tr>
            <td>Zone cible</td>
            <td>
              {k !== null && onWatch ? (
                <><strong>{athlete.zones[k].name}</strong> <span className="muted">(« {onWatch.name} », envoyée à la montre)</span></>
              ) : (
                <span className="muted">inchangée (réglée sur la montre) : envoie à la montre une séance avec une zone sur tout le parcours pour la régler d'ici</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      {on && <p className="muted small">Données publiées : <code>{epPayload(athlete, onWatch)}</code></p>}
    </Card>
  )
}
