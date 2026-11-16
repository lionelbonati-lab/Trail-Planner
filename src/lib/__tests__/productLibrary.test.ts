import { describe, expect, it } from 'vitest'
import { isFlask, per100, productType, withPer100 } from '../nutrition'
import { LIBRARY_BRANDS, libraryProduct, PRODUCT_LIBRARY, RAVITO_BRAND } from '../productLibrary'
import type { Product } from '../types'

describe('produits au 100 g', () => {
  it('portion tirée des valeurs au 100 g et du poids', () => {
    const p = withPer100({ id: 'g', name: 'Gel', type: 'gel', carbs: 0, sodium: 0, share: 0.5 }, { carbs: 62.5, sodium: 50, weight: 40 })
    expect(p.carbs).toBe(25)
    expect(p.sodium).toBe(20)
    expect(per100(p)).toEqual({ carbs: 62.5, sodium: 50, weight: 40 })
  })
  it('anciens produits (valeurs par portion) : valeurs au 100 g déduites d’un poids par défaut', () => {
    const old: Product = { id: 'gel', name: 'Gel', carbs: 25, sodium: 50, share: 0.5 }
    expect(per100(old)).toEqual({ carbs: 62.5, sodium: 125, weight: 40 })
  })
  it('case flasque : un liquide sans flasque (bouillon) n’est pas l’isotonique', () => {
    const iso: Product = { id: 'i', name: 'Iso', type: 'liquid', carbs: 30, sodium: 300, share: 0 }
    expect(isFlask(iso)).toBe(true)
    expect(isFlask({ ...iso, flask: false })).toBe(false)
    expect(isFlask({ id: 'boisson', name: 'Boisson (500 ml)', carbs: 30, sodium: 300, share: 0.3 })).toBe(true)
  })
})

describe('bibliothèque de base', () => {
  it('ravitaillements et marques demandées, identifiants uniques', () => {
    expect(LIBRARY_BRANDS[0]).toBe(RAVITO_BRAND)
    for (const b of ['Sponser', 'Baouw', 'Näak', 'TA Energy', 'Overstim.s', 'Maurten', 'Decathlon']) expect(LIBRARY_BRANDS).toContain(b)
    expect(new Set(PRODUCT_LIBRARY.map((p) => p.id)).size).toBe(PRODUCT_LIBRARY.length)
    for (const n of ['Banane', 'Orange', 'Bouillon']) expect(PRODUCT_LIBRARY.some((p) => p.brand === RAVITO_BRAND && p.name.includes(n))).toBe(true)
  })
  it('article copié en produit : portion calculée, flasque pour les poudres', () => {
    const dm = libraryProduct(PRODUCT_LIBRARY.find((p) => p.id === 'maurten-dm320')!)
    expect(dm.carbs).toBe(79)
    expect(dm.brand).toBe('Maurten')
    expect(isFlask(dm)).toBe(true)
    const bouillon = libraryProduct(PRODUCT_LIBRARY.find((p) => p.id === 'rv-bouillon')!)
    expect(productType(bouillon)).toBe('liquid')
    expect(isFlask(bouillon)).toBe(false)
    expect(bouillon.sodium).toBe(700)
  })
})
