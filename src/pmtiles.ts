// PMTiles loading: prefer a copy saved on the device (OPFS or Cache Storage) so the
// map works with zero signal; otherwise stream from TILE_BASE with HTTP range requests.
import { addProtocol } from 'maplibre-gl';
import { FileSource, PMTiles, Protocol } from 'pmtiles';
import { PMTILES, TILE_BASE, type PmKey } from './config';

export const protocol = new Protocol({ metadata: true });
addProtocol('pmtiles', protocol.tile);

const CACHE_NAME = 'vw-pmtiles';
export const remoteUrl = (k: PmKey) => new URL(TILE_BASE + PMTILES[k], location.href).href;

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
  try {
    const r = await fetch(remoteUrl(k), { method: 'HEAD' });
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return null; // SPA fallback page
    const n = Number(r.headers.get('content-length'));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Download a whole archive to the device with progress. Requests persistent storage first. */
export async function saveToDevice(k: PmKey, onProgress: (done: number, total: number | null) => void, signal?: AbortSignal) {
  try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  const res = await fetch(remoteUrl(k), { signal, cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || null;
  let done = 0;
  const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) { done += chunk.byteLength; onProgress(done, total); ctl.enqueue(chunk); },
  }));
  const dir = await opfsDir();
  if (dir) {
    try {
      const fh = await dir.getFileHandle(PMTILES[k], { create: true });
      const w = await (fh as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
      try {
        await counted.pipeTo(w); // closes the writable on success → atomic swap-in
      } catch (e) {
        await dir.removeEntry(PMTILES[k]).catch(() => {});
        throw e;
      }
      return;
    } catch (e) {
      console.warn('OPFS write failed, falling back to Cache Storage', e);
      if (signal?.aborted || done > 0) throw e; // stream already consumed
    }
  }
  // Fallback (older Safari): buffer through Cache Storage
  const blob = await new Response(counted).blob();
  await (await caches.open(CACHE_NAME)).put(PMTILES[k], new Response(blob));
}

export async function removeFromDevice(k: PmKey) {
  const dir = await opfsDir();
  try { await dir?.removeEntry(PMTILES[k]); } catch { /* none */ }
  try { await (await caches.open(CACHE_NAME)).delete(PMTILES[k]); } catch { /* none */ }
}
