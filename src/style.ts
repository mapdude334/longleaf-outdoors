import type { LayerSpecification, SourceSpecification, StyleSpecification, ExpressionSpecification, GeoJSONSourceSpecification } from 'maplibre-gl';
import { layers as pmLayers, namedFlavor } from '@protomaps/basemaps';
import mlcontour from 'maplibre-contour';
import { addProtocol } from 'maplibre-gl';
import { ARCGIS, GLYPHS, RADAR_TILES, RASTER_BASEMAPS, SPRITE, TERRAIN_URL, USGS_HYDRO_TILES, arcgisExport } from './config';
import type { Resolved } from './pmtiles';
import { SYMBOL_COLORS } from './symbols';

export const demSource = new mlcontour.DemSource({
  url: TERRAIN_URL,
  encoding: 'terrarium',
  maxzoom: 12,
  worker: true,
});
demSource.setupMaplibre({ addProtocol } as never);

export type BasemapId = 'vector' | keyof typeof RASTER_BASEMAPS;
export type Availability = { basemap: Resolved | null; overlays: Resolved | null; parcels: Resolved | null };

/** Toggleable groups → layer ids. Filled in by buildStyle. */
export const groups: Record<string, string[]> = {};
const add = (g: string, l: LayerSpecification, out: LayerSpecification[]) => {
  (groups[g] ??= []).push(l.id);
  out.push(l);
};

const EMPTY: GeoJSONSourceSpecification = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };

// PAD-US manager type colors
const MANAGER_COLOR: ExpressionSpecification = [
  'match', ['get', 'Mang_Type'],
  'FED', '#d9a441',
  'STAT', '#3f8f4f',
  'LOC', '#8e7cc3',
  'NGO', '#2a9d8f',
  'PVT', '#c0607a',
  'JNT', '#6a994e',
  'DIST', '#4c78a8',
  '#888888',
];

export const ACCESS_COLORS = Object.fromEntries(['boat_ramp', 'paddle_launch', 'fishing', 'marina', 'campground', 'trailhead', 'parking', 'other'].map((kind) => [kind, SYMBOL_COLORS[kind]]));

const badge = (id: string, source: string, kind: string): LayerSpecification => ({ id, source, type: 'symbol', layout: { 'icon-image': 'll-' + kind, 'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.65, 12, 0.9, 15, 1], 'icon-padding': 3 } });

export function buildStyle(av: Availability): StyleSpecification {
  for (const k of Object.keys(groups)) delete groups[k];
  const sources: Record<string, SourceSpecification> = {};
  const L: LayerSpecification[] = [];

  L.push({ id: 'bg', type: 'background', paint: { 'background-color': '#eef0ea' } });

  // ---------- basemaps ----------
  if (av.basemap) {
    sources.protomaps = { type: 'vector', url: av.basemap.url, attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://protomaps.com">Protomaps</a>' };
    for (const l of pmLayers('protomaps', namedFlavor('light'), { lang: 'en' })) {
      add('base:vector', { ...l, id: 'pm-' + l.id } as LayerSpecification, L);
    }
  }
  for (const [id, b] of Object.entries(RASTER_BASEMAPS)) {
    sources['r-' + id] = { type: 'raster', tiles: [b.url], tileSize: 256, maxzoom: b.maxzoom, attribution: 'USGS The National Map' };
    add('base:' + id, { id: 'r-' + id, type: 'raster', source: 'r-' + id, layout: { visibility: 'none' } }, L);
  }

  // ---------- terrain ----------
  sources.dem = { type: 'raster-dem', tiles: [demSource.sharedDemProtocolUrl], encoding: 'terrarium', maxzoom: 12, tileSize: 256, attribution: 'Terrain: AWS Terrain Tiles / USGS 3DEP' };
  // The selected destination outline is fetched from USGS NHD and can be cached offline.
  sources['selected-water-boundary'] = { ...EMPTY, attribution: 'USGS National Hydrography Dataset (NHD)' };
  // A separate source lets map taps highlight any inspected feature without
  // replacing the destination shoreline outline.
  sources['identify-selection'] = { ...EMPTY };
  add('hillshade', {
    id: 'hillshade', type: 'hillshade', source: 'dem',
    paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#4a4a3f', 'hillshade-highlight-color': '#ffffff' },
  }, L);

  // ---------- public lands ----------
  if (av.overlays) {
    sources.overlays = { type: 'vector', url: av.overlays.url, attribution: 'USGS PAD-US, USGS NHD, Alabama DCNR fish attractors, USACE Mobile District, © OpenStreetMap contributors' };
    add('public_lands', { id: 'pl-fill', type: 'fill', source: 'overlays', 'source-layer': 'public_lands', paint: { 'fill-color': MANAGER_COLOR, 'fill-opacity': 0.28 } }, L);
    add('public_lands', {
      id: 'pl-line', type: 'line', source: 'overlays', 'source-layer': 'public_lands',
      paint: {
        'line-color': MANAGER_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2],
        'line-dasharray': ['match', ['get', 'Pub_Access'], ['RA', 'XA'], ['literal', [2, 2]], ['literal', [1, 0]]],
      },
    }, L);
    add('public_lands', {
      id: 'pl-label', type: 'symbol', source: 'overlays', 'source-layer': 'public_lands_labels', minzoom: 9,
      layout: { 'text-field': ['coalesce', ['get', 'Unit_Nm'], ['get', 'Loc_Nm']], 'text-size': 11, 'text-font': ['Noto Sans Italic'], 'text-max-width': 9, 'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'area'], 0]] },
      paint: { 'text-color': '#2f4f2f', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
    }, L);
  }
  {
    sources['padus-live'] = { type: 'raster', tiles: [arcgisExport(ARCGIS.padus.service)], tileSize: 512, attribution: 'USGS PAD-US 4.1' };
    add('public_lands', { id: 'pl-live', type: 'raster', source: 'padus-live', minzoom: 7, paint: { 'raster-opacity': 0.6 } }, L);
  }

  // ---------- parcels ----------
  if (av.parcels) {
    sources.parcels = { type: 'vector', url: av.parcels.url, attribution: 'County GIS' };
    add('parcels', { id: 'parcel-line', type: 'line', source: 'parcels', 'source-layer': 'parcels', minzoom: 12, layout: { visibility: 'none' }, paint: { 'line-color': '#e65100', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 16, 1.4] } }, L);
    add('parcels', { id: 'parcel-hit', type: 'fill', source: 'parcels', 'source-layer': 'parcels', minzoom: 12, layout: { visibility: 'none' }, paint: { 'fill-color': '#e65100', 'fill-opacity': 0.02 } }, L);
  } else {
    ARCGIS.parcels.forEach((p, i) => {
      sources['parcels-live-' + i] = { type: 'raster', tiles: [arcgisExport(p.service, String(p.layer))], tileSize: 512, attribution: p.label + ' GIS' };
      add('parcels', { id: 'parcels-live-' + i, type: 'raster', source: 'parcels-live-' + i, minzoom: 13, layout: { visibility: 'none' } }, L);
    });
  }

  // ---------- water ----------
  if (av.overlays) {
    add('water', { id: 'wb-fill', type: 'fill', source: 'overlays', 'source-layer': 'water_bodies', paint: { 'fill-color': ['case', ['has', 'water_id'], '#5aa9e6', '#8cc4ec'], 'fill-opacity': 0.55 } }, L);
    add('water', { id: 'stream-line', type: 'line', source: 'overlays', 'source-layer': 'streams', paint: { 'line-color': '#3d8fd6', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', ['has', 'water_id'], 1.5, 0.5], 14, ['case', ['has', 'water_id'], 4, 2]] } }, L);
    add('water', {
      id: 'stream-label', type: 'symbol', source: 'overlays', 'source-layer': 'streams', minzoom: 11,
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'gnis_name'], 'text-size': 11, 'text-font': ['Noto Sans Italic'] },
      paint: { 'text-color': '#1f5f99', 'text-halo-color': '#fff', 'text-halo-width': 1 },
    }, L);
  }
  {
    sources['hydro-live'] = { type: 'raster', tiles: [USGS_HYDRO_TILES], tileSize: 256, maxzoom: 16, attribution: 'USGS NHD' };
    add('water', { id: 'hydro-live', type: 'raster', source: 'hydro-live', paint: { 'raster-opacity': 0.85 } }, L);
  }

  L.push(
    { id: 'selected-water-fill', type: 'fill', source: 'selected-water-boundary', paint: { 'fill-color': '#efb53d', 'fill-opacity': 0.11 } },
    { id: 'selected-water-casing', type: 'line', source: 'selected-water-boundary', paint: { 'line-color': '#173c37', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3.5, 13, 6] } },
    { id: 'selected-water-outline', type: 'line', source: 'selected-water-boundary', paint: { 'line-color': '#ffc247', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2, 13, 3.5] } },
  );

  // ---------- contours (generated client-side from the DEM) ----------
  sources.contours = {
    type: 'vector', maxzoom: 15,
    tiles: [demSource.contourProtocolUrl({
      multiplier: 3.28084, // feet
      thresholds: { 11: [200, 1000], 12: [100, 500], 13: [50, 250], 14: [20, 100], 15: [10, 50] },
      elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours',
    })],
  };
  add('contours', { id: 'contour-line', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 11, layout: { visibility: 'none' }, paint: { 'line-color': '#8a6d3b', 'line-opacity': 0.55, 'line-width': ['match', ['get', 'level'], 1, 1.1, 0.5] } }, L);
  add('contours', { id: 'contour-label', type: 'symbol', source: 'contours', 'source-layer': 'contours', minzoom: 12, filter: ['>', ['get', 'level'], 0], layout: { visibility: 'none', 'symbol-placement': 'line', 'text-field': ['concat', ['number-format', ['get', 'ele'], {}], "'"], 'text-size': 10, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#7a5d2b', 'text-halo-color': '#fff', 'text-halo-width': 1 } }, L);

  // ---------- weather radar ----------
  sources.radar = { type: 'raster', tiles: [RADAR_TILES], tileSize: 256, attribution: 'NEXRAD via Iowa Environmental Mesonet' };
  add('radar', { id: 'radar', type: 'raster', source: 'radar', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.6 } }, L);

  // ---------- access points ----------
  if (av.overlays) {
    add('dams_osm', { ...badge('osm-dam', 'overlays', 'dam'), 'source-layer': 'osm_dams', minzoom: 11 } as LayerSpecification, L);
  }
  // The current statewide catalog must not be replaced by an older clipped archive.
  sources['access-live'] = { ...EMPTY };
  add('access', accessLayer('access-pts', 'access-live'), L);

  // Keep these catalog-backed point layers independent of the version of the
  // downloadable overlays pack. Catalog JSON is precached with the app for offline use.
  sources['fish-structures-live'] = { ...EMPTY };
  add('fish_structures', { ...badge('fish-structures-pts', 'fish-structures-live', 'structure'), minzoom: 11 }, L);
  sources['restrooms-live'] = { ...EMPTY };
  add('restrooms', { ...badge('restrooms-pts', 'restrooms-live', 'restroom'), minzoom: 10 }, L);
  sources['habitat-live'] = { ...EMPTY };
  add('habitat', { ...badge('habitat-pts', 'habitat-live', 'habitat'), minzoom: 11 }, L);
  sources['state-boundaries'] = { ...EMPTY };
  add('state_boundaries', { id: 'state-boundaries-line', type: 'line', source: 'state-boundaries', paint: { 'line-color': '#746f55', 'line-width': 1.4, 'line-opacity': 0.65, 'line-dasharray': [3, 3] } }, L);

  // ---------- live + curated GeoJSON ----------
  sources.waters = { ...EMPTY };
  add('waters', badge('waters-pt', 'waters', 'water'), L);
  add('waters', {
    id: 'waters-lbl', type: 'symbol', source: 'waters', minzoom: 7,
    layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 12, 15], 'text-font': ['Noto Sans Medium'], 'text-ignore-placement': false, 'text-allow-overlap': false, 'symbol-sort-key': ['coalesce', ['get', 'priority'], 1], 'text-max-width': 8, 'text-offset': [0, 1.25], 'text-anchor': 'top' },
    paint: { 'text-color': '#0d47a1', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  }, L);

  sources.dams = { ...EMPTY };
  add('dams', badge('dams-pt', 'dams', 'dam'), L);
  add('dams', { id: 'dams-lbl', type: 'symbol', source: 'dams', minzoom: 9, layout: { 'text-ignore-placement': true, 'text-allow-overlap': true, 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-font': ['Noto Sans Medium'] }, paint: { 'text-color': '#263238', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } }, L);

  sources.gauges = { ...EMPTY };
  add('gauges', { id: 'gauges-pt', type: 'symbol', source: 'gauges', layout: { 'icon-image': ['case', ['get', 'stale'], 'll-stale', 'll-gauge'], 'icon-size': 0.85, 'icon-padding': 3 } }, L);
  add('gauges', { id: 'gauges-lbl', type: 'symbol', source: 'gauges', minzoom: 10, layout: { 'text-ignore-placement': true, 'text-allow-overlap': true, 'text-field': ['get', 'summary'], 'text-size': 10, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#704700', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } }, L);

  sources.track = { ...EMPTY };
  add('mine', { id: 'track-line', type: 'line', source: 'track', paint: { 'line-color': '#d81b60', 'line-width': 3, 'line-opacity': 0.85 } }, L);
  sources.waypoints = { ...EMPTY };
  add('mine', { id: 'wpt-pt', type: 'symbol', source: 'waypoints', layout: { 'icon-image': ['match', ['get', 'type'], 'fish', 'll-spot', 'ramp', 'll-boat_ramp', 'camp', 'll-campground', 'hazard', 'll-hazard', 'parking', 'll-parking', 'll-other'], 'icon-size': 0.95, 'icon-allow-overlap': true } }, L);
  add('mine', { id: 'wpt-lbl', type: 'symbol', source: 'waypoints', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-font': ['Noto Sans Medium'] }, paint: { 'text-color': '#880e4f', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } }, L);

  // ESRI-style identify feedback: emphasize the selected shape above all data.
  L.push(
    { id: 'identify-selection-fill', type: 'fill', source: 'identify-selection', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#ffc247', 'fill-opacity': 0.18 } },
    { id: 'identify-selection-casing', type: 'line', source: 'identify-selection', paint: { 'line-color': '#173c37', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 4, 14, 7] } },
    { id: 'identify-selection-outline', type: 'line', source: 'identify-selection', paint: { 'line-color': '#ffc247', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2, 14, 3.5] } },
  );

  return {
    version: 8,
    glyphs: GLYPHS,
    sprite: SPRITE,
    sources,
    layers: L,
  };
}

function accessLayer(id: string, source: string, sourceLayer?: string): LayerSpecification {
  return {
    id, type: 'symbol', source, ...(sourceLayer ? { 'source-layer': sourceLayer } : {}), minzoom: 9,
    layout: {
      'icon-image': ['match', ['get', 'kind'], ...Object.keys(ACCESS_COLORS).flatMap((kind) => [kind, 'll-' + kind]), 'll-other'] as unknown as ExpressionSpecification,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 13, 0.9, 15, 1],
      'icon-padding': 3,
      'text-field': ['step', ['zoom'], '', 12, ['coalesce', ['get', 'name'], '']], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-optional': true, 'text-offset': [0, 1.5], 'text-anchor': 'top',
    },
    paint: { 'text-color': '#344747', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  } as LayerSpecification;
}
