import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const registry = JSON.parse(await readFile(resolve(root, 'src/point-symbols.json'), 'utf8'));
const symbolKeys = new Set(Object.keys(registry.colors ?? {}));
if (!symbolKeys.size) throw new Error('Point symbol registry has no symbols.');

for (const [raw, canonical] of Object.entries(registry.catalogs?.access ?? {})) {
  if (!symbolKeys.has(canonical)) throw new Error(`Access category "${raw}" maps to missing symbol "${canonical}".`);
}
for (const [catalog, mappings] of Object.entries(registry.catalogs ?? {})) {
  for (const [raw, canonical] of Object.entries(mappings)) {
    if (!symbolKeys.has(canonical)) throw new Error(`${catalog} category "${raw}" maps to missing symbol "${canonical}".`);
  }
}
for (const kind of symbolKeys) {
  await access(resolve(root, `public/symbols/${kind}.svg`));
}

const datasets = [
  ['access', 'public/data/access.json'],
  ['fish-structures', 'public/data/fish-structures.json'],
  ['restrooms', 'public/data/restrooms.json'],
  ['habitat', 'public/data/habitat.json'],
];
for (const [catalog, file] of datasets) {
  const data = JSON.parse(await readFile(resolve(root, file), 'utf8'));
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(`${file} is not a point feature collection.`);
  const mappings = registry.catalogs[catalog];
  for (const [index, feature] of data.features.entries()) {
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (feature.geometry?.type !== 'Point' || !Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`${file} feature ${index} has invalid point coordinates.`);
    const raw = feature.properties?.kind;
    if (typeof raw !== 'string' || !mappings[raw]) throw new Error(`${file} feature ${index} has an unmapped category: ${String(raw)}.`);
  }
  console.log(`${file}: ${data.features.length} points use registered ${catalog} symbols.`);
}
console.log(`Validated ${symbolKeys.size} shared point symbols and their SVG assets.`);
