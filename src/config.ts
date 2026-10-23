// Central configuration. Override tile hosting at build time with VITE_TILE_BASE
// (e.g. https://tiles.example.com/valley-waters/) — see docs/HOSTING.md.

export const APP_NAME = 'Valley Waters';

/** AOI: East Alabama / West Georgia (Tallapoosa + Middle Chattahoochee basins). [w, s, e, n] */
export const AOI: [number, number, number, number] = [-86.35, 31.55, -84.35, 33.85];
export const START_VIEW = { center: [-85.25, 32.7] as [number, number], zoom: 8.3 };

const base = (import.meta.env.VITE_TILE_BASE as string | undefined) ?? `${import.meta.env.BASE_URL}tiles/`;
export const TILE_BASE = base.endsWith('/') ? base : base + '/';

/** PMTiles archives produced by /pipeline. Each is optional — the app falls back to live services. */
export const PMTILES = {
  basemap: 'basemap.pmtiles',
  overlays: 'overlays.pmtiles',
  parcels: 'parcels.pmtiles',
} as const;
export type PmKey = keyof typeof PMTILES;

export const GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
export const SPRITE = 'https://protomaps.github.io/basemaps-assets/sprites/v4/light';

/** Terrarium-encoded DEM (AWS Open Data). Cached by the service worker for offline use. */
export const TERRAIN_URL =
  (import.meta.env.VITE_TERRAIN_URL as string | undefined) ??
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const TNM = 'https://basemap.nationalmap.gov/arcgis/rest/services';
/** Public-domain USGS National Map raster basemaps (no key). */
export const RASTER_BASEMAPS = {
  topo: { label: 'USGS Topo', url: `${TNM}/USGSTopo/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16 },
  imagery: { label: 'USGS Imagery', url: `${TNM}/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16 },
  hybrid: { label: 'Imagery + Topo', url: `${TNM}/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16 },
} as const;
export const USGS_HYDRO_TILES = `${TNM}/USGSHydroCached/MapServer/tile/{z}/{y}/{x}`;

const exportUrl = (svc: string, layers?: string) =>
  `${svc}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true&dpi=96&f=image` +
  (layers ? `&layers=show:${layers}` : '');

/** Live ArcGIS services, used when the offline vector overlays aren't installed (and for identify). */
export const ARCGIS = {
  padus: {
    label: 'PAD-US 4.1 public lands',
    service: 'https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer',
    layer: 0,
  },
  parcels: [
    {
      label: 'Lee County, AL',
      service: 'https://explore.opelika-al.gov/server/rest/services/Lee_County_Parcels/MapServer',
      layer: 0,
    },
    {
      label: 'Muscogee County, GA',
      service: 'https://ccggisprod.columbusga.org/server/rest/services/TaxAssessors/Base/MapServer',
      layer: 279,
    },
  ],
} as const;
export const arcgisExport = exportUrl;

/** NEXRAD base reflectivity mosaic (Iowa Environmental Mesonet). */
export const RADAR_TILES = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';

export const USGS_OGC = 'https://api.waterdata.usgs.gov/ogcapi/v0';
export const USGS_LEGACY_IV = 'https://waterservices.usgs.gov/nwis/iv/';
/** Optional free key from https://api.waterdata.usgs.gov/signup raises rate limits. */
export const USGS_API_KEY = import.meta.env.VITE_USGS_API_KEY as string | undefined;

export const OVERPASS = 'https://overpass-api.de/api/interpreter';
export const CWMS = 'https://cwms-data.usace.army.mil/cwms-data';

/** USGS parameter codes we surface. */
export const PARAMS: Record<string, { label: string; unit: string; digits: number }> = {
  '00060': { label: 'Discharge', unit: 'cfs', digits: 0 },
  '00065': { label: 'Gage height', unit: 'ft', digits: 2 },
  '62614': { label: 'Lake elevation (NGVD29)', unit: 'ft', digits: 2 },
  '62615': { label: 'Lake elevation (NAVD88)', unit: 'ft', digits: 2 },
  '00062': { label: 'Reservoir elevation', unit: 'ft', digits: 2 },
  '00010': { label: 'Water temp', unit: '°F', digits: 1 },
  '00300': { label: 'Dissolved oxygen', unit: 'mg/L', digits: 1 },
  '63680': { label: 'Turbidity', unit: 'FNU', digits: 1 },
};
