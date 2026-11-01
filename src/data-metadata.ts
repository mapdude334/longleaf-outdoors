import { esc } from './util';
import { placeTitleCase, waterById, waterDisplayName } from './layers/waters';

export function sourceMetadata(p: Record<string, any>) {
  const date = (value: unknown) => {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  };
  const source = String(p.data_source || 'Source not specified');
  const countyLabel = (value: unknown) => {
    const county = String(value || '').trim();
    if (!county || /^[A-Z]{2}$/i.test(county)) return '';
    return /\bcounty$/i.test(county) ? placeTitleCase(county) : `${placeTitleCase(county)} County`;
  };
  const mappedCounty = countyLabel(p.point_county);
  const mappedState = String(p.point_state || '').trim();
  const mappedArea = [mappedCounty, mappedState].filter(Boolean).join(', ')
    || 'No point-in-boundary match available';
  const sourceCounty = countyLabel(p.county);
  const sourceState = String(p.state || '').trim();
  const sourceArea = [sourceCounty, sourceState].filter(Boolean).join(', ')
    || 'Source location label not supplied';
  const stateMismatch = mappedState && sourceState && mappedState.toUpperCase() !== sourceState.toUpperCase();
  const water = p.waterbody_id ? waterById(String(p.waterbody_id)) : undefined;
  const sourceWater = String(p.waterbody || '').trim();
  const waterContext = water
    ? `<button class="link data-provenance-water" data-open-water="${esc(water.id)}">${esc(waterDisplayName(water))} destination ↗</button>`
    : sourceWater
      ? `<span>${esc(placeTitleCase(sourceWater))} · source water label; no destination match</span>`
      : p.waterbody_id
        ? '<span>Water link is not available in the current destination catalog.</span>'
        : '<span>No waterbody match is recorded.</span>';
  const sourceDate = p.source_updated ? esc(date(p.source_updated)) : 'Date not supplied by source';
  const retrievedDate = p.retrieved_at ? esc(date(p.retrieved_at)) : 'Retrieval date not supplied';
  const sourceLink = p.source_url
    ? `<a href="${esc(p.source_url)}" target="_blank" rel="noopener">Open source ↗</a>`
    : p.osm
      ? `<a href="https://www.openstreetmap.org/${esc(p.osm)}" target="_blank" rel="noopener">OpenStreetMap record ↗</a>`
      : '<span>Source record link not supplied</span>';
  return `<details class="data-provenance"><summary>Data source &amp; location details</summary>
    <dl>
      <div><dt>Source</dt><dd>${esc(source)}</dd></div>
      <div><dt>Mapped area</dt><dd>${esc(mappedArea)}</dd></div>
      <div><dt>Source location</dt><dd>${esc(sourceArea)}${stateMismatch ? ' · source state differs from mapped state' : ''}</dd></div>
      <div><dt>Associated water</dt><dd>${waterContext}</dd></div>
      <div><dt>Source updated</dt><dd>${sourceDate}</dd></div>
      <div><dt>Catalog retrieved</dt><dd>${retrievedDate}</dd></div>
      <div><dt>Reference</dt><dd>${sourceLink}</dd></div>
    </dl>
  </details>`;
}

export function addPointToTrip(p: Record<string, any>, coords?: [number, number]) {
  if (!coords) return '';
  return `<button class="btn primary" data-use-spot data-launch-id="${esc(p.record_id || coords.join(','))}" data-launch-name="${esc(p.name || 'Agency-mapped fishing location')}" data-launch-lng="${coords[0]}" data-launch-lat="${coords[1]}">Add fishing spot to trip</button>`;
}
