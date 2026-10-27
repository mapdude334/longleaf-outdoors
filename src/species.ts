import { SPECIES } from './species-data';
import photos from './data/species-photos.json';
import { esc } from './util';

type Photo = { file: string; credit: string; license: string; licenseUrl: string | null; page: string };
const catalogue = photos as Record<string, Photo>;
const verifiedCatalogPhoto: Record<string, string> = {
  'smallmouth bass': 'smallmouth-bass', sauger: 'sauger', walleye: 'walleye',
  'yellow perch': 'yellow-perch', 'red snapper': 'red-snapper',
};
export function speciesForLabel(label: string) {
  if (/crappie/i.test(label)) return SPECIES.filter((s) => s.id === 'black-crappie' || s.id === 'white-crappie');
  const normal = label.replace(/\s*\(seasonal\)/i, '').toLowerCase();
  return SPECIES.filter((s) => s.name.toLowerCase() === normal);
}

export function speciesPhoto(id: string, name: string) {
  const p = catalogue[id];
  return p ? photoMarkup(p, name) : '';
}

function photoMarkup(p: Photo, name: string) {
  return `<figure class="fish-photo"><img src="${import.meta.env.BASE_URL}${esc(p.file)}" alt="Photograph of ${esc(name)}" width="800" height="500"><figcaption>${esc(p.credit)} · <a href="${esc(p.page)}" target="_blank" rel="noopener">Photo source</a> · ${p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>` : esc(p.license)} · resized for display</figcaption></figure>`;
}

/** Only labels matched to a checked scientific/common-name source get an image. */
export function verifiedSpeciesPhoto(label: string) {
  const key = verifiedCatalogPhoto[label.replace(/\s*\(seasonal\)/i, '').trim().toLowerCase()];
  const photo = key ? catalogue[key] : undefined;
  return photo ? photoMarkup(photo, label) : '';
}

export function speciesHtml(id: string) {
  const s = SPECIES.find((s) => s.id === id);
  if (!s) return '<p>Species profile unavailable.</p>';
  return `<article class="fish-profile"><span class="destination-eyebrow fish-eyebrow">LONGLEAF FIELD GUIDE</span>
    <h2>${esc(s.name)}</h2><p class="fish-scientific">${esc(s.scientific)}</p>
    ${speciesPhoto(s.id, s.name)}<p class="fish-size">${esc(s.size)}</p>
    <h4>How to recognize it</h4><p>${esc(s.identify)}</p>
    <dl class="fish-facts">${[['Spawning & season',s.spawn],['What it eats',s.diet],['Where it lives',s.habitat],['Habits & behavior',s.habits]].map(([title,body])=>`<div><dt>${esc(title)}</dt><dd>${esc(body)}</dd></div>`).join('')}</dl>
    <p class="muted small">Seasonal windows are regional guides, not a forecast for this lake. Water temperature and local conditions shift timing. Adult size ranges are reference ranges, not minimum keeping sizes.</p>
    <h4>Agency sources</h4><ul class="links">${s.sources.map((l)=>`<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join('')}</ul>
    <p class="muted small">Educational profile · reviewed October 26, 2026. Consult current state regulations and consumption advisories before keeping fish.</p></article>`;
}

export function speciesChoiceHtml(label: string) {
  return `<h3>${esc(label)}</h3><p class="muted">Two different fish share this label. Choose one to see its field guide.</p>${speciesForLabel(label).map((s)=>`<div class="fish-choice">${speciesPhoto(s.id,s.name)}<button class="btn" data-fish-id="${s.id}">${esc(s.name)} ↗</button></div>`).join('')}`;
}
