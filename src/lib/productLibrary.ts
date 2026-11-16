// Bibliothèque de base : produits fréquents aux ravitaillements et produits de quelques marques.
// Valeurs au 100 g (ou 100 ml) et poids d'une portion, relevées sur les fiches des fabricants ou des
// revendeurs (novembre 2026) : indicatives, à vérifier sur l'étiquette. Les saveurs d'une même gamme
// aux apports presque identiques (à quelques grammes près) sont regroupées en un seul article.
import { withPer100 } from './nutrition'
import type { Product, ProductType } from './types'

export interface LibraryItem {
  id: string
  /** Marque, ou « Ravitaillement » pour les aliments servis aux ravitos. */
  brand: string
  name: string
  type: ProductType
  /** Glucides et sodium au 100 g (ou 100 ml), poids d'une portion (g). */
  carbs: number
  sodium: number
  weight: number
  /** Boisson en flasque de 500 ml (poudre). */
  flask?: boolean
  /** Saveurs regroupées, précision de portion. */
  note?: string
}

export const RAVITO_BRAND = 'Ravitaillement'

export const PRODUCT_LIBRARY: LibraryItem[] = [
  // Ravitaillements courants.
  { id: 'rv-banane', brand: RAVITO_BRAND, name: 'Banane (½)', type: 'solid', carbs: 21, sodium: 1, weight: 60, note: 'demi-banane' },
  { id: 'rv-orange', brand: RAVITO_BRAND, name: 'Orange (quartiers)', type: 'solid', carbs: 9, sodium: 0, weight: 60, note: '2 à 3 quartiers' },
  { id: 'rv-abricot', brand: RAVITO_BRAND, name: 'Abricots secs', type: 'solid', carbs: 55, sodium: 10, weight: 30, note: '4 à 5 abricots' },
  { id: 'rv-raisins', brand: RAVITO_BRAND, name: 'Raisins secs', type: 'solid', carbs: 75, sodium: 20, weight: 30, note: 'une poignée' },
  { id: 'rv-pate-fruits', brand: RAVITO_BRAND, name: 'Pâte de fruits', type: 'solid', carbs: 75, sodium: 10, weight: 25 },
  { id: 'rv-pain-epices', brand: RAVITO_BRAND, name: "Pain d'épices", type: 'solid', carbs: 70, sodium: 240, weight: 30, note: '1 tranche' },
  { id: 'rv-biscuit', brand: RAVITO_BRAND, name: 'Biscuits secs (petit-beurre)', type: 'solid', carbs: 75, sodium: 400, weight: 25, note: '3 biscuits' },
  { id: 'rv-chocolat', brand: RAVITO_BRAND, name: 'Chocolat', type: 'solid', carbs: 50, sodium: 10, weight: 20, note: '2 carrés' },
  { id: 'rv-chips', brand: RAVITO_BRAND, name: 'Chips', type: 'solid', carbs: 50, sodium: 520, weight: 25 },
  { id: 'rv-crackers', brand: RAVITO_BRAND, name: 'Crackers salés (type TUC)', type: 'solid', carbs: 60, sodium: 800, weight: 20 },
  { id: 'rv-fromage', brand: RAVITO_BRAND, name: 'Fromage (Comté)', type: 'solid', carbs: 0, sodium: 300, weight: 20 },
  { id: 'rv-saucisson', brand: RAVITO_BRAND, name: 'Saucisson', type: 'solid', carbs: 2, sodium: 1600, weight: 20 },
  { id: 'rv-soupe', brand: RAVITO_BRAND, name: 'Soupe de pâtes / vermicelles', type: 'solid', carbs: 8, sodium: 300, weight: 250, note: 'un bol (base de vie)' },
  { id: 'rv-bouillon', brand: RAVITO_BRAND, name: 'Bouillon', type: 'liquid', carbs: 1, sodium: 350, weight: 200, note: 'un gobelet' },
  { id: 'rv-coca', brand: RAVITO_BRAND, name: 'Coca-Cola', type: 'liquid', carbs: 10.6, sodium: 5, weight: 150, note: 'un gobelet' },
  { id: 'rv-st-yorre', brand: RAVITO_BRAND, name: 'Eau gazeuse salée (St-Yorre)', type: 'liquid', carbs: 0, sodium: 170, weight: 500, flask: true, note: 'mélangée à l’eau des flasques' },

  // Baouw (bio).
  { id: 'baouw-stick', brand: 'Baouw', name: 'Gel stick 44 g', type: 'gel', carbs: 69, sodium: 50, weight: 44, note: 'citron-yuzu, caramel salé, framboise-grenade, cerise-guarana…' },
  { id: 'baouw-gel-85', brand: 'Baouw', name: 'Gel naturel 85 g', type: 'gel', carbs: 35, sodium: 4, weight: 85, note: 'banane-vanille, pêche-thé matcha, fruits rouges-hibiscus' },
  { id: 'baouw-puree', brand: 'Baouw', name: 'Purée énergétique fruits 90 g', type: 'gel', carbs: 14, sodium: 10, weight: 90, note: 'poire-pomme-menthe, banane-kiwi, framboise-fraise…' },
  { id: 'baouw-puree-salee', brand: 'Baouw', name: 'Purée salée légumes 90 g', type: 'gel', carbs: 16, sodium: 250, weight: 90, note: 'patate douce-carotte, petits pois, cari de légumes…' },
  { id: 'baouw-barre-extra', brand: 'Baouw', name: 'Barre Extra 50 g', type: 'solid', carbs: 50, sodium: 100, weight: 50, note: 'chocolat-noisette, framboise-pistache, banane-pécan…' },

  // Näak.
  { id: 'naak-bar', brand: 'Näak', name: 'Ultra Energy Bar 50 g', type: 'solid', carbs: 56, sodium: 360, weight: 50, note: 'toutes saveurs' },
  { id: 'naak-gel', brand: 'Näak', name: 'Ultra Energy Gel', type: 'gel', carbs: 49, sodium: 330, weight: 57, note: 'sirop d’érable salé, chocolat…' },
  { id: 'naak-drink', brand: 'Näak', name: 'Ultra Energy Drink Mix (dose)', type: 'liquid', carbs: 76, sodium: 556, weight: 72, flask: true, note: '72 g (2 mesures) pour une flasque ; citron vert, ananas-ginseng, pêche-abricot…' },

  // TA Energy.
  { id: 'ta-gel', brand: 'TA Energy', name: 'Energie Gel 40 ml', type: 'gel', carbs: 82, sodium: 250, weight: 40, note: 'pastèque salée, vanille, caramel salé… (café : moins de sodium)' },
  { id: 'ta-jelly', brand: 'TA Energy', name: 'Jelly Gel 51 g', type: 'gel', carbs: 68, sodium: 392, weight: 51, note: 'neutre, citron-yuzu, fruits des bois' },
  { id: 'ta-drink', brand: 'TA Energy', name: 'Energy Drink Mix (dose)', type: 'liquid', carbs: 88, sodium: 875, weight: 40, flask: true, note: '40 g pour une flasque ; tropical, cola, fruits rouges, citron' },

  // Overstim.s.
  { id: 'ovs-gel-antiox', brand: 'Overstim.s', name: 'Gel Antioxydant 34 g', type: 'gel', carbs: 75, sodium: 212, weight: 34, note: 'toutes saveurs' },
  { id: 'ovs-hydrixir', brand: 'Overstim.s', name: 'Hydrixir Antioxydant (dose)', type: 'liquid', carbs: 88, sodium: 660, weight: 42, flask: true, note: 'une dose pour une flasque' },

  // Maurten.
  { id: 'maurten-gel100', brand: 'Maurten', name: 'Gel 100 (et Caf 100)', type: 'gel', carbs: 62.5, sodium: 50, weight: 40 },
  { id: 'maurten-gel160', brand: 'Maurten', name: 'Gel 160', type: 'gel', carbs: 61.5, sodium: 45, weight: 65 },
  { id: 'maurten-dm160', brand: 'Maurten', name: 'Drink Mix 160', type: 'liquid', carbs: 97.5, sodium: 500, weight: 40, flask: true, note: 'un sachet pour 500 ml' },
  { id: 'maurten-dm320', brand: 'Maurten', name: 'Drink Mix 320', type: 'liquid', carbs: 98.8, sodium: 500, weight: 80, flask: true, note: 'un sachet pour 500 ml' },

  // Sponser.
  { id: 'sponser-liquid', brand: 'Sponser', name: 'Liquid Energy tube 70 g', type: 'gel', carbs: 70, sodium: 172, weight: 70, note: 'Pure et Plus (caféine)' },
  { id: 'sponser-competition', brand: 'Sponser', name: 'Competition (dose)', type: 'liquid', carbs: 90, sodium: 580, weight: 30, flask: true, note: '30 g pour 500 ml' },

  // Decathlon.
  { id: 'dkt-gel', brand: 'Decathlon', name: 'Energy Gel 32 g', type: 'gel', carbs: 72, sodium: 100, weight: 32, note: 'courte et longue distance, toutes saveurs' },
  { id: 'dkt-barre-clak', brand: 'Decathlon', name: 'Barre céréales Clak 21 g', type: 'solid', carbs: 70, sodium: 140, weight: 21, note: 'chocolat, chocolat-caramel, fruits rouges' },
  { id: 'dkt-barre-amande', brand: 'Decathlon', name: "Barre pâte d'amande 25 g", type: 'solid', carbs: 58, sodium: 200, weight: 25, note: 'nature, miel, banane, bio' },
  { id: 'dkt-iso-plus', brand: 'Decathlon', name: 'Boisson ISO+ (dose)', type: 'liquid', carbs: 86, sodium: 1040, weight: 38, flask: true, note: '38 g pour 500 ml' },
]

/** Article de la bibliothèque en produit de l'athlète (part des glucides par défaut selon le type). */
export function libraryProduct(item: LibraryItem): Product {
  const share = item.type === 'gel' ? 0.5 : item.type === 'solid' ? 0.3 : 0
  const base: Product = {
    id: crypto.randomUUID(),
    libraryId: item.id,
    name: item.name,
    brand: item.brand,
    type: item.type,
    share,
    carbs: 0,
    sodium: 0,
    ...(item.type === 'liquid' ? { flask: !!item.flask } : {}),
    // Aliments servis aux ravitos : mangés sur place (sauf l'eau des flasques).
    ...(item.brand === RAVITO_BRAND && !item.flask ? { atRavito: true } : {}),
  }
  return withPer100(base, { carbs: item.carbs, sodium: item.sodium, weight: item.weight })
}

/** Marques de la bibliothèque, dans l'ordre (ravitaillements d'abord). */
export const LIBRARY_BRANDS = [...new Set(PRODUCT_LIBRARY.map((p) => p.brand))]
