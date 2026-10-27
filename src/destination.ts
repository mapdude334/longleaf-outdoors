import { symbolHtml } from './symbols';
import type { Map } from 'maplibre-gl';
import { waters, placeTitleCase, waterAdministrativeLabel, waterDisplayLabel, waterDisplayName, waterHtml } from './layers/waters';
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
import { showSelectedWaterOutline } from './water-outline';
import { ALL_REGION } from './config';
import { REGIONS, regionContainsWater, type RegionDefinition } from './state-regions';

const BOUNDS: [[number, number], [number, number]] = [[-85.32, 32.86], [-85.02, 33.22]];
const regionWaters = (region: RegionDefinition) => waters.filter((water) => regionContainsWater(region, water));
const selectedRegion = () => REGIONS.find((region) => region.id === store.get<string>('destination-area')?.v) ?? ALL_REGION;
export function zoomToRegion(map: Map, region: RegionDefinition) {
  const compact = isCompactLayout();
  if (compact) setSheetSnap('peek');
  const bottom = compact ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) + 20 : 45;
  // Fit the entire state outline into the usable map rectangle. Reset any
  // persistent sidebar padding first, then calculate the inset relative to the
  // map container (not the browser window) so all supported states center
  // consistently beside the open panel.
  map.setPadding({ top: 0, left: 0, right: 0, bottom: 0 });
  const mapLeft = map.getContainer().getBoundingClientRect().left;
  const panel = document.querySelector<HTMLElement>('#sheet');
  const panelRight = panel?.getBoundingClientRect().right ?? 390;
  const left = compact ? 35 : Math.max(45, Math.ceil(panelRight - mapLeft + 32));
  const padding = { top: 45, left, right: 45, bottom };
  map.fitBounds(region.viewBounds ?? region.bounds, { padding, maxZoom: 9, bearing: 0, pitch: 0, duration: 900, essential: true });
}
function showFullRegionMap(map: Map, region: RegionDefinition) {
  setSheetSnap('peek');
  requestAnimationFrame(() => {
    map.resize();
    zoomToRegion(map, region);
  });
}
function pickerHtml(id: string, title: string, placeholder: string, options: { value: string; label: string }[], selected?: string, disabled = false) {
  const selectedOption = options.find((option) => option.value === selected);
  return `<div class="destination-picker"><span class="destination-picker-label" id="${id}-label">${esc(title)}</span><div class="destination-combobox"><button type="button" id="${id}" class="destination-select" role="combobox" aria-labelledby="${id}-label ${id}-value" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list" data-picker-button ${disabled ? 'disabled' : ''}><span id="${id}-value">${esc(selectedOption?.label ?? placeholder)}</span><span class="destination-select-arrow" aria-hidden="true"></span></button><div class="destination-menu" hidden><input type="search" class="destination-search" placeholder="Type to search" aria-label="Search ${esc(title.toLowerCase())}" autocomplete="off"><div class="destination-option-list" id="${id}-list" role="listbox" aria-labelledby="${id}-label">${options.map((option) => `<button type="button" class="destination-option" role="option" data-picker-option data-value="${esc(option.value)}" aria-selected="${option.value === selected ? 'true' : 'false'}">${esc(option.label)}</button>`).join('')}</div><p class="destination-no-results" hidden>No matches. Try another search.</p></div></div></div>`;
}
function regionPickerHtml() {
  const selected = store.get<string>('destination-area')?.v;
  return pickerHtml('destination-region', 'Choose a region', 'Search regions', REGIONS.map((item) => ({ value: item.id, label: placeTitleCase(item.label) })), selected);
}
function destinationPickerHtml(choices: typeof waters, selected?: string) {
  const sorted = [...choices].sort((a, b) => a.name.localeCompare(b.name));
  const options = sorted.map((water) => ({ value: water.id, label: waterDisplayLabel(water) }));
  return pickerHtml('destination-select', 'Choose your destination', sorted.length ? 'Search lakes, rivers, or coastal waters' : 'No cataloged waters in this area yet', options, selected, !sorted.length);
}
function wireSearchPicker(root: HTMLElement, id: string, choose: (value: string) => void) {
  const button = root.querySelector<HTMLButtonElement>(`#${id}`);
  const menu = button?.parentElement?.querySelector<HTMLElement>('.destination-menu');
  const search = menu?.querySelector<HTMLInputElement>('.destination-search');
  const list = menu?.querySelector<HTMLElement>('.destination-option-list');
  const noResults = menu?.querySelector<HTMLElement>('.destination-no-results');
  if (!button || !menu || !search || !list || !noResults || button.disabled) return;
  const filter = () => {
    const term = search.value.trim().toLocaleLowerCase();
    let matches = 0;
    list.querySelectorAll<HTMLButtonElement>('[data-picker-option]').forEach((option) => {
      const visible = option.textContent!.toLocaleLowerCase().includes(term);
      option.hidden = !visible;
      if (visible) matches++;
    });
    noResults.hidden = matches > 0;
  };
  button.onclick = () => {
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) { search.value = ''; filter(); search.focus(); }
  };
  search.oninput = filter;
  search.onkeydown = (event) => {
    if (event.key === 'Escape') { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus(); }
    if (event.key === 'Enter') {
      const first = list.querySelector<HTMLButtonElement>('[data-picker-option]:not([hidden])');
      if (first) { event.preventDefault(); choose(first.dataset.value!); }
    }
  };
  list.onclick = (event) => {
    const option = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-picker-option]');
    if (option) choose(option.dataset.value!);
  };
}
function wireRegionPicker(root: HTMLElement, map: Map, region: RegionDefinition, actions: Parameters<typeof renderDestination>[2]) {
  wireSearchPicker(root, 'destination-region', (id) => {
    const nextRegion = REGIONS.find((item) => item.id === id);
    if (!nextRegion) return;
    if (nextRegion.id !== region.id) {
      store.set('destination-area', nextRegion.id);
      actions.regionChanged?.();
      const current = store.get<string>('destination')?.v;
      if (current && !regionWaters(nextRegion).some((water) => water.id === current)) store.del('destination');
    }
    root.scrollTop = 0;
    void renderDestination(root, map, actions);
    // Recalculate the map viewport after the destination panel has refreshed.
    // This keeps the selected region centered in the unobstructed map area.
    requestAnimationFrame(() => {
      map.resize();
      zoomToRegion(map, nextRegion);
    });
  });
}
export function selectDestination(id: string) {
  store.set('destination', id);
  const current = selectedRegion();
  if (store.get<string>('destination-area')?.v && regionWaters(current).some((water) => water.id === id)) return;
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
  regionChanged?: () => void;
}) {
  if (destinationDownloadBusy()) return;
  const region = selectedRegion();
  const choices = regionWaters(region).sort((a, b) => a.name.localeCompare(b.name));
  const selected = store.get<string>('destination')?.v;
  const water = choices.find((w) => w.id === selected);
  if (!choices.length) {
    root.innerHTML = `<div class="destination-hero"><span class="destination-eyebrow">YOUR NEXT DAY OUT</span>${regionPickerHtml()}${destinationPickerHtml([], undefined)}<h2>Explore the map</h2><p>We don’t have destination records mapped for this area yet. You can still explore the map and its available layers.</p><button class="btn destination-explore" data-explore-region>Show full map ↗</button></div><div class="destination-body"><div class="destination-card"><b>Destination coverage is still growing</b><p class="muted small">The map can show available public data here, but lake-specific species, access, and trip guidance have not been cataloged for this region yet.</p></div></div>`;
    showSelectedWaterOutline(map, undefined);
    wireRegionPicker(root, map, region, actions);
    root.querySelector<HTMLButtonElement>('[data-explore-region]')!.onclick = () => showFullRegionMap(map, region);
    return;
  }
  if (!water) {
    root.innerHTML = `<div class="destination-hero"><span class="destination-eyebrow">YOUR NEXT DAY OUT</span>${regionPickerHtml()}<p class="small region-scope-note">Search for a region to update the map data and destination choices.</p>${destinationPickerHtml(choices)}<h2>Choose a body of water</h2><p>Select a lake, river, or coastal water to see its details, species, nearby access, and trip planning options.</p><button class="btn destination-explore" data-explore-region>Show full map ↗</button></div><div class="destination-body"><div class="destination-card"><b>Explore the map while you decide</b><p class="muted small">Browse anywhere in the available map area. Data and point symbols appear as you zoom to useful map scales. Choose a destination when you’re ready for water-specific information and trip planning.</p></div></div>`;
    showSelectedWaterOutline(map, undefined);
    wireRegionPicker(root, map, region, actions);
  root.querySelector<HTMLButtonElement>('[data-explore-region]')!.onclick = () => showFullRegionMap(map, region);
    wireSearchPicker(root, 'destination-select', (id) => {
      const chosen = choices.find((item) => item.id === id);
      if (!chosen) return;
      selectDestination(chosen.id);
      actions.regionChanged?.();
      if (chosen.center) map.flyTo({ center: chosen.center, zoom: 10 });
      root.scrollTop = 0; void renderDestination(root, map, actions);
    });
    return;
  }
  const CENTER = water?.center ?? [-85.16, 33.0] as [number, number];
  const radius = Math.max(8, Math.sqrt((water?.acres ?? 5000) * 0.00404686 / Math.PI) * 2.4);
  const latSpan = radius / 111;
  const lngSpan = latSpan / Math.cos(CENTER[1] * Math.PI / 180);
  const bounds: [[number, number], [number, number]] = water?.id === 'west-point' ? BOUNDS : (water?.bounds && locationBounds(water.bounds)) || [[CENTER[0] - lngSpan, CENTER[1] - latSpan], [CENTER[0] + lngSpan, CENTER[1] + latSpan]];
  const inside = (p: number[]) => !!water?.center && p[0] >= bounds[0][0] && p[0] <= bounds[1][0] && p[1] >= bounds[0][1] && p[1] <= bounds[1][1];
  const near = gauges.filter((g) => inside(g.coords)).sort((a, b) => haversineKm(a.coords, CENTER) - haversineKm(b.coords, CENTER));
  const dam = dams.find((d) => d.lake === water?.id);
  const spots = getWpts().filter((p) => inside([p.lng, p.lat]));
  const trip = activeTrip();
  const seen = new Set<string>();
  const catalog = accessFeatures();
  const coastal = /coastal|reef/i.test(water?.type ?? '');
  const accessMatches = (f: { properties: Record<string, any>; geometry: { coordinates: number[] } }) => !!water?.center && (f.properties.waterbody_id === water.id || (coastal ? haversineKm(f.geometry.coordinates as [number, number], CENTER) <= 120 : inside(f.geometry.coordinates)));
  const nearbyCatalog = catalog.filter(accessMatches).sort((a, b) => haversineKm(a.geometry.coordinates as [number, number], CENTER) - haversineKm(b.geometry.coordinates as [number, number], CENTER));
  const visibleCatalog = nearbyCatalog.filter((f) => map.getBounds().contains(f.geometry.coordinates as [number, number]));
  const showingNearby = catalog.length > 0 && visibleCatalog.length === 0 && nearbyCatalog.length > 0;
  const candidates = catalog.length ? (showingNearby ? nearbyCatalog : visibleCatalog) : map.queryRenderedFeatures(undefined, { layers: ['access-pts'].filter((id) => !!map.getLayer(id)) });
  const access = candidates
    .filter((f) => {
      if (f.geometry.type !== 'Point' || !accessMatches(f as any)) return false;
      const key = f.properties.osm ?? f.properties.record_id ?? `${f.properties.name}:${f.geometry.coordinates.join(',')}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    });
  const accessCache = store.get('access-osm');
  const accessEdition = store.get<string>('access-edition')?.v;
  const sectionOpen = new globalThis.Map([...root.querySelectorAll<HTMLDetailsElement>('details[data-section]')].map((section) => [section.dataset.section!, section.open]));
  const tripSummaryOpen = root.querySelector<HTMLDetailsElement>('details[data-trip-summary]')?.open;
  const overviewOpen = root.querySelector<HTMLDetailsElement>('details[data-overview]')?.open;
  root.innerHTML = `<div class="destination-hero">
      <span class="destination-eyebrow">YOUR NEXT DAY OUT · SOUTHEAST</span>
      ${regionPickerHtml()}
      <p class="small region-scope-note">Map points and destination choices are scoped to this area. Choose another region to switch the map data shown here.</p>
      ${destinationPickerHtml(choices, water.id)}
      <h2>${esc(water ? waterDisplayName(water) : 'Choose your water')}</h2><p>Pick your launch. Check the water.<br>Keep the day yours.</p>
      <p class="muted small water-outline-status" data-water-outline-status role="status" aria-live="polite"></p>
      <button class="btn destination-explore" ${water?.center ? '' : 'disabled'}>Explore this water ↗</button>
      ${water && !water.center ? '<p class="small">A single map location is not available for this destination. Browse its information below.</p>' : ''}
    </div>
    <div class="destination-body">
      <div class="destination-meta">${esc(water ? waterAdministrativeLabel(water) : '')}<span>${esc(water?.manager ?? '')}</span></div>
      <div class="destination-actions" aria-label="Plan your visit">
        <button class="btn primary plan-trip" data-action="trips">Plan or edit a trip</button>
        <button class="btn" data-action="weather" ${water?.center ? '' : 'disabled'}>Check weather</button>
        <button class="btn" data-action="offline">Offline maps</button>
      </div>
      ${trip && trip.destination === water?.id ? `<details class="destination-card trip-summary" data-trip-summary><summary><b>Ready to head out?</b><span>${esc(trip.name)}</span><small>${esc(trip.ramp?.name ?? 'Choose a launch')} · ${esc(trip.date || 'Date not set')}</small></summary><p>Launch: ${esc(trip.ramp?.name ?? 'Not selected')}${trip.ramp ? ` · <a href="https://www.google.com/maps/dir/?api=1&destination=${trip.ramp.coords[1]},${trip.ramp.coords[0]}" target="_blank" rel="noopener">Directions ↗</a>` : ''}</p><p>Fishing spots: ${esc(trip.spots.map((s) => s.name).join(', ') || 'None selected')}</p><p style="white-space:pre-wrap">${esc(trip.notes)}</p><p data-trip-maps>Checking downloaded map packs…</p><div class="trip-actions"><button class="btn" data-trip-weather>Check trip weather</button><button class="btn" data-trip-maps>Review offline downloads</button></div><p class="muted small">Check the conditions below and official access rules before leaving. Launches use a boat symbol; your fishing spots use a rose fish symbol.</p></details>` : ''}
      ${water ? `<details class="destination-section destination-overview" data-overview><summary>Lake details, species &amp; rules</summary><p class="muted small">${water.acres ? water.acres.toLocaleString() + ' acres · ' : ''}${esc(waterAdministrativeLabel(water))} · ${esc(water.type)}</p><p>${esc(water.notes ?? '')}</p><button class="btn" data-action="overview">Species, lake notes &amp; official links ↗</button></details>` : ''}
      <h4>01 / Before you launch</h4>
      <p class="muted small">Readings below come from nearby gauges; they may describe river conditions rather than the reservoir level. Check each station and observation time.</p>
      ${near.length ? near.slice(0, 2).map((g) => `<details class="destination-card"><summary>${esc(g.name)}</summary>${gaugeHtml(g)}</details>`).join('') : `<div class="destination-card">${actions.gaugeState === 'loading' ? 'Loading water readings…' : actions.gaugeState === 'unavailable' ? 'Water-reading service unavailable.' : 'No stations loaded near this destination.'}<p class="muted small">A missing reading does not establish current conditions.</p></div>`}
      ${dam ? '<button class="btn" data-action="dam">Dam & release information ↗</button>' : ''}
      <h4>02 / Access points &amp; launches${access.length ? ` · ${access.length} nearby` : ''}</h4>
      <p class="muted small">${water?.center ? coastal ? 'Coastal access within 75 miles of this overview point, ranked by straight-line distance. These locations may serve neighboring waters; proximity is not a safe boating route or confirmation of marine access.' : 'Locations near this destination, selected by distance. They may serve a neighboring water body. Explore the water, then refresh to see more.' : 'Nearby access cannot be matched until a map location is available.'} A mapped location does not confirm an open launch.</p>
      <button class="link" data-action="refresh">Refresh visible access</button>
      ${showingNearby ? '<p class="muted small">No access locations in this map view. Showing nearby places outside the view; check each location before choosing a launch.</p>' : ''}
      <ul class="list">${access.slice(0, 8).map((f, i) => `<li><button class="destination-row" data-access="${i}"><b>${symbolHtml(f.properties.kind)}${esc(f.properties.name || ACCESS_LABELS[f.properties.kind] || 'Access point')}</b>${f.properties.description ? `<span>${esc(f.properties.description)}</span>` : ''}<span>${esc(accessLocation(f.properties, f.geometry.type === 'Point' ? f.geometry.coordinates as [number, number] : CENTER))}</span><span>${esc(ACCESS_LABELS[f.properties.kind] ?? 'Access')} · View details ↗</span></button></li>`).join('') || '<li class="muted">No access locations in this view. Explore this water or zoom out to see nearby places.</li>'}</ul>
      ${accessCache ? `<p class="muted small">${accessEdition ? 'Access catalog retrieved ' + esc(new Date(accessEdition).toLocaleDateString()) : 'Live-service access cache saved ' + esc(new Date(accessCache.t).toLocaleString())}. Agency and community sources are identified on each location card. Regional map packs have separate coverage and dates.</p>` : ''}
      <h4>03 / Make it your lake</h4>
      <ul class="list">${spots.map((p) => `<li><button class="destination-row" data-spot="${esc(p.id)}"><b>${esc(p.name)}</b><span>My saved spot ↗</span></button></li>`).join('') || '<li class="muted">Your lake spots will appear here. Long-press the map to save your first one.</li>'}</ul>
      <button class="btn" data-action="fish">Species & lake notes</button>
      <h4>04 / Ready for no signal?</h4><div class="destination-card" id="destination-packs" aria-live="polite">Checking downloaded maps…</div>
      <p class="muted small">Map packs cover the configured region. Weather and release information need a connection for updates. Keep the app open while recording GPS.</p>
    </div>`;
  showSelectedWaterOutline(map, water, (message) => {
    const status = root.querySelector<HTMLElement>('[data-water-outline-status]');
    if (status) status.textContent = message;
  });
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
  wireSearchPicker(root, 'destination-select', (id) => {
    const next = waters.find((item) => item.id === id);
    if (!next) return;
    selectDestination(id);
    actions.regionChanged?.();
    if (next?.center) map.flyTo({ center: next.center, zoom: 10 });
    root.scrollTop = 0;
    void renderDestination(root, map, actions);
  });
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
    const exploreBounds: [[number, number], [number, number]] = water?.acres && water.acres < 1000
      ? [[CENTER[0] - 0.015, CENTER[1] - 0.012], [CENTER[0] + 0.015, CENTER[1] + 0.012]] : bounds;
    setSheetSnap('peek');
    requestAnimationFrame(() => {
      map.resize();
      const bottom = isCompactLayout() ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) + 20 : 45;
      map.fitBounds(exploreBounds, { padding: { top: 45, left: 45, right: 45, bottom }, duration: 900 });
    });
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
