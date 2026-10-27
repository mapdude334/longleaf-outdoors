import type { Feature, Point } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { esc, fetchJSON } from '../util';

export type AnglerFeature = Feature<Point, Record<string, any>>;
type Catalog = { type: string; updated: string; source?: string; sourceUrl?: string; features: AnglerFeature[] };

export let fishStructures: AnglerFeature[] = [];
export let restrooms: AnglerFeature[] = [];

async function catalog(path: string): Promise<Catalog> {
  const result = await fetchJSON<Catalog>(`${import.meta.env.BASE_URL}data/${path}`);
  if (result.type !== 'FeatureCollection' || !Array.isArray(result.features) || !result.features.every((f) =>
    f.geometry?.type === 'Point' && f.geometry.coordinates.length >= 2 && f.geometry.coordinates.every(Number.isFinite),
  )) throw new Error(`Invalid map data: ${path}`);
  return result;
}

export async function loadAnglerData(map: Map) {
  const [structures, toilets] = await Promise.all([catalog('fish-structures.json'), catalog('restrooms.json')]);
  fishStructures = structures.features;
  restrooms = toilets.features;
  (map.getSource('fish-structures-live') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: fishStructures });
  (map.getSource('restrooms-live') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: restrooms });
  return { structureCount: fishStructures.length, restroomCount: restrooms.length, updated: structures.updated };
}

export function fishStructureHtml(p: Record<string, any>) {
  const installed = p.installed ? `<tr><th>Installed</th><td>${esc(p.installed)}</td></tr>` : '';
  const quantity = p.quantity ? `<tr><th>Reported amount</th><td>${esc(p.quantity)}</td></tr>` : '';
  const depth = Number(p.depth_ft) > 0 ? `<tr><th>Reported depth</th><td>${Number(p.depth_ft).toLocaleString()} ft</td></tr>` : '';
  const note = p.source_note || 'Structure records mark reported installation locations, not live sonar, water depth, or a guarantee the structure remains intact. Check current water level and navigation hazards.';
  return `<h3>${esc(p.name || 'Fish attractor / structure')}</h3>
    <p>${esc(p.waterbody || 'Regional water')} · ${esc(p.structure || 'Fish-attractor structure')}</p>
    <table class="props">${installed}${quantity}${depth}<tr><th>Data source</th><td>${esc(p.data_source || 'Agency data')}</td></tr></table>
    <p class="muted small">${esc(note)}</p>
    ${p.source_url ? `<p><a href="${esc(p.source_url)}" target="_blank" rel="noopener">Source details ↗</a></p>` : ''}`;
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
    <p>${p.facility ? `${esc(p.facility)} · ` : ''}Public restroom (community map data)</p>
    ${rows ? `<table class="props">${rows}</table>` : ''}
    <p class="muted small">${locationNote}</p>
    ${p.source_url ? `<p><a href="${esc(p.source_url)}" target="_blank" rel="noopener">OpenStreetMap details ↗</a></p>` : ''}`;
}
