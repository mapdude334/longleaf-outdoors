import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';

const json = async (name) => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'));
const original = (name) => JSON.parse(execFileSync('git', ['show', `origin/main:public/data/${name}.json`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const configSource = (await readFile(new URL('../src/config.ts', import.meta.url), 'utf8')).replaceAll('import.meta.env', JSON.stringify({ BASE_URL: '/' }));
const configUrl = moduleUrl(configSource);
const { AOI, MAP_BOUNDS } = await import(configUrl);
const coverage = await import(moduleUrl((await readFile(new URL('../src/coverage.ts', import.meta.url), 'utf8')).replace("'./config'", JSON.stringify(configUrl))));
const outsideCore = ([x, y]) => x < AOI[0] || x > AOI[2] || y < AOI[1] || y > AOI[3];

for (const catalog of ['access', 'fish-structures', 'restrooms', 'habitat']) {
  const data = await json(catalog);
  const ids = new Set();
  let outside = 0;
  for (const feature of data.features) {
    const p = feature.properties;
    const id = p.osm ?? feature.id ?? p.record_id;
    assert.ok(id, `${catalog}: missing stable identity`);
    assert.ok(!ids.has(id), `${catalog}: duplicate record ${id}`);
    ids.add(id);
    const [x, y] = feature.geometry.coordinates;
    assert.ok(x >= MAP_BOUNDS[0][0] && x <= MAP_BOUNDS[1][0] && y >= MAP_BOUNDS[0][1] && y <= MAP_BOUNDS[1][1], `${catalog}: record lies beyond navigable map`);
    if (outsideCore([x, y])) outside++;
    if (p.record_id) assert.ok(p.data_source && p.source_url && p.retrieved_at, `${catalog}: incomplete provenance`);
    if (String(feature.id).startsWith('ga-reefs-')) assert.ok(!/corner|permitted reef area/i.test(p.structure), 'Reef-area corners are not submerged structures.');
    if (String(feature.id).startsWith('ga-structures-')) assert.ok(['attractor', 'trout_structure'].includes(p.source_activity), 'Planting/restoration records must not be shown as submerged structures.');
  }
  assert.ok(outside > 0, `${catalog}: expansion has no records outside the original pack`);
  if (catalog !== 'habitat') {
    for (const feature of original(catalog).features) assert.ok(ids.has(feature.properties.osm ?? feature.id), `${catalog}: existing core record was lost`);
  }
  console.log(`${catalog}: ${data.features.length} unique points; ${outside} outside core; original records retained.`);
}
const waters = (await json('waters')).waters;
assert.equal(new Set(waters.map((water) => water.id)).size, waters.length);
const scWaters = waters.filter((water) => water.id.startsWith('sc-water-'));
assert.ok(scWaters.length > 280, 'South Carolina destination catalog is unexpectedly sparse');
assert.ok(scWaters.every((water) => water.state === 'SC' && water.center && water.location_note && water.links.some((link) => link.url.includes('dnr.sc.gov/regs/fishing.html'))), 'South Carolina destination metadata or official guidance is incomplete');
for (const baseline of original('waters').waters) {
  const current = waters.find((water) => water.id === baseline.id);
  assert.ok(current, `Saved destination ID ${baseline.id} was lost`);
  for (const key of ['name', 'species', 'notes', 'acres']) assert.deepEqual(current[key], baseline[key], `Curated ${baseline.id} ${key} changed`);
  assert.ok(baseline.state.split('/').every((code) => current.state.split('/').includes(code)), `Curated ${baseline.id} lost a state association`);
}
const waterIds = new Set(waters.map((water) => water.id));
for (const feature of (await json('access')).features) {
  if (feature.properties.waterbody_id) assert.ok(waterIds.has(feature.properties.waterbody_id), 'An access point refers to a missing destination');
}
const scAccess = (await json('access')).features.filter((feature) => feature.id?.startsWith('sc-access-'));
assert.equal(scAccess.length, 1030, 'South Carolina access source records are incomplete');
assert.equal(new Set(scAccess.map((feature) => feature.properties.record_id)).size, scAccess.length, 'South Carolina access IDs must be unique');
assert.deepEqual(Object.fromEntries(['Open', 'Closed', 'Limited access'].map((status) => [status, scAccess.filter((feature) => feature.properties.status === status).length])), { Open: 1027, Closed: 2, 'Limited access': 1 }, 'Agency access statuses must remain explicit');
assert.ok(scAccess.every((feature) => feature.properties.data_source && feature.properties.source_url && feature.properties.source_global_id), 'South Carolina access provenance is incomplete');
assert.ok(scAccess.filter((feature) => feature.properties.waterbody !== 'Pond').every((feature) => waterIds.has(feature.properties.waterbody_id)), 'A named South Carolina access point is missing its destination');
assert.ok(scAccess.filter((feature) => feature.properties.waterbody === 'Pond').every((feature) => !feature.properties.waterbody_id), 'Generic pond labels must not become false destinations');
const scRestrooms = (await json('restrooms')).features.filter((feature) => feature.id?.startsWith('sc-access-'));
assert.equal(scRestrooms.length, 265, 'South Carolina facility restroom reports are incomplete');
assert.ok(scRestrooms.every((feature) => feature.properties.location_accuracy === 'facility point (restroom may be nearby)'), 'Facility restroom points need an uncertainty label');
const scStructures = (await json('fish-structures')).features.filter((feature) => feature.id?.startsWith('sc-attractor-'));
assert.equal(scStructures.length, 129, 'South Carolina fish-attractor records are incomplete');
assert.ok(scStructures.every((feature) => feature.properties.source_note?.includes('June 2023')), 'Historical attractor caveat is missing');
const scHabitat = (await json('habitat')).features.filter((feature) => feature.id?.startsWith('sc-attractor-'));
assert.equal(scHabitat.length, 257, 'South Carolina habitat-project records are incomplete');
assert.ok(scHabitat.every((feature) => feature.properties.source_note?.includes('June 2023')), 'Historical habitat caveat is missing');
for (const water of waters.filter((item) => item.id.startsWith('water-'))) {
  assert.ok(water.center && water.catalog_sources?.length, `${water.name}: missing mapped location or source`);
  if (!water.species.length) assert.ok(water.species_note, 'Missing species must be explained instead of inferred');
}
for (const core of [true, false]) {
  for (const pack of [true, false]) {
    assert.equal(coverage.overlayAvailable('access', 'access-pts', pack, core), true, 'Regional archives must never hide statewide access');
    assert.equal(coverage.overlayAvailable('public_lands', 'pl-live', pack, core), !pack || !core);
    assert.equal(coverage.overlayAvailable('water', 'hydro-live', pack, core), !pack || !core);
  }
}
assert.equal(coverage.availableBasemap('vector', false), 'topo');
assert.equal(coverage.availableBasemap('vector', true), 'vector');
assert.equal(coverage.availableBasemap('imagery', false), 'imagery');
const states = await json('state-boundaries');
assert.deepEqual(states.features.map((f) => f.properties.STUSAB).sort(), ['AL', 'GA', 'SC']);
console.log(`${waters.length} destinations: curated IDs/species preserved; statewide links, boundary outlines and pack fallbacks verified.`);
