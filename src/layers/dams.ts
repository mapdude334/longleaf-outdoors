// Dams: curated release-info sources + nearby live USGS gauges + (for Corps dams) USACE CWMS data.
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { CWMS } from '../config';
import { cachedLive, esc, fetchJSON, haversineKm, sparkline, ago } from '../util';
import { gauges, gaugeHtml } from './gauges';
import { recentObservation } from '../observation-age';

export type Dam = {
  id: string; name: string; river: string; lake?: string; operator: string; coords: [number, number];
  usgs_radius_km?: number; cwms?: { office: string; like: string; station?: string }; links: { label: string; url: string }[];
  observationStatus?: 'recent' | 'unknown';
};
export let dams: Dam[] = [];

async function latestDamObservation(d: Dam): Promise<number | null> {
  if (!d.cwms?.station) return null;
  try {
    const cwms = d.cwms;
    const result = await cachedLive<number | null>(`dam-observation-${d.id}-v1`, 6 * 3600_000, async () => {
      const cat = await fetchJSON<any>(`${CWMS}/catalog/TIMESERIES?office=${cwms.office}&like=${encodeURIComponent(cwms.like)}&page-size=200`, { headers: { Accept: 'application/json;version=2' }, timeout: 15000 });
      if (!Array.isArray(cat.entries) || (typeof cat.total === 'number' && cat.total > cat.entries.length)) throw new Error('Incomplete Corps catalog');
      const now = Date.now();
      const times = cat.entries.filter((entry: any) => {
        const name = String(entry.name ?? '');
        return (name.startsWith(`${cwms.station}.`) || name.startsWith(`${cwms.station}-`))
          && /\.(Elev|Flow|Power|Energy)(?:[-.]|$)/i.test(name) && /\.Raw(?:-|$)/i.test(name);
      }).flatMap((entry: any) => Array.isArray(entry.extents) ? entry.extents : [])
        .map((extent: any) => Date.parse(extent['latest-time']))
        .filter((time: number) => Number.isFinite(time) && time <= now);
      return times.length ? Math.max(...times) : null;
    });
    return result.v;
  } catch {
    return null;
  }
}

export async function loadDams(map: Map) {
  const j = await fetchJSON<{ dams: Dam[] }>(`${import.meta.env.BASE_URL}data/dams.json`);
  // Keep markers available while the dated-source lookup is pending.
  dams = j.dams.map((d) => ({ ...d, observationStatus: 'unknown' }));
  (map.getSource('dams') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: dams.map((d) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: d.coords }, properties: { id: d.id, name: d.name } })),
  });
  const latest = await Promise.all(j.dams.map(latestDamObservation));
  const now = Date.now();
  dams = j.dams.flatMap((d, index) => {
    const time = latest[index];
    if (time !== null && !recentObservation(time, now)) return [];
    return [{ ...d, observationStatus: time === null ? 'unknown' as const : 'recent' as const }];
  });
}

export function damHtml(d: Dam): string {
  const near = gauges
    .map((g) => ({ g, km: haversineKm(d.coords, g.coords) }))
    .filter((x) => x.km <= (d.usgs_radius_km ?? 10))
    .sort((a, b) => a.km - b.km)
    .slice(0, 4);
  return `<h3>${esc(d.name)}</h3>
  <p class="muted">${esc(d.river)} River · ${esc(d.operator)}</p>
  ${d.observationStatus === 'unknown' ? '<p class="muted small">A recent observation date is not available for this dam. Check the official sources below for current conditions.</p>' : ''}
  <div class="callout warn">Water levels below dams can rise several feet in minutes when generation starts. Check the schedule before wading or anchoring in tailwaters.</div>
  <h4>Release / generation schedule</h4>
  <ul class="links">${d.links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join('')}</ul>
  ${d.cwms ? `<h4>USACE live data</h4><div class="cwms" data-dam="${esc(d.id)}"><span class="muted">Loading Corps data…</span></div>` : ''}
  <h4>Nearby USGS gauges</h4>
  ${near.length ? near.map(({ g, km }) => `<details><summary>${esc(g.name)} <span class="muted">(${km.toFixed(1)} km)</span></summary>${gaugeHtml(g)}</details>`).join('') : '<p class="muted">No live gauges within range (or gauges not loaded yet).</p>'}
  <p class="muted small">Approximate dam location; precise dam features come from the offline overlays.</p>`;
}

/** Best-effort USACE CWMS Data API lookup: find elevation/flow/power series by name pattern. */
export async function fillCwms(root: HTMLElement, d: Dam) {
  const el = root.querySelector<HTMLElement>('.cwms');
  if (!el || !d.cwms) return;
  const hdr = { headers: { Accept: 'application/json;version=2' }, timeout: 15000 };
  try {
    const cat = await fetchJSON<any>(`${CWMS}/catalog/TIMESERIES?office=${d.cwms.office}&like=${encodeURIComponent(d.cwms.like)}&page-size=200`, hdr);
    const names: string[] = (cat.entries ?? []).map((e: any) => e.name);
    const pick = (re: RegExp) => names.find((n) => re.test(n));
    const wanted = [
      ['Lake elevation', pick(/\.Elev(\.|-Forebay|-Pool).*Inst/i) ?? pick(/\.Elev\b/i)],
      ['Outflow', pick(/\.Flow-(Out|Total|Release).*/i) ?? pick(/\.Flow\b/i)],
      ['Generation', pick(/\.(Power|Energy)/i)],
    ].filter(([, n]) => n) as [string, string][];
    if (!wanted.length) throw new Error('no series');
    const end = new Date();
    const begin = new Date(end.getTime() - 48 * 3600_000);
    const parts = await Promise.all(wanted.map(async ([label, name]) => {
      const ts = await fetchJSON<any>(`${CWMS}/timeseries?office=${d.cwms!.office}&name=${encodeURIComponent(name)}&begin=${begin.toISOString()}&end=${end.toISOString()}`, hdr);
      const vals: [number, number][] = (ts.values ?? []).filter((v: any) => v[1] != null);
      const last = vals.at(-1);
      return last ? `<div><strong>${esc(label)}:</strong> ${last[1].toLocaleString(undefined, { maximumFractionDigits: 2 })} ${esc(ts.units ?? '')} <span class="muted">${esc(ago(last[0]))}</span>${sparkline(vals.map((v) => v[1]), 220, 32)}</div>` : '';
    }));
    el.innerHTML = parts.join('') || '<span class="muted">No recent values.</span>';
  } catch {
    el.innerHTML = '<span class="muted small">Corps data not available right now — use the links above.</span>';
  }
}
