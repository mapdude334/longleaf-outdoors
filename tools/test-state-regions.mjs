import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/state-regions.ts', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const { STATES, REGIONS, regionContainsPoint, regionContainsWater } = await import(moduleUrl);

assert.deepEqual(STATES.map(({ code, coverage }) => [code, coverage]), [
  ['AL', 'available'], ['GA', 'available'], ['SC', 'available'], ['NC', 'planned'], ['VA', 'planned'],
]);
assert.deepEqual(REGIONS.map(({ id }) => id), ['core', 'alabama', 'georgia', 'south-carolina', 'coastal', 'gulf', 'atlantic']);

const region = Object.fromEntries(REGIONS.map((item) => [item.id, item]));
const waters = {
  alCore: { state: 'AL', center: [-85.16, 33] },
  gaCore: { state: 'GA', center: [-85.1, 32.71] },
  alGulf: { state: 'AL', center: [-88.0, 30.3] },
  gaCoast: { state: 'GA', center: [-81.3, 31.2] },
  scInterior: { state: 'SC', center: [-80.9, 34] },
  scCoast: { state: 'SC', center: [-79.1, 33.3] },
  dualState: { state: 'GA/SC', center: [-81.3, 31.2] },
  plannedOnly: { state: 'SC', center: [-80.9, 33.8] },
  noPoint: { state: 'AL' },
};

assert.equal(regionContainsWater(region.alabama, waters.alCore), true);
assert.equal(regionContainsWater(region.alabama, waters.gaCore), false);
assert.equal(regionContainsWater(region.georgia, waters.dualState), true);
assert.equal(regionContainsWater(region['south-carolina'], waters.scInterior), true);
assert.equal(regionContainsWater(region['south-carolina'], waters.alCore), false);
assert.equal(regionContainsWater(region.coastal, waters.alGulf), true);
assert.equal(regionContainsWater(region.coastal, waters.gaCoast), true);
assert.equal(regionContainsWater(region.coastal, waters.dualState), true);
assert.equal(regionContainsWater(region.coastal, waters.scCoast), true);
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

console.log('State readiness and region filters include South Carolina; existing Alabama/Georgia behavior and planned North Carolina/Virginia remain intact.');
