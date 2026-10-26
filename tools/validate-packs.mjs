// Validate real regional archives before publishing; generate the public download manifest.
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { PMTiles } from 'pmtiles';

const config = JSON.parse(await readFile('pipeline/sources.json', 'utf8'));
const expected = {
  basemap: [],
  overlays: ['public_lands', 'public_lands_labels', 'water_bodies', 'streams', 'access', 'osm_dams'],
  parcels: ['parcels'],
};
const counts = {};
for (const name of [...expected.overlays, ...config.arcgis.filter(s => s.id.startsWith('parcels_')).map(s => s.id)]) {
  const data = JSON.parse(await readFile(`pipeline/out/${name}.geojson`, 'utf8'));
  const count = data.features?.length ?? 0;
  if (!count) throw Error(`Required source is empty: ${name}`);
  counts[name] = count;
  if (name === 'water_bodies' && !data.features.some(f => f.properties.water_id === 'west-point')) {
    throw Error('West Point Lake fishery join is missing');
  }
}
const packs = {};
let total = 0;
for (const [key, required] of Object.entries(expected)) {
  const path = `pipeline/out/${key}.pmtiles`;
  const info = await stat(path);
  const file = await open(path, 'r');
  try {
    const archive = new PMTiles({
      getKey: () => path,
      getBytes: async (offset, length) => {
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await file.read(bytes, 0, length, offset);
        return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytesRead) };
      },
    });
    const header = await archive.getHeader();
    if (header.specVersion !== 3 || !header.numAddressedTiles || !header.tileDataLength) throw Error(`Empty or unsupported pack: ${key}`);
    for (const [offset, length] of [[header.rootDirectoryOffset,header.rootDirectoryLength],[header.jsonMetadataOffset,header.jsonMetadataLength],[header.leafDirectoryOffset,header.leafDirectoryLength],[header.tileDataOffset,header.tileDataLength]]) {
      if (!Number.isFinite(offset) || !Number.isFinite(length) || offset < 0 || length < 0 || offset + length > info.size) throw Error(`Truncated pack: ${key}`);
    }
    const metadata = await archive.getMetadata();
    const layers = (metadata.vector_layers ?? []).map(l => l.id);
    for (const layer of required) if (!layers.includes(layer)) throw Error(`Missing ${layer} in ${key}`);
    const z = key === 'parcels' ? 13 : 8;
    const [lon, lat] = key === 'parcels' ? [-85.38,32.65] : [-85.16,33.0];
    const n = 2 ** z;
    const tile = await archive.getZxy(z, Math.floor((lon+180)/360*n), Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n));
    if (!tile?.data.byteLength) throw Error(`Representative regional tile is missing: ${key}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    packs[key] = { file: `${key}.pmtiles`, bytes: info.size, sha256: hash.digest('hex'), minZoom: header.minZoom, maxZoom: header.maxZoom, bounds: [header.minLon,header.minLat,header.maxLon,header.maxLat], tiles: header.numAddressedTiles, layers };
    total += info.size;
    console.log(`${key}: ${(info.size/1048576).toFixed(1)} MB; ${header.numAddressedTiles} tiles; ${layers.join(', ')}`);
  } finally { await file.close(); }
}
if (total > 850*1048576) throw Error('Regional archives exceed the GitHub Pages publishing budget (850 MB)');
const manifest = { schema: 1, region: config.aoi.name, bounds: config.aoi.bbox, builtAt: new Date().toISOString(), sourceCounts: counts, parcelCoverage: config.arcgis.filter(s=>s.county).map(s=>s.county), packs };
await writeFile('pipeline/out/manifest.json', JSON.stringify(manifest,null,2)+'\n');
console.log(`Validated all packs: ${(total/1048576).toFixed(1)} MB total`);
