// Listes triables (glisser-déposer).

/** Liste réordonnée : l'élément en `from` déplacé en `to`. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, x)
  return next
}

/**
 * Place d'arrivée d'une ligne glissée : nombre des autres lignes dont le milieu (`mids`, positions au
 * début du glissement) est au-dessus du centre actuel de la ligne glissée.
 */
export function dropIndex(mids: number[], from: number, center: number): number {
  return mids.filter((m, k) => k !== from && m < center).length
}
