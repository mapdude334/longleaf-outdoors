# Data sources

For the current Alabama and Georgia statewide agency catalogs and the source-limited South Carolina pilot, including editions, reuse-review status, and coverage limitations, see [Statewide expansion](STATEWIDE_EXPANSION.md) and [South Carolina pilot status](SOUTHEAST_EXPANSION_PHASE_1_SOUTH_CAROLINA.md). The original regional pack sources below are retained as the archive baseline.

| Layer | Source | Access | License / terms | Refresh |
|---|---|---|---|---|
| Vector basemap | [Protomaps](https://docs.protomaps.com/basemaps/downloads) daily build of OpenStreetMap (v4 schema) | `pmtiles extract` by bbox | ODbL. "© OpenStreetMap contributors" must be shown (it's in the map attribution) | Monthly (pipeline) |
| Topo / imagery rasters | [USGS The National Map](https://basemap.nationalmap.gov/) `USGSTopo`, `USGSImageryOnly`, `USGSImageryTopo`, `USGSHydroCached` | XYZ tiles (live, cached for offline) | Public domain | Live |
| Terrain / hillshade / contours | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium; USGS 3DEP + others). Contours are generated in the browser with `maplibre-contour` | XYZ tiles. `20_terrain.py` can mirror them to `terrain.pmtiles` if you'd rather self-host | Public / attribution | Static |
| Public lands | [USGS PAD-US 4.1](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview) Fee layer | ArcGIS REST `edits.nationalmap.gov/.../PAD_US_4_1/MapServer/0` | Public domain | Annual (USGS) |
| Conservation easements | PAD-US Easement feature class (in the full geodatabase download from ScienceBase). The public MapServer only exposes the Fee layer | Manual: download the AL/GA state GPKG and drop it in `pipeline/out/easements.geojson` | Public domain. Some easements are withheld by holders | Annual |
| Parcels – Lee Co., AL | City of Opelika GIS `explore.opelika-al.gov/server/rest/services/Lee_County_Parcels/MapServer/0` | ArcGIS REST | Public web service. No owner field is published | Monthly |
| Parcels – Muscogee Co., GA | Columbus Consolidated Govt. `ccggisprod.columbusga.org/server/rest/services/TaxAssessors/Base/MapServer/279` (TaxParcels_2025) | ArcGIS REST | "Reference only." Follow the county's terms | Monthly |
| Other counties | Not freely published as services in most of the AOI (Chambers, Tallapoosa, Russell, Macon, Harris, Troup, etc.). Options: county assessor portals, or paid statewide sources (Regrid, ReportAll) | Add to `sources.json` as found | Varies | — |
| Lakes & streams | [USGS NHD High Resolution](https://www.usgs.gov/national-hydrography) HU4 0313, 0315, 0314 | File geodatabase (S3 staged products) | Public domain | Quarterly |
| Boat ramps, piers, put-ins, marinas, campgrounds | OpenStreetMap via [Overpass API](https://overpass-api.de/) | Overpass QL | ODbL | Monthly (tiles) / weekly (live fallback cache) |
| Stream gauges & lake levels | [USGS Water Data OGC API](https://api.waterdata.usgs.gov/ogcapi/v0/) `latest-continuous`, `continuous`, `monitoring-locations`. Fallback: legacy NWIS IV (retiring early 2027) | JSON, CORS | Public domain. An API key is optional ([signup](https://api.waterdata.usgs.gov/signup)) | Live (10-min cache) |
| Dam releases – USACE | [CWMS Data API](https://cwms-data.usace.army.mil/cwms-data/) (catalog + timeseries, office SAM) and Mobile District pages | JSON | Public domain | Live |
| Dam releases – Georgia Power / Alabama Power | Utility lake-level and generation pages ([GA Power West GA lakes](https://georgiapower.com/our-impact/lakes-rivers/our-lakes/west-georgia-lakes.html), [APC Shorelines](https://apcshorelines.com/)) | Links only. Neither utility publishes an open API, so don't scrape without permission | Utility terms | — |
| Weather | [NWS API](https://www.weather.gov/documentation/services-web-api) points, forecast, hourly, alerts, observations | JSON, CORS | Public domain | Live (20-min cache) |
| Radar | NEXRAD n0q mosaic via [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/ogc/) | XYZ tiles | Free for non-commercial use | Live |
| Fishery info | Curated in `public/data/waters.json` from ADCNR and GA DNR WRD lake/river profiles | — | Edit and verify locally | Manual |

## Roadmap ideas

- **Lake depth contours / bathymetry.** Neither state publishes them openly for most of these reservoirs. Candidates are USACE hydrographic surveys for West Point and W.F. George, and ADCNR lake maps (scanned).
- **More parcels.** You could ask neighboring counties to publish a public parcel REST layer. You could also add owner names where the county allows it.
- **ADCNR / GA DNR boat ramp inventories.** Ingest them as authoritative ramp points if the agencies share GIS data. OSM is the fallback for now.
- **Fish attractors.** GA DNR and ADCNR publish fish-attractor and brush-pile coordinates for some lakes. These are good candidates for a points layer.
- **Native app wrap** (Capacitor) for background GPS tracking and larger offline storage on iOS.
