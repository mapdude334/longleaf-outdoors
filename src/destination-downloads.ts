import type { Map } from 'maplibre-gl';
import { type PmKey } from './config';
import { packStatus, remoteSize, saveToDevice } from './pmtiles';
import { cacheGlyphs, MAX_AREA_TILES, planArea, recordAreaCoverage, saveArea, showAreaLimitDialog } from './offline';

const chosen = new Set<string>(['topo', 'terrain']);
let zoom = 12;
let busy = false;
let moveHandler: (() => void) | undefined;
export const destinationDownloadBusy = () => busy;
const size = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const packChecks = new globalThis.Map<PmKey, Promise<{ status: string; bytes: number | null }>>();

export function renderDestinationDownloads(root: HTMLElement, map: Map, onChanged: () => void) {
  const packs: [PmKey, string][] = [['basemap', 'Vector base map'], ['overlays', 'Land, water & access'], ['parcels', 'Parcels (selected counties)']];
  root.innerHTML = `<p class="muted small">Choose what to keep on this device before heading out.</p>
    <p class="callout info">Area downloads save the map view currently on screen. Pan and zoom to the exact place you need <b>before</b> starting; save separate areas separately. You can move the map while this panel is open to update the extent.</p>
    <p class="muted small" data-download-extent></p>
    <b>Current map view</b>
    ${[['topo', 'USGS Topo'], ['imagery', 'Satellite imagery'], ['terrain', 'Terrain & contours'], ['hydro', 'Lakes & streams overlay']].map(([id, label]) => `<label class="row"><input type="checkbox" data-download="${id}" ${chosen.has(id) ? 'checked' : ''}>${label}</label>`).join('')}
    <label class="field">Map detail<select data-download-zoom>${[10, 12, 14, 15].map((z) => `<option value="${z}" ${z === zoom ? 'selected' : ''}>Zoom ${z}${z === 10 ? ' · overview' : z === 15 ? ' · most detail' : ''}</option>`).join('')}</select></label>
    <p class="muted small" data-download-estimate></p>
    <b>Whole-region packs</b>
    ${packs.map(([id, label]) => `<label class="row"><input type="checkbox" data-download="${id}" disabled><span>${label}<br><span class="muted small" data-pack-status="${id}">Checking availability…</span></span></label>`).join('')}
    <p class="muted small">Water, access, structure, habitat, restroom, dam and species catalogs are bundled with the installed app and can be viewed offline wherever catalog records exist. Regional packs cover their own published footprint. Live weather, readings and releases need a connection to update.</p>
    <button class="btn primary" data-download-start>Download selected data</button>
    <button class="btn" data-download-cancel hidden>Cancel download</button>
    <button class="btn" data-download-library hidden>Open Saved Maps</button>
    <progress class="destination-download-progress" hidden max="1" value="0"></progress>
    <p class="muted small" data-download-message role="status" aria-live="polite"></p>`;
  const start = root.querySelector<HTMLButtonElement>('[data-download-start]')!;
  const cancel = root.querySelector<HTMLButtonElement>('[data-download-cancel]')!;
  const library = root.querySelector<HTMLButtonElement>('[data-download-library]')!;
  const progress = root.querySelector<HTMLProgressElement>('progress')!;
  const message = root.querySelector<HTMLElement>('[data-download-message]')!;
  const raster = () => [...chosen].filter((id) => ['topo', 'imagery', 'terrain', 'hydro'].includes(id));
  const region = () => packs.map(([id]) => id).filter((id) => chosen.has(id));
  const estimate = () => {
    const selectedRaster = raster();
    const noBase = selectedRaster.length > 0 && !selectedRaster.includes('topo') && !selectedRaster.includes('imagery');
    const count = planArea(map, selectedRaster, zoom).length;
    root.querySelector('[data-download-estimate]')!.textContent = noBase ? 'Select USGS Topo or Satellite imagery to make a custom area viewable offline.' : `${count.toLocaleString()} area tiles${count > MAX_AREA_TILES ? ` — zoom in or lower detail (${MAX_AREA_TILES.toLocaleString()} tile limit).` : ` · size varies by layer · up to 160 MB per area.`}`;
    const b = map.getBounds();
    root.querySelector<HTMLElement>('[data-download-extent]')!.textContent = `View now: ${b.getSouth().toFixed(3)}°–${b.getNorth().toFixed(3)}° latitude · ${b.getWest().toFixed(3)}°–${b.getEast().toFixed(3)}° longitude · zoom ${map.getZoom().toFixed(1)}.`;
    start.disabled = busy || (!count && !region().length) || noBase || !navigator.onLine;
  };
  root.querySelectorAll<HTMLInputElement>('[data-download]').forEach((input) => input.onchange = () => { if (input.checked) chosen.add(input.dataset.download!); else chosen.delete(input.dataset.download!); estimate(); });
  root.querySelector<HTMLSelectElement>('[data-download-zoom]')!.onchange = (event) => { zoom = Number((event.target as HTMLSelectElement).value); estimate(); };
  for (const [id] of packs) {
    if (!packChecks.has(id)) packChecks.set(id, Promise.all([packStatus(id), remoteSize(id)]).then(([status, bytes]) => ({ status, bytes })));
    void packChecks.get(id)!.then(({ status, bytes }) => {
      if (!root.isConnected || busy) return;
      const input = root.querySelector<HTMLInputElement>(`[data-download="${id}"]`)!;
      const ready = status === 'Verified on device';
      input.disabled = ready || !bytes;
      if (input.disabled) chosen.delete(id);
      input.checked = chosen.has(id);
      root.querySelector(`[data-pack-status="${id}"]`)!.textContent = ready ? 'Verified on this device' : bytes ? `${size(bytes)} · available` : `${status} · download currently unavailable`;
      estimate();
    });
  }
  if (!navigator.onLine) message.textContent = 'Connect to download more map tiles or regional packs. Previously downloaded map areas and bundled catalog data remain available offline.';
  library.onclick = () => document.querySelector<HTMLButtonElement>('[data-tab="saved-maps"]')?.click();
  if (moveHandler) map.off('moveend', moveHandler);
  moveHandler = () => {
    if (!root.isConnected) { map.off('moveend', moveHandler!); return; }
    estimate();
  };
  map.on('moveend', moveHandler);
  estimate();
  start.onclick = async () => {
    const area = planArea(map, raster(), zoom);
    const selectedPacks = region();
    const selectedRaster = raster();
    const noBase = selectedRaster.length > 0 && !selectedRaster.includes('topo') && !selectedRaster.includes('imagery');
    if (busy || noBase || (!area.length && !selectedPacks.length)) return;
    if (area.length > MAX_AREA_TILES) return showAreaLimitDialog(area.length);
    const bounds = map.getBounds();
    const savedBounds: [number, number, number, number] = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const maxZoom = zoom;
    busy = true;
    const controller = new AbortController();
    const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')];
    const disabled = inputs.map((input) => input.disabled);
    inputs.forEach((input) => input.disabled = true);
    const destination = document.querySelector<HTMLInputElement>('#destination-select');
    if (destination) destination.disabled = true;
    start.disabled = true; cancel.hidden = false; progress.hidden = false;
    cancel.onclick = () => { controller.abort(); cancel.disabled = true; message.textContent = 'Stopping download…'; };
    let changed = false;
    const result: string[] = [];
    try {
      if (area.length) {
        const saved = await saveArea(area, (done, failed) => { progress.value = done / area.length; message.textContent = `Area: ${done.toLocaleString()} / ${area.length.toLocaleString()} tiles${failed ? ` · ${failed} failed` : ''}`; }, controller.signal);
        result.push(saved.cancelled ? 'Area download canceled; completed tiles kept.' : saved.budgetExceeded ? `Area download reached this device’s safe storage limit after saving ${size(saved.bytesAdded)}; zoom in or choose fewer map layers and retry.` : saved.failed || saved.missingAssets ? `Area incomplete: ${saved.failed} tiles and ${saved.missingAssets} label/icon files failed. Retry while connected.` : `${saved.done.toLocaleString()} area tiles saved.`);
        if (!saved.cancelled) recordAreaCoverage({ bounds: savedBounds, maxZoom, mapLayers: raster(), dataLayers: [], savedAt: new Date().toISOString(), complete: !saved.failed && !saved.missingAssets && !saved.budgetExceeded, tileCount: saved.done - saved.failed, failedTiles: saved.failed, bytesAdded: saved.bytesAdded });
      }
      for (const id of selectedPacks) {
        if (controller.signal.aborted) break;
        try {
          await saveToDevice(id, (done, total) => { progress.value = total ? done / total : 0; message.textContent = `${packs.find(([key]) => key === id)![1]}: ${size(done)}${total ? ` / ${size(total)}` : ''}`; }, controller.signal);
          changed = true; packChecks.delete(id);
          result.push(`${packs.find(([key]) => key === id)![1]} saved and verified.`);
        } catch (error) { result.push(controller.signal.aborted ? 'Pack download canceled.' : `${id}: ${(error as Error).message}`); }
      }
      if (changed && !controller.signal.aborted && await cacheGlyphs(controller.signal)) result.push('Some labels/icons could not be saved. Retry while connected.');
    } catch (error) { result.push(controller.signal.aborted ? 'Download canceled; completed data kept.' : `Download failed: ${(error as Error).message}`); }
    finally {
      busy = false; inputs.forEach((input, index) => input.disabled = disabled[index]);
      if (destination) destination.disabled = false;
      cancel.hidden = true; cancel.disabled = false; progress.hidden = true;
      message.textContent = result.join(' ') || 'Download canceled.';
      library.hidden = !result.length || !result.some((item) => /saved|kept/i.test(item));
      estimate();
      if (changed) onChanged();
    }
  };
}
