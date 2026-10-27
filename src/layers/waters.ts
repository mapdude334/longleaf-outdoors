import type { GeoJSONSource, Map } from 'maplibre-gl';
import { esc, fetchJSON, haversineKm, store } from '../util';

export type Water = {
  id: string; name: string; gnis_names?: string[]; state: string; river?: string; type: string; acres?: number;
  manager?: string; center: [number, number] | null; species: { name: string }[]; notes?: string;
  links: { label: string; url: string }[];
  location_note?: string;
  bounds?: [[number, number], [number, number]];
  catalog_sources?: { label: string; url: string; source_updated?: string | null }[];
  retrieved_at?: string;
  species_note?: string;
  location_label?: string;
  county?: string;
};
export let waters: Water[] = [];
export let regulations: { label: string; url: string }[] = [];

const norm = (s: string) => s.toLowerCase().replace(/\blake\b|\breservoir\b/g, '').replace(/[^a-z]/g, '');
const byName: Record<string, Water[]> = {};

export async function loadWaters(map: Map) {
  const j = await fetchJSON<{ waters: Water[]; regulations: typeof regulations }>(`${import.meta.env.BASE_URL}data/waters.json`);
  waters = j.waters;
  const previous = store.get<string>('destination')?.v;
  if (previous === 'al-pfl') store.set('destination', 'lee-county-lake');
  if (previous === 'ga-pfa') store.set('destination', 'big-lazer-creek');
  regulations = j.regulations;
  for (const name of Object.keys(byName)) delete byName[name];
  for (const w of waters) for (const n of [w.name, ...(w.gnis_names ?? [])]) {
    const candidates = byName[norm(n)] ??= [];
    if (!candidates.includes(w)) candidates.push(w);
  }
  (map.getSource('waters') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: waters.filter((w) => w.center).map((w) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: w.center! }, properties: { id: w.id, name: w.name.replace(/\s*\(.*\)/, ''), priority: w.id.startsWith('water-') ? 1 : 0 } })),
  });
}

export const waterById = (id: string) => waters.find((w) => w.id === id);
export const waterByName = (n?: string, at?: [number, number]) => {
  const candidates = n ? byName[norm(n)] ?? [] : [];
  return at ? [...candidates].sort((a, b) => (a.center ? haversineKm(a.center, at) : Infinity) - (b.center ? haversineKm(b.center, at) : Infinity))[0] : candidates[0];
};

/** Build a consistent user-facing destination label without repeating state codes. */
export function waterCountyLabel(w: Pick<Water, 'county' | 'location_label' | 'state'>): string {
  const stateCodes = new Set(w.state.split(/[\/,]/).map((part) => part.trim().toUpperCase()).filter(Boolean));
  const raw = (w.county ?? w.location_label ?? '').trim();
  if (!raw) return '';

  // Catalog location labels may include a state suffix, or may only repeat the
  // state (for example "AL" or "GA/AL"). Keep only an actual county label.
  const county = raw.split(',')[0].trim();
  const codes = raw.split(/[\/,]/).map((part) => part.trim().toUpperCase()).filter(Boolean);
  if (!county || codes.length && codes.every((code) => stateCodes.has(code))) return '';
  if (/^[A-Z]{2}(\s*\/\s*[A-Z]{2})*$/.test(county)) return '';
  return placeTitleCase(county);
}

const PLACE_ACRONYMS = new Set(['ALT', 'BSF', 'CAT', 'CCA', 'CDH', 'DRH', 'DUA', 'HLHA', 'ICW', 'JL', 'KBY', 'KTK', 'MRY', 'NHD', 'PFA', 'SFC', 'USGS', 'WMA']);

/** Normalize catalog place names while keeping acronyms and state codes readable. */
export function placeTitleCase(value: string): string {
  return value.replace(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu, (word) => {
    if (PLACE_ACRONYMS.has(word.toLocaleUpperCase())) return word.toLocaleUpperCase();
    if (word.length > 1 && word[0] === word[0].toLocaleUpperCase() && word.slice(1) !== word.slice(1).toLocaleLowerCase()) return word;
    const lower = word.toLocaleLowerCase();
    if (/^mc[\p{L}]/u.test(lower)) return `Mc${lower[2].toLocaleUpperCase()}${lower.slice(3)}`;
    if (/^dekalb$/i.test(lower)) return 'DeKalb';
    return word.split(/(['’])/).map((part) => part === "'" || part === '’' ? part : part ? part[0].toLocaleUpperCase() + part.slice(1).toLocaleLowerCase() : part).join('');
  });
}

export function waterDisplayName(w: Pick<Water, 'name'>): string {
  return placeTitleCase(w.name);
}

export function waterDisplayLabel(w: Pick<Water, 'name' | 'county' | 'location_label' | 'state'>): string {
  return `${waterDisplayName(w)} · ${waterAdministrativeLabel(w)}`;
}

export function waterAdministrativeLabel(w: Pick<Water, 'county' | 'location_label' | 'state'>): string {
  const county = waterCountyLabel(w);
  return `${county ? `${county} · ` : ''}${w.state}`;
}

export function waterHtml(w: Water, nhd?: Record<string, unknown>): string {
  const acres = w.acres ? `${w.acres.toLocaleString()} acres · ` : '';
  const location = waterAdministrativeLabel(w);
  return `<h3>${esc(waterDisplayName(w))}</h3>
  <p class="muted">${acres}${esc(w.river ? w.river + ' basin · ' : '')}${esc(location)}${w.manager ? ' · ' + esc(w.manager) : ''}</p>
  ${w.location_note ? `<p class="muted small">${esc(w.location_note)}</p>` : ''}
  <h4>Species</h4>
  <div class="chips">${w.species.map((s) => `<button class="chip species-chip" data-species="${esc(s.name)}" aria-label="Learn about ${esc(s.name)}">${esc(s.name)} ↗</button>`).join('')}</div>
  ${w.notes ? `<p>${esc(w.notes)}</p>` : ''}
  ${w.species_note ? `<p class="muted small">${esc(w.species_note)}</p>` : ''}
  ${!w.species.length ? '<p class="muted small">Species information has not been verified for this source record.</p>' : ''}
  ${w.links.length || w.catalog_sources?.length ? `<ul class="links">${[...w.links, ...(w.catalog_sources ?? [])].filter((link, index, links) => links.findIndex((item) => item.url === link.url) === index).map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join('')}</ul>` : ''}
  ${w.retrieved_at ? `<p class="muted small">Catalog retrieved ${esc(new Date(w.retrieved_at).toLocaleDateString())}. Overview points and point extents are not surveyed water boundaries.</p>` : ''}
  ${w.catalog_sources?.map((source) => `<p class="muted small">${esc(source.label)} · Source layer edition ${source.source_updated ? esc(new Date(source.source_updated).toLocaleDateString()) : 'not supplied'}</p>`).join('') ?? ''}
  ${nhd?.areasqkm ? `<p class="muted small">NHD feature: ${esc(nhd.gnis_name ?? '')} · ${(Number(nhd.areasqkm) * 247.105).toFixed(0)} acres mapped</p>` : ''}
  <p class="muted small">Species lists are general — check current regulations, limits and consumption advisories.</p>
  <ul class="links">${regulations.slice(0, 4).map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join('')}</ul>`;
}
