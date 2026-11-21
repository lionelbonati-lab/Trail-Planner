import { useEffect, useState } from 'react'

/** Vrai pendant `ms` après `set(true)` : message passager (« une notification de test arrive… »). */
export function useBriefly(ms: number): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!on) return
    const t = setTimeout(() => setOn(false), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return [on, setOn]
}
