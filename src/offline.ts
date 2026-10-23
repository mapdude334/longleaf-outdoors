// Offline manager: whole-region PMTiles downloads + "save this area" raster/terrain tile caching.
// Cache names must match the service worker runtime caches in vite.config.ts.
import type { Map } from 'maplibre-gl';
import { GLYPHS, PMTILES, RASTER_BASEMAPS, TERRAIN_URL, USGS_HYDRO_TILES, type PmKey } from './config';
import { localFile, remoteSize, removeFromDevice, saveToDevice } from './pmtiles';
import { esc, toast } from './util';

export const RASTER_CACHE = 'vw-raster';
export const STATIC_CACHE = 'vw-static';
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const RANGES = ['0-255', '256-511', '8192-8447'];

let moveHandler: (() => void) | null = null;
const mb = (n: number) => (n / 1048576).toFixed(n > 100 * 1048576 ? 0 : 1) + ' MB';

function tilesFor(bounds: [number, number, number, number], z: number) {
  const n = 2 ** z;
  const x = (lon: number) => Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
  const y = (lat: number) => Math.max(0, Math.min(n - 1, Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n)));
  const out: [number, number, number][] = [];
  for (let i = x(bounds[0]); i <= x(bounds[2]); i++) for (let j = y(bounds[3]); j <= y(bounds[1]); j++) out.push([z, i, j]);
  return out;
}
const fill = (tpl: string, [z, x, y]: [number, number, number]) => tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

export function planArea(map: Map, layers: string[], maxZoom: number) {
  const b = map.getBounds();
  const bounds: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const urls: string[] = [];
  const minZ = Math.max(0, Math.floor(map.getZoom()) - 3);
  for (const id of layers) {
    const tpl = id === 'terrain' ? TERRAIN_URL : id === 'hydro' ? USGS_HYDRO_TILES : RASTER_BASEMAPS[id as keyof typeof RASTER_BASEMAPS].url;
    const top = id === 'terrain' ? Math.min(12, maxZoom) : maxZoom;
    for (let z = minZ; z <= top; z++) for (const t of tilesFor(bounds, z)) urls.push(fill(tpl, t));
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
          const r = await fetch(u, { signal });
          if (r.ok) await cache.put(u, r); else failed++;
        }
      } catch { failed++; }
      done++;
      if (done % 10 === 0 || done === urls.length) onProgress(done, failed);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  await cacheGlyphs();
  return { done, failed };
}

export async function cacheGlyphs() {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(FONTS.flatMap((f) => RANGES.map(async (r) => {
    const u = GLYPHS.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', r);
    try { if (!(await cache.match(u))) { const res = await fetch(u); if (res.ok) await cache.put(u, res); } } catch { /* offline */ }
  })));
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
      Used ${mb(s.used)} of ${mb(s.quota)}${s.persisted ? ' · storage is persistent' : ' · <b>not yet persistent</b> (granted on first download)'}.</p>
    <h4>Region packs</h4>
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

  for (const el of root.querySelectorAll<HTMLElement>('.pack')) {
    const k = el.dataset.k as PmKey;
    const status = el.querySelector<HTMLElement>('.status')!;
    const actions = el.querySelector<HTMLElement>('.pack-actions')!;
    const prog = el.querySelector<HTMLProgressElement>('progress')!;
    const [local, size] = await Promise.all([localFile(k), remoteSize(k)]);
    if (local) {
      status.textContent = `Saved on device · ${mb(local.size)}`;
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
          toast('Saved for offline use');
          onChanged();
        } catch (e) {
          toast(ctl.signal.aborted ? 'Download cancelled' : 'Download failed: ' + (e as Error).message);
        }
        renderOffline(root, map, onChanged);
      };
    } else {
      status.textContent = navigator.onLine ? 'Not published yet — run the data pipeline (see README)' : 'Offline';
    }
  }

  const est = root.querySelector<HTMLElement>('.est')!;
  const layersSel = () => [...root.querySelectorAll<HTMLInputElement>('.area input:checked')].map((i) => i.value);
  const maxz = root.querySelector<HTMLSelectElement>('.maxz')!;
  const update = () => {
    const n = planArea(map, layersSel(), Number(maxz.value)).length;
    est.textContent = `${n.toLocaleString()} tiles ≈ ${mb(n * 25_000)}${n > 15000 ? ' — too many; zoom in or lower max zoom' : ''}`;
  };
  root.querySelectorAll('.area input, .maxz').forEach((el) => el.addEventListener('change', update));
  if (moveHandler) map.off('moveend', moveHandler);
  moveHandler = update;
  map.on('moveend', update);
  update();

  root.querySelector<HTMLButtonElement>('.save-area')!.onclick = async (ev) => {
    const urls = planArea(map, layersSel(), Number(maxz.value));
    if (urls.length > 15000) return toast('Area too large — zoom in or lower max zoom');
    const btn = ev.currentTarget as HTMLButtonElement;
    const prog = root.querySelector<HTMLProgressElement>('.area-prog')!;
    const ctl = new AbortController();
    btn.textContent = 'Cancel';
    btn.onclick = () => ctl.abort();
    prog.hidden = false;
    const r = await saveArea(urls, (d, f) => { prog.value = d / urls.length; est.textContent = `${d.toLocaleString()} / ${urls.length.toLocaleString()} tiles${f ? ` (${f} failed)` : ''}`; }, ctl.signal);
    toast(`Saved ${(r.done - r.failed).toLocaleString()} tiles`);
    renderOffline(root, map, onChanged);
  };
  root.querySelector<HTMLButtonElement>('.clear-area')!.onclick = async () => { await clearAreaCache(); toast('Cleared'); renderOffline(root, map, onChanged); };
}
