import type { Map } from 'maplibre-gl';
import pointSymbols from './point-symbols.json';

export const SYMBOL_COLORS: Record<string, string> = pointSymbols.colors;
export const SYMBOL_KINDS = Object.freeze(Object.keys(SYMBOL_COLORS));
const SYMBOL_KIND_SET = new Set(SYMBOL_KINDS);
type PointCatalog = keyof typeof pointSymbols.catalogs;

/** Normalize imported point categories through the shared cross-region Maki registry. */
export function normalizePointKinds<T extends { properties?: Record<string, any> }>(features: T[], catalog: PointCatalog, source: string): T[] {
  const mappings: Record<string, string> = pointSymbols.catalogs[catalog];
  return features.map((feature) => {
    const raw = feature.properties?.kind;
    const kind = typeof raw === 'string' ? mappings[raw] : undefined;
    if (!kind || !SYMBOL_KIND_SET.has(kind)) throw new Error(`${source} contains unmapped point category: ${String(raw)}`);
    return { ...feature, properties: { ...feature.properties, kind } };
  });
}

export const symbolUrl = (kind: string) => `${import.meta.env.BASE_URL}symbols/${Object.hasOwn(SYMBOL_COLORS, kind) ? kind : 'other'}.svg`;
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

