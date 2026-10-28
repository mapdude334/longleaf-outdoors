import { SPECIES } from './species-data';
import photos from './data/species-photos.json';
import { esc } from './util';
import type { Water } from './layers/waters';
import { fishingGuideHtml } from './fishing-tactics';

type Photo = { file: string; credit: string; license: string; licenseUrl: string | null; page: string };
const catalogue = photos as Record<string, Photo>;
const verifiedCatalogPhoto: Record<string, string> = {
  'smallmouth bass': 'smallmouth-bass', sauger: 'sauger', walleye: 'walleye',
  'yellow perch': 'yellow-perch', 'red snapper': 'red-snapper',
};
export function speciesForLabel(label: string) {
  const normal = label.replace(/\s*\(seasonal\)/i, '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (['crappie', 'black & white crappie', 'black and white crappie'].includes(normal)) return SPECIES.filter((s) => s.id === 'black-crappie' || s.id === 'white-crappie');
  if (normal === 'flounder') return SPECIES.filter((s) => s.id === 'southern-flounder' || s.id === 'summer-flounder');
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

export function speciesHtml(id: string, state?: string, water?: Water) {
  const s = SPECIES.find((s) => s.id === id);
  if (!s) return '<p>Species profile unavailable.</p>';
  const isSC = state?.split(/[\/,;]/).some((code) => code.trim().toUpperCase() === 'SC') ?? false;
  const facts = { ...s, ...(isSC ? s.regional?.SC : undefined) };
  return `<article class="fish-profile"><span class="destination-eyebrow fish-eyebrow">LONGLEAF FIELD GUIDE</span>
    <h2>${esc(s.name)}</h2><p class="fish-scientific">${esc(s.scientific)}</p>
    ${speciesPhoto(s.id, s.name)}${catalogue[s.id] ? '' : '<p class="muted small">No photograph is shown because a species-specific image with suitable provenance has not been verified.</p>'}<p class="fish-size">${esc(facts.size)}</p>
    <h4>How to recognize it</h4><p>${esc(facts.identify)}</p>
    <dl class="fish-facts">${[['Spawning & season',facts.spawn],['What it eats',facts.diet],['Where it lives',facts.habitat],['Habits & behavior',facts.habits]].map(([title,body])=>`<div><dt>${esc(title)}</dt><dd>${esc(body)}</dd></div>`).join('')}</dl>
    ${fishingGuideHtml(s.name, water)}
    ${isSC && s.regional?.SC ? '<p class="muted small">Showing South Carolina-specific notes for this water.</p>' : ''}
    <p class="muted small">Seasonal windows are regional guides, not a forecast for this lake. Water temperature and local conditions shift timing. Some SCDNR freshwater pages cite older reference material. Adult size ranges are reference ranges, not minimum keeping sizes.</p>
    <h4>Agency sources</h4><ul class="links">${s.sources.map((l)=>`<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a></li>`).join('')}</ul>
    <p class="muted small">Educational profile · reviewed October 27, 2026. Consult current state regulations and consumption advisories before keeping fish.</p></article>`;
}

export function speciesChoiceHtml(label: string) {
  return `<h3>${esc(label)}</h3><p class="muted">Two different fish share this label. Choose one to see its field guide.</p>${speciesForLabel(label).map((s)=>`<div class="fish-choice">${speciesPhoto(s.id,s.name)}<button class="btn" data-fish-id="${s.id}">${esc(s.name)} ↗</button></div>`).join('')}`;
}
