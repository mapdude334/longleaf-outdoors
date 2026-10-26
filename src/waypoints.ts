// Waypoints and GPS tracks, stored on the device. GPX import/export for Garmin/Lowrance/Humminbird/onX.
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { esc, haversineKm, store, toast } from './util';

export type Wpt = { id: string; name: string; type: string; lng: number; lat: number; notes?: string; time: number };
export type Track = { id: string; name: string; pts: [number, number, number][]; time: number }; // lng, lat, epoch ms

export const WPT_TYPES: Record<string, { label: string; color: string }> = {
  fish: { label: 'Fish / structure', color: '#d81b60' },
  ramp: { label: 'Launch', color: '#1565c0' },
  hazard: { label: 'Hazard', color: '#e53935' },
  parking: { label: 'Parking', color: '#546e7a' },
  camp: { label: 'Camp', color: '#2e7d32' },
  other: { label: 'Other', color: '#6a1b9a' },
};

let wpts: Wpt[] = store.get<Wpt[]>('wpts')?.v ?? [];
let tracks: Track[] = store.get<Track[]>('tracks')?.v ?? [];
let recording: Track | null = null;
let watchId: number | null = null;
let mapRef: Map;

export const getWpts = () => wpts;
export const getTracks = () => tracks;
export const isRecording = () => !!recording;

function save() {
  store.set('wpts', wpts);
  store.set('tracks', tracks);
  render();
}

export function initWaypoints(map: Map) {
  mapRef = map;
  render();
}

function render() {
  if (!mapRef) return;
  (mapRef.getSource('waypoints') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: wpts.map((w) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [w.lng, w.lat] }, properties: { id: w.id, name: w.name, color: WPT_TYPES[w.type]?.color ?? '#6a1b9a' } })),
  });
  const all = [...tracks, ...(recording ? [recording] : [])];
  (mapRef.getSource('track') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: all.filter((t) => t.pts.length > 1).map((t) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: t.pts.map((p) => [p[0], p[1]]) }, properties: { id: t.id, name: t.name } })),
  });
  document.dispatchEvent(new CustomEvent('vw:mine-changed'));
}

export function addWpt(lng: number, lat: number, name?: string, type = 'fish', notes = '') {
  const w: Wpt = { id: crypto.randomUUID(), name: name || `WP ${wpts.length + 1}`, type, lng, lat, notes, time: Date.now() };
  wpts.push(w);
  save();
  return w;
}
export function updateWpt(id: string, patch: Partial<Wpt>) {
  wpts = wpts.map((w) => (w.id === id ? { ...w, ...patch } : w));
  save();
}
export function deleteWpt(id: string) {
  wpts = wpts.filter((w) => w.id !== id);
  save();
}
export function deleteTrack(id: string) {
  tracks = tracks.filter((t) => t.id !== id);
  save();
}

export function trackKm(t: Track) {
  let d = 0;
  for (let i = 1; i < t.pts.length; i++) d += haversineKm([t.pts[i - 1][0], t.pts[i - 1][1]], [t.pts[i][0], t.pts[i][1]]);
  return d;
}

export function toggleRecording(): boolean {
  if (recording) {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (recording.pts.length > 1) tracks.push(recording);
    toast(recording.pts.length > 1 ? `Saved track (${(trackKm(recording) * 0.621).toFixed(2)} mi)` : 'Track too short — discarded');
    recording = null;
    save();
    return false;
  }
  if (!('geolocation' in navigator)) { toast('GPS not available on this device'); return false; }
  recording = { id: crypto.randomUUID(), name: `Track ${new Date().toLocaleString()}`, pts: [], time: Date.now() };
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!recording) return;
      const p: [number, number, number] = [pos.coords.longitude, pos.coords.latitude, pos.timestamp];
      const last = recording.pts.at(-1);
      // ignore jitter < 5 m and poor fixes
      if (pos.coords.accuracy > 50) return;
      if (!last || haversineKm([last[0], last[1]], [p[0], p[1]]) > 0.005) {
        recording.pts.push(p);
        render();
      }
    },
    (err) => toast('GPS: ' + err.message),
    { enableHighAccuracy: true, maximumAge: 2000 },
  );
  toast('Recording track — keep the app open');
  return true;
}

// ---------- GPX ----------
export function exportGpx(): string {
  const x = (s: string) => esc(s);
  const w = wpts.map((p) => `<wpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.time).toISOString()}</time><name>${x(p.name)}</name>${p.notes ? `<desc>${x(p.notes)}</desc>` : ''}<type>${x(p.type)}</type></wpt>`).join('\n');
  const t = tracks.map((tr) => `<trk><name>${x(tr.name)}</name><trkseg>${tr.pts.map((p) => `<trkpt lat="${p[1]}" lon="${p[0]}"><time>${new Date(p[2]).toISOString()}</time></trkpt>`).join('')}</trkseg></trk>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Longleaf Outdoors" xmlns="http://www.topografix.com/GPX/1/1">\n${w}\n${t}\n</gpx>`;
}

export function downloadGpx() {
  const blob = new Blob([exportGpx()], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `longleaf-outdoors-${new Date().toISOString().slice(0, 10)}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function importGpx(file: File) {
  const doc = new DOMParser().parseFromString(await file.text(), 'application/xml');
  let nw = 0, nt = 0;
  doc.querySelectorAll('wpt').forEach((el) => {
    const lat = Number(el.getAttribute('lat'));
    const lng = Number(el.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const type = el.querySelector('type')?.textContent ?? 'other';
    wpts.push({ id: crypto.randomUUID(), name: el.querySelector('name')?.textContent ?? 'Imported', type: WPT_TYPES[type] ? type : 'other', lng, lat, notes: el.querySelector('desc')?.textContent ?? '', time: Date.now() });
    nw++;
  });
  doc.querySelectorAll('trk').forEach((trk) => {
    const pts: [number, number, number][] = [];
    trk.querySelectorAll('trkpt').forEach((p) => pts.push([Number(p.getAttribute('lon')), Number(p.getAttribute('lat')), Date.parse(p.querySelector('time')?.textContent ?? '') || Date.now()]));
    if (pts.length > 1) { tracks.push({ id: crypto.randomUUID(), name: trk.querySelector('name')?.textContent ?? file.name, pts, time: Date.now() }); nt++; }
  });
  save();
  toast(`Imported ${nw} waypoints, ${nt} tracks`);
}
