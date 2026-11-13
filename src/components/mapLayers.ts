import L from 'leaflet'

// Fonds de carte. OpenTopoMap n'est mis à jour qu'irrégulièrement : les sentiers récents
// manquent souvent. Les cartes OpenStreetMap (standard, France) suivent les modifications
// d'OSM de près ; le Plan IGN suit la BD TOPO (France) ; les photos aériennes montrent le
// terrain tel qu'il est.
const ign = (layer: string, format: string) =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&FORMAT=${format}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`
const swiss = (layer: string, ext: string) => `https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/3857/{z}/{x}/{y}.${ext}`

const MAX_ZOOM = 19

export const LAYERS: Record<string, () => L.TileLayer> = {
  'Plan IGN (France)': () =>
    L.tileLayer(ign('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), {
      maxZoom: MAX_ZOOM,
      maxNativeZoom: 19,
      attribution: '© IGN – Géoplateforme',
    }),
  'Photos aériennes IGN (France)': () =>
    L.tileLayer(ign('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), {
      maxZoom: MAX_ZOOM,
      maxNativeZoom: 19,
      attribution: '© IGN – Géoplateforme',
    }),
  'OpenStreetMap (à jour)': () =>
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: MAX_ZOOM,
      maxNativeZoom: 19,
      attribution: '© contributeurs OpenStreetMap',
    }),
  'OpenStreetMap France': () =>
    L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
      subdomains: 'abc',
      maxZoom: MAX_ZOOM,
      maxNativeZoom: 19,
      attribution: '© contributeurs OpenStreetMap · rendu OSM France',
    }),
  'Carte nationale suisse': () =>
    L.tileLayer(swiss('ch.swisstopo.pixelkarte-farbe', 'jpeg'), {
      maxZoom: MAX_ZOOM,
      maxNativeZoom: 18,
      attribution: '© swisstopo',
    }),
  'Satellite (monde)': () =>
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: MAX_ZOOM,
      maxNativeZoom: 18,
      attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics',
    }),
  'Relief (OpenTopoMap)': () =>
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: MAX_ZOOM,
      maxNativeZoom: 17,
      attribution: '© OpenStreetMap, SRTM · style © OpenTopoMap (CC-BY-SA)',
    }),
}

/** Surcouches transparentes, à superposer à n'importe quel fond. */
export const OVERLAYS: Record<string, () => L.TileLayer> = {
  'Sentiers balisés (Waymarked Trails)': () =>
    L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', {
      maxZoom: MAX_ZOOM,
      maxNativeZoom: 18,
      opacity: 0.8,
      attribution: 'Itinéraires © waymarkedtrails.org, OpenStreetMap',
    }),
  'Chemins de randonnée suisses': () =>
    L.tileLayer(swiss('ch.swisstopo.swisstlm3d-wanderwege', 'png'), {
      maxZoom: MAX_ZOOM,
      maxNativeZoom: 18,
      attribution: '© swisstopo',
    }),
}

const STORE_KEY = 'tp-map-layers'

function inFrance(c: L.LatLng): boolean {
  return c.lat > 41.2 && c.lat < 51.2 && c.lng > -5.3 && c.lng < 9.7
}

/**
 * Ajoute le fond (dernier choisi, sinon Plan IGN en France et OpenStreetMap ailleurs), les
 * surcouches mémorisées et le sélecteur de couches. Les choix sont retenus pour la prochaine fois.
 */
export function addLayers(m: L.Map, center?: L.LatLngExpression): void {
  m.setMaxZoom(MAX_ZOOM)
  let saved: { base?: string; overlays?: string[] } = {}
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
  } catch {
    /* stockage indisponible */
  }
  const bases = Object.fromEntries(Object.entries(LAYERS).map(([k, f]) => [k, f()]))
  const overlays = Object.fromEntries(Object.entries(OVERLAYS).map(([k, f]) => [k, f()]))
  const c = center ? L.latLng(center) : null
  const base = saved.base && bases[saved.base] ? saved.base : c && inFrance(c) ? 'Plan IGN (France)' : 'OpenStreetMap (à jour)'
  bases[base].addTo(m)
  for (const o of saved.overlays ?? []) overlays[o]?.addTo(m)
  L.control.layers(bases, overlays, { position: 'topright' }).addTo(m)

  const state = { base, overlays: (saved.overlays ?? []).filter((o) => overlays[o]) }
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state))
    } catch {
      /* stockage indisponible */
    }
  }
  m.on('baselayerchange', (e: L.LayersControlEvent) => {
    state.base = e.name
    save()
  })
  m.on('overlayadd', (e: L.LayersControlEvent) => {
    state.overlays = [...new Set([...state.overlays, e.name])]
    save()
  })
  m.on('overlayremove', (e: L.LayersControlEvent) => {
    state.overlays = state.overlays.filter((o) => o !== e.name)
    save()
  })
}
