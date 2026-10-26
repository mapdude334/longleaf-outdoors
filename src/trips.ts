import type { Map, MapMouseEvent } from 'maplibre-gl';
import { waters } from './layers/waters';
import { getWpts } from './waypoints';
import { loadAccessLive } from './layers/access';
import { esc, haversineKm, store, toast } from './util';

type Place = { id: string; name: string; coords: [number, number] };
type Trip = { id: string; name: string; destination: string; ramp?: Place; spots: Place[]; notes: string; updated: number; view: { center: [number, number]; zoom: number } };
const saved = () => store.get<Trip[]>('trips')?.v ?? [];
let cancelPick: (() => void) | undefined;
export const pickingTripSpot = () => !!cancelPick;
export function cancelTripPick() { cancelPick?.(); }
export const activeTrip = () => store.get<Trip>('active-trip')?.v;
export function showTripPlan(map: Map, preview?: Trip) {
  if (!map.isStyleLoaded()) return;
  if (!map.getSource('trip-plan')) {
    map.addSource('trip-plan', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'trip-plan-points', type: 'circle', source: 'trip-plan', paint: { 'circle-radius': 8, 'circle-color': ['match', ['get', 'kind'], 'Launch', '#1565c0', '#d81b60'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
    map.addLayer({ id: 'trip-plan-labels', type: 'symbol', source: 'trip-plan', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' }, paint: { 'text-color': '#173f36', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
  }
  const trip = preview ?? activeTrip();
  const features = trip && (preview || trip.destination === store.get<string>('destination')?.v) ? [...(trip.ramp ? [{ ...trip.ramp, kind: 'Launch' }] : []), ...trip.spots.map((s) => ({ ...s, kind: 'Fishing spot' }))] : [];
  (map.getSource('trip-plan') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection', features: features.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p.coords }, properties: { name: p.name, kind: p.kind } })) });
}

export function renderTrips(root: HTMLElement, map: Map, openDestination: (id: string) => void) {
  function list() {
    showTripPlan(map);
    root.innerHTML = `<h3>My trips</h3><button class="btn primary" data-new>+ Plan a trip</button>
      <p class="muted small">Saved on this browser, available offline. Map packs must be downloaded separately. Clearing browser data removes trips.</p>
      <ul class="list">${saved().map((t) => `<li><button class="destination-row" data-edit="${esc(t.id)}"><b>${esc(t.name)}</b><span>${esc(waters.find((w) => w.id === t.destination)?.name ?? t.destination)}</span><span>${esc(t.ramp?.name ?? 'No launch selected')} · ${t.spots.length} fishing spots</span></button></li>`).join('') || '<li class="muted">Your saved trips will appear here.</li>'}</ul>`;
    root.querySelector<HTMLButtonElement>('[data-new]')!.onclick = () => edit({ id: crypto.randomUUID(), name: '', destination: store.get<string>('destination')?.v ?? 'west-point', spots: [], notes: '', updated: Date.now(), view: { center: map.getCenter().toArray() as [number, number], zoom: map.getZoom() } });
    root.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) => b.onclick = () => { const trip = saved().find((t) => t.id === b.dataset.edit); if (trip) edit(structuredClone(trip)); });
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
      candidates.set(id, { id, name: f.properties.name || `Launch · ${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`, coords });
    }
    for (const w of getWpts().filter((w) => w.type === 'ramp')) candidates.set(w.id, { id: w.id, name: w.name, coords: [w.lng, w.lat] });
    if (trip.ramp) candidates.set(trip.ramp.id, trip.ramp);
    const ramps = [...candidates.values()].sort((a, b) => water?.center ? haversineKm(a.coords, water.center) - haversineKm(b.coords, water.center) : a.name.localeCompare(b.name));
    const spots = new globalThis.Map<string, Place>();
    for (const w of getWpts().filter((w) => w.type === 'fish')) spots.set(w.id, { id: w.id, name: w.name, coords: [w.lng, w.lat] });
    for (const spot of trip.spots) spots.set(spot.id, spot);
    root.innerHTML = `<button class="link" data-back>← My trips</button><h3>Plan your trip</h3>
      <label class="field">Trip name<input id="trip-name" maxlength="120" value="${esc(trip.name)}" placeholder="Saturday on the lake"></label>
      <label class="field">Destination<select id="trip-destination">${waters.some((w) => w.id === trip.destination) ? '' : `<option value="${esc(trip.destination)}" selected>Choose a specific lake (previous group retired)</option>`}${waters.map((w) => `<option value="${esc(w.id)}" ${w.id === trip.destination ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
      <label class="field">Boat ramp / launch<select id="trip-ramp"><option value="">Choose a launch later</option>${ramps.map((r) => `<option value="${esc(r.id)}" ${trip.ramp?.id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
      <p class="muted small">Launches within 25 miles of the destination’s mapped center, plus your saved launches. Confirm access before traveling.</p>
      <button class="btn" data-refresh-launches>Refresh nearby launches</button>
      <h4>Fishing spots</h4>${[...spots.values()].map((s) => `<label class="row"><input type="checkbox" data-trip-spot="${esc(s.id)}" ${trip.spots.some((p) => p.id === s.id) ? 'checked' : ''}><span>${esc(s.name)}<br><span class="muted small">${s.coords[1].toFixed(5)}, ${s.coords[0].toFixed(5)}</span></span></label>`).join('') || '<p class="muted small">Choose saved fishing waypoints from My Spots, or drop a pin anywhere on the map.</p>'}
      <label class="field">New fishing spot name<input id="trip-spot-name" maxlength="120" placeholder="Point, cove or brush pile"></label><button class="btn" data-add-spot>Drop a fishing pin</button><button class="btn" data-cancel-pin hidden>Cancel pin</button>
      <label class="field">Trip notes<textarea id="trip-notes" rows="5" maxlength="10000" placeholder="Meet-up time, tackle, plan for the day…">${esc(trip.notes)}</textarea></label>
      <p class="muted small" data-trip-status aria-live="polite">${saved().some((t) => t.id === trip.id) ? 'Previously saved. Save again to keep edits.' : 'Draft — save to keep this trip.'}</p>
      <div class="row-btns"><button class="btn primary" data-save-trip>Save trip</button><button class="btn" data-open-trip>Open trip on map</button></div>`;
    const input = <T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id: string) => root.querySelector<T>(id)!;
    const collect = () => {
      trip.name = input('#trip-name').value.trim(); trip.destination = input('#trip-destination').value;
      trip.ramp = candidates.get(input('#trip-ramp').value);
      trip.notes = input('#trip-notes').value;
      trip.spots = [...root.querySelectorAll<HTMLInputElement>('[data-trip-spot]:checked')].flatMap((b) => spots.get(b.dataset.tripSpot!) ?? []);
    };
    const save = () => {
      collect();
      if (!waters.some((w) => w.id === trip.destination)) { input('#trip-destination').focus(); toast('Choose a specific lake for this trip.'); return false; }
      if (!trip.name) { input('#trip-name').focus(); toast('Give your trip a name.'); return false; }
      trip.updated = Date.now(); trip.view = { center: map.getCenter().toArray() as [number, number], zoom: map.getZoom() };
      const trips = saved(); const index = trips.findIndex((t) => t.id === trip.id);
      if (index < 0) trips.unshift(trip); else trips[index] = trip;
      if (!store.set('trips', trips)) return false;
      if (activeTrip()?.id === trip.id) { store.set('active-trip', trip); showTripPlan(map); }
      root.querySelector('[data-trip-status]')!.textContent = 'Trip saved on this device.';
      return true;
    };
    input<HTMLSelectElement>('#trip-destination').onchange = () => { collect(); trip.ramp = undefined; edit(trip); };
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
      const wasOpen = sheet.classList.contains('open');
      if (innerWidth <= 800) sheet.classList.remove('open');
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
        if (wasOpen) sheet.classList.add('open');
      };
      const place = (event: MapMouseEvent) => {
        const coords: [number, number] = [event.lngLat.lng, event.lngLat.lat];
        cleanup(); trip.spots.push({ id: crypto.randomUUID(), name, coords }); edit(trip); showTripPlan(map, trip);
        toast('Fishing pin added. Save your trip to keep it.');
      };
      const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelTripPick(); };
      cancelPick = () => { cleanup(); status.textContent = 'Pin canceled. Your trip draft is unchanged.'; };
      cancel.onclick = cancelTripPick;
      map.on('click', place); window.addEventListener('keydown', escape);
      toast('Tap the map where you want your fishing pin. Escape cancels.', 10000);
    };
    root.querySelector<HTMLButtonElement>('[data-save-trip]')!.onclick = () => { if (save()) toast('Trip saved.'); };
    root.querySelector<HTMLButtonElement>('[data-open-trip]')!.onclick = () => {
      // Opening a saved trip restores its saved view; edits are saved explicitly.
      if (!save()) return;
      if (!store.set('active-trip', trip)) return;
      openDestination(trip.destination);
      const points = [...(trip.ramp ? [trip.ramp.coords] : []), ...trip.spots.map((s) => s.coords)];
      const center = waters.find((w) => w.id === trip.destination)?.center;
      if (center) points.push(center);
      showTripPlan(map);
      if (points.length) map.fitBounds([[Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))], [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))]], { padding: { left: innerWidth > 800 ? 420 : 40, right: 55, top: 45, bottom: innerWidth > 800 ? 45 : 150 }, maxZoom: 13 });
      else map.flyTo(trip.view);
    };
  }
  list();
}
