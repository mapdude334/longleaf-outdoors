import { symbolHtml } from './symbols';
import type { Map } from 'maplibre-gl';
import { waters, waterHtml } from './layers/waters';
import { gauges, gaugeHtml, fillTrend } from './layers/gauges';
import { dams, damHtml, fillCwms } from './layers/dams';
import { ACCESS_LABELS, accessHtml, accessLocation, accessFeatures } from './layers/access';
import { getWpts } from './waypoints';
import { renderDestinationDownloads, destinationDownloadBusy } from './destination-downloads';
import { activeTrip } from './trips';
import { packStatus, loadPackManifest } from './pmtiles';
import { esc, haversineKm, store } from './util';
import { isCompactLayout, setSheetSnap } from './sheet';
import { locationBounds } from './region-bounds';

const BOUNDS: [[number, number], [number, number]] = [[-85.32, 32.86], [-85.02, 33.22]];
type Region = { id: string; label: string; bounds: [[number, number], [number, number]]; state?: 'AL' | 'GA'; };
const REGIONS: Region[] = [
  { id: 'core', label: 'East Alabama & West Georgia · core map pack', bounds: [[-86.35, 31.55], [-84.35, 33.85]] },
  { id: 'alabama', label: 'Alabama · cataloged destinations', state: 'AL', bounds: [[-88.6, 30.15], [-84.85, 35.1]] },
  { id: 'georgia', label: 'Georgia · cataloged destinations', state: 'GA', bounds: [[-85.7, 30.25], [-80.75, 35.05]] },
  { id: 'coastal', label: 'Gulf & Atlantic Coast · map bookmark', bounds: [[-88.55, 29.55], [-80.72, 32.12]] },
];
const stateCodes = (state: string) => state.split(/[\/,]/).map((part) => part.trim());
const regionWaters = (region: Region) => waters.filter((water) => {
  if (!water.center) return false;
  if (region.id === 'coastal') {
    const [lng, lat] = water.center;
    const codes = stateCodes(water.state);
    return (codes.includes('AL') && lng >= -88.4 && lng <= -87.25 && lat <= 31.35)
      || (codes.includes('GA') && lng >= -82.35 && lng <= -80.72 && lat <= 32.12);
  }
  const [west, south] = region.bounds[0], [east, north] = region.bounds[1];
  return water.center[0] >= west && water.center[0] <= east && water.center[1] >= south && water.center[1] <= north && (!region.state || stateCodes(water.state).includes(region.state));
});
const selectedRegion = () => REGIONS.find((region) => region.id === store.get<string>('destination-area')?.v) ?? REGIONS[0];
function zoomToRegion(map: Map, region: Region) {
  const points = regionWaters(region).flatMap((water) => water.center ? [water.center] : []);
  const bounds = locationBounds(points) ?? region.bounds;
  if (isCompactLayout()) setSheetSnap('peek');
  const bottom = isCompactLayout() ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) + 20 : 45;
  map.fitBounds(bounds, { padding: { top: 45, left: isCompactLayout() ? 35 : 410, right: 45, bottom }, duration: 900, maxZoom: points.length === 1 ? 11 : 12 });
}
function regionPickerHtml(region: Region) {
  return `<label class="destination-picker">Choose a region<select id="destination-region">${REGIONS.map((item) => `<option value="${item.id}" ${item.id === region.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>`;
}
function wireRegionPicker(root: HTMLElement, map: Map, region: Region, actions: Parameters<typeof renderDestination>[2]) {
  root.querySelector<HTMLSelectElement>('#destination-region')?.addEventListener('change', (event) => {
    const nextRegion = REGIONS.find((item) => item.id === (event.target as HTMLSelectElement).value) ?? REGIONS[0];
    store.set('destination-area', nextRegion.id);
    const options = regionWaters(nextRegion);
    const current = store.get<string>('destination')?.v;
    if (options.length && !options.some((water) => water.id === current)) selectDestination(options[0].id);
    zoomToRegion(map, nextRegion);
    root.scrollTop = 0;
    void renderDestination(root, map, actions);
  });
}
export function selectDestination(id: string) {
  store.set('destination', id);
  const current = selectedRegion();
  if (regionWaters(current).some((water) => water.id === id)) return;
  const matching = REGIONS.find((region) => regionWaters(region).some((water) => water.id === id));
  if (matching) store.set('destination-area', matching.id);
}

export async function renderDestination(root: HTMLElement, map: Map, actions: {
  weather: (at: [number, number]) => void;
  offline: () => void;
  info: (html: string, after?: (root: HTMLElement) => void) => void;
  spot: (id: string) => void;
  trips: () => void;
  downloadsChanged: () => void;
  gaugeState: 'loading' | 'ready' | 'unavailable';
}) {
  if (destinationDownloadBusy()) return;
  const region = selectedRegion();
  const choices = regionWaters(region).sort((a, b) => a.name.localeCompare(b.name));
  const selected = store.get<string>('destination')?.v ?? 'west-point';
  const water = choices.find((w) => w.id === selected) ?? choices[0];
  if (!choices.length) {
    root.innerHTML = `<div class="destination-hero"><span class="destination-eyebrow">EXPLORE ALABAMA &amp; GEORGIA</span>${regionPickerHtml(region)}<label class="destination-picker">Choose your destination<select id="destination-select" disabled><option>No cataloged waters in this area yet</option></select></label><h2>${esc(region.label)}</h2><p>We don’t have destination records mapped for this area yet. You can still explore the map and its available layers.</p><button class="btn destination-explore" data-explore-region>Explore this area ↗</button></div><div class="destination-body"><div class="destination-card"><b>Destination coverage is still growing</b><p class="muted small">The map can show available public data here, but lake-specific species, access, and trip guidance have not been cataloged for this region yet.</p></div></div>`;
    wireRegionPicker(root, map, region, actions);
    root.querySelector<HTMLButtonElement>('[data-explore-region]')!.onclick = () => zoomToRegion(map, region);
    return;
  }
  const CENTER = water?.center ?? [-85.16, 33.0] as [number, number];
  const radius = Math.max(8, Math.sqrt((water?.acres ?? 5000) * 0.00404686 / Math.PI) * 2.4);
  const latSpan = radius / 111;
  const lngSpan = latSpan / Math.cos(CENTER[1] * Math.PI / 180);
  const bounds: [[number, number], [number, number]] = water?.id === 'west-point' ? BOUNDS : [[CENTER[0] - lngSpan, CENTER[1] - latSpan], [CENTER[0] + lngSpan, CENTER[1] + latSpan]];
  const inside = (p: number[]) => !!water?.center && p[0] >= bounds[0][0] && p[0] <= bounds[1][0] && p[1] >= bounds[0][1] && p[1] <= bounds[1][1];
  const near = gauges.filter((g) => inside(g.coords)).sort((a, b) => haversineKm(a.coords, CENTER) - haversineKm(b.coords, CENTER));
  const dam = dams.find((d) => d.lake === water?.id);
  const spots = getWpts().filter((p) => inside([p.lng, p.lat]));
  const trip = activeTrip();
  const seen = new Set<string>();
  const catalog = accessFeatures();
  const nearbyCatalog = catalog.filter((f) => inside(f.geometry.coordinates)).sort((a, b) => haversineKm(a.geometry.coordinates as [number, number], CENTER) - haversineKm(b.geometry.coordinates as [number, number], CENTER));
  const visibleCatalog = nearbyCatalog.filter((f) => map.getBounds().contains(f.geometry.coordinates as [number, number]));
  const showingNearby = catalog.length > 0 && visibleCatalog.length === 0 && nearbyCatalog.length > 0;
  const candidates = catalog.length ? (showingNearby ? nearbyCatalog : visibleCatalog) : map.queryRenderedFeatures(undefined, { layers: ['access-pts'].filter((id) => !!map.getLayer(id)) });
  const access = candidates
    .filter((f) => {
      if (f.geometry.type !== 'Point' || !inside(f.geometry.coordinates)) return false;
      const key = f.properties.osm ?? `${f.properties.name}:${f.geometry.coordinates.join(',')}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    });
  const accessCache = store.get('access-osm');
  const accessEdition = store.get<string>('access-edition')?.v;
  const sectionOpen = new globalThis.Map([...root.querySelectorAll<HTMLDetailsElement>('details[data-section]')].map((section) => [section.dataset.section!, section.open]));
  const tripSummaryOpen = root.querySelector<HTMLDetailsElement>('details[data-trip-summary]')?.open;
  const overviewOpen = root.querySelector<HTMLDetailsElement>('details[data-overview]')?.open;
  root.innerHTML = `<div class="destination-hero">
      <span class="destination-eyebrow">YOUR NEXT DAY OUT · ALABAMA / GEORGIA</span>
      ${regionPickerHtml(region)}
      <p class="small region-scope-note">Showing cataloged destinations in this area. Spatial layers and offline map coverage vary by source.</p>
      <label class="destination-picker">Choose your destination<select id="destination-select">${choices.map((w) => `<option value="${esc(w.id)}" ${w.id === water?.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
      <h2>${esc(water?.name ?? 'Choose your water')}</h2><p>Pick your launch. Check the water.<br>Keep the day yours.</p>
      <button class="btn destination-explore" ${water?.center ? '' : 'disabled'}>Explore this water ↗</button>
      ${water && !water.center ? '<p class="small">A single map location is not available for this destination. Browse its information below.</p>' : ''}
    </div>
    <div class="destination-body">
      <div class="destination-meta">${esc(water?.river ? water.river + ' basin' : water?.state ?? '')}<span>${esc(water?.manager ?? '')}</span></div>
      <div class="destination-actions" aria-label="Plan your visit">
        <button class="btn primary plan-trip" data-action="trips">Plan or edit a trip</button>
        <button class="btn" data-action="weather" ${water?.center ? '' : 'disabled'}>Check weather</button>
        <button class="btn" data-action="offline">Offline maps</button>
      </div>
      ${trip && trip.destination === water?.id ? `<details class="destination-card trip-summary" data-trip-summary><summary><b>Ready to head out?</b><span>${esc(trip.name)}</span><small>${esc(trip.ramp?.name ?? 'Choose a launch')} · ${esc(trip.date || 'Date not set')}</small></summary><p>Launch: ${esc(trip.ramp?.name ?? 'Not selected')}${trip.ramp ? ` · <a href="https://www.google.com/maps/dir/?api=1&destination=${trip.ramp.coords[1]},${trip.ramp.coords[0]}" target="_blank" rel="noopener">Directions ↗</a>` : ''}</p><p>Fishing spots: ${esc(trip.spots.map((s) => s.name).join(', ') || 'None selected')}</p><p style="white-space:pre-wrap">${esc(trip.notes)}</p><p data-trip-maps>Checking downloaded map packs…</p><div class="trip-actions"><button class="btn" data-trip-weather>Check trip weather</button><button class="btn" data-trip-maps>Review offline downloads</button></div><p class="muted small">Check the conditions below and official access rules before leaving. Launches use a boat symbol; your fishing spots use a rose fish symbol.</p></details>` : ''}
      ${water ? `<details class="destination-section destination-overview" data-overview><summary>Lake details, species &amp; rules</summary><p class="muted small">${water.acres ? water.acres.toLocaleString() + ' acres · ' : ''}${esc(water.state)} · ${esc(water.type)}</p><p>${esc(water.notes ?? '')}</p><button class="btn" data-action="overview">Species, lake notes &amp; official links ↗</button></details>` : ''}
      <h4>01 / Before you launch</h4>
      <p class="muted small">Readings below come from nearby gauges; they may describe river conditions rather than the reservoir level. Check each station and observation time.</p>
      ${near.length ? near.slice(0, 2).map((g) => `<details class="destination-card"><summary>${esc(g.name)}</summary>${gaugeHtml(g)}</details>`).join('') : `<div class="destination-card">${actions.gaugeState === 'loading' ? 'Loading water readings…' : actions.gaugeState === 'unavailable' ? 'Water-reading service unavailable.' : 'No stations loaded near this destination.'}<p class="muted small">A missing reading does not establish current conditions.</p></div>`}
      ${dam ? '<button class="btn" data-action="dam">Dam & release information ↗</button>' : ''}
      <h4>02 / Access points &amp; launches${access.length ? ` · ${access.length} nearby` : ''}</h4>
      <p class="muted small">${water?.center ? 'Locations near this destination, selected by distance. They may serve a neighboring water body. Explore the water, then refresh to see more.' : 'Nearby access cannot be matched until a map location is available.'} Community locations do not confirm an open launch.</p>
      <button class="link" data-action="refresh">Refresh visible access</button>
      ${showingNearby ? '<p class="muted small">No access locations in this map view. Showing nearby places outside the view; check each location before choosing a launch.</p>' : ''}
      <ul class="list">${access.slice(0, 8).map((f, i) => `<li><button class="destination-row" data-access="${i}"><b>${symbolHtml(f.properties.kind)}${esc(f.properties.name || ACCESS_LABELS[f.properties.kind] || 'Access point')}</b>${f.properties.description ? `<span>${esc(f.properties.description)}</span>` : ''}<span>${esc(accessLocation(f.properties, f.geometry.type === 'Point' ? f.geometry.coordinates as [number, number] : CENTER))}</span><span>${esc(ACCESS_LABELS[f.properties.kind] ?? 'Access')} · View details ↗</span></button></li>`).join('') || '<li class="muted">No access locations in this view. Explore this water or zoom out to see nearby places.</li>'}</ul>
      ${accessCache ? `<p class="muted small">${accessEdition ? 'Published OpenStreetMap catalog dated ' + esc(new Date(accessEdition).toLocaleDateString()) : 'Live-service access cache saved ' + esc(new Date(accessCache.t).toLocaleString())}. Downloaded overlays may have a different date.</p>` : ''}
      <h4>03 / Make it your lake</h4>
      <ul class="list">${spots.map((p) => `<li><button class="destination-row" data-spot="${esc(p.id)}"><b>${esc(p.name)}</b><span>My saved spot ↗</span></button></li>`).join('') || '<li class="muted">Your lake spots will appear here. Long-press the map to save your first one.</li>'}</ul>
      <button class="btn" data-action="fish">Species & lake notes</button>
      <h4>04 / Ready for no signal?</h4><div class="destination-card" id="destination-packs" aria-live="polite">Checking downloaded maps…</div>
      <p class="muted small">Map packs cover the configured region. Weather and release information need a connection for updates. Keep the app open while recording GPS.</p>
    </div>`;
  const headings = [...root.querySelectorAll<HTMLElement>('.destination-body > h4')];
  headings.forEach((heading, index) => {
    const section = document.createElement('details');
    section.className = 'destination-section'; section.dataset.section = String(index);
    section.open = sectionOpen.get(String(index)) ?? (isCompactLayout() ? index === 1 : index < 2);
    const summary = document.createElement('summary'); summary.textContent = heading.textContent;
    section.append(summary); heading.replaceWith(section);
    while (section.nextSibling && !headings.includes(section.nextSibling as HTMLElement)) section.append(section.nextSibling);
  });
  const tripSummary = root.querySelector<HTMLDetailsElement>('details[data-trip-summary]');
  if (tripSummary) tripSummary.open = tripSummaryOpen ?? !isCompactLayout();
  const overviewDetails = root.querySelector<HTMLDetailsElement>('details[data-overview]');
  if (overviewDetails) overviewDetails.open = overviewOpen ?? !isCompactLayout();
  root.querySelector<HTMLSelectElement>('#destination-select')!.onchange = (event) => {
    const id = (event.target as HTMLSelectElement).value;
    selectDestination(id);
    const next = waters.find((w) => w.id === id);
    if (next?.center) map.flyTo({ center: next.center, zoom: 10 });
    root.scrollTop = 0;
    void renderDestination(root, map, actions);
    root.querySelector<HTMLSelectElement>('#destination-select')?.focus({ preventScroll: true });
  };
  wireRegionPicker(root, map, region, actions);
  const overview = root.querySelector<HTMLButtonElement>('[data-action="overview"]');
  root.querySelector<HTMLButtonElement>('[data-action="trips"]')!.onclick = actions.trips;
  const tripWeather = root.querySelector<HTMLButtonElement>('[data-trip-weather]');
  if (tripWeather) tripWeather.onclick = () => actions.weather(trip?.ramp?.coords ?? CENTER);
  const tripMaps = root.querySelector<HTMLButtonElement>('button[data-trip-maps]');
  if (tripMaps) tripMaps.onclick = actions.offline;
  const mapsStatus = root.querySelector<HTMLElement>('p[data-trip-maps]');
  if (mapsStatus && trip) void Promise.all([packStatus('basemap'), packStatus('overlays'), loadPackManifest()]).then(([base, overlays, manifest]) => {
    if (!mapsStatus.isConnected) return;
    const locations = [...(water?.center ? [water.center] : []), ...(trip.ramp ? [trip.ramp.coords] : []), ...trip.spots.map((p) => p.coords)];
    const bounds = manifest?.bounds;
    const covered = !!bounds && locations.length > 0 && locations.every(([x, y]) => x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3]);
    mapsStatus.textContent = base === 'Verified on device' && overlays === 'Verified on device'
      ? covered ? 'Regional packs verified on device; trip points are within coverage.' : 'Regional packs are on device. Coverage for every trip point is not verified.'
      : 'Regional packs are not ready on this device. Review saved area coverage in Offline and test before leaving.';
  });
  if (overview) overview.onclick = () => actions.info(waterHtml(water!));
  root.querySelector<HTMLButtonElement>('.destination-explore')!.onclick = () => {
    if (isCompactLayout()) setSheetSnap('peek');
    const bottom = isCompactLayout() ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) + 20 : 45;
    const exploreBounds: [[number, number], [number, number]] = water?.acres && water.acres < 1000
      ? [[CENTER[0] - 0.015, CENTER[1] - 0.012], [CENTER[0] + 0.015, CENTER[1] + 0.012]] : bounds;
    map.fitBounds(exploreBounds, { padding: { top: 45, left: 45, right: 45, bottom }, duration: 900 });
  };
  root.querySelector<HTMLButtonElement>('[data-action="weather"]')!.onclick = () => actions.weather(CENTER);
  root.querySelector<HTMLButtonElement>('[data-action="offline"]')!.onclick = actions.offline;
  root.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.onclick = () => { void renderDestination(root, map, actions); };
  root.querySelector<HTMLButtonElement>('[data-action="fish"]')!.onclick = () => actions.info(water ? waterHtml(water) : '<h3>Lake notes unavailable</h3><p>Reconnect to load lake information.</p>');
  const damButton = root.querySelector<HTMLButtonElement>('[data-action="dam"]');
  if (damButton && dam) damButton.onclick = () => actions.info(damHtml(dam), (el) => { void fillCwms(el, dam); });
  root.querySelectorAll<HTMLButtonElement>('[data-access]').forEach((b) => { b.onclick = () => {
    const f = access[Number(b.dataset.access)];
    if (f.geometry.type === 'Point') actions.info(accessHtml(f.properties, f.geometry.coordinates as [number, number]));
  }; });
  root.querySelectorAll<HTMLButtonElement>('[data-spot]').forEach((b) => { b.onclick = () => actions.spot(b.dataset.spot!); });
  root.querySelectorAll<HTMLDetailsElement>('details.destination-card').forEach((detail) => {
    detail.addEventListener('toggle', () => {
      if (!detail.open || detail.dataset.trendLoaded) return;
      const id = detail.querySelector<HTMLElement>('.spark-wrap')?.dataset.gauge;
      const gauge = near.find((g) => g.id === id);
      if (gauge) { detail.dataset.trendLoaded = 'true'; void fillTrend(detail, gauge); }
    });
  });
  const target = root.querySelector('#destination-packs')!;
  if (target.isConnected) renderDestinationDownloads(target as HTMLElement, map, actions.downloadsChanged);
}
