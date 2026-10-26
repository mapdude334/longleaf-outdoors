import type { GeoJSONSource, Map } from 'maplibre-gl';
import { esc, fetchJSON, store } from '../util';

export type Water = {
  id: string; name: string; gnis_names?: string[]; state: string; river?: string; type: string; acres?: number;
  manager?: string; center: [number, number] | null; species: { name: string }[]; notes?: string;
  links: { label: string; url: string }[];
  location_note?: string;
};
export let waters: Water[] = [];
export let regulations: { label: string; url: string }[] = [];

const norm = (s: string) => s.toLowerCase().replace(/\blake\b|\breservoir\b/g, '').replace(/[^a-z]/g, '');
const byName: Record<string, Water> = {};

export async function loadWaters(map: Map) {
  const j = await fetchJSON<{ waters: Water[]; regulations: typeof regulations }>(`${import.meta.env.BASE_URL}data/waters.json`);
  waters = j.waters;
  const previous = store.get<string>('destination')?.v;
  if (previous === 'al-pfl') store.set('destination', 'lee-county-lake');
  if (previous === 'ga-pfa') store.set('destination', 'big-lazer-creek');
  regulations = j.regulations;
  for (const w of waters) for (const n of [w.name, ...(w.gnis_names ?? [])]) byName[norm(n)] = w;
  (map.getSource('waters') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: waters.filter((w) => w.center).map((w) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: w.center! }, properties: { id: w.id, name: w.name.replace(/\s*\(.*\)/, '') } })),
  });
}

export const waterById = (id: string) => waters.find((w) => w.id === id);
export const waterByName = (n?: string) => (n ? byName[norm(n)] : undefined);

export function waterHtml(w: Water, nhd?: Record<string, unknown>): string {
  const acres = w.acres ? `${w.acres.toLocaleString()} acres · ` : '';
  return `<h3>${esc(w.name)}</h3>
  <p class="muted">${acres}${esc(w.river ? w.river + ' basin · ' : '')}${esc(w.state)}${w.manager ? ' · ' + esc(w.manager) : ''}</p>
  ${w.location_note ? `<p class="muted small">${esc(w.location_note)}</p>` : ''}
  <h4>Species</h4>
  <div class="chips">${w.species.map((s) => `<button class="chip species-chip" data-species="${esc(s.name)}" aria-label="Learn about ${esc(s.name)}">${esc(s.name)} ↗</button>`).join('')}</div>
  ${w.notes ? `<p>${esc(w.notes)}</p>` : ''}
  ${w.links.length ? `<ul class="links">${w.links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join('')}</ul>` : ''}
  ${nhd?.areasqkm ? `<p class="muted small">NHD feature: ${esc(nhd.gnis_name ?? '')} · ${(Number(nhd.areasqkm) * 247.105).toFixed(0)} acres mapped</p>` : ''}
  <p class="muted small">Species lists are general — check current regulations, limits and consumption advisories.</p>
  <ul class="links">${regulations.slice(0, 4).map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join('')}</ul>`;
}
