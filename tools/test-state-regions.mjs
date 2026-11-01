import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/state-regions.ts', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const { STATES, REGIONS, regionContainsPoint, regionContainsWater, watersInRegion } = await import(moduleUrl);
const boundaryData = JSON.parse(await readFile(new URL('../public/data/state-boundaries.json', import.meta.url), 'utf8'));
const curatedWaters = JSON.parse(await readFile(new URL('../public/data/waters.json', import.meta.url), 'utf8')).waters;

assert.deepEqual(STATES.map(({ code, coverage }) => [code, coverage]), [
  ['AL', 'available'], ['GA', 'available'], ['SC', 'available'], ['FL', 'partial'], ['NC', 'planned'], ['VA', 'planned'],
]);
assert.deepEqual(REGIONS.map(({ id }) => id), ['core', 'alabama', 'georgia', 'south-carolina', 'florida-panhandle', 'coastal', 'gulf', 'atlantic']);

const region = Object.fromEntries(REGIONS.map((item) => [item.id, item]));
// Bounds of the user-supplied AL_GA_SC polygons after projection to WGS84.
// This reference is used for statewide camera fitting only; the polygons are not rendered.
const suppliedShapeBounds = {
  AL: [-88.47296, 30.23360, -84.89401, 35.01604],
  GA: [-85.60897, 30.36129, -80.89475, 35.00037],
  SC: [-83.35069, 32.06817, -78.57945, 35.20836],
};
function geometryBounds(coords, bounds = [Infinity, Infinity, -Infinity, -Infinity]) {
  if (Array.isArray(coords) && typeof coords[0] === 'number') {
    bounds[0] = Math.min(bounds[0], coords[0]); bounds[1] = Math.min(bounds[1], coords[1]);
    bounds[2] = Math.max(bounds[2], coords[0]); bounds[3] = Math.max(bounds[3], coords[1]);
  } else if (Array.isArray(coords)) for (const child of coords) geometryBounds(child, bounds);
  return bounds;
}
for (const state of STATES.filter(({ coverage }) => coverage === 'available')) {
  const stateRegion = REGIONS.find(({ states }) => states?.includes(state.code));
  const feature = boundaryData.features.find(({ properties }) => properties.STUSAB === state.code);
  assert.ok(stateRegion?.viewBounds, `${state.code} statewide view needs an explicit fit extent`);
  assert.ok(feature, `${state.code} needs a maintained boundary outline`);
  const [west, south, east, north] = geometryBounds(feature.geometry.coordinates);
  const [shapeWest, shapeSouth, shapeEast, shapeNorth] = suppliedShapeBounds[state.code];
  assert.ok(stateRegion.viewBounds[0][0] <= west && stateRegion.viewBounds[0][1] <= south, `${state.code} view omits its western or southern border`);
  assert.ok(stateRegion.viewBounds[1][0] >= east && stateRegion.viewBounds[1][1] >= north, `${state.code} view omits its eastern or northern border`);
  assert.ok(stateRegion.viewBounds[0][0] <= shapeWest && stateRegion.viewBounds[0][1] <= shapeSouth, `${state.code} view omits part of the supplied polygon extent`);
  assert.ok(stateRegion.viewBounds[1][0] >= shapeEast && stateRegion.viewBounds[1][1] >= shapeNorth, `${state.code} view omits part of the supplied polygon extent`);
}
const floridaRegion = region['florida-panhandle'];
const floridaBoundary = boundaryData.features.find(({ properties }) => properties.STUSAB === 'FL');
const floridaDestinations = curatedWaters.filter((water) => water.id.startsWith('florida-panhandle-'));
assert.ok(floridaBoundary?.properties.reference_only, 'Florida state outline must remain a reference, not a drawn pilot polygon');
assert.equal(floridaDestinations.length, 18, 'Florida Northwest region should expose the current 18 FWC destination guides');
assert.deepEqual(watersInRegion(floridaDestinations, floridaRegion).map((water) => water.id).sort(), floridaDestinations.map((water) => water.id).sort(), 'The Florida region filter must retain every available FWC destination guide');
assert.ok(floridaRegion.viewBounds[0][0] <= -87.634871 && floridaRegion.viewBounds[0][1] <= 29.43598, 'Florida Panhandle view omits western/southern FWC Northwest counties');
assert.ok(floridaRegion.viewBounds[1][0] >= -83.604121 && floridaRegion.viewBounds[1][1] >= 31.000968, 'Florida Panhandle view omits eastern/northern FWC Northwest counties');
assert.match(await readFile(new URL('../src/style.ts', import.meta.url), 'utf8'), /reference_only.*true/, 'Reference-only state outline must be excluded from map rendering');
const waters = {
  alCore: { state: 'AL', center: [-85.16, 33] },
  gaCore: { state: 'GA', center: [-85.1, 32.71] },
  alGulf: { state: 'AL', center: [-88.0, 30.3] },
  gaCoast: { state: 'GA', center: [-81.3, 31.2] },
  scInterior: { state: 'SC', center: [-80.9, 34] },
  scCoast: { state: 'SC', center: [-79.1, 33.3] },
  flPanhandle: { state: 'FL', center: [-85.5, 30.3] },
  dualState: { state: 'GA/SC', center: [-81.3, 31.2] },
  plannedOnly: { state: 'SC', center: [-80.9, 33.8] },
  noPoint: { state: 'AL' },
};

assert.equal(regionContainsWater(region.alabama, waters.alCore), true);
assert.equal(regionContainsWater(region.alabama, waters.gaCore), false);
assert.equal(regionContainsPoint(region.alabama, [-88.47323, 32]), true, 'Alabama scope must include the western state boundary');
assert.equal(regionContainsPoint(region.alabama, [-88.2, 32.5]), true, 'Alabama scope must include West Alabama');
assert.equal(regionContainsPoint(region.alabama, [-84.88825, 34.9]), true, 'Alabama scope must include the eastern and northern state extent');
assert.equal(regionContainsWater(region.georgia, waters.dualState), true);
assert.equal(regionContainsWater(region['south-carolina'], waters.dualState), false, 'A border-water label must not place its mapped point in another state');
assert.equal(regionContainsWater(region['south-carolina'], waters.scInterior), true);
assert.equal(regionContainsWater(region['south-carolina'], waters.alCore), false);
assert.equal(regionContainsWater(floridaRegion, waters.flPanhandle), true);
assert.equal(regionContainsWater(floridaRegion, waters.gaCore), false, 'The Florida Panhandle destination list must exclude nearby Georgia waters');
assert.equal(regionContainsWater(region.coastal, waters.alGulf), true);
assert.equal(regionContainsWater(region.coastal, waters.gaCoast), true);
assert.equal(regionContainsWater(region.coastal, waters.dualState), true);
assert.equal(regionContainsWater(region.coastal, waters.scCoast), true);
assert.equal(regionContainsWater(region.coastal, waters.flPanhandle), true, 'The existing Gulf & Atlantic region must include mapped Northwest Florida data');
assert.equal(regionContainsWater(region.coastal, waters.plannedOnly), true);
assert.equal(regionContainsWater(region.gulf, waters.gaCoast), false);
assert.equal(regionContainsWater(region.atlantic, waters.alGulf), false);
assert.equal(regionContainsWater(region.core, waters.noPoint), false);
assert.equal(regionContainsPoint(region['south-carolina'], [-80.9, 34]), true);
assert.equal(regionContainsPoint(region['south-carolina'], [-85.16, 33]), false);
assert.equal(regionContainsPoint(region.coastal, [-80.8, 32.5]), true);
assert.equal(regionContainsPoint(region.coastal, [-83.0, 34.0]), false, 'Coastal filter must not include inland SC points');
assert.equal(regionContainsPoint(region.atlantic, [-81.3, 31.2]), true);
assert.equal(regionContainsPoint(region.gulf, [-81.3, 31.2]), false);
assert.equal(regionContainsPoint(region.core, [NaN, 32]), false);
assert.equal(regionContainsPoint(floridaRegion, [-85.5, 30.3], 'FL'), true);
assert.equal(regionContainsPoint(floridaRegion, [-85.5, 30.3], 'GA'), false, 'State-aware filtering must exclude a neighboring-state point inside the Panhandle rectangle');
assert.equal(regionContainsPoint(floridaRegion, [-85.5, 31.2], 'FL'), false, 'Florida points outside FWC Northwest Region must remain out of this pilot');

console.log('State readiness and region filters include the Florida Panhandle pilot; existing statewide states and planned North Carolina/Virginia remain intact.');
