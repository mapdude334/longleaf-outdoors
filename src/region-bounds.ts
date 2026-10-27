export type RegionBounds = [[number, number], [number, number]];

/** Fit the destinations actually offered in a region, with room around single points. */
export function locationBounds(points: readonly (readonly [number, number])[]): RegionBounds | null {
  const valid = points.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90);
  if (!valid.length) return null;
  const west = Math.min(...valid.map(([lng]) => lng));
  const east = Math.max(...valid.map(([lng]) => lng));
  const south = Math.min(...valid.map(([, lat]) => lat));
  const north = Math.max(...valid.map(([, lat]) => lat));
  const xBuffer = Math.max(0, (0.04 - (east - west)) / 2);
  const yBuffer = Math.max(0, (0.04 - (north - south)) / 2);
  return [[Math.max(-180, west - xBuffer), Math.max(-90, south - yBuffer)], [Math.min(180, east + xBuffer), Math.min(90, north + yBuffer)]];
}
