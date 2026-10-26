// Live USGS stream gauges & lake levels.
// Primary: USGS Water Data OGC API (api.waterdata.usgs.gov). Fallback: legacy NWIS IV
// (waterservices.usgs.gov, scheduled for retirement in early 2027).
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { AOI, PARAMS, USGS_API_KEY, USGS_LEGACY_IV, USGS_OGC } from '../config';
import { cachedLive, fetchJSON, sparkline, esc, ago } from '../util';

export type Reading = { code: string; value: number; time: string; unit?: string };
export type Gauge = { id: string; name: string; coords: [number, number]; readings: Record<string, Reading> };

const CODES = Object.keys(PARAMS);
const keyQS = USGS_API_KEY ? `&api_key=${encodeURIComponent(USGS_API_KEY)}` : '';
export let gauges: Gauge[] = [];

// Verified against USGS monitoring-location metadata; keep station IDs in the expanded record.
const LOCAL_NAMES: Record<string, string> = {
  '02339400': 'West Point Lake · near West Point',
  '02339402': 'Chattahoochee River · below West Point Dam',
};
export function gaugeName(g: Pick<Gauge, 'id' | 'name'>) {
  if (LOCAL_NAMES[g.id]) return LOCAL_NAMES[g.id];
  if (!g.name || /^\d+$/.test(g.name)) return 'Water monitoring station';
  return g.name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bNr\b/g, 'near').replace(/\bAbv\b/g, 'above').replace(/\bBlw\b/g, 'below')
    .replace(/\b(Ga|Al|Usgs)\b/g, (s) => s.toUpperCase());
}

async function fromOgc(): Promise<Gauge[]> {
  const bbox = AOI.join(',');
  const byId: Record<string, Gauge> = {};
  // One request per parameter keeps responses small and avoids relying on list-valued filters.
  await Promise.all(CODES.map(async (code) => {
    const url = `${USGS_OGC}/collections/latest-continuous/items?f=json&bbox=${bbox}&parameter_code=${code}&limit=5000${keyQS}`;
    const fc = await fetchJSON<any>(url, { timeout: 25000 });
    for (const f of fc.features ?? []) {
      const p = f.properties ?? {};
      const id = String(p.monitoring_location_id ?? '').replace(/^USGS-/, '');
      if (!id || !f.geometry) continue;
      const g = (byId[id] ??= { id, name: id, coords: f.geometry.coordinates, readings: {} });
      const v = Number(p.value);
      if (Number.isFinite(v)) g.readings[code] = { code, value: v, time: p.time, unit: p.unit_of_measure };
    }
  }));
  const ids = Object.keys(byId);
  if (!ids.length) throw new Error('OGC: no gauges');
  // Names
  try {
    const ml = await fetchJSON<any>(`${USGS_OGC}/collections/monitoring-locations/items?f=json&bbox=${bbox}&limit=10000&agency_code=USGS${keyQS}`, { timeout: 25000 });
    for (const f of ml.features ?? []) {
      const id = String(f.properties?.monitoring_location_number ?? f.id ?? '').replace(/^USGS-/, '');
      if (byId[id] && f.properties?.monitoring_location_name) byId[id].name = f.properties.monitoring_location_name;
    }
  } catch (e) {
    console.warn('monitoring-locations lookup failed', e);
  }
  return Object.values(byId);
}

async function fromLegacy(): Promise<Gauge[]> {
  const [w, s, e, n] = AOI;
  const url = `${USGS_LEGACY_IV}?format=json&bBox=${w},${s},${e},${n}&parameterCd=${CODES.join(',')}&siteStatus=active`;
  const j = await fetchJSON<any>(url, { timeout: 30000 });
  const byId: Record<string, Gauge> = {};
  for (const ts of j.value?.timeSeries ?? []) {
    const si = ts.sourceInfo;
    const id = si.siteCode[0].value;
    const gl = si.geoLocation.geogLocation;
    const g = (byId[id] ??= { id, name: si.siteName, coords: [gl.longitude, gl.latitude], readings: {} });
    const code = ts.variable.variableCode[0].value;
    const last = ts.values?.[0]?.value?.at(-1);
    const nd = ts.variable.noDataValue;
    if (last && Number(last.value) !== nd) g.readings[code] = { code, value: Number(last.value), time: last.dateTime, unit: ts.variable.unit?.unitCode };
  }
  return Object.values(byId);
}

function fmt(r: Reading) {
  const p = PARAMS[r.code];
  let v = r.value;
  if (r.code === '00010') v = v * 9 / 5 + 32; // USGS reports °C
  return `${v.toLocaleString(undefined, { maximumFractionDigits: p?.digits ?? 2 })} ${p?.unit ?? r.unit ?? ''}`;
}

function summary(g: Gauge) {
  const r = g.readings;
  const parts: string[] = [];
  if (r['00060']) parts.push(fmt(r['00060']));
  const elev = r['62614'] ?? r['62615'] ?? r['00062'];
  if (elev) parts.push(fmt(elev));
  else if (r['00065']) parts.push(fmt(r['00065']));
  if (r['00010']) parts.push(fmt(r['00010']));
  return parts.join(' · ');
}

export async function loadGauges(map: Map): Promise<{ count: number; t: number; offline: boolean; source: string }> {
  let source = 'USGS Water Data API';
  const res = await cachedLive('gauges-v2', 10 * 60_000, async () => {
    try {
      return await fromOgc();
    } catch (e) {
      console.warn('USGS OGC failed, trying legacy IV', e);
      source = 'USGS NWIS (legacy)';
      return await fromLegacy();
    }
  });
  gauges = res.v.map((g) => ({ ...g, name: gaugeName(g) }));
  const now = Date.now();
  (map.getSource('gauges') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: gauges.map((g) => {
      const times = Object.values(g.readings).map((r) => Date.parse(r.time)).filter(Number.isFinite);
      const newest = times.length ? Math.max(...times) : 0;
      return {
        type: 'Feature', id: g.id,
        geometry: { type: 'Point', coordinates: g.coords },
        properties: { id: g.id, name: g.name, summary: summary(g), stale: now - newest > 6 * 3600_000, ...(g.readings['00060'] ? { q: g.readings['00060'].value } : {}) },
      };
    }),
  });
  return { count: gauges.length, t: res.t, offline: res.offline, source };
}

async function history(id: string, code: string): Promise<number[]> {
  try {
    const url = `${USGS_OGC}/collections/continuous/items?f=json&monitoring_location_id=USGS-${id}&parameter_code=${code}&time=P2D&limit=1000&sortby=time${keyQS}`;
    const fc = await fetchJSON<any>(url, { timeout: 15000 });
    const vals = (fc.features ?? []).map((f: any) => [Date.parse(f.properties.time), Number(f.properties.value)] as const)
      .sort((a: any, b: any) => a[0] - b[0]).map((x: any) => x[1]);
    if (vals.length > 1) return vals;
  } catch { /* fall through */ }
  const j = await fetchJSON<any>(`${USGS_LEGACY_IV}?format=json&sites=${id}&parameterCd=${code}&period=P2D`, { timeout: 15000 });
  return (j.value?.timeSeries?.[0]?.values?.[0]?.value ?? []).map((v: any) => Number(v.value));
}

export function gaugeHtml(g: Gauge): string {
  const rows = Object.values(g.readings)
    .sort((a, b) => CODES.indexOf(a.code) - CODES.indexOf(b.code))
    .map((r) => `<tr><th>${esc(PARAMS[r.code]?.label ?? r.code)}</th><td>${esc(fmt(r))}</td><td class="muted">${esc(ago(r.time))}</td></tr>`)
    .join('');
  return `<h3>${esc(g.name)}</h3>
    <p class="muted">USGS ${esc(g.id)}</p>
    <table class="props">${rows || '<tr><td>No current readings</td></tr>'}</table>
    <div class="spark-wrap" data-gauge="${esc(g.id)}"><span class="muted">Loading 48-hour trend…</span></div>
    <p><a href="https://waterdata.usgs.gov/monitoring-location/USGS-${esc(g.id)}/" target="_blank" rel="noopener">Full record at USGS ↗</a></p>`;
}

export async function fillTrend(root: HTMLElement, g: Gauge) {
  const el = root.querySelector<HTMLElement>('.spark-wrap');
  if (!el) return;
  const code = g.readings['00060'] ? '00060' : g.readings['62614'] ? '62614' : g.readings['00065'] ? '00065' : Object.keys(g.readings)[0];
  if (!code) { el.innerHTML = ''; return; }
  try {
    const v = await history(g.id, code);
    el.innerHTML = `<div class="muted small">${esc(PARAMS[code]?.label)} – last 48 hours</div>${sparkline(v)}`;
  } catch {
    el.innerHTML = '<span class="muted small">Trend unavailable offline.</span>';
  }
}
