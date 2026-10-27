import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/state-regions.ts', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const { STATES, REGIONS, regionContainsWater } = await import(moduleUrl);

assert.deepEqual(STATES.map(({ code, coverage }) => [code, coverage]), [
  ['AL', 'available'], ['GA', 'available'], ['SC', 'planned'], ['NC', 'planned'], ['VA', 'planned'],
]);
assert.deepEqual(REGIONS.map(({ id }) => id), ['core', 'alabama', 'georgia', 'coastal', 'gulf', 'atlantic']);

const region = Object.fromEntries(REGIONS.map((item) => [item.id, item]));
const waters = {
  alCore: { state: 'AL', center: [-85.16, 33] },
  gaCore: { state: 'GA', center: [-85.1, 32.71] },
  alGulf: { state: 'AL', center: [-88.0, 30.3] },
  gaCoast: { state: 'GA', center: [-81.3, 31.2] },
  dualState: { state: 'GA/SC', center: [-81.3, 31.2] },
  plannedOnly: { state: 'SC', center: [-80.9, 33.8] },
  noPoint: { state: 'AL' },
};

assert.equal(regionContainsWater(region.alabama, waters.alCore), true);
assert.equal(regionContainsWater(region.alabama, waters.gaCore), false);
assert.equal(regionContainsWater(region.georgia, waters.dualState), true);
assert.equal(regionContainsWater(region.coastal, waters.alGulf), true);
assert.equal(regionContainsWater(region.coastal, waters.gaCoast), true);
assert.equal(regionContainsWater(region.coastal, waters.dualState), true);
assert.equal(regionContainsWater(region.coastal, waters.plannedOnly), false);
assert.equal(regionContainsWater(region.gulf, waters.gaCoast), false);
assert.equal(regionContainsWater(region.atlantic, waters.alGulf), false);
assert.equal(regionContainsWater(region.core, waters.noPoint), false);

console.log('State readiness and region filters are data-driven; AL/GA region behavior is preserved and planned states remain hidden.');
