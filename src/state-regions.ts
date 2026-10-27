export type StateCode = 'AL' | 'GA' | 'SC' | 'NC' | 'VA';
export type GeographicBounds = [[number, number], [number, number]];

export type StateDefinition = {
  code: StateCode;
  name: string;
  coverage: 'available' | 'planned';
  bounds: GeographicBounds;
};

export type RegionMembership = { states: StateCode[]; bounds: GeographicBounds };
export type RegionDefinition = {
  id: string;
  label: string;
  bounds: GeographicBounds;
  states?: StateCode[];
  membership?: RegionMembership[];
};

/**
 * State readiness is separate from the geographic extent. A state becomes
 * available only when its destination and data coverage gates have passed.
 */
export const STATES: StateDefinition[] = [
  { code: 'AL', name: 'Alabama', coverage: 'available', bounds: [[-88.65, 28.5], [-84.85, 35.1]] },
  { code: 'GA', name: 'Georgia', coverage: 'available', bounds: [[-85.7, 30.25], [-79.5, 35.05]] },
  { code: 'SC', name: 'South Carolina', coverage: 'available', bounds: [[-83.55, 31.85], [-78.4, 35.25]] },
  { code: 'NC', name: 'North Carolina', coverage: 'planned', bounds: [[-84.5, 33.75], [-75.3, 36.65]] },
  { code: 'VA', name: 'Virginia', coverage: 'planned', bounds: [[-83.7, 36.45], [-75.0, 39.5]] },
];

const AL_GULF: GeographicBounds = [[-88.65, 28.5], [-87.25, 31.35]];
const GA_ATLANTIC: GeographicBounds = [[-82.35, 30.25], [-79.5, 32.5]];
const SC_ATLANTIC: GeographicBounds = [[-81.55, 31.85], [-78.4, 35.25]];

/** Keep the existing region IDs, labels, bounds, and membership behavior stable. */
export const REGIONS: RegionDefinition[] = [
  { id: 'core', label: 'East Alabama & West Georgia · core map pack', bounds: [[-86.35, 31.55], [-84.35, 33.85]] },
  { id: 'alabama', label: 'Alabama · statewide & Gulf', states: ['AL'], bounds: STATES[0].bounds },
  { id: 'georgia', label: 'Georgia · statewide & Atlantic', states: ['GA'], bounds: STATES[1].bounds },
  { id: 'south-carolina', label: 'South Carolina · statewide & coast', states: ['SC'], bounds: STATES[2].bounds },
  { id: 'coastal', label: 'Gulf & Atlantic Coast', bounds: [[-88.65, 28.5], [-78.4, 35.25]], membership: [
    { states: ['AL'], bounds: AL_GULF },
    { states: ['GA'], bounds: GA_ATLANTIC },
    { states: ['SC'], bounds: SC_ATLANTIC },
  ] },
  { id: 'gulf', label: 'Alabama Gulf & coast', bounds: AL_GULF, membership: [{ states: ['AL'], bounds: AL_GULF }] },
  { id: 'atlantic', label: 'Georgia Atlantic & coast', bounds: GA_ATLANTIC, membership: [{ states: ['GA'], bounds: GA_ATLANTIC }] },
];

function stateCodes(value: string): string[] {
  return value.split(/[\/,]/).map((part) => part.trim()).filter(Boolean);
}

function within(point: readonly [number, number], bounds: GeographicBounds): boolean {
  const [west, south] = bounds[0], [east, north] = bounds[1];
  return point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north;
}

/** Whether a map point belongs to the currently selected geographic region. */
export function regionContainsPoint(region: RegionDefinition, point: readonly [number, number]): boolean {
  if (!point.every(Number.isFinite)) return false;
  if (region.membership) return region.membership.some((area) => within(point, area.bounds));
  return within(point, region.bounds);
}

export function regionContainsWater(region: RegionDefinition, water: { state: string; center?: [number, number] | null }): boolean {
  if (!water.center) return false;
  const codes = stateCodes(water.state);
  if (region.membership) return region.membership.some((area) => codes.some((code) => area.states.includes(code as StateCode)) && within(water.center!, area.bounds));
  if (region.states) return codes.some((code) => region.states!.includes(code as StateCode));
  return within(water.center, region.bounds);
}

export function watersInRegion<T extends { state: string; center?: [number, number] | null }>(waters: readonly T[], region: RegionDefinition): T[] {
  return waters.filter((water) => regionContainsWater(region, water));
}
