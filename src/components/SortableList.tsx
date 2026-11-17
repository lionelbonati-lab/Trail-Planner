import { GripVertical } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { dropIndex, moveItem } from '../lib/order'

interface Drag {
  from: number
  to: number
  dy: number
  y0: number
  tops: number[]
  heights: number[]
}

/**
 * Liste triable : poignée à glisser (doigt ou souris) devant chaque ligne ; au clavier, flèches haut / bas
 * sur la poignée. La ligne glissée suit le doigt, les autres s'écartent pour montrer sa future place.
 */
export function SortableList<T>({
  items,
  keyOf,
  label,
  onSort,
  children,
}: {
  items: T[]
  keyOf: (x: T) => string
  label: (x: T) => string
  onSort: (next: T[]) => void
  children: (x: T, i: number) => ReactNode
}) {
  const rows = useRef<(HTMLDivElement | null)[]>([])
  const [drag, setDrag] = useState<Drag | null>(null)
  const begin = (i: number, e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rects = rows.current.slice(0, items.length).map((r) => r?.getBoundingClientRect())
    setDrag({ from: i, to: i, dy: 0, y0: e.clientY, tops: rects.map((r) => r?.top ?? 0), heights: rects.map((r) => r?.height ?? 0) })
  }
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const dy = e.clientY - drag.y0
    const center = drag.tops[drag.from] + drag.heights[drag.from] / 2 + dy
    setDrag({ ...drag, dy, to: dropIndex(drag.tops.map((t, k) => t + drag.heights[k] / 2), drag.from, center) })
  }
  const end = () => {
    if (drag && drag.to !== drag.from) onSort(moveItem(items, drag.from, drag.to))
    setDrag(null)
  }
  const key = (i: number, e: KeyboardEvent<HTMLButtonElement>) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null
    if (to === null || to < 0 || to >= items.length) return
    e.preventDefault()
    onSort(moveItem(items, i, to))
  }
  // Décalage des autres lignes pendant le glissement : la place libérée se déplace avec le doigt.
  const shift = (k: number) => {
    if (!drag || k === drag.from) return 0
    const gap = drag.tops.length > 1 ? Math.max(0, drag.tops[1] - drag.tops[0] - drag.heights[0]) : 0
    const step = drag.heights[drag.from] + gap
    if (drag.from < drag.to && k > drag.from && k <= drag.to) return -step
    if (drag.to < drag.from && k >= drag.to && k < drag.from) return step
    return 0
  }
  return (
    <div className={`sortable ${drag ? 'sorting' : ''}`}>
      {items.map((x, i) => (
        <div
          key={keyOf(x)}
          ref={(el) => {
            rows.current[i] = el
          }}
          className={`sortable-row ${drag?.from === i ? 'dragging' : ''}`}
          style={drag ? { transform: `translateY(${drag.from === i ? drag.dy : shift(i)}px)` } : undefined}
        >
          <button
            type="button"
            className="ghost drag-handle"
            aria-label={`Déplacer ${label(x)} (flèches haut et bas)`}
            title="Glisser pour changer l'ordre"
            onPointerDown={(e) => begin(i, e)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => key(i, e)}
          >
            <GripVertical />
          </button>
          {children(x, i)}
        </div>
      ))}
    </div>
  )
}
