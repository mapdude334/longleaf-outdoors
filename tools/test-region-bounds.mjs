import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../src/region-bounds.ts', import.meta.url), 'utf8');
const { locationBounds } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const destinations = [[-85.16, 33], [-85.1, 32.71], [-86.29725, 32.64215]];
assert.deepEqual(locationBounds(destinations), [[-86.29725, 32.64215], [-85.1, 33]], 'The view must match the locations, not a statewide bookmark.');
const single = locationBounds([destinations[0]]);
assert.ok(single[0][0] < destinations[0][0] && single[1][0] > destinations[0][0]);
assert.ok(single[0][1] < destinations[0][1] && single[1][1] > destinations[0][1]);
assert.deepEqual(locationBounds([destinations[0], destinations[0]]), single, 'Coincident locations need a usable map extent.');
assert.equal(locationBounds([]), null, 'Empty regions must retain the geographic bookmark fallback.');
assert.equal(locationBounds([[NaN, 32], [-85, Infinity], [200, 32]]), null);
assert.deepEqual(locationBounds([...destinations, [NaN, 32]]), locationBounds(destinations));
console.log('Region views fit destination locations, include single/coincident points, and safely handle empty or invalid data.');
