import type { Water } from './layers/waters';

const NHD_WATERBODIES = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12/query';

/** Build a bounded USGS NHD request from a destination's official names and approximate local extent. */
export function waterOutlineQueryUrl(water: Water, usePermanentIdentifiers = true) {
  if (!water.center) return null;
  const [lng, lat] = water.center;
  const acreageRadiusKm = Math.sqrt(Math.max(1, water.acres ?? 5000) * 0.00404686 / Math.PI) * 2.4;
  let radiusKm = Math.max(8, acreageRadiusKm);
  if (water.bounds) {
    const [[west, south], [east, north]] = water.bounds;
    const latRadius = Math.max(Math.abs(lat - south), Math.abs(north - lat)) * 111.2;
    const lonRadius = Math.max(Math.abs(lng - west), Math.abs(east - lng)) * 111.2 * Math.cos(lat * Math.PI / 180);
    radiusKm = Math.max(radiusKm, latRadius, lonRadius);
  }
  radiusKm = Math.min(125, radiusKm * 1.45);
  const latSpan = radiusKm / 111.2;
  const lonSpan = radiusKm / (111.2 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const names = [...new Set([water.name, ...(water.gnis_names ?? [])].map((name) => name.trim()).filter(Boolean))];
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const permanentIds = usePermanentIdentifiers ? [...new Set((water.nhd_permanent_identifiers ?? []).map((id) => id.trim()).filter(Boolean))] : [];
  if (!names.length && !permanentIds.length) return null;
  const params = new URLSearchParams({
    where: permanentIds.length && permanentIds.length <= 25
      ? `PERMANENT_IDENTIFIER IN (${permanentIds.map(quote).join(',')})`
      : `GNIS_NAME IN (${names.map(quote).join(',')})`,
    outFields: 'GNIS_NAME,AREASQKM,PERMANENT_IDENTIFIER',
    returnGeometry: 'true', outSR: '4326', f: 'geojson',
    geometry: `${lng - lonSpan},${lat - latSpan},${lng + lonSpan},${lat + latSpan}`,
    geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    maxAllowableOffset: '0.00012', geometryPrecision: '5', resultRecordCount: '100', returnZ: 'false', returnM: 'false',
  });
  return `${NHD_WATERBODIES}?${params.toString()}`;
}
