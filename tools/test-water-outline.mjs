import assert from 'node:assert/strict';
import { waterOutlineQueryUrl } from '../src/water-outline-query.ts';

const lake = {
  id: 'jordan', name: 'Lake Jordan', gnis_names: ['Jordan Lake', 'Jordan Reservoir'],
  state: 'AL', type: 'reservoir', acres: 6800, center: [-86.29725, 32.64215],
  bounds: [[-86.37121, 32.597859], [-86.24904, 32.74731]], species: [], links: [],
};
const url = new URL(waterOutlineQueryUrl(lake));
assert.equal(url.hostname, 'hydro.nationalmap.gov');
assert.equal(url.pathname, '/arcgis/rest/services/nhd/MapServer/12/query');
assert.match(url.searchParams.get('where'), /GNIS_NAME IN \('Lake Jordan','Jordan Lake','Jordan Reservoir'\)/);
assert.equal(url.searchParams.get('f'), 'geojson');
assert.equal(url.searchParams.get('returnGeometry'), 'true');
assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
assert.equal(url.searchParams.get('resultRecordCount'), '100');
const [west, south, east, north] = url.searchParams.get('geometry').split(',').map(Number);
assert.ok(west < lake.center[0] && east > lake.center[0] && south < lake.center[1] && north > lake.center[1]);
assert.ok(east - west < 2 && north - south < 2, 'query stays bounded around the chosen destination');
assert.equal(waterOutlineQueryUrl({ ...lake, center: null }), null);
assert.ok(waterOutlineQueryUrl({ ...lake, name: '', gnis_names: [] }) === null);
const apostrophe = new URL(waterOutlineQueryUrl({ ...lake, name: "Lake O'Neil", gnis_names: [] }));
assert.match(apostrophe.searchParams.get('where'), /Lake O''Neil/, 'GNIS names are safely quoted for the ArcGIS SQL query');
console.log('USGS water outline queries use exact GNIS aliases and a bounded destination-area envelope.');
