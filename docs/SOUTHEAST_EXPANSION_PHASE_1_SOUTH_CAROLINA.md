# Southeast expansion: Phase 1 South Carolina source and readiness audit

**Status:** source discovery and state/region foundation complete; no South Carolina records have been ingested and the visible app behavior is unchanged.

## Why this is the first deliverable

The current statewide expansion job (`pipeline/scripts/46_expand_states.py`) is built around Alabama and Georgia. It fetches those states' agency layers, rejects coordinates outside a fixed AL/GA envelope, and requests exactly two state boundaries. The destination selector also has an `AL | GA` state type and hand-coded coastal filters. Adding a third state directly to those conditionals would create a fragile one-off and could accidentally change existing destination matching.

Current integrity baseline passes:

- 497 cataloged destinations, with all production destination IDs and curated species/notes preserved.
- Access: 1,790 unique points; fish structures: 5,160; restrooms: 621; habitat: 7,403.
- Statewide, regional-bounds, water-outline, and preview-isolation tests pass.

These counts are a baseline, not a target for South Carolina. We should compare stable identifiers and validated coverage rather than require future sources to reproduce these numbers.

## South Carolina source candidates

| Theme | Candidate source | Initial assessment | Gate before ingestion |
|---|---|---|---|
| Water access, ramps, fishing piers, public fishing sites | [SCDNR public water-access feature layer](https://services.arcgis.com/acgZYxoN5Oj8pDLa/ArcGIS/rest/services/South_Carolina_Public_Water_Access_PUBLIC_VIEW/FeatureServer/0) | Strong first candidate. The service exposes stable GlobalID, access type/name, waterbody, status, public-access flag, parking, restroom, accessibility, species, county, directions, coordinates, and last-edit metadata. Its metadata says records are for information and recreation and are not necessarily owned or maintained by SCDNR. The service reports a March 17, 2026 data edit. | Query and profile every feature; map source access types to existing global symbols; retain owner/maintenance/status and source location caveat; do not equate a mapped public-access point with a currently open or boatable launch. Confirm public reuse/attribution terms for this specific service. |
| Freshwater fish attractors | [SCDNR freshwater fish-attractor service](https://services.arcgis.com/acgZYxoN5Oj8pDLa/ArcGIS/rest/services/SCDNR_Freshwater_Fish_Attractors_Public_Web_App/FeatureServer) and [SCDNR attractor map](https://dnr.sc.gov/fish/fishattract/fishattr.html) | Promising, agency-maintained public-facing source. A separate legacy metadata page describes a 2010 snapshot, so that older file must not be treated as current without comparing it to the live service. | Inspect the service's layer schema, last-edit date, counts, spatial reference, and public-use conditions. Confirm coordinates represent individual structures rather than generalized areas; retain placement/vintage caveats. |
| Waterbody destinations and hydrography | [USGS 3D Hydrography Program products](https://www.usgs.gov/3d-hydrography-program/access-3dhp-data-products), SCDNR Geospatial Open Data, and [SCDNR lakes/waterways](https://www.dnr.sc.gov/lakeswaterw.html) | Use a consistent hydrography backbone, supplemented by agency names and fishing context. USGS has moved from maintaining NHD/NHDPlus HR to 3DHP; the 3DHP services and downloadable products have different update schedules and coverage. SCDNR says its LiDAR-derived hydrography can be more detailed but has less attribution. | Check South Carolina coverage and release date at the feature level. Keep mapped hydrography separate from verified fishing destinations. Do not treat a point-derived extent as a shoreline polygon or safe navigation boundary. Preserve current waterbody IDs. |
| Restrooms and amenities | SCDNR public-access attributes first; other agency/facility sources only as needed | The SCDNR access layer includes restroom and facility information, which can avoid low-confidence duplicate points. A restroom flag may describe a facility rather than the restroom's exact location. | Represent facility-level restroom information as an amenity attached to the facility; only create a standalone restroom point when its location is explicitly mapped. Record the source and location precision. |
| Habitat, reefs, and other structure | SCDNR freshwater/coastal open-data catalog; NOAA and USACE layers where appropriate | Candidate sources exist, but availability alone does not establish recency, angler relevance, or precise locations. Coastal and freshwater products need different meanings and symbology categories. | Add only individual, publicly usable, georeferenced features with a clear source, date, and point meaning. Exclude reef-area corners, generalized habitat polygons converted to fake points, and sensitive wildlife locations. |
| State outline and region geometry | Census TIGER/Line state boundary, with source edition recorded | Suitable for display and state/region navigation. It is not a fishing-water boundary or legal jurisdiction determination. | Generate boundary features for all supported states from one source/version and check containment at borders. Use waterbody state associations separately for cross-border waters. |

The official SCDNR GIS page says its GIS data are available to the public free of charge and points to its Geospatial Open Data portal. That does not automatically establish the terms for every hosted layer, so the individual item/service attribution and use terms still need to be captured before redistribution. [SCDNR GIS](https://www.dnr.sc.gov/gis.html)

## What the later-state inventory suggests

- **North Carolina:** NCWRC reports more than 500 publicly accessible fishing locations and more than 800 fish-attractor sites across 60+ waters. Its public page describes GPX/CSV export in WGS84. This is a strong candidate, but we still need to identify the authoritative service/export terms and inspect fields before ingestion. [NCWRC Where to Fish](https://www.ncwildlife.gov/fishing/where-fish)
- **Virginia:** Virginia DWR exposes a statewide maintained boating-access FeatureServer and public services for lakes, stocked trout waters, wild trout streams, coldwater streams, and anadromous fish use. Each layer needs a separate freshness and use review; the service catalog alone does not guarantee an open redistribution license. [Virginia DWR public services](https://services.dwr.virginia.gov/arcgis/rest/services/Public), [DWR boating access](https://services.dwr.virginia.gov/arcgis/rest/services/Public/BoatingAccessSites/FeatureServer)

## Implementation sequence

1. **Generalize state and region configuration.** Replace the AL/GA union and hand-coded coastal tests with a state registry and explicit region definitions. Keep current region IDs, labels, bounds, and destination behavior stable. Add SC only after its eligible coverage is known; later add NC and VA through the same registry.
2. **Create a source manifest and adapter boundary.** Each source declares state coverage, theme, endpoint, stable identity field, geometry and CRS, refresh metadata, attribution/use terms, field mapping, and caveats. Per-agency adapters normalize into the existing shared schemas; do not let agency field names leak into UI logic.
3. **Ingest SC into staging first.** Produce counts, rejected-record reasons, duplicate candidates, state-boundary checks, and sample records without overwriting production catalogs. Inspect map placement around major reservoirs, rivers, coast, and SC/GA border waters.
4. **Preserve cross-state water identities.** A shared reservoir or river should remain one destination with multiple state associations. Keep fishing rules and links state-specific; do not infer jurisdiction from a centroid or map outline.
5. **Pass gates before enabling SC in the app.** Verify source provenance for every imported feature, no empty/invalid geometry, IDs are stable, symbols resolve through the global registry, waterbody references resolve, cards render, search/selection/zoom work, and saved trips/offline downloads do not regress. Check AL/GA golden IDs and content before and after.
6. **Preview before production.** Run build and existing tests plus new state-specific fixtures. Validate representative desktop/mobile flows and offline map packs on the isolated preview. Production remains unchanged until an explicit promotion request.

## First coding slice completed

The initial code change is the state/region configuration and regression-test layer, without changing the visible list or importing new point records. State coverage now distinguishes available AL/GA from planned SC/NC/VA, while the existing region IDs, labels, bounds, and coastal membership remain covered by regression checks. The next slice adds the vetted SCDNR access source to staging and compares it against the existing access/restroom semantics. Fish attractors and hydrography follow only after their source-level checks pass. This order avoids publishing a wide, mostly empty map or confusing visitors with stale or ambiguously located features.
