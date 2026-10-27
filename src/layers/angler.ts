import type { Feature, Point } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { esc, fetchJSON } from '../util';
import { normalizePointKinds } from '../symbols';
import { addPointToTrip, sourceMetadata } from '../data-metadata';

export type AnglerFeature = Feature<Point, Record<string, any>>;
type Catalog = { type: string; updated: string; source?: string; sourceUrl?: string; features: AnglerFeature[] };

export let fishStructures: AnglerFeature[] = [];
export let restrooms: AnglerFeature[] = [];
export let habitats: AnglerFeature[] = [];

async function catalog(path: string): Promise<Catalog> {
  const result = await fetchJSON<Catalog>(`${import.meta.env.BASE_URL}data/${path}`);
  if (result.type !== 'FeatureCollection' || !Array.isArray(result.features) || !result.features.every((f) =>
    f.geometry?.type === 'Point' && f.geometry.coordinates.length >= 2 && f.geometry.coordinates.every(Number.isFinite),
  )) throw new Error(`Invalid map data: ${path}`);
  result.features = normalizePointKinds(result.features, path === 'fish-structures.json' ? 'fish-structures' : path === 'habitat.json' ? 'habitat' : 'restrooms', path);
  return result;
}

export async function loadAnglerData(map: Map) {
  const [structures, toilets, vegetation, states] = await Promise.all([catalog('fish-structures.json'), catalog('restrooms.json'), catalog('habitat.json'), fetchJSON<any>(`${import.meta.env.BASE_URL}data/state-boundaries.json`)]);
  fishStructures = structures.features;
  restrooms = toilets.features;
  habitats = vegetation.features;
  (map.getSource('fish-structures-live') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: fishStructures });
  (map.getSource('restrooms-live') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: restrooms });
  (map.getSource('habitat-live') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: habitats });
  (map.getSource('state-boundaries') as GeoJSONSource | undefined)?.setData(states);
  return { structureCount: fishStructures.length, restroomCount: restrooms.length, habitatCount: habitats.length, updated: structures.updated };
}

export function fishStructureHtml(p: Record<string, any>, coords?: [number, number]) {
  const installed = p.installed ? `<tr><th>Installed</th><td>${esc(p.installed)}</td></tr>` : '';
  const quantity = p.quantity ? `<tr><th>Reported amount</th><td>${esc(p.quantity)}</td></tr>` : '';
  const depth = Number(p.depth_ft) > 0 ? `<tr><th>Reported depth</th><td>${Number(p.depth_ft).toLocaleString()} ft</td></tr>` : p.reported_depth ? `<tr><th>Source depth entry</th><td>${esc(p.reported_depth)} · ${esc(p.depth_unit)}</td></tr>` : '';
  const note = p.source_note || 'Structure records mark reported installation locations, not live sonar, water depth, or a guarantee the structure remains intact. Check current water level and navigation hazards.';
  return `<h3>${esc(p.name || 'Fish attractor / structure')}</h3>
    <p>${esc(p.waterbody || 'Regional water')} · ${esc(p.structure || 'Fish-attractor structure')}</p>
    <table class="props">${installed}${quantity}${depth}<tr><th>Data source</th><td>${esc(p.data_source || 'Agency data')}</td></tr></table>
    <p class="muted small">${esc(note)}</p>
    ${sourceMetadata(p)}${addPointToTrip(p, coords)}`;
}

export function habitatHtml(p: Record<string, any>, coords?: [number, number]) {
  return `<h3>${esc(p.name || 'Aquatic habitat survey')}</h3><p>${esc(p.waterbody || 'Agency survey location')}</p><table class="props"><tr><th>Habitat record</th><td>${esc(p.habitat_type)}</td></tr>${p.observed_at ? `<tr><th>Observed</th><td>${esc(p.observed_at)}</td></tr>` : ''}${p.origin ? `<tr><th>Plant origin</th><td>${esc(p.origin)}</td></tr>` : ''}</table>${p.description ? `<p>${esc(p.description)}</p>` : ''}<p class="muted small">${esc(p.source_note)}</p>${sourceMetadata(p)}${addPointToTrip(p, coords)}`;
}

export function restroomHtml(p: Record<string, any>) {
  const access = p['toilets:access'] || p.access;
  const rows = [
    ['Access', access], ['Hours', p.opening_hours], ['Fee', p.fee], ['Wheelchair access', p['toilets:wheelchair'] || p.wheelchair],
    ['Changing table', p.changing_table], ['Operator', p.operator],
  ].filter((row) => row[1]).map(([label, value]) => `<tr><th>${label}</th><td>${esc(value)}</td></tr>`).join('');
  const locationNote = p.location_accuracy === 'facility point (restroom may be nearby)'
    ? 'The mapped point identifies a recreation facility tagged with restrooms. The restroom building may be elsewhere within the facility.'
    : 'This point is mapped as a restroom. Hours, access, and facility conditions can change; verify before relying on it.';
  return `<h3>${esc(p.name || 'Public restroom')}</h3>
    <p>${p.facility ? `${esc(p.facility)} · ` : ''}Restroom reported by ${esc(p.data_source || 'the mapped facility source')}</p>
    ${rows ? `<table class="props">${rows}</table>` : ''}
    <p class="muted small">${locationNote}</p>
    ${sourceMetadata(p)}`;
}
