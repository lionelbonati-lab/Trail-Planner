import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { indexAt } from '../lib/gpx'
import { formatClock } from '../lib/time'
import type { SplitRow, Track } from '../lib/types'
import { LAYERS } from './mapLayers'

interface Props {
  track: Track
  splits: SplitRow[]
  timeZone: string
  /** Distance survolée sur le profil (m), ou null. */
  hoverDist: number | null
  /** Clic sur la carte : distance du point de trace le plus proche (m). */
  onPick?: (dist: number) => void
}

/** Carte Leaflet du parcours, synchronisée avec le profil. */
export default function MapView({ track, splits, timeZone, hoverDist, onPick }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marks = useRef<L.LayerGroup | null>(null)
  const cursor = useRef<L.CircleMarker | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  // Carte et trace (recréées si la trace change).
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { scrollWheelZoom: false })
    const layers = Object.fromEntries(Object.entries(LAYERS).map(([k, f]) => [k, f()]))
    Object.values(layers)[0].addTo(m)
    L.control.layers(layers, undefined, { position: 'topright' }).addTo(m)
    const latlngs = track.points.map((p) => [p.lat, p.lon] as [number, number])
    const line = L.polyline(latlngs, { color: '#2f6b4f', weight: 4, opacity: 0.9 }).addTo(m)
    L.circleMarker(latlngs[0], { radius: 6, color: '#2f6b4f', fillColor: '#ffffff', fillOpacity: 1, weight: 3 }).bindTooltip('Départ').addTo(m)
    m.fitBounds(line.getBounds(), { padding: [20, 20] })
    line.on('click', (e: L.LeafletMouseEvent) => {
      let best = 0
      let bestD = Infinity
      track.points.forEach((p, i) => {
        const d = (p.lat - e.latlng.lat) ** 2 + ((p.lon - e.latlng.lng) * Math.cos((p.lat * Math.PI) / 180)) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      pickRef.current?.(track.points[best].dist)
    })
    marks.current = L.layerGroup().addTo(m)
    cursor.current = L.circleMarker(latlngs[0], { radius: 7, color: '#1f2420', fillColor: '#f5c542', fillOpacity: 1, weight: 2 })
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [track])

  // Points de passage.
  useEffect(() => {
    const g = marks.current
    if (!g) return
    g.clearLayers()
    for (const s of splits) {
      const p = track.points[indexAt(track.points, s.to)]
      const ravito = s.cp.kind === 'ravito'
      L.circleMarker([p.lat, p.lon], {
        radius: ravito ? 7 : 4,
        color: ravito ? '#c0571b' : '#2f6b4f',
        fillColor: ravito ? '#c0571b' : '#ffffff',
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip(`${s.cp.name} · km ${(s.to / 1000).toFixed(1)} · ${formatClock(s.arrivalClock, timeZone)}`)
        .addTo(g)
    }
  }, [splits, track, timeZone])

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
  }, [hoverDist, track])

  return <div ref={el} className="map" role="region" aria-label="Carte du parcours" />
}
