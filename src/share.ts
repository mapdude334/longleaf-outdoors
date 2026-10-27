import type { Map } from 'maplibre-gl';
import type { Trip } from './trips';
import type { Wpt } from './waypoints';
import { esc } from './util';

export type SharePayload =
  | { schema: 1; kind: 'trip'; trip: Trip }
  | { schema: 1; kind: 'spots'; spots: Pick<Wpt, 'name' | 'type' | 'lng' | 'lat' | 'notes'>[] };

const SHARE_KEY = 'share';
const MAX_SHARE_URL = 8000;
const appUrl = () => new URL(import.meta.env.BASE_URL, location.origin);

function encode(payload: SharePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value: string): SharePayload {
  if (!value || value.length > MAX_SHARE_URL) throw Error('This shared link is too large or incomplete. Ask for a fresh link.');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))); }
  catch { throw Error('This shared link could not be read. Ask for a fresh link.'); }
  const data = raw as any;
  const validPoint = (p: any) => p && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 120 && Number.isFinite(p.lng) && Number.isFinite(p.lat) && Math.abs(p.lng) <= 180 && Math.abs(p.lat) <= 85;
  if (data?.schema !== 1) throw Error('This shared link uses a version the app cannot open.');
  if (data.kind === 'spots' && Array.isArray(data.spots) && data.spots.length > 0 && data.spots.length <= 100 && data.spots.every((p: any) => validPoint(p) && typeof p.type === 'string' && p.type.length <= 30 && (p.notes === undefined || (typeof p.notes === 'string' && p.notes.length <= 2000)))) return data;
  if (data.kind === 'trip' && data.trip && typeof data.trip.name === 'string' && data.trip.name.trim() && data.trip.name.length <= 120 && typeof data.trip.destination === 'string' && data.trip.destination.length <= 100 && Array.isArray(data.trip.spots) && data.trip.spots.length <= 100 && data.trip.spots.every((p: any) => p && typeof p.name === 'string' && p.name.length <= 120 && Array.isArray(p.coords) && p.coords.length === 2 && p.coords.every(Number.isFinite) && Math.abs(p.coords[0]) <= 180 && Math.abs(p.coords[1]) <= 85) && typeof data.trip.notes === 'string' && data.trip.notes.length <= 10000 && (!data.trip.ramp || (typeof data.trip.ramp.name === 'string' && Array.isArray(data.trip.ramp.coords) && data.trip.ramp.coords.length === 2 && data.trip.ramp.coords.every(Number.isFinite) && Math.abs(data.trip.ramp.coords[0]) <= 180 && Math.abs(data.trip.ramp.coords[1]) <= 85))) return data;
  throw Error('This shared trip or spot data is incomplete or invalid. Nothing has been saved.');
}

export function makeShareUrl(payload: SharePayload): string {
  const url = appUrl();
  url.searchParams.set(SHARE_KEY, encode(payload));
  if (payload.kind === 'trip') {
    const [lng, lat] = payload.trip.view.center;
    url.hash = `map=${Math.max(3, Math.min(18, payload.trip.view.zoom)).toFixed(2)}/${lat.toFixed(5)}/${lng.toFixed(5)}`;
  } else {
    const xs = payload.spots.map((p) => p.lng); const ys = payload.spots.map((p) => p.lat);
    const lng = (Math.min(...xs) + Math.max(...xs)) / 2; const lat = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.004);
    const zoom = Math.max(6, Math.min(15, Math.floor(Math.log2(360 / span)) - 2));
    url.hash = `map=${zoom.toFixed(2)}/${lat.toFixed(5)}/${lng.toFixed(5)}`;
  }
  if (url.href.length > MAX_SHARE_URL) throw Error('This share link would be too long to send reliably. Shorten the notes or share fewer locations.');
  return url.href;
}

export function readIncomingShare(): SharePayload | undefined {
  const params = new URL(location.href).searchParams;
  if (!params.has(SHARE_KEY)) return undefined;
  return decode(params.get(SHARE_KEY)!);
}

export function clearIncomingShare() {
  const url = new URL(location.href);
  url.searchParams.delete(SHARE_KEY);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export function openShareDialog(title: string, text: string, url: string, includesLocations = false) {
  const dialog = document.createElement('dialog');
  dialog.className = 'share-dialog';
  dialog.setAttribute('aria-labelledby', 'share-title');
  dialog.innerHTML = `<h2 id="share-title">${esc(title)}</h2>
    <p>${esc(text)}</p>
    <label class="field">Share link<input type="url" readonly></label>
    ${includesLocations ? '<p class="callout warn small">The link carries exact map locations and any trip notes shown here. It is not private or encrypted; anyone with the link can view them. Avoid sharing sensitive spots.</p>' : ''}
    <div class="row-btns"><button class="btn primary" data-copy-link>Copy link</button><button class="btn" data-device-share>More sharing options</button></div>
    <p class="small muted" role="status" aria-live="polite" data-share-status></p>
    <button class="btn" data-close-share>Close</button>`;
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  input.value = url;
  const status = dialog.querySelector<HTMLElement>('[data-share-status]')!;
  dialog.querySelector<HTMLButtonElement>('[data-copy-link]')!.onclick = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      status.textContent = 'Share link copied to clipboard.';
    } catch {
      input.focus(); input.select();
      status.textContent = 'Automatic copying is unavailable. Copy the selected link above.';
    }
  };
  const deviceShare = dialog.querySelector<HTMLButtonElement>('[data-device-share]')!;
  deviceShare.hidden = typeof navigator.share !== 'function';
  deviceShare.onclick = async () => {
    try {
      await navigator.share({ title: 'Longleaf Atlas', text, url });
      status.textContent = 'Sharing options closed.';
    } catch (error) {
      status.textContent = (error as Error).name === 'AbortError' ? 'Sharing canceled. You can still copy the link.' : 'Device sharing is unavailable. Use Copy link instead.';
    }
  };
  dialog.querySelector<HTMLButtonElement>('[data-close-share]')!.onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

export function shareTrip(trip: Trip) {
  const url = makeShareUrl({ schema: 1, kind: 'trip', trip });
  openShareDialog(`Share “${trip.name}”`, 'Send this trip plan, including its destination, chosen launch, fishing pins, date and notes.', url, true);
}

export function shareSpots(spots: Wpt[]) {
  const url = makeShareUrl({ schema: 1, kind: 'spots', spots: spots.map(({ name, type, lng, lat, notes }) => ({ name, type, lng, lat, notes })) });
  openShareDialog(spots.length === 1 ? `Share “${spots[0].name}”` : `Share ${spots.length} saved locations`, 'Send these saved map pins to a friend so they can review and save them.', url, true);
}

export function addShareControl(map: Map) {
  const url = appUrl().href;
  let control: HTMLDivElement;
  map.addControl({
    onAdd() {
      control = document.createElement('div');
      control.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      const button = document.createElement('button');
      button.type = 'button'; button.title = 'Share Longleaf Atlas';
      button.setAttribute('aria-label', 'Share Longleaf Atlas');
      button.setAttribute('aria-haspopup', 'dialog');
      button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="display:block;margin:auto;fill:none;stroke:currentColor;stroke-width:1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>';
      button.onclick = () => openShareDialog('Share Longleaf Atlas', 'Send someone the app’s home link.', url);
      control.append(button);
      return control;
    },
    onRemove() { control.remove(); },
  }, 'top-right');
}
