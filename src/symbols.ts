import type { Map } from 'maplibre-gl';

export const SYMBOL_COLORS: Record<string, string> = { boat_ramp: '#14645e', paddle_launch: '#14645e', fishing: '#754699', marina: '#43566a', campground: '#98532e', trailhead: '#486640', parking: '#424b53', restroom: '#2f5b50', structure: '#914f82', other: '#555b60', water: '#23476a', dam: '#39434c', gauge: '#9b6107', stale: '#697078', spot: '#ad3867', hazard: '#b63b32' };
export const symbolUrl = (kind: string) => `${import.meta.env.BASE_URL}symbols/${kind in SYMBOL_COLORS ? kind : 'other'}.svg`;
export const symbolHtml = (kind: string) => `<img class="map-key-icon" src="${symbolUrl(kind)}" alt="" width="28" height="28">`;
const images = new globalThis.Map<string, Promise<ImageData>>();
export function installSymbols(map: Map) {
  map.setMissingStyleImageResolver(async (id) => {
    if (!id.startsWith('ll-')) return;
    const kind = id.slice(3);
    if (!(kind in SYMBOL_COLORS)) return;
    if (!images.has(kind)) images.set(kind, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 64, 64);
        resolve(context.getImageData(0, 0, 64, 64));
      };
      image.onerror = reject; image.src = symbolUrl(kind);
    }));
    await images.get(kind)!.then((image) => { if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 }); }).catch(() => console.warn(`Map symbol unavailable: ${kind}`));
  });
}

/** A shape-independent selection halo stays visible on topo and imagery. */
export function highlightLocation(map: Map, coords: [number, number]) {
  if (!map.isStyleLoaded()) return;
  if (!map.getSource('selected-location')) {
    map.addSource('selected-location', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'selected-location-ring', type: 'circle', source: 'selected-location', paint: { 'circle-radius': 19, 'circle-color': '#ffffff', 'circle-opacity': 0, 'circle-stroke-color': '#c7830a', 'circle-stroke-width': 3 } });
  }
  (map.getSource('selected-location') as import('maplibre-gl').GeoJSONSource).setData({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} });
}

