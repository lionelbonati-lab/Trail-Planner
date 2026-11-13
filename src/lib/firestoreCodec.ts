// Firestore n'accepte ni les tableaux de tableaux ni les valeurs undefined.
// À l'écriture, chaque tableau placé directement dans un tableau est enveloppé
// dans { __a: [...] } ; à la lecture, l'enveloppe est retirée.

export function encodeForFirestore(v: unknown, inArray = false): unknown {
  if (Array.isArray(v)) {
    const arr = v.map((x) => encodeForFirestore(x, true))
    return inArray ? { __a: arr } : arr
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .map(([k, x]) => [k, encodeForFirestore(x)]),
    )
  }
  return v === undefined ? null : v
}

export function decodeFromFirestore<T = unknown>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => decodeFromFirestore(x)) as T
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o)
    if (keys.length === 1 && keys[0] === '__a' && Array.isArray(o.__a)) return decodeFromFirestore(o.__a) as T
    return Object.fromEntries(keys.map((k) => [k, decodeFromFirestore(o[k])])) as T
  }
  return v as T
}

/** Vrai si la valeur contient un tableau directement dans un tableau (refusé par Firestore). */
export function hasNestedArray(v: unknown, inArray = false): boolean {
  if (Array.isArray(v)) return inArray || v.some((x) => hasNestedArray(x, true))
  if (v && typeof v === 'object') return Object.values(v).some((x) => hasNestedArray(x))
  return false
}
