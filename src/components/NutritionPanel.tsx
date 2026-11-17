import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { brandsOf, isFlask, isFlaskWater, isSodiumProduct, per100, PRODUCT_TYPES, productType, SODIUM_CARBS_MAX, SODIUM_SOURCES, sodiumOrder, withPer100 } from '../lib/nutrition'
import { LIBRARY_BRANDS, libraryProduct, PRODUCT_LIBRARY } from '../lib/productLibrary'
import type { Athlete, Product, ProductType } from '../lib/types'
import { Card, Hint, Num } from './ui'

/** Onglet Nutrition : produits de l'athlète (gels, barres, isotonique en flasque), avec leur marque. */
export function NutritionPanel({ athlete, onChange }: { athlete: Athlete; onChange: (a: Athlete) => void }) {
  const products = athlete.products
  const set = (next: Product[]) => onChange({ ...athlete, products: next })
  const [libBrand, setLibBrand] = useState<string>(LIBRARY_BRANDS[0])
  const owned = new Set(products.map((p) => p.libraryId).filter(Boolean))
  return (
    <div className="grid two">
      <Card title="Mes produits" className="span2" fold="open">
        <Hint>
          Tes produits habituels : type, marque, glucides et sodium <strong>au 100 g</strong> (ou 100 ml) et poids d'une portion, comme
          sur l'étiquette ; la portion en est déduite. Le plan nutrition de chaque course en tire le nombre de gels ou de solides à
          emporter entre deux ravitos, selon la part des glucides. <strong>Sur ravito</strong> : aliment mangé ou bu au ravito (banane, bouillon…), compté
          dans le tronçon qui en part mais pas emporté (ni au départ, ni dans le sac ou les dropbags). <strong>Flasque</strong> (liquide) : ta boisson isotonique en poudre
          pour 500 ml d'eau (si plusieurs, la première retenue pour la course sert) ; un liquide sans flasque (bouillon, coca) se compte comme un gel ou un solide. Isotonique en flasque : une seule flasque d'isotonique si 500 ml suffisent sur le tronçon,
          sinon une d'eau et une d'isotonique, puis une de plus par 500 ml d'eau commencés (en alternant eau et isotonique),
          ses glucides et son sodium déduits du plan ; au-delà de 4 flasques, le plan signale qu'il faut remplir en route.
          L'eau est un <strong>liquide sans glucides</strong> : case Flasque cochée, elle remplit les flasques d'eau ; une eau
          minérale salée (St-Yorre : environ 850 mg de sodium par 500 ml) y est mélangée à l'eau plate, juste assez pour le sodium
          visé, puis à l'isotonique si les flasques d'eau ne suffisent pas (ou s'il n'y en a pas) ; case décochée : ignorée.
          <strong>Produit salé</strong> (moins de {SODIUM_CARBS_MAX} g de glucides par portion : bouillon, saucisson, salt caps) : compté pour le
          sodium qui manque au tronçon, au ravito de départ (case Sur ravito, deux portions au plus) ou emporté, dans l'ordre choisi
          plus bas ; le sel complète. Dans chaque course, la carte « Nutrition » choisit les produits retenus ou la marque présente aux
          ravitaillements.
        </Hint>
        <datalist id="tp-brands">{brandsOf(products).map((b) => <option key={b} value={b} />)}</datalist>
        <div className="scroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>Produit</th><th>Type</th><th title="Boisson en poudre pour une flasque de 500 ml">Flasque</th><th title="Mangé ou bu au ravito (fourni par l'organisation), pas emporté">Sur ravito</th><th>Marque</th>
              <th>Glucides /100 g</th><th>Sodium /100 g</th><th>Poids (g)</th><th>Par portion</th><th>Part des glucides (%)</th><th />
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => {
              const setP = (patch: Partial<Product>) => set(products.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              const v = per100(p)
              const setV = (patch: Partial<typeof v>) => set(products.map((x, j) => (j === i ? withPer100(x, { ...v, ...patch }) : x)))
              return (
                <tr key={p.id}>
                  <td><input type="text" value={p.name} onChange={(e) => setP({ name: e.target.value })} /></td>
                  <td>
                    <select value={productType(p)} onChange={(e) => setP({ type: e.target.value as ProductType, flask: undefined })} aria-label={`Type de ${p.name}`}>
                      {(Object.keys(PRODUCT_TYPES) as ProductType[]).map((t) => <option key={t} value={t}>{PRODUCT_TYPES[t]}</option>)}
                    </select>
                  </td>
                  <td>
                    {productType(p) === 'liquid' ? (
                      <input
                        type="checkbox"
                        checked={p.carbs > 0 ? isFlask(p) : isFlaskWater(p)}
                        onChange={(e) => setP({ flask: e.target.checked })}
                        aria-label={`${p.name} en flasque`}
                        title={p.carbs > 0 ? 'Poudre pour une flasque de 500 ml (isotonique)' : 'Eau des flasques (une eau salée y est mélangée) ; décochée : ignorée'}
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {isFlask(p) || isFlaskWater(p) ? (
                      <span className="muted">—</span>
                    ) : (
                      <input type="checkbox" checked={!!p.atRavito} onChange={(e) => setP({ atRavito: e.target.checked })} aria-label={`${p.name} sur ravito`} title="Mangé ou bu au ravito, pas emporté" />
                    )}
                  </td>
                  <td><input type="text" value={p.brand ?? ''} placeholder="—" list="tp-brands" size={10} onChange={(e) => setP({ brand: e.target.value || undefined })} aria-label={`Marque de ${p.name}`} /></td>
                  <td><Num value={v.carbs} width={60} min={0} unit="g" onChange={(x) => setV({ carbs: x })} /></td>
                  <td><Num value={v.sodium} width={64} min={0} unit="mg" onChange={(x) => setV({ sodium: x })} /></td>
                  <td><Num value={v.weight} width={60} min={1} unit="g" onChange={(x) => setV({ weight: Math.max(1, x) })} /></td>
                  <td className="muted small">{Math.round(p.carbs)} g gluc. · {Math.round(p.sodium)} mg Na</td>
                  <td>
                    {isFlask(p) ? (
                      <span className="muted">selon l’eau</span>
                    ) : isFlaskWater(p) ? (
                      <span className="muted">eau des flasques</span>
                    ) : isSodiumProduct(p) ? (
                      <span className="muted" title="Compté pour le sodium manquant, pas pour les glucides">pour le sodium</span>
                    ) : productType(p) === 'liquid' && !(p.carbs > 0) ? (
                      <span className="muted">—</span>
                    ) : (
                      <Num value={p.share} scale={100} width={70} min={0} max={100} onChange={(v) => setP({ share: v })} />
                    )}
                  </td>
                  <td><button className="ghost" onClick={() => set( products.filter((_, j) => j !== i))} aria-label="Supprimer"><Trash2 /></button></td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={11}>
                <button className="ghost" onClick={() => set([...products, withPer100({ id: crypto.randomUUID(), name: 'Nouveau produit', type: 'gel', carbs: 0, sodium: 0, share: 0 }, { carbs: 65, sodium: 100, weight: 40 })])}>
                  <Plus /> Ajouter un produit
                </button>
                {(() => {
                  const sum = products.filter((p) => !isFlask(p) && !isSodiumProduct(p) && p.carbs >= SODIUM_CARBS_MAX).reduce((a, p) => a + p.share, 0)
                  return Math.abs(sum - 1) > 0.01 ? <span className="warn-text"> La somme des parts fait {Math.round(sum * 100)} % (elle est ramenée à 100 %).</span> : null
                })()}
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </Card>

      <SodiumOrderCard athlete={athlete} onChange={onChange} />

      <Card title="Bibliothèque de produits" className="span2">
        <Hint>
          Produits fréquents aux ravitaillements et produits de quelques marques, saveurs aux apports presque identiques regroupées.
          Valeurs indicatives relevées sur les fiches des fabricants ou des revendeurs : vérifie l'étiquette. « Ajouter » copie le
          produit dans tes produits (modifiable).
        </Hint>
        <div className="seg lib-brands" role="group" aria-label="Marque">
          {LIBRARY_BRANDS.map((b) => (
            <button key={b} className={libBrand === b ? 'on' : ''} onClick={() => setLibBrand(b)}>{b}</button>
          ))}
        </div>
        <div className="scroll">
          <table className="table compact">
            <thead>
              <tr><th>Produit</th><th>Type</th><th>Glucides /100 g</th><th>Sodium /100 g</th><th>Portion</th><th /></tr>
            </thead>
            <tbody>
              {PRODUCT_LIBRARY.filter((it) => it.brand === libBrand).map((it) => (
                <tr key={it.id}>
                  <td>
                    <strong>{it.name}</strong>
                    {it.note && <div className="muted small">{it.note}</div>}
                  </td>
                  <td>{PRODUCT_TYPES[it.type]}{it.flask ? ' · flasque' : ''}</td>
                  <td>{it.carbs} g</td>
                  <td>{it.sodium} mg</td>
                  <td>{it.weight} g · {Math.round((it.carbs * it.weight) / 100)} g gluc. · {Math.round((it.sodium * it.weight) / 100)} mg Na</td>
                  <td>
                    {owned.has(it.id) ? (
                      <span className="muted small"><Check className="inline" /> ajouté</span>
                    ) : (
                      <button className="ghost" onClick={() => set([...products, libraryProduct(it)])}><Plus /> Ajouter</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button
            onClick={() => set([...products, ...PRODUCT_LIBRARY.filter((it) => it.brand === libBrand && !owned.has(it.id)).map(libraryProduct)])}
            disabled={PRODUCT_LIBRARY.filter((it) => it.brand === libBrand).every((it) => owned.has(it.id))}
          >
            <Plus /> Ajouter tous les produits {libBrand === 'Ravitaillement' ? 'de ravitaillement' : libBrand}
          </button>
        </div>
      </Card>
    </div>
  )
}

/** Ordre des sources de sodium : ce qui couvre d'abord le sodium manquant d'un tronçon (le sel en dernier). */
function SodiumOrderCard({ athlete, onChange }: { athlete: Athlete; onChange: (a: Athlete) => void }) {
  const order = sodiumOrder(athlete.sodiumOrder)
  const move = (i: number, by: number) => {
    const next = [...order]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    onChange({ ...athlete, sodiumOrder: next })
  }
  return (
    <Card title="Sodium : ordre des sources" className="span2" fold="open">
      <Hint>
        Gels, barres et isotonique apportent d'abord leur sodium ; ce qui manque au tronçon vient ensuite de ces sources, dans cet ordre
        (chacune seulement si elle fait partie des produits retenus pour la course), et le sel complète.
      </Hint>
      <ul className="sodium-order">
        {order.map((src, i) => (
          <li key={src}>
            <span>{i + 1}. {SODIUM_SOURCES[src]}</span>
            <span className="row tight">
              <button className="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Monter : ${SODIUM_SOURCES[src]}`}><ArrowUp /></button>
              <button className="ghost" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Descendre : ${SODIUM_SOURCES[src]}`}><ArrowDown /></button>
            </span>
          </li>
        ))}
        <li className="muted"><span>{order.length + 1}. Sel (le reste, au-delà de 150 mg)</span></li>
      </ul>
    </Card>
  )
}
