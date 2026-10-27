import type { Map } from 'maplibre-gl';
import { AOI } from './config';

/** Regional archives are authoritative only for their existing build footprint. */
export function viewInsideCore(map: Map): boolean {
  const bounds = map.getBounds();
  return bounds.getWest() >= AOI[0] && bounds.getSouth() >= AOI[1]
    && bounds.getEast() <= AOI[2] && bounds.getNorth() <= AOI[3];
}

export function overlayAvailable(group: string, id: string, hasRegionalPack: boolean, core: boolean): boolean {
  if (id === 'pl-live' || id === 'hydro-live') return !hasRegionalPack || !core;
  if (group === 'public_lands' || group === 'water') return hasRegionalPack && core;
  return true;
}

export function availableBasemap<T extends string>(selected: T, core: boolean): T | 'topo' {
  return selected === 'vector' && !core ? 'topo' : selected;
}
