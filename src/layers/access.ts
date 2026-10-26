// Boat ramps, fishing piers, paddle launches, marinas, campgrounds.
// With overlays.pmtiles installed these come from the tiles; otherwise we pull them live from
// OpenStreetMap (Overpass) once for the whole region and keep the result for offline use.
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { AOI, OVERPASS } from '../config';
import { ACCESS_COLORS } from '../style';
import { cachedLive, esc, haversineKm } from '../util';
import { waters } from './waters';
import { dams } from './dams';

export const ACCESS_LABELS: Record<string, string> = {
  boat_ramp: 'Boat ramp', paddle_launch: 'Kayak / canoe launch', fishing: 'Fishing pier / spot',
  marina: 'Marina', campground: 'Campground', trailhead: 'Trailhead', parking: 'Parking', other: 'Access',
};

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
  const [w, s, e, n] = AOI;
  const bb = `(${s},${w},${n},${e})`;
  const q = `[out:json][timeout:90];(nwr["leisure"="slipway"]${bb};nwr["amenity"="boat_ramp"]${bb};nwr["leisure"="fishing"]${bb};nwr["man_made"="pier"]${bb};nwr["canoe"="put_in"]${bb};nwr["leisure"="marina"]${bb};nwr["tourism"="camp_site"]${bb};);out center tags;`;
  const res = await cachedLive('access-osm', 7 * 24 * 3600_000, async () => {
    const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!r.ok) throw new Error('Overpass ' + r.status);
    const j = await r.json();
    return (j.elements ?? []).flatMap((el: any) => {
      const lon = el.lon ?? el.center?.lon;
      const lat = el.lat ?? el.center?.lat;
      if (lon == null) return [];
      const t = el.tags ?? {};
      return [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { ...pick(t), kind: kind(t), osm: `${el.type}/${el.id}` } }];
    });
  });
  (map.getSource('access-live') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: res.v });
  return { count: res.v.length, offline: res.offline };
}

const KEEP = ['name', 'operator', 'access', 'fee', 'opening_hours', 'surface', 'lanes', 'website', 'phone', 'description', 'parking', 'toilets', 'fishing', 'lit', 'addr:street', 'addr:city'];

/** Describe the mapped position without inventing a facility name or access conditions. */
export function accessLocation(p: Record<string, any>, coords: [number, number]): string {
  const address = [p['addr:street'], p['addr:city']].filter(Boolean).join(', ');
  if (address) return address;
  const anchors = [
    ...dams.map((d) => ({ name: d.name, coords: d.coords })),
    ...waters.flatMap((w) => w.center ? [{ name: `${w.name} (mapped center)`, coords: w.center }] : []),
  ].map((a) => ({ ...a, distance: haversineKm(coords, a.coords) })).sort((a, b) => a.distance - b.distance);
  const anchor = anchors[0];
  if (!anchor) return `${coords[1].toFixed(4)}° N, ${Math.abs(coords[0]).toFixed(4)}° W`;
  if (anchor.distance < 0.16) return `Near ${anchor.name}`;
  const radians = Math.PI / 180;
  const lat1 = anchor.coords[1] * radians, lat2 = coords[1] * radians;
  const delta = (coords[0] - anchor.coords[0]) * radians;
  const bearing = (Math.atan2(Math.sin(delta) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta)) / radians + 360) % 360;
  const direction = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(bearing / 45) % 8];
  return `${(anchor.distance / 1.609344).toFixed(1)} mi ${direction} of ${anchor.name} · straight-line distance`;
}
function pick(t: Record<string, string>) {
  return Object.fromEntries(Object.entries(t).filter(([k]) => KEEP.includes(k)));
}

export function accessHtml(p: Record<string, any>, coords: [number, number]): string {
  const k = p.kind ?? 'other';
  const rows = KEEP.filter((key) => key !== 'name' && p[key]).map((key) => `<tr><th>${esc(key.replace('_', ' '))}</th><td>${esc(p[key])}</td></tr>`).join('');
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${coords[1]},${coords[0]}`;
  return `<h3>${esc(p.name ?? ACCESS_LABELS[k])}</h3>
  <p><span class="dot" style="background:${ACCESS_COLORS[k]}"></span>${esc(ACCESS_LABELS[k])}</p>
  <p>${esc(accessLocation(p, coords))}</p>
  <p class="muted small">${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}</p>
  ${rows ? `<table class="props">${rows}</table>` : ''}
  <p><a href="${nav}" target="_blank" rel="noopener">Driving directions ↗</a>${p.osm ? ` · <a href="https://www.openstreetmap.org/${esc(p.osm)}" target="_blank" rel="noopener">Fix/add info on OSM ↗</a>` : ''}</p>
  <p class="muted small">Community data (OpenStreetMap). Confirm access rules on site.</p>`;
}
