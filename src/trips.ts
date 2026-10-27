import type { Map, MapMouseEvent } from 'maplibre-gl';
import { symbolHtml, highlightLocation } from './symbols';
import { waters } from './layers/waters';
import { getWpts } from './waypoints';
import { loadAccessLive, accessLocation } from './layers/access';
import { isCompactLayout, setSheetSnap, type SheetSnap } from './sheet';
import { esc, haversineKm, store, toast } from './util';
import { shareTrip } from './share';

export type Place = { id: string; name: string; coords: [number, number] };
export type Trip = { id: string; name: string; destination: string; date?: string; ramp?: Place; spots: Place[]; notes: string; updated: number; view: { center: [number, number]; zoom: number } };
const saved = () => store.get<Trip[]>('trips')?.v ?? [];
const draft = () => store.get<Trip>('trip-draft')?.v;
function draftForPlace(place: Place) {
  const destination = store.get<string>('destination')?.v ?? 'west-point';
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
      <ul class="list">${saved().map((t) => `<li><button class="destination-row" data-edit="${esc(t.id)}"><b>${esc(t.name)}</b><span>${esc(waters.find((w) => w.id === t.destination)?.name ?? t.destination)}</span><span>${esc(t.ramp?.name ?? 'No launch selected')} · ${t.spots.length} fishing spots</span></button><div class="row-btns"><button class="btn" data-share-trip="${esc(t.id)}">Share trip</button></div></li>`).join('') || '<li class="muted">Your saved trips will appear here.</li>'}</ul>`;
    root.querySelector<HTMLButtonElement>('[data-new]')!.onclick = () => edit({ id: crypto.randomUUID(), name: '', destination: store.get<string>('destination')?.v ?? 'west-point', spots: [], notes: '', updated: Date.now(), view: { center: map.getCenter().toArray() as [number, number], zoom: map.getZoom() } });
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
    const candidates = new globalThis.Map<string, Place>();
    const cached = store.get<any[]>('access-osm')?.v ?? [];
    const rendered = map.getLayer('access-pts') ? map.queryRenderedFeatures(undefined, { layers: ['access-pts'] }) : [];
    for (const f of [...cached, ...rendered]) {
      if (f.geometry?.type !== 'Point' || !['boat_ramp', 'paddle_launch'].includes(f.properties?.kind)) continue;
      const coords = f.geometry.coordinates.slice(0, 2) as [number, number];
      if (!water?.center || haversineKm(coords, water.center) > 40) continue;
      const id = String(f.properties.osm ?? coords.join(','));
      const name = String(f.properties.name ?? '').trim();
      candidates.set(id, { id, name: name && !/^(boat ramp|launch|paddle launch)$/i.test(name) ? name : `${f.properties.kind === 'paddle_launch' ? 'Paddle launch' : 'Boat ramp'} — ${accessLocation(f.properties, coords)}`, coords });
    }
    for (const w of getWpts().filter((w) => w.type === 'ramp')) candidates.set(w.id, { id: w.id, name: w.name, coords: [w.lng, w.lat] });
    if (trip.ramp && !candidates.has(trip.ramp.id)) {
      const ramp = trip.ramp;
      candidates.set(ramp.id, { ...ramp, name: !ramp.name.trim() || /^(Launch ·|boat ramp$|launch$)/i.test(ramp.name) ? `Boat ramp — ${accessLocation({}, ramp.coords)}` : ramp.name });
    }
    const ramps = [...candidates.values()].sort((a, b) => water?.center ? haversineKm(a.coords, water.center) - haversineKm(b.coords, water.center) : a.name.localeCompare(b.name));
    const spots = new globalThis.Map<string, Place>();
    for (const w of getWpts().filter((w) => w.type === 'fish')) spots.set(w.id, { id: w.id, name: w.name, coords: [w.lng, w.lat] });
    for (const spot of trip.spots) spots.set(spot.id, spot);
    root.innerHTML = `<button class="link" data-back>← My trips</button><h3>Plan your trip</h3>
      <label class="field">Trip name<input id="trip-name" maxlength="120" value="${esc(trip.name)}" placeholder="Saturday on the lake"></label>
      <label class="field">Trip date<input id="trip-date" type="date" value="${esc(trip.date ?? '')}"></label>
      <label class="field">Destination<select id="trip-destination">${waters.some((w) => w.id === trip.destination) ? '' : `<option value="${esc(trip.destination)}" selected>Choose a specific lake (previous group retired)</option>`}${waters.map((w) => `<option value="${esc(w.id)}" ${w.id === trip.destination ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
      <label class="field">${symbolHtml('boat_ramp')}Boat ramp / launch<select id="trip-ramp"><option value="">Choose a launch later</option>${ramps.map((r) => `<option value="${esc(r.id)}" ${trip.ramp?.id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
      <p class="muted small">Launches within 25 miles of the destination’s mapped center, plus your saved launches. Confirm access before traveling.</p>
      <button class="btn" data-refresh-launches>Refresh nearby launches</button>
      <h4>${symbolHtml('spot')}Fishing spots</h4>${[...spots.values()].map((s) => `<div class="trip-spot"><label class="row"><input type="checkbox" data-trip-spot="${esc(s.id)}" ${trip.spots.some((p) => p.id === s.id) ? 'checked' : ''}>Include this spot</label><label class="field">Spot name<input data-spot-name="${esc(s.id)}" maxlength="120" value="${esc(s.name)}"></label><span class="muted small">${s.coords[1].toFixed(5)}, ${s.coords[0].toFixed(5)}</span> <button class="link" data-remove-spot="${esc(s.id)}">Remove from trip</button></div>`).join('') || '<p class="muted small">Choose saved fishing waypoints from My Spots, or drop a pin anywhere on the map.</p>'}
      <label class="field">New fishing spot name<input id="trip-spot-name" maxlength="120" placeholder="Point, cove or brush pile"></label><button class="btn" data-add-spot>Drop a fishing pin</button><button class="btn" data-cancel-pin hidden>Cancel pin</button>
      <label class="field">Trip notes<textarea id="trip-notes" rows="5" maxlength="10000" placeholder="Meet-up time, tackle, plan for the day…">${esc(trip.notes)}</textarea></label>
      <p class="muted small" data-trip-status aria-live="polite">${draft()?.id === trip.id ? 'Autosaved draft recovered. Save trip when your plan is ready.' : saved().some((t) => t.id === trip.id) ? 'Previously saved. Edits will autosave as a draft.' : 'Your draft will autosave as you edit.'}</p>
      <div class="row-btns"><button class="btn primary" data-save-trip>Save trip</button><button class="btn" data-open-trip>Open trip on map</button><button class="btn" data-share-trip-draft>Share trip</button></div>`;
    const input = <T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id: string) => root.querySelector<T>(id)!;
    const collect = () => {
      trip.name = input('#trip-name').value.trim(); trip.destination = input('#trip-destination').value;
      trip.date = input('#trip-date').value;
      trip.ramp = candidates.get(input('#trip-ramp').value);
      trip.notes = input('#trip-notes').value;
      root.querySelectorAll<HTMLInputElement>('[data-spot-name]').forEach((field) => { const spot = spots.get(field.dataset.spotName!); if (spot) spot.name = field.value.trim() || 'Fishing spot'; });
      trip.spots = [...root.querySelectorAll<HTMLInputElement>('[data-trip-spot]:checked')].flatMap((b) => spots.get(b.dataset.tripSpot!) ?? []);
    };
    const autosave = () => { collect(); if (store.set('trip-draft', trip)) root.querySelector('[data-trip-status]')!.textContent = 'Draft autosaved on this device.'; };
    root.oninput = autosave;
    root.onchange = autosave;
    input<HTMLSelectElement>('#trip-ramp').onchange = () => {
      autosave(); showTripPlan(map, trip);
      if (!trip.ramp) return;
      highlightLocation(map, trip.ramp.coords);
      if (isCompactLayout()) setSheetSnap('peek');
      map.flyTo({ center: trip.ramp.coords, zoom: Math.max(map.getZoom(), 14), padding: { left: !isCompactLayout() ? 410 : 20, right: 55, top: 60, bottom: !isCompactLayout() ? 40 : 160 } });
      toast(`Selected ${trip.ramp.name}`);
    };
    root.querySelectorAll<HTMLButtonElement>('[data-remove-spot]').forEach((button) => button.onclick = () => { collect(); trip.spots = trip.spots.filter((p) => p.id !== button.dataset.removeSpot); store.set('trip-draft', trip); edit(trip); showTripPlan(map, trip); });
    const save = () => {
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
    input<HTMLSelectElement>('#trip-destination').onchange = () => {
      collect(); trip.ramp = undefined; store.set('trip-draft', trip);
      const center = waters.find((w) => w.id === trip.destination)?.center;
      if (center) map.flyTo({ center, zoom: 11, padding: { left: !isCompactLayout() ? 410 : 40, right: 55, top: 50, bottom: !isCompactLayout() ? 45 : 150 } });
      edit(trip);
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
