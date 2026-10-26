import type { Map } from 'maplibre-gl';
import { waters, waterHtml } from './layers/waters';
import { gauges, gaugeHtml, fillTrend } from './layers/gauges';
import { dams, damHtml, fillCwms } from './layers/dams';
import { ACCESS_LABELS, accessHtml, accessLocation } from './layers/access';
import { getWpts } from './waypoints';
import { packStatus } from './pmtiles';
import { activeTrip } from './trips';
import { esc, haversineKm, store } from './util';

const BOUNDS: [[number, number], [number, number]] = [[-85.32, 32.86], [-85.02, 33.22]];
export function selectDestination(id: string) { store.set('destination', id); }

export async function renderDestination(root: HTMLElement, map: Map, actions: {
  weather: (at: [number, number]) => void;
  offline: () => void;
  info: (html: string, after?: (root: HTMLElement) => void) => void;
  spot: (id: string) => void;
  trips: () => void;
}) {
  const selected = store.get<string>('destination')?.v ?? 'west-point';
  const water = waters.find((w) => w.id === selected) ?? waters.find((w) => w.id === 'west-point');
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
  const access = map.queryRenderedFeatures(undefined, { layers: ['access-pts'].filter((id) => !!map.getLayer(id)) })
    .filter((f) => {
      if (f.geometry.type !== 'Point' || !inside(f.geometry.coordinates)) return false;
      const key = f.properties.osm ?? `${f.properties.name}:${f.geometry.coordinates.join(',')}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    });
  const accessCache = store.get('access-osm');
  root.innerHTML = `<div class="destination-hero">
      <span class="destination-eyebrow">YOUR NEXT DAY OUT · ALABAMA / GEORGIA</span>
      <label class="destination-picker">Choose your destination<select id="destination-select">${[...waters].sort((a, b) => a.name.localeCompare(b.name)).map((w) => `<option value="${esc(w.id)}" ${w.id === water?.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
      <h2>${esc(water?.name ?? 'Choose your water')}</h2><p>Pick your launch. Check the water.<br>Keep the day yours.</p>
      <button class="btn destination-explore" ${water?.center ? '' : 'disabled'}>Explore this water ↗</button>
      ${water && !water.center ? '<p class="small">A single map location is not available for this destination. Browse its information below.</p>' : ''}
    </div>
    <div class="destination-body">
      <div class="destination-meta">${esc(water?.river ? water.river + ' basin' : water?.state ?? '')}<span>${esc(water?.manager ?? '')}</span></div>
      <button class="btn primary" data-action="trips">Plan / saved trips</button>
      ${trip && trip.destination === water?.id ? `<div class="destination-card"><b>${esc(trip.name)}</b><p>Launch: ${esc(trip.ramp?.name ?? 'Not selected')}</p><p>Fishing spots: ${esc(trip.spots.map((s) => s.name).join(', ') || 'None selected')}</p><p style="white-space:pre-wrap">${esc(trip.notes)}</p><span class="muted small">Saved trip · launch is blue, fishing spots are pink on the map.</span></div>` : ''}
      ${water ? `<p class="muted small">${water.acres ? water.acres.toLocaleString() + ' acres · ' : ''}${esc(water.state)} · ${esc(water.type)}</p><p>${esc(water.notes ?? '')}</p><button class="btn" data-action="overview">Species, lake notes & official links ↗</button>` : ''}
      <div class="destination-actions"><button class="btn primary" data-action="weather" ${water?.center ? '' : 'disabled'}>Check weather</button><button class="btn" data-action="offline">Prepare offline</button></div>
      <h4>01 / Before you launch</h4>
      <p class="muted small">Readings below come from nearby gauges; they may describe river conditions rather than the reservoir level. Check each station and observation time.</p>
      ${near.length ? near.slice(0, 2).map((g) => `<details class="destination-card"><summary>${esc(g.name)}</summary>${gaugeHtml(g)}</details>`).join('') : '<div class="destination-card">No nearby gauge readings loaded.<p class="muted small">A missing reading does not establish current conditions.</p></div>'}
      ${dam ? '<button class="btn" data-action="dam">Dam & release information ↗</button>' : ''}
      <h4>02 / Find your way to the water</h4>
      <p class="muted small">${water?.center ? 'Access points currently drawn near this destination. Explore the water, then refresh to see more.' : 'Nearby access cannot be matched until a map location is available.'} Community locations do not confirm an open launch.</p>
      <button class="link" data-action="refresh">Refresh visible access</button>
      <ul class="list">${access.slice(0, 8).map((f, i) => `<li><button class="destination-row" data-access="${i}"><b>${esc(f.properties.name || ACCESS_LABELS[f.properties.kind] || 'Access point')}</b>${f.properties.description ? `<span>${esc(f.properties.description)}</span>` : ''}<span>${esc(accessLocation(f.properties, f.geometry.type === 'Point' ? f.geometry.coordinates as [number, number] : CENTER))}</span><span>${esc(ACCESS_LABELS[f.properties.kind] ?? 'Access')} · View details ↗</span></button></li>`).join('') || '<li class="muted">No access points drawn yet. Explore the lake or enable the access layer.</li>'}</ul>
      ${accessCache ? `<p class="muted small">Live-service access cache saved ${esc(new Date(accessCache.t).toLocaleString())}. Downloaded overlays may have a different date.</p>` : ''}
      <h4>03 / Make it your lake</h4>
      <ul class="list">${spots.map((p) => `<li><button class="destination-row" data-spot="${esc(p.id)}"><b>${esc(p.name)}</b><span>My saved spot ↗</span></button></li>`).join('') || '<li class="muted">Your lake spots will appear here. Long-press the map to save your first one.</li>'}</ul>
      <button class="btn" data-action="fish">Species & lake notes</button>
      <h4>04 / Ready for no signal?</h4><div class="destination-card" id="destination-packs" aria-live="polite">Checking downloaded maps…</div>
      <p class="muted small">Map packs cover the configured region. Weather and release information need a connection for updates. Keep the app open while recording GPS.</p>
    </div>`;
  root.querySelector<HTMLSelectElement>('#destination-select')!.onchange = (event) => {
    const id = (event.target as HTMLSelectElement).value;
    selectDestination(id);
    const next = waters.find((w) => w.id === id);
    if (next?.center) map.flyTo({ center: next.center, zoom: 10 });
    root.scrollTop = 0;
    void renderDestination(root, map, actions);
    root.querySelector<HTMLSelectElement>('#destination-select')?.focus({ preventScroll: true });
  };
  const overview = root.querySelector<HTMLButtonElement>('[data-action="overview"]');
  root.querySelector<HTMLButtonElement>('[data-action="trips"]')!.onclick = actions.trips;
  if (overview) overview.onclick = () => actions.info(waterHtml(water!));
  root.querySelector<HTMLButtonElement>('.destination-explore')!.onclick = () => {
    if (innerWidth <= 800) document.querySelector('#sheet')?.classList.remove('open');
    const bottom = innerWidth <= 800 ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) + 20 : 45;
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
  const statuses = await Promise.all((['basemap', 'overlays', 'parcels'] as const).map(async (key) => `<div><b>${key === 'basemap' ? 'Base map' : key === 'overlays' ? 'Land, water & access' : 'Parcels (optional)'}</b><span>${esc(await packStatus(key))}</span></div>`));
  if (target.isConnected) target.innerHTML = statuses.join('');
}
