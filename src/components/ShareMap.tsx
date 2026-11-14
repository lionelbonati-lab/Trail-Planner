// Carte en direct de la page d'assistance : partie déjà courue en gris, reste du parcours en
// magenta, points de passage (cochés une fois passés) et position du coureur, qui clignote.
// Chargée à la demande (Leaflet) pour garder la page légère.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LocateFixed, Maximize2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { routePointAt, splitRouteAt, type RoutePoint } from '../lib/routeGeo'
import { addLayers, ROUTE_COLOR, routeCasing } from './mapLayers'

export interface MapPoint {
  dist: number
  kind: string
  done: boolean
  text: string
}

/** Coureur : distance le long du parcours, position GPS si la montre l'envoie. */
export interface Runner {
  dist: number
  lat?: number
  lon?: number
  label: string
}

const DONE_COLOR = '#7d8580'
const RUNNER_ZOOM = 14

export default function ShareMap({ route, points, runner }: { route: RoutePoint[]; points: MapPoint[]; runner: Runner | null }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const lines = useRef<L.LayerGroup | null>(null)
  const marks = useRef<L.LayerGroup | null>(null)
  const me = useRef<L.Marker | null>(null)
  const [follow, setFollow] = useState(true)
  // Chaque mise à jour du partage recrée les tableaux : on ne redessine que si le tracé change.
  const key = `${route.length}:${route[0]?.join()}:${route[route.length - 1]?.join()}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => route, [key])
  const pos = runner ? (runner.lat !== undefined && runner.lon !== undefined ? { lat: runner.lat, lon: runner.lon } : routePointAt(stable, runner.dist)) : null

  useEffect(() => {
    if (!el.current || stable.length < 2) return
    const m = L.map(el.current, { scrollWheelZoom: false })
    const latlngs = stable.map((p) => [p[1], p[2]] as [number, number])
    addLayers(m, latlngs[0])
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m)
    lines.current = L.layerGroup().addTo(m)
    marks.current = L.layerGroup().addTo(m)
    m.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] })
    // Déplacer la carte à la main arrête de suivre le coureur.
    m.on('dragstart', () => setFollow(false))
    map.current = m
    return () => {
      m.remove()
      map.current = null
      me.current = null
    }
  }, [stable])

  // Tracé : déjà couru (gris) puis à faire (magenta), chacun avec son liseré blanc.
  const runnerDist = runner?.dist ?? null
  useEffect(() => {
    const g = lines.current
    if (!g || stable.length < 2) return
    g.clearLayers()
    const draw = (latlngs: [number, number][], color: string, weight: number) => {
      if (latlngs.length < 2) return
      routeCasing(latlngs, weight).addTo(g)
      L.polyline(latlngs, { color, weight, opacity: 0.95, interactive: false }).addTo(g)
    }
    if (runnerDist === null) {
      draw(stable.map((p) => [p[1], p[2]]), ROUTE_COLOR, 4)
      return
    }
    const { done, todo } = splitRouteAt(stable, runnerDist)
    draw(todo, ROUTE_COLOR, 4)
    draw(done, DONE_COLOR, 4)
  }, [stable, runnerDist])

  // Points de passage.
  useEffect(() => {
    const g = marks.current
    if (!g || stable.length < 2) return
    g.clearLayers()
    for (const p of points) {
      const at = routePointAt(stable, p.dist)
      const ravito = p.kind === 'ravito'
      L.circleMarker([at.lat, at.lon], {
        radius: ravito ? 7 : 5,
        color: '#ffffff',
        weight: 2,
        fillColor: p.done ? DONE_COLOR : ravito ? '#c0571b' : '#1f2420',
        fillOpacity: 1,
      })
        .bindTooltip(p.text)
        .addTo(g)
    }
  }, [stable, points])

  // Coureur : créé au premier relevé, déplacé ensuite ; la carte le suit tant qu'on ne l'a pas bougée.
  const lat = pos?.lat ?? null
  const lon = pos?.lon ?? null
  const label = runner?.label ?? ''
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (lat === null || lon === null) {
      me.current?.remove()
      me.current = null
      return
    }
    if (!me.current) {
      me.current = L.marker([lat, lon], {
        icon: L.divIcon({ className: 'runner-icon', iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 1000,
        title: 'Coureur',
      })
        .bindTooltip(label, { direction: 'top', offset: [0, -10] })
        .addTo(m)
      if (follow) m.setView([lat, lon], Math.max(m.getZoom(), RUNNER_ZOOM))
    } else {
      me.current.setLatLng([lat, lon]).setTooltipContent(label)
      if (follow) m.panTo([lat, lon])
    }
  }, [lat, lon, label, follow, stable])

  const centerOnRunner = () => {
    setFollow(true)
    if (map.current && lat !== null && lon !== null) map.current.setView([lat, lon], Math.max(map.current.getZoom(), RUNNER_ZOOM))
  }
  const showAll = () => {
    setFollow(false)
    map.current?.fitBounds(L.latLngBounds(stable.map((p) => [p[1], p[2]] as [number, number])), { padding: [24, 24] })
  }

  return (
    <section className="share-map-wrap">
      <div className="share-map-head">
        <h3>Carte en direct</h3>
        <span className="row tight">
          {runner && (
            <button className={follow ? 'ghost on' : 'ghost'} onClick={centerOnRunner} title="Garder le coureur au centre de la carte">
              <LocateFixed /> Suivre le coureur
            </button>
          )}
          <button className="ghost" onClick={showAll}><Maximize2 /> Tout le parcours</button>
        </span>
      </div>
      <div ref={el} className="share-map" role="region" aria-label="Carte du parcours et position du coureur" />
    </section>
  )
}
