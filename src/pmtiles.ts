// PMTiles loading: prefer a copy saved on the device (OPFS or Cache Storage) so the
// map works with zero signal; otherwise stream from TILE_BASE with HTTP range requests.
import { addProtocol } from 'maplibre-gl';
import { FileSource, PMTiles, Protocol } from 'pmtiles';
import { PMTILES, TILE_BASE, type PmKey } from './config';
import { fetchJSON, store } from './util';

export const protocol = new Protocol({ metadata: true });
addProtocol('pmtiles', protocol.tile);

const CACHE_NAME = 'vw-pmtiles';
export const remoteUrl = (k: PmKey) => new URL(TILE_BASE + PMTILES[k], location.href).href;
export type PackManifest = { schema: number; region: string; bounds: [number, number, number, number]; builtAt: string; parcelCoverage: string[]; packs: Record<PmKey, { bytes: number; maxZoom: number; sha256: string }> };
let manifestRequest: Promise<PackManifest | null> | undefined;
let manifestExpires = 0;
export function loadPackManifest(): Promise<PackManifest | null> {
  if (!manifestRequest || Date.now() >= manifestExpires) { manifestExpires = Date.now() + 60_000; manifestRequest = fetchPackManifest(); }
  return manifestRequest;
}
async function fetchPackManifest(): Promise<PackManifest | null> {
  if (navigator.onLine) {
    try {
      const manifest = await fetchJSON<PackManifest>(new URL(TILE_BASE + 'manifest.json', location.href).href, { timeout: 8000, cache: 'no-store' });
      if (manifest.schema !== 1 || !manifest.region || !manifest.packs?.basemap?.bytes) throw new Error('Invalid pack manifest');
      store.set('pack-manifest', manifest);
      return manifest;
    } catch { /* Keep the last published coverage summary available offline. */ }
  }
  return store.get<PackManifest>('pack-manifest')?.v ?? null;
}

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

/** Returns a File for an archive previously saved on this device, if any. */
export async function localFile(k: PmKey): Promise<File | null> {
  const name = PMTILES[k];
  const dir = await opfsDir();
  if (dir) {
    try {
      const fh = await dir.getFileHandle(name);
      const f = await fh.getFile();
      if (f.size > 0) return f;
    } catch { /* not saved */ }
  }
  try {
    const res = await (await caches.open(CACHE_NAME)).match(name);
    if (res) return new File([await res.blob()], name);
  } catch { /* no cache api */ }
  return null;
}

export type Resolved = { url: string; where: 'device' | 'remote'; header?: Awaited<ReturnType<PMTiles['getHeader']>> };

/** Resolve a pmtiles:// URL for MapLibre, or null if the archive is unavailable. */
export async function resolvePm(k: PmKey): Promise<Resolved | null> {
  const f = await localFile(k);
  if (f) {
    const p = new PMTiles(new FileSource(f));
    try {
      const header = await p.getHeader();
      protocol.add(p);
      return { url: `pmtiles://${f.name}`, where: 'device', header };
    } catch (e) {
      console.warn('Saved archive unreadable', k, e);
    }
  }
  if (!navigator.onLine) return null;
  const url = remoteUrl(k);
  const p = new PMTiles(url);
  try {
    const header = await Promise.race([
      p.getHeader(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    protocol.add(p);
    return { url: `pmtiles://${url}`, where: 'remote', header };
  } catch {
    return null;
  }
}

export async function remoteSize(k: PmKey): Promise<number | null> {
  if (!navigator.onLine) return null;
  try {
    const r = await fetch(remoteUrl(k), { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return null; // SPA fallback page
    const manifest = await loadPackManifest();
    const n = manifest?.packs[k]?.bytes ?? Number(r.headers.get('content-length'));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function validateArchive(file: File) {
  const p = new PMTiles(new FileSource(file));
  const h = await p.getHeader();
  if (h.rootDirectoryLength <= 0 || !h.tileDataLength) throw new Error('Map archive contains no tiles');
  for (const [offset, length] of [[h.rootDirectoryOffset, h.rootDirectoryLength], [h.jsonMetadataOffset, h.jsonMetadataLength], [h.leafDirectoryOffset, h.leafDirectoryLength], [h.tileDataOffset, h.tileDataLength]]) {
    if (offset === undefined || length === undefined || offset < 0 || length < 0 || offset + length > file.size) throw new Error('Incomplete map archive');
  }
  await p.getMetadata();
  // Traverse the directory as well as the header; metadata alone can be intact in a damaged archive.
  await p.getZxy(h.minZoom, 0, 0);
  return h;
}

export async function packStatus(k: PmKey) {
  const file = await localFile(k);
  if (!file) return 'Not downloaded';
  try { await validateArchive(file); return 'Verified on device'; }
  catch { return 'Unreadable — remove and download again'; }
}

/** Download a whole archive to the device with progress. Requests persistent storage first. */
export async function saveToDevice(k: PmKey, onProgress: (done: number, total: number | null) => void, signal?: AbortSignal) {
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  const manifest = await loadPackManifest();
  const download = new URL(remoteUrl(k));
  if (manifest?.packs[k]?.sha256) download.searchParams.set('edition', manifest.packs[k].sha256);
  const res = await fetch(download.href, { signal, cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new Error('Server returned a webpage instead of a map');
  // Fetch yields decoded bytes. A gzip/br Content-Length describes transferred
  // bytes, so compare against the canonical archive size from the manifest.
  const encoded = res.headers.get('content-encoding');
  const total = manifest?.packs[k]?.bytes ?? ((!encoded || encoded === 'identity') ? Number(res.headers.get('content-length')) || null : null);
  let done = 0;
  const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) { done += chunk.byteLength; onProgress(done, total); ctl.enqueue(chunk); },
  }));
  const dir = await opfsDir();
  if (dir) {
    try {
      const pending = PMTILES[k] + '.pending';
      const fh = await dir.getFileHandle(pending, { create: true });
      const w = await (fh as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
      try {
        await counted.pipeTo(w);
        const file = await fh.getFile();
        if (total && file.size !== total) throw new Error('Download size mismatch');
        await validateArchive(file);
        signal?.throwIfAborted();
        const target = await dir.getFileHandle(PMTILES[k], { create: true });
        const out = await target.createWritable();
        await file.stream().pipeTo(out);
      } catch (e) {
        throw e;
      } finally {
        await dir.removeEntry(pending).catch(() => {});
      }
      return;
    } catch (e) {
      console.warn('OPFS write failed, falling back to Cache Storage', e);
      if (signal?.aborted || done > 0) throw e; // stream already consumed
    }
  }
  // Fallback (older Safari): buffer through Cache Storage
  const blob = await new Response(counted).blob();
  if (total && blob.size !== total) throw new Error('Download size mismatch');
  await validateArchive(new File([blob], PMTILES[k]));
  signal?.throwIfAborted();
  await (await caches.open(CACHE_NAME)).put(PMTILES[k], new Response(blob));
}

export async function removeFromDevice(k: PmKey) {
  const dir = await opfsDir();
  try { await dir?.removeEntry(PMTILES[k]); } catch { /* none */ }
  try { await (await caches.open(CACHE_NAME)).delete(PMTILES[k]); } catch { /* none */ }
}
