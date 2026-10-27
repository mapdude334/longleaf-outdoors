// Offline manager: whole-region PMTiles downloads + "save this area" raster/terrain tile caching.
// Cache names must match the service worker runtime caches in vite.config.ts.
import type { Map } from 'maplibre-gl';
import { GLYPHS, SPRITE, PMTILES, RASTER_BASEMAPS, TERRAIN_URL, USGS_HYDRO_TILES, type PmKey } from './config';
import { localFile, loadPackManifest, packStatus, remoteSize, removeFromDevice, saveToDevice } from './pmtiles';
import { esc, toast } from './util';

export const RASTER_CACHE = 'vw-raster';
export const STATIC_CACHE = 'vw-static';
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const RANGES = ['0-255', '256-511', '8192-8447'];

let moveHandler: (() => void) | null = null;
const mb = (n: number) => (n / 1048576).toFixed(n > 100 * 1048576 ? 0 : 1) + ' MB';

function* tilesFor(bounds: [number, number, number, number], z: number): Generator<[number, number, number]> {
  const n = 2 ** z;
  const x = (lon: number) => Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
  const y = (lat: number) => Math.max(0, Math.min(n - 1, Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n)));
  for (let i = x(bounds[0]); i <= x(bounds[2]); i++) for (let j = y(bounds[3]); j <= y(bounds[1]); j++) yield [z, i, j];
}
const fill = (tpl: string, [z, x, y]: [number, number, number]) => tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

export function planArea(map: Map, layers: string[], maxZoom: number) {
  const b = map.getBounds();
  const bounds: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const urls: string[] = [];
  // Include overview zooms so a saved area still works when zooming out.
  const minZ = 0;
  for (const id of layers) {
    const tpl = id === 'terrain' ? TERRAIN_URL : id === 'hydro' ? USGS_HYDRO_TILES : RASTER_BASEMAPS[id as keyof typeof RASTER_BASEMAPS].url;
    const top = id === 'terrain' ? Math.min(12, maxZoom) : maxZoom;
    for (let z = minZ; z <= top; z++) for (const t of tilesFor(bounds, z)) {
      urls.push(fill(tpl, t));
      if (urls.length > 15000) return urls; // Bound planning memory before the UI rejects a large area.
    }
  }
  return urls;
}

export async function saveArea(urls: string[], onProgress: (done: number, failed: number) => void, signal: AbortSignal) {
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  const cache = await caches.open(RASTER_CACHE);
  let i = 0, done = 0, failed = 0;
  const worker = async () => {
    while (i < urls.length && !signal.aborted) {
      const u = urls[i++];
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
          if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) await cache.put(u, r); else failed++;
        }
      } catch { failed++; }
      done++;
      if (done % 10 === 0 || done === urls.length) onProgress(done, failed);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const missingAssets = signal.aborted ? 0 : await cacheGlyphs(signal);
  onProgress(done, failed);
  return { done, failed, cancelled: signal.aborted, missingAssets };
}

export async function cacheGlyphs(signal?: AbortSignal) {
  const cache = await caches.open(STATIC_CACHE);
  const urls = FONTS.flatMap((f) => RANGES.map((r) => GLYPHS.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', r)));
  urls.push(...['.json', '.png', '@2x.json', '@2x.png'].map((suffix) => SPRITE + suffix));
  let failed = 0;
  await Promise.all(urls.map(async (u) => {
    try {
      if (!(await cache.match(u))) {
        const res = await fetch(u, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]) });
        if (!res.ok) throw new Error('Asset unavailable');
        await cache.put(u, res);
      }
    } catch { failed++; }
  }));
  return failed;
}

export async function clearAreaCache() {
  await caches.delete(RASTER_CACHE);
}

export async function storageSummary() {
  const est = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persisted?.();
  let rasterCount = 0;
  try { rasterCount = (await (await caches.open(RASTER_CACHE)).keys()).length; } catch { /* none */ }
  return { used: est?.usage ?? 0, quota: est?.quota ?? 0, persisted: !!persisted, rasterCount };
}

const PM_LABELS: Record<PmKey, string> = {
  basemap: 'Vector basemap (roads, trails, names – OpenStreetMap)',
  overlays: 'Public lands, lakes, streams, ramps & access',
  parcels: 'Parcels (counties with free public data)',
};

/** Renders the Offline panel. `onChanged` reloads the map style when archives are added/removed. */
export async function renderOffline(root: HTMLElement, map: Map, onChanged: () => void) {
  const s = await storageSummary();
  root.innerHTML = `
    <h3>Offline maps</h3>
    <p class="muted small">Download before you lose signal. Files are stored in this browser on this device.
      Used ${mb(s.used)} of ${mb(s.quota)}${s.persisted ? ' · storage is persistent' : ' · <b>storage may be cleared by the browser</b> (persistence will be requested)'}.</p>
    <h4>Region packs</h4>
    <p class="muted small region-summary" aria-live="polite">East Alabama / West Georgia · checking published map edition…</p>
    <p class="muted small">These packs contain vector maps and overlays. Fish attractor and restroom points are bundled with the app for offline use. Save imagery, terrain and contours separately using “Save this area” below. Weather and river readings need a connection to update.</p>
    <div class="packs">${(Object.keys(PMTILES) as PmKey[]).map((k) => `
      <div class="pack" data-k="${k}"><div><b>${esc(PM_LABELS[k])}</b><br><span class="muted small status">checking…</span></div>
      <div class="pack-actions"></div><progress hidden max="1" value="0"></progress></div>`).join('')}
    </div>
    <h4>Save this area (imagery / topo / terrain)</h4>
    <div class="area">
      <label><input type="checkbox" value="topo" checked> USGS Topo</label>
      <label><input type="checkbox" value="imagery"> Imagery</label>
      <label><input type="checkbox" value="terrain" checked> Terrain (hillshade + contours)</label>
      <label><input type="checkbox" value="hydro"> USGS hydro overlay</label>
      <label>Max zoom <select class="maxz"><option>13</option><option selected>14</option><option>15</option><option>16</option></select></label>
      <p class="muted small est"></p>
      <button class="btn primary save-area">Save visible area</button> <button class="btn clear-area">Clear saved areas (${s.rasterCount.toLocaleString()} tiles)</button>
      <progress class="area-prog" hidden max="1" value="0"></progress>
    </div>`;

  void loadPackManifest().then((manifest) => {
    const summary = root.querySelector('.region-summary');
    if (!summary) return;
    summary.textContent = manifest
      ? `${manifest.region} · built ${new Date(manifest.builtAt).toLocaleDateString()} · parcels: ${manifest.parcelCoverage.join('; ')} only.`
      : 'East Alabama / West Georgia · map edition unavailable. Check each pack below.';
  });

  void Promise.all([...root.querySelectorAll<HTMLElement>('.pack')].map(async (el) => {
    const k = el.dataset.k as PmKey;
    const status = el.querySelector<HTMLElement>('.status')!;
    const actions = el.querySelector<HTMLElement>('.pack-actions')!;
    const prog = el.querySelector<HTMLProgressElement>('progress')!;
    const local = await localFile(k);
    const size = local ? null : await remoteSize(k);
    if (local) {
      status.textContent = `${await packStatus(k)} · ${mb(local.size)}`;
      actions.innerHTML = `<button class="btn">Remove</button>`;
      actions.querySelector('button')!.onclick = async () => { await removeFromDevice(k); toast('Removed'); onChanged(); renderOffline(root, map, onChanged); };
    } else if (size) {
      status.textContent = `Available · ${mb(size)}`;
      actions.innerHTML = `<button class="btn primary">Download</button>`;
      actions.querySelector('button')!.onclick = async () => {
        const ctl = new AbortController();
        actions.innerHTML = `<button class="btn">Cancel</button>`;
        actions.querySelector('button')!.onclick = () => ctl.abort();
        prog.hidden = false;
        try {
          await saveToDevice(k, (d, t) => { prog.value = t ? d / t : 0; status.textContent = `${mb(d)}${t ? ' / ' + mb(t) : ''}`; }, ctl.signal);
          const missing = await cacheGlyphs(ctl.signal);
          toast(missing ? 'Map saved. Some labels or icons could not be saved; reconnect and retry.' : 'Map and label assets saved for offline use');
          onChanged();
        } catch (e) {
          toast(ctl.signal.aborted ? 'Download cancelled' : 'Download failed: ' + (e as Error).message);
        }
        renderOffline(root, map, onChanged);
      };
    } else {
      status.textContent = navigator.onLine ? 'Download unavailable. Try again when connected; this pack may not be published yet.' : 'Not downloaded · connect to download';
    }
  })).catch(() => toast('Could not check map packs. Area download controls are still available.'));

  const est = root.querySelector<HTMLElement>('.est')!;
  const layersSel = () => [...root.querySelectorAll<HTMLInputElement>('.area input:checked')].map((i) => i.value);
  const maxz = root.querySelector<HTMLSelectElement>('.maxz')!;
  const update = () => {
    const n = planArea(map, layersSel(), Number(maxz.value)).length;
    est.textContent = n > 15000 ? 'More than 15,000 tiles — zoom in or lower max zoom' : `${n.toLocaleString()} tiles ≈ ${mb(n * 25_000)}`;
    root.querySelector<HTMLButtonElement>('.save-area')!.disabled = n === 0 || n > 15000;
  };
  root.querySelectorAll('.area input, .maxz').forEach((el) => el.addEventListener('change', update));
  if (moveHandler) map.off('moveend', moveHandler);
  moveHandler = update;
  map.on('moveend', update);
  update();

  root.querySelector<HTMLButtonElement>('.save-area')!.onclick = async (ev) => {
    const urls = planArea(map, layersSel(), Number(maxz.value));
    if (urls.length > 15000) return toast('Area too large — zoom in or lower max zoom');
    if (!urls.length) return toast('Select at least one map layer');
    const btn = ev.currentTarget as HTMLButtonElement;
    const prog = root.querySelector<HTMLProgressElement>('.area-prog')!;
    const ctl = new AbortController();
    btn.textContent = 'Cancel';
    btn.onclick = () => ctl.abort();
    prog.hidden = false;
    try {
      const r = await saveArea(urls, (d, f) => { prog.value = d / urls.length; est.textContent = `${d.toLocaleString()} / ${urls.length.toLocaleString()} tiles${f ? ` (${f} failed)` : ''}`; }, ctl.signal);
      toast(`${r.cancelled ? 'Cancelled. Kept' : r.failed || r.missingAssets ? 'Incomplete download. Saved' : 'Saved'} ${(r.done - r.failed).toLocaleString()} of ${urls.length.toLocaleString()} tiles${r.missingAssets ? '; some labels or icons unavailable' : ''}`, 7000);
    } catch (e) {
      toast('Area download failed: ' + (e as Error).message, 7000);
    } finally {
      void renderOffline(root, map, onChanged);
    }
  };
  root.querySelector<HTMLButtonElement>('.clear-area')!.onclick = async () => { await clearAreaCache(); toast('Cleared'); renderOffline(root, map, onChanged); };
}
