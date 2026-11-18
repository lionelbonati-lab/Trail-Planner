// Carte en direct de la page d'assistance : partie déjà courue en gris, reste du parcours en
// magenta, points de passage (cochés une fois passés) et position du coureur, qui clignote.
// Chargée à la demande (Leaflet) pour garder la page légère.
import { isRavitoKind } from '../lib/splits'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Expand, LocateFixed, Maximize2, Shrink } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { navUrl } from '../lib/assist'
import { routePointAt, splitRouteAt, type RoutePoint } from '../lib/routeGeo'
import { addLayers, ROUTE_COLOR, routeCasing } from './mapLayers'

export interface MapPoint {
  dist: number
  kind: string
  done: boolean
  text: string
}

/**
 * Coureur : dernier relevé (distance le long du parcours, position GPS si la montre l'envoie) et,
 * entre deux relevés, position estimée d'après son rythme.
 */
export interface Runner {
  dist: number
  lat?: number
  lon?: number
  label: string
  estimate?: { dist: number; label: string } | null
}

/** Passage à une distance du parcours (toucher le tracé) : heure prévue ou estimée, déjà passé ou non. */
export type PassageAt = (dist: number) => { when: string; passed: boolean }

/** Distance max (px) entre le doigt et le tracé pour le « toucher ». */
const TAP_PX = 28

const DONE_COLOR = '#7d8580'
const RUNNER_ZOOM = 14

export default function ShareMap({
  route,
  points,
  runner,
  passageAt,
  title = 'Carte en direct',
}: {
  route: RoutePoint[]
  points: MapPoint[]
  runner: Runner | null
  passageAt?: PassageAt
  /** Titre au-dessus de la carte (debrief : « Parcours »). */
  title?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const lines = useRef<L.LayerGroup | null>(null)
  const marks = useRef<L.LayerGroup | null>(null)
  const me = useRef<L.Marker | null>(null)
  const [follow, setFollow] = useState(true)
  const [full, setFull] = useState(false)
  // Dernière fonction de passage (change à chaque rendu), lue au toucher du tracé.
  const passage = useRef(passageAt)
  passage.current = passageAt
  // Chaque mise à jour du partage recrée les tableaux : on ne redessine que si le tracé change.
  const key = `${route.length}:${route[0]?.join()}:${route[route.length - 1]?.join()}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => route, [key])
  const last = runner ? (runner.lat !== undefined && runner.lon !== undefined ? { lat: runner.lat, lon: runner.lon } : routePointAt(stable, runner.dist)) : null
  // Point suivi : la position estimée s'il y en a une, sinon le dernier relevé.
  const est = runner?.estimate && runner.estimate.dist > runner.dist + 1 ? routePointAt(stable, runner.estimate.dist) : null
  const pos = est ?? last

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
    // Toucher le tracé : km, heure de passage (estimée ou réelle) et lien GPS vers ce point.
    m.on('click', (e: L.LeafletMouseEvent) => {
      const at = m.latLngToContainerPoint(e.latlng)
      let best = -1
      let bestPx = Infinity
      for (let i = 0; i < stable.length; i++) {
        const q = m.latLngToContainerPoint([stable[i][1], stable[i][2]])
        const px = Math.hypot(q.x - at.x, q.y - at.y)
        if (px < bestPx) {
          bestPx = px
          best = i
        }
      }
      if (best < 0 || bestPx > TAP_PX) return
      const [dist, lat, lon] = stable[best]
      const info = passage.current?.(dist)
      const km = (dist / 1000).toFixed(1).replace('.', ',')
      const html =
        `<div class="tap-pop"><strong>km ${km}</strong>` +
        (info ? `<div>${info.passed ? 'Passé vers' : 'Passage estimé vers'} <strong>${info.when}</strong></div>` : '') +
        `<a href="${navUrl({ lat, lon })}" target="_blank" rel="noreferrer">Y aller</a></div>`
      L.popup({ closeButton: true, autoPan: true }).setLatLng([lat, lon]).setContent(html).openOn(m)
    })
    map.current = m
    return () => {
      m.remove()
      map.current = null
      me.current = null
      lastMark.current = null
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
      const ravito = isRavitoKind(p.kind)
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

  // Dernier relevé, en petit, quand une position estimée est affichée plus loin.
  const lastMark = useRef<L.CircleMarker | null>(null)
  const lastLat = est && last ? last.lat : null
  const lastLon = est && last ? last.lon : null
  const lastLabel = runner?.label ?? ''
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (lastLat === null || lastLon === null) {
      lastMark.current?.remove()
      lastMark.current = null
      return
    }
    if (!lastMark.current) {
      lastMark.current = L.circleMarker([lastLat, lastLon], { radius: 5, color: '#ffffff', weight: 2, fillColor: '#1d6fe0', fillOpacity: 0.6 })
        .bindTooltip(lastLabel)
        .addTo(m)
    } else lastMark.current.setLatLng([lastLat, lastLon]).setTooltipContent(lastLabel)
  }, [lastLat, lastLon, lastLabel, stable])

  // Coureur (position estimée, sinon dernier relevé) : créé au premier relevé, déplacé ensuite ;
  // la carte le suit tant qu'on ne l'a pas bougée.
  const lat = pos?.lat ?? null
  const lon = pos?.lon ?? null
  const label = est && runner?.estimate ? runner.estimate.label : (runner?.label ?? '')
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

  // Plein écran : la carte occupe tout l'écran, barres du navigateur comprises quand il le permet
  // (API Fullscreen ; sinon carte fixée sur toute la fenêtre). Échap, geste retour ou bouton pour revenir.
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const m = map.current
    const t = setTimeout(() => m?.invalidateSize(), 80)
    if (!full) return () => clearTimeout(t)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const el = box.current
    if (el?.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => undefined)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false)
    }
    // Sortie du plein écran par le système (Échap, geste retour) : on revient à la carte normale.
    const onFs = () => {
      if (!document.fullscreenElement) setFull(false)
      setTimeout(() => map.current?.invalidateSize(), 80)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => undefined)
    }
  }, [full])

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
        <h3>{title}</h3>
      </div>
      <div ref={box} className={`share-map-box ${full ? 'full' : ''}`}>
        <div ref={el} className="share-map" role="region" aria-label="Carte du parcours et position du coureur" />
        {/* Boutons ronds, icône seule, en colonne à droite sous le choix du fond de carte. */}
        <div className="map-fabs">
          {runner && (
            <button className={`map-fab ${follow ? 'on' : ''}`} onClick={centerOnRunner} title="Suivre le coureur" aria-label="Suivre le coureur" aria-pressed={follow}>
              <LocateFixed />
            </button>
          )}
          <button className="map-fab" onClick={showAll} title="Tout le parcours" aria-label="Tout le parcours">
            <Maximize2 />
          </button>
          <button className="map-fab" onClick={() => setFull(!full)} title={full ? 'Quitter le plein écran' : 'Plein écran'} aria-label={full ? 'Quitter le plein écran' : 'Plein écran'} aria-pressed={full}>
            {full ? <Shrink /> : <Expand />}
          </button>
        </div>
      </div>
      <p className="muted small map-tip">
        {passageAt ? "Touche le tracé : heure de passage estimée et itinéraire jusqu'à ce point." : "Touche le tracé : km et itinéraire jusqu'à ce point."}
      </p>
    </section>
  )
}
