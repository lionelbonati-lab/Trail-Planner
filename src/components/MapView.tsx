import { isRavitoKind } from '../lib/splits'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { indexAt } from '../lib/gpx'
import { formatClock } from '../lib/time'
import type { GeoPoint, SplitRow, Track } from '../lib/types'
import { addLayers, ROUTE_COLOR, routeCasing } from './mapLayers'

interface Props {
  track: Track
  splits: SplitRow[]
  timeZone: string
  /** Distance survolée sur le profil (m), ou null. */
  hoverDist: number | null
  /** Clic sur la carte : distance du point de trace le plus proche (m). */
  onPick?: (dist: number) => void
  /** Pose d'un accès assistance : le prochain clic sur la carte donne sa position. */
  accessPick?: ((at: GeoPoint) => void) | null
  /** Accès assistance placés, reliés à leur point du parcours. */
  accesses?: { name: string; at: GeoPoint; trail: GeoPoint }[]
  /**
   * Édition des points (carte plein écran) : appuyer sur le tracé, glisser puis lâcher ajoute un point
   * à l'endroit lâché ; un point se déplace en le glissant le long du tracé ; un toucher le sélectionne.
   */
  edit?: { onAdd: (dist: number) => void; onMove: (id: string, dist: number) => void; onSelect: (id: string) => void; selected: string | null }
  className?: string
}

/** Point de la trace le plus proche d'une position (indice). */
function nearestIndex(track: Track, lat: number, lon: number): number {
  let best = 0
  let bestD = Infinity
  const k = Math.cos((lat * Math.PI) / 180)
  track.points.forEach((p, i) => {
    const d = (p.lat - lat) ** 2 + ((p.lon - lon) * k) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** Carte Leaflet du parcours (zoom à la molette), synchronisée avec le profil : elle suit le curseur survolé. */
export default function MapView({ track, splits, timeZone, hoverDist, onPick, accessPick = null, accesses = [], edit, className }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marks = useRef<L.LayerGroup | null>(null)
  const cursor = useRef<L.CircleMarker | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const accessRef = useRef(accessPick)
  useEffect(() => {
    accessRef.current = accessPick
  }, [accessPick])
  const accessLayer = useRef<L.LayerGroup | null>(null)
  const editRef = useRef(edit)
  editRef.current = edit

  // Carte et trace (recréées si la trace change).
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { scrollWheelZoom: true })
    const latlngs = track.points.map((p) => [p.lat, p.lon] as [number, number])
    addLayers(m, latlngs[0])
    routeCasing(latlngs, 4).addTo(m)
    const line = L.polyline(latlngs, { color: ROUTE_COLOR, weight: 4, opacity: 0.95 }).addTo(m)
    L.circleMarker(latlngs[0], { radius: 6, color: '#ffffff', fillColor: '#2f6b4f', fillOpacity: 1, weight: 3 }).bindTooltip('Départ').addTo(m)
    m.fitBounds(line.getBounds(), { padding: [20, 20] })
    // Pose d'un accès : n'importe où sur la carte (le clic sur le tracé remonte aussi ici).
    m.on('click', (e: L.LeafletMouseEvent) => accessRef.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }))
    line.on('click', (e: L.LeafletMouseEvent) => {
      if (accessRef.current || editRef.current) return
      pickRef.current?.(track.points[nearestIndex(track, e.latlng.lat, e.latlng.lng)].dist)
    })
    // Édition : bande invisible large autour du tracé (facile à toucher) ; appui, glisser, lâcher → point
    // ajouté là où le doigt ou la souris est lâché (calé sur le tracé).
    if (editRef.current) {
      const hit = L.polyline(latlngs, { color: '#000', weight: 24, opacity: 0.001, className: 'edit-hit' }).addTo(m)
      const ghost = L.circleMarker(latlngs[0], { radius: 9, color: '#ffffff', fillColor: '#e0007a', fillOpacity: 1, weight: 3, interactive: false })
      hit.getElement()?.addEventListener('pointerdown', (ev: Event) => {
        const pe = ev as PointerEvent
        if (accessRef.current || !editRef.current || pe.button > 0) return
        pe.preventDefault()
        pe.stopPropagation()
        m.dragging.disable()
        const at = (x: PointerEvent) => {
          const ll = m.mouseEventToLatLng(x as unknown as MouseEvent)
          return track.points[nearestIndex(track, ll.lat, ll.lng)]
        }
        const p0 = at(pe)
        ghost.setLatLng([p0.lat, p0.lon]).addTo(m)
        const move = (x: PointerEvent) => {
          const p = at(x)
          ghost.setLatLng([p.lat, p.lon])
        }
        const up = (x: PointerEvent) => {
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerup', up)
          document.removeEventListener('pointercancel', up)
          m.dragging.enable()
          ghost.remove()
          if (x.type === 'pointerup') editRef.current?.onAdd(at(x).dist)
        }
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', up)
        document.addEventListener('pointercancel', up)
      })
    }
    marks.current = L.layerGroup().addTo(m)
    accessLayer.current = L.layerGroup().addTo(m)
    cursor.current = L.circleMarker(latlngs[0], { radius: 7, color: '#1f2420', fillColor: '#f5c542', fillOpacity: 1, weight: 2 })
    map.current = m
    // Carte redimensionnée (plein écran, séparation carte / profil déplacée) : tuiles recalées.
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, !!edit])

  // Points de passage.
  useEffect(() => {
    const g = marks.current
    if (!g) return
    g.clearLayers()
    for (const s of splits) {
      const p = track.points[indexAt(track.points, s.to)]
      const ravito = isRavitoKind(s.cp.kind)
      const tip = `${s.cp.name} · km ${(s.to / 1000).toFixed(1)} · ${formatClock(s.arrivalClock, timeZone)}`
      if (edit && s.cp.id !== '__finish') {
        // Point déplaçable : glissé puis recalé sur le tracé ; un toucher l'ouvre.
        const size = s.cp.kind === 'base' ? 22 : ravito ? 18 : 14
        const mk = L.marker([p.lat, p.lon], {
          draggable: true,
          icon: L.divIcon({
            className: `edit-pt kind-${s.cp.kind}${edit.selected === s.cp.id ? ' sel' : ''}`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          }),
        })
          .bindTooltip(tip)
          .addTo(g)
        mk.on('click', () => editRef.current?.onSelect(s.cp.id))
        mk.on('dragend', () => {
          const ll = mk.getLatLng()
          editRef.current?.onMove(s.cp.id, track.points[nearestIndex(track, ll.lat, ll.lng)].dist)
        })
        continue
      }
      L.circleMarker([p.lat, p.lon], {
        radius: ravito ? 7 : 4,
        color: ravito ? '#ffffff' : '#1f2420',
        fillColor: ravito ? '#c0571b' : '#ffffff',
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip(tip)
        .addTo(g)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splits, track, timeZone, !!edit, edit?.selected])

  // Accès assistance : « P » relié en pointillés au point du parcours.
  useEffect(() => {
    const g = accessLayer.current
    if (!g) return
    g.clearLayers()
    for (const a of accesses) {
      L.polyline([[a.trail.lat, a.trail.lon], [a.at.lat, a.at.lon]], { color: '#1d6fe0', weight: 2, dashArray: '4 5', interactive: false }).addTo(g)
      L.marker([a.at.lat, a.at.lon], { icon: L.divIcon({ className: 'access-icon', html: 'P', iconSize: [20, 20], iconAnchor: [10, 10] }) })
        .bindTooltip(`Accès assistance · ${a.name}`)
        .addTo(g)
    }
  }, [accesses])

  // Curseur en croix pendant la pose d'un accès.
  useEffect(() => {
    el.current?.classList.toggle('picking', !!accessPick)
  }, [accessPick])

  // Curseur synchronisé avec le survol du profil.
  useEffect(() => {
    const m = map.current
    const c = cursor.current
    if (!m || !c) return
    if (hoverDist === null) {
      c.remove()
      return
    }
    const p = track.points[indexAt(track.points, hoverDist)]
    c.setLatLng([p.lat, p.lon])
    if (!m.hasLayer(c)) c.addTo(m)
    // Carte zoomée : elle suit le curseur, qui reste à plus de 60 px du bord.
    m.panInside([p.lat, p.lon], { padding: [60, 60], animate: false })
  }, [hoverDist, track])

  return <div ref={el} className={`map ${className ?? ''}`} role="region" aria-label="Carte du parcours" />
}
