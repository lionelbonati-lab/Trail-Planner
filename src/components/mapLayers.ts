import L from 'leaflet'

/** Fonds de carte : topographique (sentiers, courbes de niveau) et OpenStreetMap. */
export const LAYERS: Record<string, () => L.TileLayer> = {
  'Topographique (OpenTopoMap)': () =>
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '© OpenStreetMap, SRTM · style © OpenTopoMap (CC-BY-SA)',
    }),
  OpenStreetMap: () =>
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }),
}
