import type { Map, MapMouseEvent } from 'maplibre-gl';
import { symbolHtml, highlightLocation } from './symbols';
import { waters, waterDisplayLabel, waterDisplayName, waterRecordStatus } from './layers/waters';
import { getWpts } from './waypoints';
import { loadAccessLive, accessLocation, accessFeatures } from './layers/access';
import { isCompactLayout, setSheetSnap, type SheetSnap } from './sheet';
import { esc, haversineKm, store, toast } from './util';
import { shareTrip } from './share';
import { ALL_REGION } from './config';
import { REGIONS, STATES, watersInRegion } from './state-regions';

export type Place = { id: string; name: string; coords: [number, number] };
export type Trip = { id: string; name: string; destination: string; date?: string; ramp?: Place; spots: Place[]; notes: string; updated: number; view: { center: [number, number]; zoom: number } };
const saved = () => store.get<Trip[]>('trips')?.v ?? [];
const draft = () => store.get<Trip>('trip-draft')?.v;
function draftForPlace(place: Place) {
  const destination = store.get<string>('destination')?.v ?? '';
  const current = draft();
  const active = activeTrip();
  const trip = structuredClone(current ?? (active?.destination === destination ? active : undefined) ?? { id: crypto.randomUUID(), name: '', destination, spots: [], notes: '', updated: Date.now(), view: { center: place.coords, zoom: 12 } });
  return trip;
}
export function useLaunchInTrip(place: Place) { const trip = draftForPlace(place); trip.ramp = place; return store.set('trip-draft', trip); }
export function useSpotInTrip(place: Place) { const trip = draftForPlace(place); if (!trip.spots.some((spot) => spot.id === place.id)) trip.spots.push(place); return store.set('trip-draft', trip); }

export function validateTripBackup(value: unknown): Trip[] {
  const data = value as { schema?: number; trips?: Trip[] };
  if (data?.schema !== 1 || !Array.isArray(data.trips) || data.trips.length > 500) throw Error('Choose a Longleaf Atlas trip backup (up to 500 trips).');
  const point = (p: any) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.length <= 120 && Array.isArray(p.coords) && p.coords.length === 2 && p.coords.every(Number.isFinite) && Math.abs(p.coords[0]) <= 180 && Math.abs(p.coords[1]) <= 85;
  const ids = new Set<string>();
  for (const t of data.trips) {
    if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id) || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 120 || typeof t.destination !== 'string' || typeof t.notes !== 'string' || t.notes.length > 10000 || !Array.isArray(t.spots) || t.spots.length > 1000 || !t.spots.every(point) || (t.ramp && !point(t.ramp)) || !Number.isFinite(t.updated) || !t.view || !point({ id: '', name: '', coords: t.view.center }) || !Number.isFinite(t.view.zoom) || t.view.zoom < 0 || t.view.zoom > 24 || (t.date && !/^\d{4}-\d{2}-\d{2}$/.test(t.date))) throw Error('This backup contains an invalid trip. No trips were imported.');
    ids.add(t.id);
  }
  return data.trips;
}
let cancelPick: (() => void) | undefined;
export const pickingTripSpot = () => !!cancelPick;
export function cancelTripPick() { cancelPick?.(); }
export const activeTrip = () => store.get<Trip>('active-trip')?.v;

type TripPickerOption = { value: string; label: string; group: string; detail?: string; search?: string };
const TRIP_PICKER_RESULT_LIMIT = 100;

function tripPickerHtml(id: string, title: string, searchPlaceholder: string, placeholder: string, options: TripPickerOption[], selected: string, prefixHtml = '') {
  const selectedOption = options.find((option) => option.value === selected);
  return `<div class="field trip-picker-field" data-trip-picker="${id}"><span class="trip-picker-label" id="${id}-label">${prefixHtml}${esc(title)}</span><div class="destination-combobox"><button type="button" id="${id}-picker" class="destination-select" role="combobox" aria-labelledby="${id}-label ${id}-value" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list"><span id="${id}-value">${esc(selectedOption?.label ?? placeholder)}</span><span class="destination-select-arrow" aria-hidden="true"></span></button><div class="destination-menu" hidden><input type="search" class="destination-search" placeholder="${esc(searchPlaceholder)}" aria-label="Search ${esc(title.toLocaleLowerCase())}" autocomplete="off"><div class="destination-option-list" id="${id}-list" role="listbox" aria-labelledby="${id}-label"></div><p class="destination-no-results" hidden></p></div></div><input type="hidden" id="${id}" value="${esc(selected)}"></div>`;
}

function wireTripPicker(root: HTMLElement, id: string, options: TripPickerOption[], choose: (value: string) => void) {
  const wrapper = root.querySelector<HTMLElement>(`[data-trip-picker="${id}"]`);
  const button = wrapper?.querySelector<HTMLButtonElement>(`#${id}-picker`);
  const menu = wrapper?.querySelector<HTMLElement>('.destination-menu');
  const search = menu?.querySelector<HTMLInputElement>('.destination-search');
  const list = menu?.querySelector<HTMLElement>('.destination-option-list');
  const noResults = menu?.querySelector<HTMLElement>('.destination-no-results');
  const value = wrapper?.querySelector<HTMLInputElement>(`#${id}`);
  const selectedLabel = wrapper?.querySelector<HTMLElement>(`#${id}-value`);
  if (!wrapper || !button || !menu || !search || !list || !noResults || !value || !selectedLabel) return;
  const close = () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  const filter = () => {
    const term = search.value.trim().toLocaleLowerCase();
    const matches = options.filter((option) => (option.search ?? `${option.label} ${option.detail ?? ''} ${option.group}`).toLocaleLowerCase().includes(term));
    let shown = matches.slice(0, TRIP_PICKER_RESULT_LIMIT);
    const selected = !term ? options.find((option) => option.value === value.value) : undefined;
    if (selected && !shown.includes(selected)) shown = [selected, ...shown.slice(0, TRIP_PICKER_RESULT_LIMIT - 1)];
    const groups = new globalThis.Map<string, TripPickerOption[]>();
    for (const option of shown) {
      const group = groups.get(option.group) ?? [];
      group.push(option); groups.set(option.group, group);
    }
    list.innerHTML = [...groups].map(([group, items]) => `<div class="trip-picker-option-group" data-picker-group><div class="trip-option-group-label">${esc(group)}</div>${items.map((option) => `<button type="button" class="destination-option trip-picker-option" role="option" data-picker-option data-value="${esc(option.value)}" data-search="${esc(option.search ?? `${option.label} ${option.detail ?? ''} ${group}`)}" aria-selected="${option.value === value.value ? 'true' : 'false'}"><span class="trip-picker-option-title">${esc(option.label)}</span>${option.detail ? `<span class="trip-picker-option-detail">${esc(option.detail)}</span>` : ''}</button>`).join('')}</div>`).join('');
    noResults.hidden = matches.length > 0 && matches.length <= shown.length;
    if (!matches.length) { noResults.textContent = 'No matches. Try another search.'; noResults.hidden = false; }
    else if (matches.length > shown.length) { noResults.textContent = `Showing ${shown.length} of ${matches.length.toLocaleString()} matches. Type more to narrow the list.`; noResults.hidden = false; }
  };
  const select = (option: HTMLButtonElement) => {
    value.value = option.dataset.value ?? '';
    selectedLabel.textContent = option.querySelector('.trip-picker-option-title')?.textContent ?? '';
    list.querySelectorAll<HTMLButtonElement>('[data-picker-option]').forEach((item) => item.setAttribute('aria-selected', String(item === option)));
    close();
    choose(value.value);
    if (button.isConnected) button.focus();
  };
  button.onclick = () => {
    const opening = menu.hidden;
    root.querySelectorAll<HTMLElement>('[data-trip-picker] .destination-menu').forEach((other) => { other.hidden = true; });
    root.querySelectorAll<HTMLButtonElement>('[data-trip-picker] [role="combobox"]').forEach((other) => other.setAttribute('aria-expanded', 'false'));
    if (!opening) return;
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    search.value = ''; filter(); search.focus();
  };
  search.oninput = (event) => { event.stopPropagation(); filter(); };
  search.onkeydown = (event) => {
    if (event.key === 'Escape') { close(); button.focus(); }
    if (event.key === 'Enter') {
      const first = list.querySelector<HTMLButtonElement>('[data-picker-option]:not([hidden])');
      if (first) { event.preventDefault(); select(first); }
    }
    if (event.key === 'ArrowDown') {
      const first = list.querySelector<HTMLButtonElement>('[data-picker-option]:not([hidden])');
      if (first) { event.preventDefault(); first.focus(); }
    }
  };
  list.onkeydown = (event) => {
    const options = [...list.querySelectorAll<HTMLButtonElement>('[data-picker-option]:not([hidden])')];
    const index = options.indexOf(event.target as HTMLButtonElement);
    if (event.key === 'Escape') { close(); button.focus(); }
    if (event.key === 'ArrowDown' && index >= 0) { event.preventDefault(); options[Math.min(index + 1, options.length - 1)]?.focus(); }
    if (event.key === 'ArrowUp' && index >= 0) { event.preventDefault(); (options[index - 1] ?? search).focus(); }
  };
  list.onclick = (event) => {
    const option = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-picker-option]');
    if (option) select(option);
  };
}

export function showTripPlan(map: Map, preview?: Trip) {
  if (!map.isStyleLoaded()) return;
  if (!map.getSource('trip-plan')) {
    map.addSource('trip-plan', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'trip-plan-points', type: 'symbol', source: 'trip-plan', layout: { 'icon-image': ['match', ['get', 'kind'], 'Launch', 'll-boat_ramp', 'll-spot'], 'icon-size': 1.1, 'icon-allow-overlap': true } });
    map.addLayer({ id: 'trip-plan-labels', type: 'symbol', source: 'trip-plan', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' }, paint: { 'text-color': '#173f36', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
  }
  const trip = preview ?? activeTrip();
  const features = trip && (preview || trip.destination === store.get<string>('destination')?.v) ? [...(trip.ramp ? [{ ...trip.ramp, kind: 'Launch' }] : []), ...trip.spots.map((s) => ({ ...s, kind: 'Fishing spot' }))] : [];
  (map.getSource('trip-plan') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection', features: features.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p.coords }, properties: { name: p.name, kind: p.kind } })) });
}

export function renderTrips(root: HTMLElement, map: Map, openDestination: (id: string) => void) {
  function list() {
    root.oninput = null; root.onchange = null;
    showTripPlan(map);
    root.innerHTML = `<h3>My trips</h3><button class="btn primary" data-new ${draft() ? 'disabled' : ''}>+ Plan a trip</button>
      ${draft() ? '<button class="btn" data-resume>Resume autosaved draft</button>' : ''}
      <div class="row-btns"><button class="btn" data-export>Export trip backup</button><label class="btn">Import trip backup<input type="file" data-import accept=".json,application/json" hidden></label></div>
      <p class="muted small" data-import-status role="status"></p>
      ${draft() ? '<p class="muted small">Resume and save your draft before starting another trip. Backups include saved trips.</p>' : ''}
      <p class="muted small">Saved on this browser, available offline. Map packs must be downloaded separately. Clearing browser data removes trips.</p>
      <ul class="list">${saved().map((t) => { const destination = waters.find((w) => w.id === t.destination); return `<li><button class="destination-row" data-edit="${esc(t.id)}"><b>${esc(t.name)}</b><span>${esc(destination ? waterDisplayName(destination) : t.destination)}</span><span>${esc(t.ramp?.name ?? 'No launch selected')} · ${t.spots.length} fishing spots</span></button><div class="row-btns"><button class="btn" data-share-trip="${esc(t.id)}">Share trip</button></div></li>`; }).join('') || '<li class="muted">Your saved trips will appear here.</li>'}</ul>`;
    root.querySelector<HTMLButtonElement>('[data-new]')!.onclick = () => edit({ id: crypto.randomUUID(), name: '', destination: store.get<string>('destination')?.v ?? '', spots: [], notes: '', updated: Date.now(), view: { center: map.getCenter().toArray() as [number, number], zoom: map.getZoom() } });
    const resume = root.querySelector<HTMLButtonElement>('[data-resume]');
    if (resume) resume.onclick = () => edit(structuredClone(draft()!));
    root.querySelector<HTMLButtonElement>('[data-export]')!.onclick = () => {
      const blob = new Blob([JSON.stringify({ schema: 1, app: 'Longleaf Atlas', exported: new Date().toISOString(), trips: saved() }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'longleaf-atlas-trips.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    root.querySelector<HTMLInputElement>('[data-import]')!.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
      const status = root.querySelector<HTMLElement>('[data-import-status]')!;
      try {
        if (file.size > 5 * 1024 * 1024) throw Error('Trip backups must be smaller than 5 MB.');
        const incoming = validateTripBackup(JSON.parse(await file.text()));
        const trips = saved(); const ids = new Set(trips.map((t) => t.id));
        let added = 0;
        for (const t of incoming) { if (ids.has(t.id)) continue; trips.push(t); ids.add(t.id); added++; }
        if (!store.set('trips', trips)) throw Error('Trips could not be stored on this device.');
        list(); root.querySelector('[data-import-status]')!.textContent = `${added} trips imported. Existing trips were kept.`;
      } catch (error) { status.textContent = (error as Error).message; }
    };
    root.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) => b.onclick = () => { const trip = saved().find((t) => t.id === b.dataset.edit); if (trip) edit(structuredClone(trip)); });
    root.querySelectorAll<HTMLButtonElement>('[data-share-trip]').forEach((b) => b.onclick = () => { const trip = saved().find((t) => t.id === b.dataset.shareTrip); if (trip) { try { shareTrip(trip); } catch (error) { toast((error as Error).message); } } });
  }
  function edit(trip: Trip) {
    const water = waters.find((w) => w.id === trip.destination);
    const coastal = /coastal|reef/i.test(water?.type ?? '');
    const candidates = new globalThis.Map<string, Place>();
    const namedRampIds = new Set<string>();
    const savedRampIds = new Set<string>();
    const currentTripRampIds = new Set<string>();
    const rampDetails = new globalThis.Map<string, { location: string; source: string }>();
    const cached = accessFeatures();
    const rendered = map.getLayer('access-pts') ? map.queryRenderedFeatures(undefined, { layers: ['access-pts'] }) : [];
    for (const f of [...cached, ...rendered]) {
      if (f.geometry?.type !== 'Point' || !['boat_ramp', 'paddle_launch'].includes(f.properties?.kind)) continue;
      const coords = f.geometry.coordinates.slice(0, 2) as [number, number];
      if (!water?.center || (f.properties.waterbody_id !== water.id && haversineKm(coords, water.center) > (coastal ? 120 : 40)) || /closed|decommissioned/i.test(String(f.properties.status ?? ''))) continue;
      const id = String(f.properties.osm ?? f.properties.record_id ?? coords.join(','));
      const name = String(f.properties.name ?? '').trim();
      const hasName = !!name && !/^(boat ramp|launch|paddle launch)$/i.test(name);
      if (hasName) namedRampIds.add(id);
      candidates.set(id, { id, name: hasName ? name : f.properties.kind === 'paddle_launch' ? 'Paddle launch' : 'Boat ramp', coords });
      rampDetails.set(id, { location: accessLocation(f.properties, coords), source: String(f.properties.data_source ?? (f.properties.osm ? 'OpenStreetMap contributors' : 'Mapped access catalog')) });
    }
    for (const w of getWpts().filter((w) => w.type === 'ramp')) {
      const coords: [number, number] = [w.lng, w.lat];
      candidates.set(w.id, { id: w.id, name: w.name || 'Saved launch', coords });
      savedRampIds.add(w.id);
      rampDetails.set(w.id, { location: accessLocation({}, coords), source: 'Saved on this device' });
    }
    if (trip.ramp && !candidates.has(trip.ramp.id)) {
      const ramp = trip.ramp;
      candidates.set(ramp.id, { ...ramp, name: !ramp.name.trim() || /^(Launch ·|boat ramp$|launch$)/i.test(ramp.name) ? 'Boat ramp' : ramp.name });
      currentTripRampIds.add(ramp.id);
      rampDetails.set(ramp.id, { location: accessLocation({}, ramp.coords), source: 'Saved in this trip' });
    }
    const ramps = [...candidates.values()].sort((a, b) => {
      const group = (ramp: Place) => namedRampIds.has(ramp.id) ? 0 : savedRampIds.has(ramp.id) ? 1 : currentTripRampIds.has(ramp.id) ? 2 : 3;
      return group(a) - group(b) || (water?.center ? haversineKm(a.coords, water.center) - haversineKm(b.coords, water.center) : a.name.localeCompare(b.name));
    });

    const selectedRegion = REGIONS.find((region) => region.id === store.get<string>('destination-area')?.v) ?? ALL_REGION;
    const regionWaters = selectedRegion.id === ALL_REGION.id ? [...waters] : watersInRegion(waters, selectedRegion);
    const regionWaterIds = new Set(regionWaters.map((choice) => choice.id));
    const currentWaterOutsideRegion = waters.find((choice) => choice.id === trip.destination && !regionWaterIds.has(choice.id));
    const destinationOptions = [...regionWaters, ...(currentWaterOutsideRegion ? [currentWaterOutsideRegion] : [])]
      .sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
    const destinationLabels = new globalThis.Map<string, string>();
    const usedDestinationLabels = new Set<string>();
    const waterBaseLabels = (choice: (typeof destinationOptions)[number]) => waterDisplayName(choice);
    const watersByLabel = new globalThis.Map<string, (typeof destinationOptions)[number][]>();
    for (const choice of destinationOptions) {
      const base = waterBaseLabels(choice);
      const peers = watersByLabel.get(base) ?? [];
      peers.push(choice); watersByLabel.set(base, peers);
    }
    const waterLabelMeta = new globalThis.Map<string, { peers: (typeof destinationOptions)[number][]; mean: [number, number]; riverCounts: globalThis.Map<string, number> }>();
    for (const [base, peers] of watersByLabel) {
      if (peers.length < 2) continue;
      const located = peers.flatMap((peer) => peer.center ? [peer.center] : []);
      const mean: [number, number] = [
        located.reduce((sum, point) => sum + point[0], 0) / Math.max(1, located.length),
        located.reduce((sum, point) => sum + point[1], 0) / Math.max(1, located.length),
      ];
      const riverCounts = new globalThis.Map<string, number>();
      for (const peer of peers) if (peer.river) riverCounts.set(peer.river, (riverCounts.get(peer.river) ?? 0) + 1);
      waterLabelMeta.set(base, { peers, mean, riverCounts });
    }
    for (const choice of destinationOptions) {
      const base = waterBaseLabels(choice);
      const group = waterLabelMeta.get(base);
      const peers = group?.peers ?? [];
      let detail = '';
      if (group && choice.river && group.riverCounts.get(choice.river) === 1) detail = choice.river;
      if (!detail && peers.length > 1 && choice.center) {
        const northSouth = Math.abs(choice.center[1] - group!.mean[1]) >= Math.abs(choice.center[0] - group!.mean[0]);
        detail = northSouth ? `${choice.center[1] >= group!.mean[1] ? 'Northern' : 'Southern'} section` : `${choice.center[0] >= group!.mean[0] ? 'Eastern' : 'Western'} section`;
      }
      if (!detail && peers.length > 1) detail = `Mapped area ${peers.indexOf(choice) + 1}`;
      let label = `${base}${detail ? ` · ${detail}` : ''}`;
      if (usedDestinationLabels.has(label)) label += ` · Mapped area ${peers.indexOf(choice) + 1}`;
      usedDestinationLabels.add(label);
      destinationLabels.set(choice.id, label);
    }
    const rampChoices = new globalThis.Map<string, Place>();
    const rampLabels = new globalThis.Map<string, string>();
    const rampLabelCounts = new globalThis.Map<string, number>();
    for (const ramp of ramps) {
      const label = ramp.name;
      rampLabelCounts.set(label, (rampLabelCounts.get(label) ?? 0) + 1);
      rampLabels.set(ramp.id, label);
    }
    const usedRampLabels = new Set<string>();
    for (const ramp of ramps) {
      let label = rampLabels.get(ramp.id)!;
      if ((rampLabelCounts.get(label) ?? 0) > 1) label += ` · ${rampDetails.get(ramp.id)?.location ?? accessLocation({}, ramp.coords)}`;
      if (usedRampLabels.has(label)) label += ` · ${ramp.coords[1].toFixed(4)}° N, ${Math.abs(ramp.coords[0]).toFixed(4)}° W`;
      usedRampLabels.add(label);
      rampLabels.set(ramp.id, label);
      rampChoices.set(ramp.id, ramp);
    }
    const stateNames = new globalThis.Map<string, string>(STATES.map((state) => [state.code, state.name]));
    const stateGroup = (choice: (typeof destinationOptions)[number]) => choice.state.split(/[\/,]/).map((code) => stateNames.get(code.trim().toUpperCase()) ?? code.trim()).filter(Boolean).join(' / ') || 'Other waters';
    const destinationPickerOptions: TripPickerOption[] = destinationOptions.map((choice) => {
      const group = choice.id === trip.destination && currentWaterOutsideRegion ? 'Current trip destination' : stateGroup(choice);
      const counties = String(choice.county ?? '').split(/[\/,]/).map((county) => county.trim()).filter(Boolean);
      const status = waterRecordStatus(choice);
      const detail = [...counties.map((county) => /county$/i.test(county) ? county : `${county} County`), choice.river ? `${choice.river} basin` : '', status.label].filter(Boolean).join(' · ');
      return { value: choice.id, label: destinationLabels.get(choice.id) ?? waterDisplayName(choice), group, detail, search: [choice.name, choice.state, choice.county, choice.river, waterDisplayLabel(choice), status.label, status.detail, group].filter(Boolean).join(' ') };
    });
    const rampGroup = (ramp: Place) => namedRampIds.has(ramp.id) ? 'Named mapped launches' : savedRampIds.has(ramp.id) ? 'Your saved launches' : currentTripRampIds.has(ramp.id) ? 'Current trip launch' : 'Nearby unnamed launches';
    const rampPickerOptions: TripPickerOption[] = [
      { value: '', label: 'Choose a launch later', group: 'Optional', detail: 'You can add a launch later or use one of your saved launches.', search: 'choose later optional' },
      ...ramps.map((ramp) => {
        const meta = rampDetails.get(ramp.id) ?? { location: accessLocation({}, ramp.coords), source: 'Mapped access catalog' };
        const miles = water?.center ? (haversineKm(ramp.coords, water.center) / 1.609344).toFixed(1) : '';
        const distance = miles ? `${miles} mi from mapped water center · straight-line` : '';
        const detail = [meta.location, distance, meta.source, 'Confirm access before traveling'].filter(Boolean).join(' · ');
        return { value: ramp.id, label: rampLabels.get(ramp.id) ?? ramp.name, group: rampGroup(ramp), detail, search: [ramp.name, meta.location, meta.source, detail].filter(Boolean).join(' ') };
      }),
    ];
    const destinationScopeNote = selectedRegion.id === ALL_REGION.id
      ? `Search ${destinationOptions.length.toLocaleString()} cataloged waters across available regions.`
      : `Showing waters in ${selectedRegion.label}. Change the region on the Destination tab to browse another area.${currentWaterOutsideRegion ? ' Your current trip destination is also kept available.' : ''}`;
    const destinationPlaceholder = trip.destination && !destinationLabels.has(trip.destination)
      ? 'Choose a current destination (previous destination unavailable)'
      : 'Search lakes, rivers, or states';
    const spots = new globalThis.Map<string, Place>();
    for (const w of getWpts().filter((w) => w.type === 'fish')) spots.set(w.id, { id: w.id, name: w.name, coords: [w.lng, w.lat] });
    for (const spot of trip.spots) spots.set(spot.id, spot);
    root.innerHTML = `<button class="link" data-back>← My trips</button><h3>Plan your trip</h3>
      <label class="field">Trip name<input id="trip-name" maxlength="120" value="${esc(trip.name)}" placeholder="Saturday on the lake"></label>
      <label class="field">Trip date<input id="trip-date" type="date" value="${esc(trip.date ?? '')}"></label>
      ${tripPickerHtml('trip-destination', 'Destination', 'Search by water, county, river, or state', destinationPlaceholder, destinationPickerOptions, trip.destination)}
      <p class="muted small trip-picker-note">${esc(destinationScopeNote)}</p>
      ${tripPickerHtml('trip-ramp', 'Boat ramp / launch', 'Search launch, water, location, or source', 'Choose a launch later', rampPickerOptions, trip.ramp?.id ?? '', symbolHtml('boat_ramp'))}
      <p class="muted small">Launches are nearby mapped access locations and your saved launches. Distances are straight-line from the mapped water center, not boating routes. Confirm current status, access, and suitability before traveling.</p>
      <button class="btn" data-refresh-launches>Refresh nearby launches</button>
      <h4>${symbolHtml('spot')}Fishing spots</h4>${[...spots.values()].map((s) => `<div class="trip-spot"><label class="row"><input type="checkbox" data-trip-spot="${esc(s.id)}" ${trip.spots.some((p) => p.id === s.id) ? 'checked' : ''}>Include this spot</label><label class="field">Spot name<input data-spot-name="${esc(s.id)}" maxlength="120" value="${esc(s.name)}"></label><span class="muted small">${s.coords[1].toFixed(5)}, ${s.coords[0].toFixed(5)}</span> <button class="link" data-remove-spot="${esc(s.id)}">Remove from trip</button></div>`).join('') || '<p class="muted small">Choose saved fishing waypoints from My Spots, or drop a pin anywhere on the map.</p>'}
      <label class="field">New fishing spot name<input id="trip-spot-name" maxlength="120" placeholder="Point, cove or brush pile"></label><button class="btn" data-add-spot>Drop a fishing pin</button><button class="btn" data-cancel-pin hidden>Cancel pin</button>
      <label class="field">Trip notes<textarea id="trip-notes" rows="5" maxlength="10000" placeholder="Meet-up time, tackle, plan for the day…">${esc(trip.notes)}</textarea></label>
      <p class="muted small" data-trip-status aria-live="polite">${draft()?.id === trip.id ? 'Autosaved draft recovered. Save trip when your plan is ready.' : saved().some((t) => t.id === trip.id) ? 'Previously saved. Edits will autosave as a draft.' : 'Your draft will autosave as you edit.'}</p>
      <div class="row-btns"><button class="btn primary" data-save-trip>Save trip</button><button class="btn" data-open-trip>Open trip on map</button><button class="btn" data-share-trip-draft>Share trip</button></div>`;
    const input = <T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id: string) => root.querySelector<T>(id)!;
    const collect = () => {
      trip.name = input('#trip-name').value.trim();
      const destinationId = input<HTMLInputElement>('#trip-destination').value;
      if (destinationOptions.some((choice) => choice.id === destinationId)) trip.destination = destinationId;
      trip.date = input('#trip-date').value;
      const rampInput = input<HTMLInputElement>('#trip-ramp');
      if (!rampInput.value) trip.ramp = undefined;
      else if (rampChoices.has(rampInput.value)) trip.ramp = rampChoices.get(rampInput.value);
      trip.notes = input('#trip-notes').value;
      root.querySelectorAll<HTMLInputElement>('[data-spot-name]').forEach((field) => { const spot = spots.get(field.dataset.spotName!); if (spot) spot.name = field.value.trim() || 'Fishing spot'; });
      trip.spots = [...root.querySelectorAll<HTMLInputElement>('[data-trip-spot]:checked')].flatMap((b) => spots.get(b.dataset.tripSpot!) ?? []);
    };
    const autosave = () => { collect(); if (store.set('trip-draft', trip)) root.querySelector('[data-trip-status]')!.textContent = 'Draft autosaved on this device.'; };
    root.oninput = autosave;
    root.onchange = autosave;
    const onRampChange = () => {
      const field = input<HTMLInputElement>('#trip-ramp');
      if (field.value && !rampChoices.has(field.value)) {
        field.setCustomValidity('Choose a launch from the suggestions, or clear the field.');
        field.reportValidity();
        return;
      }
      field.setCustomValidity('');
      autosave(); showTripPlan(map, trip);
      if (!trip.ramp) return;
      highlightLocation(map, trip.ramp.coords);
      if (isCompactLayout()) setSheetSnap('peek');
      map.flyTo({ center: trip.ramp.coords, zoom: Math.max(map.getZoom(), 14), padding: { left: !isCompactLayout() ? 410 : 20, right: 55, top: 60, bottom: !isCompactLayout() ? 40 : 160 } });
      toast(`Selected ${trip.ramp.name}`);
    };
    input<HTMLInputElement>('#trip-ramp').onchange = onRampChange;
    const onDestinationChange = () => {
      const field = input<HTMLInputElement>('#trip-destination');
      if (!destinationOptions.some((choice) => choice.id === field.value)) return;
      collect(); trip.ramp = undefined; store.set('trip-draft', trip);
      const center = waters.find((w) => w.id === trip.destination)?.center;
      if (center) map.flyTo({ center, zoom: 11, padding: { left: !isCompactLayout() ? 410 : 40, right: 55, top: 50, bottom: !isCompactLayout() ? 45 : 150 } });
      edit(trip);
    };
    input<HTMLInputElement>('#trip-destination').onchange = onDestinationChange;
    wireTripPicker(root, 'trip-destination', destinationPickerOptions, onDestinationChange);
    wireTripPicker(root, 'trip-ramp', rampPickerOptions, onRampChange);
    root.onpointerdown = (event) => {
      if ((event.target as HTMLElement).closest('[data-trip-picker]')) return;
      root.querySelectorAll<HTMLElement>('[data-trip-picker] .destination-menu').forEach((menu) => { menu.hidden = true; });
      root.querySelectorAll<HTMLButtonElement>('[data-trip-picker] [role="combobox"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    };
    const openTripPicker = (id: string) => root.querySelector<HTMLButtonElement>(`#${id}-picker`)?.click();
    root.querySelectorAll<HTMLButtonElement>('[data-remove-spot]').forEach((button) => button.onclick = () => { collect(); trip.spots = trip.spots.filter((p) => p.id !== button.dataset.removeSpot); store.set('trip-draft', trip); edit(trip); showTripPlan(map, trip); });
    const save = () => {
      const destinationInput = input<HTMLInputElement>('#trip-destination');
      if (!destinationOptions.some((choice) => choice.id === destinationInput.value)) {
        openTripPicker('trip-destination'); toast('Choose a destination from the available waters.');
        return false;
      }
      const rampInput = input<HTMLInputElement>('#trip-ramp');
      if (rampInput.value && !rampChoices.has(rampInput.value)) {
        openTripPicker('trip-ramp'); toast('Choose a launch from the list, or leave it for later.');
        return false;
      }
      collect();
      if (!waters.some((w) => w.id === trip.destination)) { input('#trip-destination').focus(); toast('Choose a specific lake for this trip.'); return false; }
      if (!trip.name) { input('#trip-name').focus(); toast('Give your trip a name.'); return false; }
      trip.updated = Date.now(); trip.view = { center: map.getCenter().toArray() as [number, number], zoom: map.getZoom() };
      const trips = saved(); const index = trips.findIndex((t) => t.id === trip.id);
      if (index < 0) trips.unshift(trip); else trips[index] = trip;
      if (!store.set('trips', trips)) return false;
      if (draft()?.id === trip.id) store.del('trip-draft');
      if (activeTrip()?.id === trip.id) { store.set('active-trip', trip); showTripPlan(map); }
      root.querySelector('[data-trip-status]')!.textContent = 'Trip saved on this device.';
      return true;
    };
    root.querySelector<HTMLButtonElement>('[data-back]')!.onclick = list;
    root.querySelector<HTMLButtonElement>('[data-refresh-launches]')!.onclick = async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true; button.textContent = 'Loading launches…';
      try { await loadAccessLive(map); if (button.isConnected) { collect(); edit(trip); } }
      catch { if (button.isConnected) { button.disabled = false; button.textContent = 'Refresh nearby launches'; } toast('Launches unavailable. Reconnect or use a saved launch waypoint.'); }
    };
    root.querySelector<HTMLButtonElement>('[data-add-spot]')!.onclick = () => {
      const name = input('#trip-spot-name').value.trim();
      if (!name) { input('#trip-spot-name').focus(); toast('Name this fishing spot first.'); return; }
      collect(); cancelTripPick();
      const sheet = document.getElementById('sheet')!;
      const previousSnap = (sheet.dataset.snap || 'peek') as SheetSnap;
      if (isCompactLayout()) setSheetSnap('peek');
      const cancel = root.querySelector<HTMLButtonElement>('[data-cancel-pin]')!;
      cancel.hidden = false;
      const status = root.querySelector('[data-trip-status]')!;
      status.textContent = 'Tap the map to place your fishing pin. Pan or zoom first if needed. Press Escape to cancel.';
      map.getCanvas().style.cursor = 'crosshair';
      const banner = document.createElement('div');
      banner.className = 'trip-pin-banner';
      banner.innerHTML = '<span>Tap the map to place your fishing pin</span><button class="btn">Cancel</button>';
      document.body.append(banner);
      banner.querySelector('button')!.onclick = cancelTripPick;
      const cleanup = () => {
        map.off('click', place); window.removeEventListener('keydown', escape);
        cancelPick = undefined; cancel.hidden = true; map.getCanvas().style.cursor = '';
        banner.remove();
        if (isCompactLayout() && previousSnap !== 'peek') setSheetSnap(previousSnap);
      };
      const place = (event: MapMouseEvent) => {
        const coords: [number, number] = [event.lngLat.lng, event.lngLat.lat];
        cleanup(); trip.spots.push({ id: crypto.randomUUID(), name, coords }); store.set('trip-draft', trip); edit(trip); showTripPlan(map, trip);
        toast('Fishing pin added. Save your trip to keep it.');
      };
      const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelTripPick(); };
      cancelPick = () => { cleanup(); status.textContent = 'Pin canceled. Your trip draft is unchanged.'; };
      cancel.onclick = cancelTripPick;
      map.on('click', place); window.addEventListener('keydown', escape);
      toast('Tap the map where you want your fishing pin. Escape cancels.', 10000);
    };
    root.querySelector<HTMLButtonElement>('[data-save-trip]')!.onclick = () => { if (save()) toast('Trip saved.'); };
    root.querySelector<HTMLButtonElement>('[data-share-trip-draft]')!.onclick = () => {
      collect();
      if (!waters.some((w) => w.id === trip.destination)) { input('#trip-destination').focus(); toast('Choose a destination before sharing.'); return; }
      if (!trip.name) { input('#trip-name').focus(); toast('Name your trip before sharing.'); return; }
      trip.updated = Date.now();
      trip.view = { center: map.getCenter().toArray() as [number, number], zoom: map.getZoom() };
      store.set('trip-draft', trip);
      try { shareTrip(trip); } catch (error) { toast((error as Error).message); }
    };
    root.querySelector<HTMLButtonElement>('[data-open-trip]')!.onclick = () => {
      // Opening a saved trip restores its saved view; edits are saved explicitly.
      if (!save()) return;
      if (!store.set('active-trip', trip)) return;
      openDestination(trip.destination);
      const points = [...(trip.ramp ? [trip.ramp.coords] : []), ...trip.spots.map((s) => s.coords)];
      const center = waters.find((w) => w.id === trip.destination)?.center;
      if (center) points.push(center);
      showTripPlan(map);
      if (points.length) map.fitBounds([[Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))], [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))]], { padding: { left: !isCompactLayout() ? 420 : 40, right: 55, top: 45, bottom: !isCompactLayout() ? 45 : 150 }, maxZoom: 13 });
      else map.flyTo(trip.view);
    };
  }
  list();
}
