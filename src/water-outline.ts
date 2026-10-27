import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { Water } from './layers/waters';
import { STATIC_CACHE } from './offline';
import { waterOutlineQueryUrl } from './water-outline-query';

type BoundaryFeature = { type: 'Feature'; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };
type BoundaryCollection = { type: 'FeatureCollection'; features: BoundaryFeature[] };
type OutlineState = { id: string; revision: number; data: BoundaryCollection; status: string; onStatus?: (message: string) => void };
const states = new WeakMap<Map, OutlineState>();
const listening = new WeakSet<Map>();
const EMPTY: BoundaryCollection = { type: 'FeatureCollection', features: [] };

function setMapData(map: Map, data: BoundaryCollection) {
  (map.getSource('selected-water-boundary') as GeoJSONSource | undefined)?.setData(data as never);
}

function setStatus(state: OutlineState, message: string) {
  state.status = message;
  state.onStatus?.(message);
}

/** Draw an authoritative named waterbody polygon, with a device cache for offline revisits. */
export function showSelectedWaterOutline(map: Map, water: Water | undefined, onStatus?: (message: string) => void, force = false) {
  let state = states.get(map);
  if (!state) {
    state = { id: '', revision: 0, data: EMPTY, status: '', onStatus };
    states.set(map, state);
  }
  if (!listening.has(map)) {
    listening.add(map);
    map.on('style.load', () => setMapData(map, states.get(map)?.data ?? EMPTY));
  }
  state.onStatus = onStatus;
  if (!water || !water.center) {
    state.revision++;
    state.id = '';
    state.data = EMPTY;
    setMapData(map, EMPTY);
    setStatus(state, 'No mapped water boundary is available for this destination.');
    return;
  }
  if (!force && state.id === water.id) {
    if (state.status) state.onStatus?.(state.status);
    return;
  }
  state.id = water.id;
  const revision = ++state.revision;
  state.data = EMPTY;
  setMapData(map, EMPTY);
  setStatus(state, 'Loading mapped shoreline from USGS…');
  const url = waterOutlineQueryUrl(water);
  if (!url) return setStatus(state, 'No mapped shoreline is available for this destination.');

  void (async () => {
    try {
      const cache = await caches.open(STATIC_CACHE);
      let response = await cache.match(url);
      if (!response) {
        response = await fetch(url, { signal: AbortSignal.timeout(25000) });
        if (!response.ok) throw new Error(`USGS returned ${response.status}`);
        if (Number(response.headers.get('content-length') ?? 0) > 4 * 1024 * 1024) throw new Error('Waterbody outline is too large to cache safely.');
        await cache.put(url, response.clone());
      }
      const payload = await response.json() as BoundaryCollection & { error?: { message?: string } };
      if (payload.error) throw new Error(payload.error.message || 'USGS waterbody query failed.');
      const features = Array.isArray(payload.features) ? payload.features.filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) : [];
      if (features.length > 100) throw new Error('USGS returned too many waterbody features.');
      if (!features.length) throw new Error('No named polygon found nearby.');
      if (states.get(map)?.revision !== revision) return;
      const data: BoundaryCollection = { type: 'FeatureCollection', features };
      state!.data = data;
      setMapData(map, data);
      setStatus(state!, 'Approximate mapped shoreline · USGS NHD. Reservoir shorelines can change with water levels.');
    } catch {
      if (states.get(map)?.revision !== revision) return;
      setMapData(map, EMPTY);
      setStatus(state!, 'A named shoreline polygon is unavailable here; the destination marker and map remain available.');
    }
  })();
}
