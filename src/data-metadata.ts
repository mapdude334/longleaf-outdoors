import { esc } from './util';

export function sourceMetadata(p: Record<string, any>) {
  const date = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  };
  return `<p class="muted small">${esc(p.data_source || 'Source not specified')}${p.source_updated ? ` · Source layer updated ${esc(date(p.source_updated))}` : ' · Source edition not supplied'}${p.retrieved_at ? ` · Retrieved ${esc(date(p.retrieved_at))}` : ''}</p>${p.source_url ? `<p><a href="${esc(p.source_url)}" target="_blank" rel="noopener">Source record collection ↗</a></p>` : ''}`;
}

export function addPointToTrip(p: Record<string, any>, coords?: [number, number]) {
  if (!coords) return '';
  return `<button class="btn primary" data-use-spot data-launch-id="${esc(p.record_id || coords.join(','))}" data-launch-name="${esc(p.name || 'Agency-mapped fishing location')}" data-launch-lng="${coords[0]}" data-launch-lat="${coords[1]}">Add fishing spot to trip</button>`;
}
