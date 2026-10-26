import { renderDestination, selectDestination } from './destination';
import { initWelcome } from './welcome';
import { addShareControl } from './share';
import { renderTrips, showTripPlan, pickingTripSpot, cancelTripPick, useLaunchInTrip, useSpotInTrip } from './trips';
import { speciesForLabel, speciesHtml, speciesChoiceHtml } from './species';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { AttributionControl, GeolocateControl, Map, NavigationControl, ScaleControl, setWorkerUrl, type MapGeoJSONFeature } from 'maplibre-gl';
import { registerSW } from 'virtual:pwa-register';
import { AOI, START_VIEW } from './config';
import { resolvePm } from './pmtiles';
import { buildStyle, groups, ACCESS_COLORS, type Availability, type BasemapId } from './style';
import { loadGauges, gauges, gaugeHtml, fillTrend } from './layers/gauges';
import { loadDams, dams, damHtml, fillCwms } from './layers/dams';
import { loadWaters, waters, waterById, waterByName, waterHtml, regulations } from './layers/waters';
import { loadAccessLive, accessHtml, ACCESS_LABELS } from './layers/access';
import { identifyParcels, identifyPublicLands, publicLandHtml, MANAGER_TYPES } from './layers/identify';
import { weatherHtml } from './weather';
import { addWpt, deleteTrack, deleteWpt, downloadGpx, getTracks, getWpts, importGpx, initWaypoints, isRecording, toggleRecording, trackKm, updateWpt, WPT_TYPES } from './waypoints';
import { renderOffline } from './offline';
import { $, ago, esc, fmtCoord, store, toast } from './util';

setWorkerUrl(workerUrl);
initWelcome();
registerSW({ immediate: true, onOfflineReady: () => toast('App installed offline. Download map packs before your trip.') });

// ---------------- state ----------------
type UiState = { basemap: BasemapId; on: Record<string, boolean>; terrain3d: boolean; coordFmt: 'dd' | 'dm' };
const DEFAULT_ON: Record<string, boolean> = {
  hillshade: true, public_lands: true, parcels: false, water: true, contours: false, radar: false,
  access: true, dams: true, dams_osm: true, gauges: true, waters: true, mine: true,
};
const ui: UiState = { basemap: 'topo', terrain3d: false, coordFmt: 'dd', ...store.get<UiState>('ui')?.v, on: { ...DEFAULT_ON, ...store.get<UiState>('ui')?.v?.on } };
const saveUi = () => store.set('ui', ui);
let av: Availability = { basemap: null, overlays: null, parcels: null };

const map = new Map({
  container: 'map',
  style: buildStyle(av),
  center: START_VIEW.center,
  zoom: START_VIEW.zoom,
  maxBounds: [[AOI[0] - 1.5, AOI[1] - 1.5], [AOI[2] + 1.5, AOI[3] + 1.5]],
  attributionControl: false,
  hash: 'map',
});
(window as unknown as { vwMap: unknown }).vwMap = map; // handy for debugging in devtools
map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl({
  onAdd() {
    const control = document.createElement('div');
    control.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Home · show all locations';
    button.setAttribute('aria-label', 'Home · show all locations');
    button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="display:block;margin:auto"><path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    button.onclick = () => {
      const points = [...waters.flatMap((w) => w.center ? [w.center] : []), ...dams.map((d) => d.coords), ...gauges.map((g) => g.coords)];
      const extent: [[number, number], [number, number]] = points.length
        ? [[Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))], [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))]]
        : [[AOI[0], AOI[1]], [AOI[2], AOI[3]]];
      const panel = document.getElementById('sheet')!;
      const open = panel.classList.contains('open');
      // Collapse the phone sheet so the full location extent has room to breathe.
      if (innerWidth <= 800) panel.classList.remove('open');
      const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) || 116;
      map.fitBounds(extent, { padding: { top: 45, right: 55, bottom: innerWidth <= 800 ? peek + 24 : 45, left: innerWidth > 800 && open ? panel.offsetWidth + 35 : 45 }, maxZoom: 11, bearing: 0, pitch: 0, duration: 700 });
    };
    control.append(button);
    return control;
  },
  onRemove() {},
}, 'top-right');
const geolocate = new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true });
map.addControl(geolocate, 'top-right');
map.addControl({
  onAdd() {
    const control = document.createElement('div');
    control.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const tools = [
      ['Map layers', '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>', false],
      ['Map legend', '<path d="M10 5h11M10 12h11M10 19h11"/><circle cx="4" cy="5" r="2"/><path d="M2 10h4v4H2zM2 19h4"/>', true],
    ] as const;
    for (const [label, icon, legend] of tools) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-controls', 'tab-layers');
      button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="display:block;margin:auto;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round">${icon}</svg>`;
      button.onclick = () => {
        showTab('layers');
        const panel = $('#tab-layers');
        if (legend) {
          const key = panel.querySelector<HTMLDetailsElement>('.legend')!;
          key.open = true;
          key.scrollIntoView({ block: 'start', behavior: 'smooth' });
          key.querySelector('summary')!.focus({ preventScroll: true });
        } else {
          panel.scrollTop = 0;
          panel.querySelector<HTMLButtonElement>('[data-base]:not(:disabled)')?.focus({ preventScroll: true });
        }
      };
      control.append(button);
    }
    return control;
  },
  onRemove() {},
}, 'top-right');
addShareControl(map);
map.addControl(new ScaleControl({ unit: 'imperial' }), 'bottom-right');
map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

// ---------------- style / availability ----------------
async function refreshAvailability() {
  const [basemap, overlays, parcels] = await Promise.all([resolvePm('basemap'), resolvePm('overlays'), resolvePm('parcels')]);
  av = { basemap, overlays, parcels };
  if (ui.basemap === 'vector' && !basemap) ui.basemap = 'topo';
  if (basemap && !store.get('ui')) ui.basemap = 'vector';
  map.once('style.load', async () => {
    applyVisibility();
    renderLayers();
    await Promise.allSettled([reloadData(), initWaypoints(map)]);
  });
  map.setStyle(buildStyle(av), { diff: false });
}

function applyVisibility() {
  for (const [g, ids] of Object.entries(groups)) {
    let visible: boolean;
    if (g.startsWith('base:')) visible = g === 'base:' + ui.basemap;
    else visible = ui.on[g] ?? true;
    for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
  map.setTerrain(ui.terrain3d ? { source: 'dem', exaggeration: 1.4 } : null);
}

let dataStatus = '';
let gaugeState: 'loading' | 'ready' | 'unavailable' = 'loading';
async function reloadData() {
  const parts: string[] = [];
  await Promise.allSettled([
    loadWaters(map).then(() => { renderWaters(); if (currentTab === 'destination') void destination(); }),
    loadDams(map).then(() => { if (currentTab === 'destination') void destination(); }),
    loadGauges(map).then((r) => { gaugeState = 'ready'; parts.push(`${r.count} gauges · ${r.source}${r.offline ? ' (cached ' + ago(r.t) + ')' : ''}`); if (currentTab === 'destination') void destination(); }).catch(() => { gaugeState = 'unavailable'; parts.push('Gauges unavailable'); if (currentTab === 'destination') void destination(); }),
    loadAccessLive(map).then((r) => { parts.push(`${r.count} access points (${r.source}${r.offline ? ', cached' : ''})`); if (currentTab === 'destination') void destination(); }).catch(() => parts.push('Access points unavailable')),
  ]);
  dataStatus = parts.join(' · ');
  renderLayers();
  renderWaters();
  if (currentTab === 'destination') void destination();
}

// ---------------- sheet / tabs ----------------
const sheet = $('#sheet');
let currentTab = 'destination';
let cancelWaypointPick: (() => void) | undefined;
let placeWaypoint: ((lng: number, lat: number) => void) | undefined;
let navigationRevision = 0;
function destination() { showTripPlan(map); return renderDestination($('#tab-destination'), map, { weather: (at) => { showTab('weather'); renderWeather(at); }, offline: () => showTab('offline'), info: showInfo, spot: editWpt, trips: () => showTab('trips'), downloadsChanged: refreshAvailability, gaugeState }); }
map.on('style.load', () => showTripPlan(map));
map.on('moveend', () => { if (currentTab === 'destination') void destination(); });
function showTab(name: string) {
  cancelTripPick();
  cancelWaypointPick?.();
  navigationRevision++;
  currentTab = name;
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => (t.hidden = t.id !== 'tab-' + name));
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  sheet.classList.add('open');
  if (name === 'destination') void destination();
  if (name === 'weather') renderWeather();
  if (name === 'offline') renderOffline($('#tab-offline'), map, refreshAvailability);
  if (name === 'mine') renderMine();
  if (name === 'trips') renderTrips($('#tab-trips'), map, (id) => { selectDestination(id); showTab('destination'); $('#tab-destination').scrollTop = 0; if (innerWidth <= 800) sheet.classList.remove('open'); });
}
document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => (b.onclick = () => (currentTab === b.dataset.tab && sheet.classList.contains('open') ? sheet.classList.remove('open') : showTab(b.dataset.tab!))));
$('#grab').onclick = () => sheet.classList.toggle('open');
// Keep the map's visual center clear of the side panel on desktop.
let padOpen: boolean | null = null;
const updatePadding = () => {
  const open = sheet.classList.contains('open') && innerWidth > 800;
  if (open === padOpen) return;
  padOpen = open;
  map.easeTo({ padding: { left: open ? 400 : 0, top: 0, right: 0, bottom: 0 }, duration: 250 });
};
new MutationObserver(updatePadding).observe(sheet, { attributes: true, attributeFilter: ['class'] });
addEventListener('resize', updatePadding);
new ResizeObserver(() => {
  const peek = $('#grab').offsetHeight + $('.tabs').offsetHeight + parseFloat(getComputedStyle(sheet).paddingBottom);
  document.documentElement.style.setProperty('--sheet-peek', `${peek}px`);
}).observe($('.tabs'));

function showInfo(html: string, after?: (root: HTMLElement) => void) {
  const el = $('#tab-info');
  el.innerHTML = `<button class="close" aria-label="Close">×</button>${html}`;
  el.querySelector<HTMLButtonElement>('.close')!.onclick = () => showTab('layers');
  showTab('info');
  el.scrollTop = 0;
  after?.(el);
  el.querySelectorAll<HTMLButtonElement>('[data-use-launch], [data-use-spot]').forEach((button) => button.onclick = () => {
    const coords: [number, number] = [Number(button.dataset.launchLng), Number(button.dataset.launchLat)];
    const add = button.hasAttribute('data-use-spot') ? useSpotInTrip : useLaunchInTrip;
    if (coords.every(Number.isFinite) && add({ id: button.dataset.launchId!, name: button.dataset.launchName!, coords })) { showTab('trips'); $('#tab-trips').querySelector<HTMLButtonElement>('[data-resume]')?.click(); toast('Location added to your autosaved trip draft.'); }
  });
  el.querySelectorAll<HTMLButtonElement>('[data-species]').forEach((button) => {
    button.onclick = () => openSpecies(button.dataset.species!, () => showInfo(html, after));
  });
}

function openSpecies(label: string, back: () => void) {
  const matches = speciesForLabel(label);
  if (!matches.length) return;
  const choice = matches.length > 1;
  showInfo(`<button class="link fish-back">← Back</button>${choice ? speciesChoiceHtml(label) : speciesHtml(matches[0].id)}`, (root) => {
    root.querySelector<HTMLButtonElement>('.fish-back')!.onclick = back;
    root.querySelectorAll<HTMLButtonElement>('[data-fish-id]').forEach((button) => {
      button.onclick = () => {
        showInfo(`<button class="link fish-back">← Back to crappie</button>${speciesHtml(button.dataset.fishId!)}`, (detail) => {
          detail.querySelector<HTMLButtonElement>('.fish-back')!.onclick = () => openSpecies(label, back);
        });
      };
    });
  });
}

// ---------------- Layers tab ----------------
const OVERLAY_ROWS: [string, string, string?][] = [
  ['public_lands', 'Public lands (PAD-US)', 'WMAs, national/state forests & parks, USACE lands, easements'],
  ['access', 'Boat ramps & access', 'Ramps, piers, paddle launches, marinas, campgrounds'],
  ['waters', 'Lake & river fishing info', 'Species and notes for major waters'],
  ['gauges', 'Live river gauges & lake levels', 'USGS flow, stage, elevation, water temp'],
  ['dams', 'Dams & release schedules', 'Georgia Power, Alabama Power, USACE'],
  ['water', 'Lakes & streams (NHD)'],
  ['parcels', 'Property parcels', 'Lee Co. AL, Muscogee Co. GA (zoom 13+)'],
  ['contours', 'Contour lines (ft)', 'Zoom 11+'],
  ['hillshade', 'Hillshade'],
  ['radar', 'Weather radar', 'Live NEXRAD'],
  ['mine', 'My waypoints & tracks'],
];
function renderLayers() {
  const el = $('#tab-layers');
  const bases: [BasemapId, string, boolean][] = [
    ['vector', 'Vector (offline)', !!av.basemap], ['topo', 'USGS Topo', true], ['imagery', 'Imagery', true], ['hybrid', 'Imagery + Topo', true],
  ];
  el.innerHTML = `
    <h3>Map layers</h3>
    <h4>Basemap</h4>
    <div class="seg">${bases.map(([id, label, ok]) => `<button data-base="${id}" class="${ui.basemap === id ? 'active' : ''}" ${ok ? '' : 'disabled title="Install with the data pipeline"'}>${label}</button>`).join('')}</div>
    <label class="row"><input type="checkbox" id="t3d" ${ui.terrain3d ? 'checked' : ''}> 3D terrain (tilt with two fingers / right-drag)</label>
    <h4>Overlays</h4>
    ${OVERLAY_ROWS.map(([g, label, hint]) => `<label class="row"><input type="checkbox" data-g="${g}" ${ui.on[g] ? 'checked' : ''}><span>${esc(label)}${hint ? `<br><span class="muted small">${esc(hint)}</span>` : ''}</span></label>`).join('')}
    <details class="legend"><summary>Legend</summary>
      <div class="muted small">Public land manager</div>
      ${[['FED', '#d9a441'], ['STAT', '#3f8f4f'], ['LOC', '#8e7cc3'], ['NGO', '#2a9d8f'], ['PVT', '#c0607a']].map(([k, c]) => `<div><span class="sw" style="background:${c}"></span>${MANAGER_TYPES[k]}</div>`).join('')}
      <div class="muted small">Dashed outline = restricted / closed access</div>
      <div class="muted small" style="margin-top:.5rem">Access</div>
      <div><span class="dot" style="background:#0d47a1;border:2px solid #fff"></span>Water destination · select for lake information</div>
      ${Object.entries(ACCESS_COLORS).filter(([k]) => k !== 'other' && k !== 'parking').map(([k, c]) => `<div><span class="dot" style="background:${c}"></span>${ACCESS_LABELS[k]}</div>`).join('')}
      <div><span class="dot" style="background:#0288d1"></span>Stream gauge · <span class="dot" style="background:#26a69a"></span>Lake/stage gauge · <span class="dot" style="background:#9e9e9e"></span>No recent data</div>
      <div><span class="dot" style="background:#263238;border:2px solid #ffca28"></span>Dam / release information</div>
      <p class="muted small">Layer switches control what is shown. Some layers appear only when zoomed in; live layers need a connection unless cached.</p>
    </details>
    <p class="muted small">Data: ${esc(dataStatus || 'loading…')}<br>
    Overlays: ${av.overlays ? (av.overlays.where === 'device' ? 'offline pack on device' : 'streaming') : 'live services (install packs in Offline tab)'}.</p>`;
  el.querySelectorAll<HTMLButtonElement>('[data-base]').forEach((b) => (b.onclick = () => { ui.basemap = b.dataset.base as BasemapId; saveUi(); applyVisibility(); renderLayers(); }));
  el.querySelectorAll<HTMLInputElement>('[data-g]').forEach((c) => (c.onchange = () => {
    ui.on[c.dataset.g!] = c.checked;
    if (c.dataset.g === 'dams') ui.on.dams_osm = c.checked;
    saveUi(); applyVisibility();
    if (c.dataset.g === 'parcels' && c.checked && map.getZoom() < 13) toast('Zoom in to see parcels');
  }));
  $<HTMLInputElement>('#t3d').onchange = (e) => { ui.terrain3d = (e.target as HTMLInputElement).checked; saveUi(); applyVisibility(); if (ui.terrain3d) map.easeTo({ pitch: 55 }); };
}

// ---------------- Waters tab ----------------
function renderWaters(filter = '') {
  const el = $('#tab-waters');
  const f = filter.toLowerCase();
  const list = waters.filter((w) => !f || w.name.toLowerCase().includes(f) || w.species.some((s) => s.name.toLowerCase().includes(f)));
  el.innerHTML = `<input class="filter" placeholder="Filter by lake or species (e.g. shoal bass)" value="${esc(filter)}">
    <ul class="list">${list.map((w) => `<li><button class="destination-row" data-water-id="${esc(w.id)}"><b>${esc(w.name)}</b><span>${esc(w.species.slice(0, 5).map((s) => s.name).join(', '))}</span><span>View water information ↗</span></button></li>`).join('')}</ul>
    <h4>Regulations & advisories</h4><ul class="links">${regulations.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join('')}</ul>`;
  const input = el.querySelector<HTMLInputElement>('.filter')!;
  input.oninput = () => { renderWaters(input.value); const i = $<HTMLInputElement>('#tab-waters .filter'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  el.querySelectorAll<HTMLButtonElement>('[data-water-id]').forEach((button) => (button.onclick = () => {
    const w = waterById(button.dataset.waterId!)!;
    showInfo(`<button class="link" data-back-waters>← Back to waters</button>${waterHtml(w)}
      <button class="btn primary" data-make-destination>Make it your destination</button>
      <p class="muted small">Plan your visit with nearby access, water readings, weather, saved spots and offline maps.</p>`, (root) => {
      const back = () => { showTab('waters'); renderWaters(filter); };
      root.querySelector<HTMLButtonElement>('[data-back-waters]')!.onclick = back;
      root.querySelector<HTMLButtonElement>('.close')!.onclick = back;
      root.querySelector<HTMLButtonElement>('[data-make-destination]')!.onclick = () => {
        selectDestination(w.id);
        if (w.center) map.flyTo({ center: w.center, zoom: 11 });
        showTab('destination');
        $('#tab-destination').scrollTop = 0;
      };
    });
  }));
}

// ---------------- Weather tab ----------------
async function renderWeather(at?: [number, number]) {
  const el = $('#tab-weather');
  const c = at ?? map.getCenter().toArray() as [number, number];
  el.innerHTML = `<div class="row-btns"><button class="btn" id="wx-here">Map center</button><button class="btn" id="wx-me">My location</button><button class="btn" id="wx-radar">${ui.on.radar ? 'Hide' : 'Show'} radar</button></div><div class="wx">Loading forecast…</div>`;
  el.querySelector<HTMLButtonElement>('#wx-here')!.onclick = () => renderWeather();
  el.querySelector<HTMLButtonElement>('#wx-me')!.onclick = () => navigator.geolocation.getCurrentPosition((p) => renderWeather([p.coords.longitude, p.coords.latitude]), (e) => toast(e.message));
  el.querySelector<HTMLButtonElement>('#wx-radar')!.onclick = () => { ui.on.radar = !ui.on.radar; saveUi(); applyVisibility(); renderWeather(c); };
  el.querySelector('.wx')!.innerHTML = await weatherHtml(c[0], c[1]);
}

// ---------------- My Spots tab ----------------
function renderMine() {
  const el = $('#tab-mine');
  const w = getWpts();
  const t = getTracks();
  el.innerHTML = `
    <button class="btn primary" id="my-trips">My saved trips</button>
    <div class="row-btns">
      <button class="btn primary" id="drop-waypoint">+ Drop a pin</button>
      <button class="btn ${isRecording() ? 'danger' : ''}" id="rec">${isRecording() ? '■ Stop track' : '● Record track'}</button>
    </div>
    <h4>Waypoints (${w.length})</h4>
    <ul class="list">${w.map((p) => `<li data-id="${p.id}"><span class="dot" style="background:${WPT_TYPES[p.type]?.color}"></span><b>${esc(p.name)}</b> <span class="muted small">${esc(WPT_TYPES[p.type]?.label ?? '')} · ${fmtCoord(p.lng, p.lat, ui.coordFmt)}</span></li>`).join('') || '<li class="muted">Long-press (or right-click) the map to drop a waypoint.</li>'}</ul>
    <h4>Tracks (${t.length})</h4>
    <ul class="list">${t.map((tr) => `<li data-track="${tr.id}"><b>${esc(tr.name)}</b> <span class="muted small">${(trackKm(tr) * 0.621).toFixed(2)} mi</span> <button class="link del-track">delete</button></li>`).join('') || '<li class="muted">No tracks yet.</li>'}</ul>
    <div class="row-btns"><button class="btn" id="gpx-out">Export GPX</button><label class="btn">Import GPX<input type="file" accept=".gpx,application/gpx+xml" hidden id="gpx-in"></label></div>
    <p class="muted small">Stored only on this device. Export GPX to back up or move to your fish finder / GPS.</p>`;
  el.querySelector<HTMLButtonElement>('#my-trips')!.onclick = () => showTab('trips');
  el.querySelector<HTMLButtonElement>('#drop-waypoint')!.onclick = () => {
    cancelTripPick(); cancelWaypointPick?.();
    const wasOpen = sheet.classList.contains('open');
    if (innerWidth <= 800) sheet.classList.remove('open');
    const banner = document.createElement('div');
    banner.className = 'trip-pin-banner';
    banner.innerHTML = '<span>Tap or click the map to drop your pin</span><button class="btn">Cancel</button>';
    document.body.append(banner);
    map.getCanvas().style.cursor = 'crosshair';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelWaypointPick?.(); };
    cancelWaypointPick = () => {
      banner.remove(); window.removeEventListener('keydown', escape);
      map.getCanvas().style.cursor = ''; placeWaypoint = undefined; cancelWaypointPick = undefined;
      if (wasOpen) sheet.classList.add('open');
    };
    banner.querySelector('button')!.onclick = () => cancelWaypointPick?.();
    placeWaypoint = (lng, lat) => { cancelWaypointPick?.(); editWpt(addWpt(lng, lat).id); };
    window.addEventListener('keydown', escape);
  };
  el.querySelector<HTMLButtonElement>('#rec')!.onclick = () => { toggleRecording(); renderMine(); };
  el.querySelector<HTMLButtonElement>('#gpx-out')!.onclick = downloadGpx;
  el.querySelector<HTMLInputElement>('#gpx-in')!.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importGpx(f).catch(() => toast('Could not read the GPX file.'));  };
  el.querySelectorAll<HTMLElement>('li[data-id]').forEach((li) => (li.onclick = () => { const p = w.find((x) => x.id === li.dataset.id)!; map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14) }); editWpt(p.id); }));
  el.querySelectorAll<HTMLElement>('li[data-track] .del-track').forEach((b) => (b.onclick = () => { deleteTrack(b.closest<HTMLElement>('li')!.dataset.track!); }));
}
document.addEventListener('vw:mine-changed', () => { if (currentTab === 'mine') renderMine(); });

function editWpt(id: string) {
  const p = getWpts().find((x) => x.id === id);
  if (!p) return;
  showInfo(`<h3>Waypoint</h3>
    <label class="field">Name <input id="w-name" value="${esc(p.name)}"></label>
    <label class="field">Type <select id="w-type">${Object.entries(WPT_TYPES).map(([k, v]) => `<option value="${k}" ${k === p.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
    <label class="field">Notes <textarea id="w-notes" rows="3" placeholder="Depth, lure, structure, date…">${esc(p.notes ?? '')}</textarea></label>
    <p class="muted small">${fmtCoord(p.lng, p.lat, 'dd')} · ${fmtCoord(p.lng, p.lat, 'dm')}<br>Saved ${new Date(p.time).toLocaleString()}</p>
    <div class="row-btns"><button class="btn primary" id="w-save">Save</button><button class="btn" id="w-nav">Directions</button><button class="btn danger" id="w-del">Delete</button></div>`, (root) => {
    root.querySelector<HTMLButtonElement>('#w-save')!.onclick = () => { const saved = updateWpt(id, { name: (root.querySelector('#w-name') as HTMLInputElement).value, type: (root.querySelector('#w-type') as HTMLSelectElement).value, notes: (root.querySelector('#w-notes') as HTMLTextAreaElement).value }); if (saved) toast('Saved'); showTab('mine'); };
    root.querySelector<HTMLButtonElement>('#w-del')!.onclick = () => { deleteWpt(id); showTab('mine'); };
    root.querySelector<HTMLButtonElement>('#w-nav')!.onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`, '_blank');
  });
}

// ---------------- map clicks ----------------
const CLICK_LAYERS = ['wpt-pt', 'gauges-pt', 'dams-pt', 'access-pts', 'waters-pt', 'waters-lbl', 'osm-dam', 'wb-fill', 'stream-line', 'pl-fill', 'parcel-hit'];
let identifyRequest = 0;
map.on('click', async (e) => {
  if (placeWaypoint) { placeWaypoint(e.lngLat.lng, e.lngLat.lat); return; }
  if (pickingTripSpot()) return;
  const request = ++identifyRequest;
  $('#ctx').hidden = true;
  const r = 8;
  const box: [[number, number], [number, number]] = [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]];
  const layers = CLICK_LAYERS.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
  const feats = map.queryRenderedFeatures(box, { layers });
  const by = (id: string) => feats.find((f) => f.layer.id === id);
  const sections: string[] = [];
  let after: ((root: HTMLElement) => void) | undefined;

  const wp = by('wpt-pt');
  if (wp) return editWpt(String(wp.properties.id));
  const g = by('gauges-pt');
  if (g) {
    const gg = gauges.find((x) => x.id === g.properties.id);
    if (gg) { sections.push(gaugeHtml(gg)); after = (root) => fillTrend(root, gg); }
  }
  const d = by('dams-pt');
  if (!sections.length && d) {
    const dd = dams.find((x) => x.id === d.properties.id);
    if (dd) { sections.push(damHtml(dd)); after = (root) => { fillCwms(root, dd); root.querySelectorAll('details').forEach((det) => det.addEventListener('toggle', () => { const gid = det.querySelector<HTMLElement>('.spark-wrap')?.dataset.gauge; const gg = gauges.find((x) => x.id === gid); if (gg && det.open) fillTrend(det as HTMLElement, gg); }, { once: true })); }; }
  }
  const a = by('access-pts');
  if (!sections.length && a) sections.push(accessHtml(a.properties, (a.geometry as { coordinates: number[] }).coordinates as [number, number]));
  const od = by('osm-dam');
  if (!sections.length && od) sections.push(`<h3>${esc(od.properties.name ?? 'Dam')}</h3><p class="muted">OpenStreetMap ${esc(od.properties.waterway ?? od.properties.power ?? '')}</p>`);

  const wl = by('waters-lbl') ?? by('waters-pt');
  const wf: MapGeoJSONFeature | undefined = by('wb-fill') ?? by('stream-line');
  const water = wl ? waterById(String(wl.properties.id)) : wf ? (wf.properties.water_id ? waterById(String(wf.properties.water_id)) : waterByName(wf.properties.gnis_name)) : undefined;
  if (water) sections.push(waterHtml(water, wf?.properties) + '<button class="btn primary" data-map-destination>Make it your destination</button>');
  else if (wf?.properties.gnis_name && !sections.length) sections.push(`<h3>${esc(wf.properties.gnis_name)}</h3><p class="muted">NHD ${wf.layer.id === 'wb-fill' ? 'water body' : 'stream'}${wf.properties.areasqkm ? ` · ${(wf.properties.areasqkm * 247.105).toFixed(0)} acres` : ''}</p>`);

  const pl = by('pl-fill');
  if (pl) sections.push(publicLandHtml(pl.properties));
  const pc = by('parcel-hit');
  if (pc) sections.push(`<h3>Parcel</h3>${Object.entries(pc.properties).filter(([k]) => !/^_|OBJECTID|Shape/i.test(k)).map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}<p class="muted small">Approximate; not a survey. Get landowner permission before entering private land.</p>`);

  // Live identify fallbacks (no offline overlays installed)
  const { lng, lat } = e.lngLat;
  const pending: Promise<string | null>[] = [];
  if (!av.overlays && ui.on.public_lands && map.getZoom() >= 7) pending.push(identifyPublicLands(lng, lat));
  if (!av.parcels && ui.on.parcels && map.getZoom() >= 13) pending.push(identifyParcels(lng, lat));

  if (!sections.length && !pending.length) return;
  const coord = `<p class="muted small coord-line">${fmtCoord(lng, lat, ui.coordFmt)} · <button class="link" id="drop-here">Drop waypoint</button> · <button class="link" id="wx-here2">Weather here</button></p>`;
  const render = (extra: string[]) => showInfo(sections.concat(extra).join('<hr>') + coord, (root) => {
    after?.(root);
    const choose = root.querySelector<HTMLButtonElement>('[data-map-destination]');
    if (choose && water) choose.onclick = () => { selectDestination(water.id); showTab('destination'); $('#tab-destination').scrollTop = 0; };
    root.querySelector<HTMLButtonElement>('#drop-here')!.onclick = () => editWpt(addWpt(lng, lat).id);
    root.querySelector<HTMLButtonElement>('#wx-here2')!.onclick = () => { showTab('weather'); renderWeather([lng, lat]); };
  });
  if (sections.length) render([]);
  if (pending.length) {
    if (!sections.length) showInfo('<p class="muted">Looking up…</p>');
    const revision = navigationRevision;
    const extra = (await Promise.all(pending)).filter(Boolean) as string[];
    if (request !== identifyRequest || revision !== navigationRevision) return;
    if (extra.length || sections.length) render(extra);
    else showTab('layers');
  }
});
map.on('mousemove', (e) => {
  if (pickingTripSpot() || placeWaypoint) return;
  const layers = CLICK_LAYERS.filter((id) => map.getLayer(id) && id !== 'wb-fill' && id !== 'pl-fill' && id !== 'parcel-hit');
  map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers }).length ? 'pointer' : '';
});

// Long-press / right-click context menu
function contextMenu(x: number, y: number, lng: number, lat: number) {
  const ctx = $('#ctx');
  ctx.innerHTML = `<div class="muted small">${fmtCoord(lng, lat, ui.coordFmt)}</div>
    <button data-a="wpt">Drop waypoint</button><button data-a="wx">Weather here</button><button data-a="copy">Copy coordinates</button><button data-a="nav">Directions</button>`;
  ctx.style.left = Math.min(x, innerWidth - 200) + 'px';
  ctx.style.top = Math.min(y, innerHeight - 200) + 'px';
  ctx.hidden = false;
  ctx.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
    ctx.hidden = true;
    if (b.dataset.a === 'wpt') editWpt(addWpt(lng, lat).id);
    if (b.dataset.a === 'wx') { showTab('weather'); renderWeather([lng, lat]); }
    if (b.dataset.a === 'copy') navigator.clipboard?.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`).then(() => toast('Copied'));
    if (b.dataset.a === 'nav') window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
  }));
}
map.on('contextmenu', (e) => contextMenu(e.point.x, e.point.y + 56, e.lngLat.lng, e.lngLat.lat));
let pressTimer: number | undefined;
map.on('touchstart', (e) => {
  if (e.originalEvent.touches.length !== 1) return;
  pressTimer = window.setTimeout(() => contextMenu(e.point.x, e.point.y + 56, e.lngLat.lng, e.lngLat.lat), 650);
});
['touchend', 'touchmove', 'movestart'].forEach((ev) => map.on(ev as 'touchend', () => clearTimeout(pressTimer)));

// Coordinates readout
const coordsEl = $('#coords');
const showCoords = () => { const c = map.getCenter(); coordsEl.textContent = fmtCoord(c.lng, c.lat, ui.coordFmt) + (innerWidth > 560 ? ` · z${map.getZoom().toFixed(1)}` : ''); };
map.on('move', showCoords);
coordsEl.onclick = () => { ui.coordFmt = ui.coordFmt === 'dd' ? 'dm' : 'dd'; saveUi(); showCoords(); };

// ---------------- search ----------------
const q = $<HTMLInputElement>('#q');
const results = $('#results');
type Hit = { label: string; sub: string; center: [number, number]; zoom: number; open?: () => void };
q.oninput = () => {
  const s = q.value.trim().toLowerCase();
  if (s.length < 2) { results.hidden = true; return; }
  const hits: Hit[] = [];
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    let [a, b] = [Number(m[1]), Number(m[2])];
    if (Math.abs(a) > 60) [a, b] = [b, a]; // accept lon,lat too
    hits.push({ label: `Go to ${a}, ${b}`, sub: 'Coordinates', center: [b, a], zoom: 14 });
  }
  for (const w of waters) if (w.name.toLowerCase().includes(s) || w.species.some((x) => x.name.toLowerCase().includes(s))) hits.push({ label: w.name, sub: 'Water · ' + w.species.slice(0, 3).map((x) => x.name).join(', '), center: w.center ?? map.getCenter().toArray() as [number, number], zoom: 11, open: () => { selectDestination(w.id); showTab('destination'); } });
  for (const d of dams) if (d.name.toLowerCase().includes(s)) hits.push({ label: d.name, sub: 'Dam · ' + d.operator, center: d.coords, zoom: 13, open: () => showInfo(damHtml(d), (r) => fillCwms(r, d)) });
  for (const g of gauges) if (g.name.toLowerCase().includes(s) || g.id.includes(s)) hits.push({ label: g.name, sub: 'USGS gauge ' + g.id, center: g.coords, zoom: 13, open: () => showInfo(gaugeHtml(g), (r) => fillTrend(r, g)) });
  for (const p of getWpts()) if (p.name.toLowerCase().includes(s)) hits.push({ label: p.name, sub: 'My waypoint', center: [p.lng, p.lat], zoom: 15, open: () => editWpt(p.id) });
  const accessSrc = av.overlays ? map.querySourceFeatures('overlays', { sourceLayer: 'access' }) : map.querySourceFeatures('access-live');
  const seen = new Set<string>();
  for (const f of accessSrc) {
    const n = String(f.properties.name ?? '');
    if (n && n.toLowerCase().includes(s) && !seen.has(n)) { seen.add(n); hits.push({ label: n, sub: ACCESS_LABELS[f.properties.kind] ?? 'Access', center: (f.geometry as { coordinates: number[] }).coordinates as [number, number], zoom: 15 }); }
  }
  results.innerHTML = hits.slice(0, 12).map((h, i) => `<li data-i="${i}"><b>${esc(h.label)}</b><br><span class="muted small">${esc(h.sub)}</span></li>`).join('') || '<li class="muted">No matches</li>';
  results.hidden = false;
  results.querySelectorAll<HTMLElement>('li[data-i]').forEach((li) => (li.onclick = () => {
    const h = hits[Number(li.dataset.i)];
    map.flyTo({ center: h.center, zoom: h.zoom });
    h.open?.();
    results.hidden = true;
    q.blur();
  }));
};
q.onkeydown = (e) => { if (e.key === 'Escape') { results.hidden = true; q.blur(); } if (e.key === 'Enter') results.querySelector<HTMLElement>('li[data-i]')?.click(); };
document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.search')) results.hidden = true; });

// ---------------- network status ----------------
const net = $('#net');
const updateNet = () => { net.textContent = navigator.onLine ? 'Online' : 'Offline'; net.classList.toggle('off', !navigator.onLine); };
addEventListener('online', () => { updateNet(); reloadData(); });
addEventListener('offline', updateNet);
updateNet();
setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') loadGauges(map).catch(() => {}); }, 15 * 60_000);

// ---------------- boot ----------------
map.once('style.load', () => {
  showCoords();
  showTab(currentTab);
  applyVisibility();
  renderLayers();
  reloadData();
  initWaypoints(map);
  refreshAvailability();
  if (innerWidth > 800) sheet.classList.add('open');
});
map.on('error', (e) => console.debug('map error', e.error?.message ?? e));
