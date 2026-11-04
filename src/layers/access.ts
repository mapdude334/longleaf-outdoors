// Boat ramps, fishing piers, paddle launches, marinas, campgrounds.
// With overlays.pmtiles installed these come from the tiles; otherwise we pull them live from
// OpenStreetMap (Overpass) once for the whole region and keep the result for offline use.
import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { Feature, Point } from 'geojson';
import { AOI, OVERPASS } from '../config';
import { normalizePointKinds, symbolHtml } from '../symbols';
import { esc, haversineKm, fetchJSON, store } from '../util';
import { placeTitleCase, waterById, waterDisplayName, waters } from './waters';
import { dams } from './dams';
import { sourceMetadata } from '../data-metadata';

export const ACCESS_LABELS: Record<string, string> = {
  boat_ramp: 'Boat ramp', paddle_launch: 'Kayak / canoe launch', fishing: 'Fishing pier / spot',
  marina: 'Marina', campground: 'Campground', trailhead: 'Trailhead', parking: 'Parking', other: 'Access',
};
type AccessFeature = Feature<Point, Record<string, any>>;
// This public catalog is already shipped and precached as data/access.json. Keep it in
// memory rather than duplicating its multi-megabyte payload in localStorage, which is
// also where the user's trips, spots, and map preferences live.
const previousAccessCache = store.get<AccessFeature[]>('access-osm');
let accessCatalog: AccessFeature[] = previousAccessCache?.v ?? [];
let accessEdition = store.get<string>('access-edition')?.v;
let accessRetrievedAt = previousAccessCache?.t ?? 0;
// Migrate older installs off the large localStorage copy before other app state is saved.
store.del('access-osm');
store.del('access-edition');

export const accessFeatures = () => accessCatalog;
export const accessCatalogInfo = () => ({ available: accessCatalog.length > 0, updated: accessEdition, retrievedAt: accessRetrievedAt });

function kind(t: Record<string, string>) {
  if (t.leisure === 'slipway' || t.amenity === 'boat_ramp') return 'boat_ramp';
  if (t.canoe === 'put_in' || t.waterway === 'access_point') return 'paddle_launch';
  if (t.man_made === 'pier' || t.leisure === 'fishing') return 'fishing';
  if (t.leisure === 'marina') return 'marina';
  if (t.tourism === 'camp_site') return 'campground';
  if (t.highway === 'trailhead') return 'trailhead';
  return 'other';
}

export async function loadAccessLive(map: Map) {
  // Ship a same-origin catalog with the app so first-time visitors do not depend
  // on an Overpass POST succeeding in their browser. It is also precached offline.
  // Do not write this large catalog to localStorage; the shipped file is its offline copy.
  try {
    const snapshot = await fetchJSON<{ type: string; updated: string; features: AccessFeature[] }>(`${import.meta.env.BASE_URL}data/access.json`, { timeout: 8000 });
    if (snapshot.type !== 'FeatureCollection' || !snapshot.features?.length || !snapshot.features.every((f) => f.geometry?.type === 'Point' && f.geometry.coordinates.length >= 2 && f.geometry.coordinates.every(Number.isFinite))) throw new Error('Invalid access catalog');
    const features = normalizePointKinds(snapshot.features, 'access', 'Access catalog');
    let ncFeatures: AccessFeature[] = [];
    try {
      const nc = await fetchJSON<{ type: string; features: AccessFeature[] }>(`${import.meta.env.BASE_URL}data/nc-access.json`, { timeout: 8000 });
      if (nc.type !== 'FeatureCollection' || !Array.isArray(nc.features) || !nc.features.every((f) => f.geometry?.type === 'Point' && f.geometry.coordinates.length >= 2 && f.geometry.coordinates.every(Number.isFinite) && f.properties?.point_state === 'NC')) throw new Error('Invalid NC access catalog');
      ncFeatures = normalizePointKinds(nc.features, 'access', 'NCWRC access catalog');
    } catch (error) {
      console.warn('Optional North Carolina access catalog is unavailable; existing access records remain available.', error);
    }
    const combined = [...features, ...ncFeatures];
    accessCatalog = combined;
    accessEdition = snapshot.updated;
    accessRetrievedAt = Date.now();
    (map.getSource('access-live') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: combined });
    return { count: combined.length, offline: !navigator.onLine, source: ncFeatures.length ? 'published agency / OSM catalog + NCWRC' : 'published agency / OSM catalog' };
  } catch { /* Older offline installations can still use their cached/live data. */ }
  const [w, s, e, n] = AOI;
  const bb = `(${s},${w},${n},${e})`;
  const q = `[out:json][timeout:90];(nwr["leisure"="slipway"]${bb};nwr["amenity"="boat_ramp"]${bb};nwr["leisure"="fishing"]${bb};nwr["man_made"="pier"]${bb};nwr["canoe"="put_in"]${bb};nwr["leisure"="marina"]${bb};nwr["tourism"="camp_site"]${bb};);out center tags;`;
  try {
    const j = await fetchJSON(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
    if (j.remark || !j.elements?.length) throw new Error('Access query incomplete or empty');
    const queried: AccessFeature[] = j.elements.flatMap((el: any) => {
      const lon = el.lon ?? el.center?.lon;
      const lat = el.lat ?? el.center?.lat;
      if (lon == null) return [];
      const t = el.tags ?? {};
      return [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] as [number, number] }, properties: { ...pick(t), kind: kind(t), osm: `${el.type}/${el.id}` } }];
    });
    const features: AccessFeature[] = normalizePointKinds(queried, 'access', 'Live access catalog');
    accessCatalog = features;
    accessEdition = undefined;
    accessRetrievedAt = Date.now();
    (map.getSource('access-live') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
    return { count: features.length, offline: false, source: 'OSM live' };
  } catch (error) {
    // Preserve the in-memory legacy catalog if an older installation is offline and
    // its service worker does not yet have the shipped access.json file.
    if (!accessCatalog.length) throw error;
    const features: AccessFeature[] = normalizePointKinds(accessCatalog, 'access', 'Saved access catalog');
    accessCatalog = features;
    (map.getSource('access-live') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
    return { count: features.length, offline: true, source: 'saved access catalog' };
  }
}

const KEEP = ['name', 'operator', 'maintenance', 'access', 'status', 'closure_reason', 'caution_notes', 'access_notes', 'public_access', 'waterbody', 'waterbody_type', 'water_type', 'county', 'state', 'region', 'district', 'source_access_type', 'source_access_subtype', 'species_summary', 'fee', 'opening_hours', 'surface', 'parking_surface', 'lanes', 'website', 'phone', 'description', 'directions', 'parking', 'toilets', 'courtesy_dock', 'fishing_pier', 'picnic_area', 'accessibility', 'game_zone', 'fishing', 'lit', 'addr:street', 'addr:city', 'boat_ramp', 'public_fishing_area', 'pfa_status', 'pfa_waterbody'];

/** Describe the mapped position without inventing a facility name or access conditions. */
export function accessLocation(p: Record<string, any>, coords: [number, number]): string {
  const address = [p['addr:street'], p['addr:city']].filter(Boolean).join(', ');
  const countyValue = String(p.point_county || p.county || '').trim();
  const county = countyValue
    ? /\bcounty$/i.test(countyValue) ? placeTitleCase(countyValue) : `${placeTitleCase(countyValue)} County`
    : '';
  const state = String(p.point_state || p.state || '').trim();
  const administrative = [county, state].filter(Boolean).join(', ');
  const withAdministrative = (place: string) => [place, administrative].filter(Boolean).join(' · ');
  if (address) return withAdministrative(address);
  const linkedWater = p.waterbody_id ? waterById(String(p.waterbody_id)) : undefined;
  if (linkedWater) return withAdministrative(waterDisplayName(linkedWater));
  if (p.waterbody) return withAdministrative(placeTitleCase(String(p.waterbody)));
  const anchors = [
    ...dams.map((d) => ({ name: d.name, coords: d.coords })),
    ...waters.flatMap((w) => w.center ? [{ name: `${w.name} (mapped center)`, coords: w.center }] : []),
  ].map((a) => ({ ...a, distance: haversineKm(coords, a.coords) })).sort((a, b) => a.distance - b.distance);
  const anchor = anchors[0];
  if (!anchor) return `${coords[1].toFixed(4)}° N, ${Math.abs(coords[0]).toFixed(4)}° W`;
  if (anchor.distance < 0.16) return withAdministrative(`Near ${anchor.name}`);
  const radians = Math.PI / 180;
  const lat1 = anchor.coords[1] * radians, lat2 = coords[1] * radians;
  const delta = (coords[0] - anchor.coords[0]) * radians;
  const bearing = (Math.atan2(Math.sin(delta) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta)) / radians + 360) % 360;
  const direction = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(bearing / 45) % 8];
  return withAdministrative(`${(anchor.distance / 1.609344).toFixed(1)} mi ${direction} of ${anchor.name} · straight-line distance`);
}
function pick(t: Record<string, string>) {
  return Object.fromEntries(Object.entries(t).filter(([k]) => KEEP.includes(k)));
}

export function accessHtml(p: Record<string, any>, coords: [number, number]): string {
  const k = p.kind ?? 'other';
  const rows = KEEP.filter((key) => key !== 'name' && p[key]).map((key) => `<tr><th>${esc(key.replaceAll('_', ' '))}</th><td>${esc(p[key])}</td></tr>`).join('');
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${coords[1]},${coords[0]}`;
  const water = p.waterbody_id ? waterById(String(p.waterbody_id)) : undefined;
  const waterAction = water ? `<button class="link" data-open-water="${esc(water.id)}">Associated water · Open ${esc(waterDisplayName(water))} ↗</button>` : '';
  const typeLabel = p.source_access_type ? placeTitleCase(String(p.source_access_type)) : ACCESS_LABELS[k];
  const closed = /closed|decommissioned/i.test(String(p.status ?? ''));
  return `<h3>${esc(p.name ? placeTitleCase(String(p.name)) : ACCESS_LABELS[k])}</h3>
  <p>${symbolHtml(k)}${esc(typeLabel)}</p>
  <p>${esc(accessLocation(p, coords))}</p>
  ${p.source_note ? `<details class="data-provenance"><summary>NCWRC data-use and accuracy notice</summary><p class="muted small">${esc(p.source_note)}</p></details>` : ''}
  ${waterAction}
  <p class="muted small">${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}</p>
  ${['boat_ramp', 'paddle_launch'].includes(k) ? `<button class="btn primary" data-use-launch data-launch-id="${esc(p.osm ?? p.record_id ?? coords.join(','))}" data-launch-name="${esc(p.name || ACCESS_LABELS[k])}" data-launch-lng="${coords[0]}" data-launch-lat="${coords[1]}" ${closed ? 'disabled title="Agency lists this facility as closed"' : ''}>Use as my launch</button>` : ''}
  ${k === 'fishing' && !p.source_access_type ? `<button class="btn primary" data-use-spot data-launch-id="${esc(p.osm ?? coords.join(','))}" data-launch-name="${esc(p.name || ACCESS_LABELS[k])}" data-launch-lng="${coords[0]}" data-launch-lat="${coords[1]}" ${closed ? 'disabled title="Agency lists this facility as closed"' : ''}>Add fishing spot to trip</button>` : ''}
  ${rows ? `<table class="props">${rows}</table>` : ''}
  <p><a href="${nav}" target="_blank" rel="noopener">Driving directions ↗</a>${p.osm ? ` · <a href="https://www.openstreetmap.org/${esc(p.osm)}" target="_blank" rel="noopener">Fix/add info on OSM ↗</a>` : ''}</p>
  ${sourceMetadata(p.data_source ? p : { ...p, data_source: 'OpenStreetMap contributors' })}<p class="muted small">A mapped access point does not confirm current opening, permissions or launch conditions. Confirm access with the operator.</p>`;
}
