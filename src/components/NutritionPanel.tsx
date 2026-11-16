import { Plus, Trash2 } from 'lucide-react'
import { brandsOf, isFlask, PRODUCT_TYPES, productType } from '../lib/nutrition'
import type { Athlete, Product, ProductType } from '../lib/types'
import { Card, Hint, Num } from './ui'

/** Onglet Nutrition : produits de l'athlète (gels, barres, isotonique en flasque), avec leur marque. */
export function NutritionPanel({ athlete, onChange }: { athlete: Athlete; onChange: (a: Athlete) => void }) {
  const products = athlete.products
  const set = (next: Product[]) => onChange({ ...athlete, products: next })
  return (
    <div className="grid two">
      <Card title="Mes produits" className="span2" fold="open">
        <Hint>
          Tes produits habituels, leur type, leur marque et la part des glucides que chacun apporte : le plan nutrition de chaque
          course en déduit le nombre de gels ou de solides à emporter entre deux ravitos. <strong>Liquide</strong> : ta boisson
          isotonique en flasque (poudre pour 500 ml d'eau) : une seule flasque d'isotonique si 500 ml suffisent sur le tronçon,
          sinon une d'eau et une d'isotonique, puis une de plus par 500 ml d'eau commencés (en alternant eau et isotonique),
          ses glucides et son sodium déduits du plan ; au-delà de 4 flasques, le plan signale qu'il faut remplir en route.
          <strong> Eau</strong> : sans glucides, pas comptée dans le plan. Dans chaque course, la carte « Nutrition » choisit les
          produits retenus ou la marque présente aux ravitaillements.
        </Hint>
        <datalist id="tp-brands">{brandsOf(products).map((b) => <option key={b} value={b} />)}</datalist>
        <div className="scroll">
        <table className="table compact">
          <thead>
            <tr><th>Produit</th><th>Type</th><th>Marque</th><th>Glucides (g)</th><th>Sodium (mg)</th><th>Part des glucides (%)</th><th /></tr>
          </thead>
          <tbody>
            {products.map((p, i) => {
              const setP = (patch: Partial<Product>) => set( products.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              return (
                <tr key={p.id}>
                  <td><input type="text" value={p.name} onChange={(e) => setP({ name: e.target.value })} /></td>
                  <td>
                    <select value={productType(p)} onChange={(e) => setP({ type: e.target.value as ProductType, flask: undefined })} aria-label={`Type de ${p.name}`}>
                      {(Object.keys(PRODUCT_TYPES) as ProductType[]).map((t) => <option key={t} value={t}>{PRODUCT_TYPES[t]}</option>)}
                    </select>
                  </td>
                  <td><input type="text" value={p.brand ?? ''} placeholder="—" list="tp-brands" size={10} onChange={(e) => setP({ brand: e.target.value || undefined })} aria-label={`Marque de ${p.name}`} /></td>
                  <td><Num value={p.carbs} width={70} min={0} onChange={(v) => setP({ carbs: v })} /></td>
                  <td><Num value={p.sodium} width={70} min={0} onChange={(v) => setP({ sodium: v })} /></td>
                  <td>
                    {productType(p) === 'liquid' ? (
                      <span className="muted">selon l’eau</span>
                    ) : productType(p) === 'water' ? (
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
              <td colSpan={7}>
                <button className="ghost" onClick={() => set( [...products, { id: crypto.randomUUID(), name: 'Nouveau produit', carbs: 25, sodium: 0, share: 0 }])}>
                  <Plus /> Ajouter un produit
                </button>
                {(() => {
                  const sum = products.filter((p) => !isFlask(p)).reduce((a, p) => a + p.share, 0)
                  return Math.abs(sum - 1) > 0.01 ? <span className="warn-text"> La somme des parts fait {Math.round(sum * 100)} % (elle est ramenée à 100 %).</span> : null
                })()}
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  )
}
