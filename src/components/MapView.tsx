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
}

/** Carte Leaflet du parcours, synchronisée avec le profil. */
export default function MapView({ track, splits, timeZone, hoverDist, onPick, accessPick = null, accesses = [] }: Props) {
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

  // Carte et trace (recréées si la trace change).
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { scrollWheelZoom: false })
    const latlngs = track.points.map((p) => [p.lat, p.lon] as [number, number])
    addLayers(m, latlngs[0])
    routeCasing(latlngs, 4).addTo(m)
    const line = L.polyline(latlngs, { color: ROUTE_COLOR, weight: 4, opacity: 0.95 }).addTo(m)
    L.circleMarker(latlngs[0], { radius: 6, color: '#ffffff', fillColor: '#2f6b4f', fillOpacity: 1, weight: 3 }).bindTooltip('Départ').addTo(m)
    m.fitBounds(line.getBounds(), { padding: [20, 20] })
    // Pose d'un accès : n'importe où sur la carte (le clic sur le tracé remonte aussi ici).
    m.on('click', (e: L.LeafletMouseEvent) => accessRef.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }))
    line.on('click', (e: L.LeafletMouseEvent) => {
      if (accessRef.current) return
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
    accessLayer.current = L.layerGroup().addTo(m)
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
        color: ravito ? '#ffffff' : '#1f2420',
        fillColor: ravito ? '#c0571b' : '#ffffff',
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip(`${s.cp.name} · km ${(s.to / 1000).toFixed(1)} · ${formatClock(s.arrivalClock, timeZone)}`)
        .addTo(g)
    }
  }, [splits, track, timeZone])

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
  }, [hoverDist, track])

  return <div ref={el} className="map" role="region" aria-label="Carte du parcours" />
}
