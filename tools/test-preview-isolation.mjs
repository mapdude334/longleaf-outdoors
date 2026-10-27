import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const environment = await readFile(new URL('../src/environment.ts', import.meta.url), 'utf8');
const utility = await readFile(new URL('../src/util.ts', import.meta.url), 'utf8');
const asModule = (source) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

async function build(preview) {
  const environmentUrl = asModule(environment.replace('import.meta.env.VITE_PREVIEW', JSON.stringify(String(preview))));
  const scope = await import(environmentUrl);
  const { store } = await import(asModule(utility.replace("'./environment'", JSON.stringify(environmentUrl))));
  return { scope, store };
}

const production = await build(false);
const preview = await build(true);
production.store.set('trips', [{ id: 'production-trip' }]);
production.store.set('ui', { basemap: 'topo' });
assert.equal(preview.store.get('trips'), null, 'Preview must not read production trips.');
preview.store.set('trips', [{ id: 'preview-trip' }]);
preview.store.set('ui', { basemap: 'imagery' });
assert.equal(production.store.get('trips').v[0].id, 'production-trip');
assert.equal(production.store.get('ui').v.basemap, 'topo');
assert.equal(preview.store.get('trips').v[0].id, 'preview-trip');
preview.store.del('trips');
assert.equal(production.store.get('trips').v[0].id, 'production-trip', 'Removing preview trips must not remove production data.');
assert.equal(production.scope.storageKey('vw:trips'), 'vw:trips', 'Production keys must remain compatible with existing saved data.');
for (const cache of ['vw-raster', 'vw-static', 'vw-pmtiles', 'vw-arcgis']) {
  assert.equal(production.scope.cacheName(cache), cache);
  assert.notEqual(preview.scope.cacheName(cache), cache);
}
console.log('Preview trips, settings, deletes and offline cache names are isolated; existing production keys remain compatible.');
