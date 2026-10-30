# South Carolina completion and North Carolina start

**Working status (2026-10-30):** South Carolina has broad statewide point catalogs, but remains source-limited rather than complete. North Carolina source intake is beginning in a separate review-only staging lane. Neither state's current record totals should be described as complete coverage.

## South Carolina baseline and immediate metadata fix

The current package contains 292 South Carolina destination records, 1,030 access points, 265 facility restroom flags, 129 fish-habitat structure points, and 257 other habitat-project points. Of the 292 destinations, 287 are South Carolina-only records derived from the SCDNR access inventory; their linked access records already provide one or more county names, but those county names were not propagated to the destination records. The remaining five destinations are cross-border Georgia/South Carolina waters and keep their existing shared destination identity.

The SC destination species list is present on 169 of 292 water records. It is derived from species lists attached to access records, so it is a source hint rather than a complete survey, lake-specific stock assessment, or catch guarantee. The other 123 records should remain explicitly unverified until a suitable source is reviewed. The SCDNR habitat feed describes its content as June 2023 information; its later service edit time is not evidence that individual projects were refreshed.

`pipeline/scripts/49_enrich_sc_destination_counties.py` adds the already-cataloged county names to the 287 SC-only destination records. Its default mode writes a candidate under ignored staging. `--apply` changes only the `county` metadata field on those waters; IDs, access records, trip references, habitat, offline packs, and other states are preserved. The map and destination labels show one to three counties by name and summarize longer lists as “Across N Counties”; the destination notes retain the linked access context.

### SC completion gates

1. Record a per-theme source and coverage inventory: waters, public access, boat ramps, restrooms, fishing piers, fish attractors, habitat, gauges/dams, bathymetry, and species. Separate measured/agency-maintained content from generic mapped hydrography.
2. Resolve reuse/attribution terms for the two currently used SCDNR ArcGIS services before refreshing or adding SCDNR records. [SCDNR says](https://www.dnr.sc.gov/gis.html) its GIS data are free to the public for resource decision-making, analysis, and education, but the service-level redistribution terms still need a recorded review.
3. Refresh habitat only from a source that provides a trustworthy feature date or installation date. Preserve the 2023 age caveat until then.
4. Improve lake-by-lake fish information only from named SCDNR lake pages, regulations, or fisheries studies. Keep species lists separate from verified occurrence records and give each entry a source link and date.
5. Treat bathymetry as a per-water availability matrix. Do not imply statewide coverage from surface hydrography, topographic contours, or a single lake survey.
6. Reconcile gauge stations to dams/reservoirs by station metadata and location; missing gauges must be described as unavailable rather than interpreted as no flow or stable conditions.

## North Carolina first intake

NCWRC's [official fishing-access page](https://www.ncwildlife.gov/fishing/where-fish) describes more than 500 public fishing places and an official Fish Attractor Map with more than 800 sites across 60-plus waterbodies. Its map offers CSV and GPX export. NCWRC also publishes an [ArcGIS public-fishing-area point layer](https://services1.arcgis.com/YfqBAUM5nWR3yhGP/ArcGIS/rest/services/NCWRC_Public_Fishing_Areas_view/FeatureServer/0) with fields including site name, county, waterbody type, access amenities, restroom flag, salinity, and access designation. The 2026-10-30 review-stage fetch returned 261 features in that layer (241 marked open, 19 marked non-NCWRC, and 1 marked closed temporarily); this is a narrower subset than NCWRC's statewide count of fishing places.

The [public-fishing-area ArcGIS item](https://www.arcgis.com/home/item.html?id=8f95684ae6ad4f6f95532100c6e41b79) limits use to “free, public, non-commercial use only”; the feature service itself has no copyright text. `pipeline/scripts/49_stage_nc.py` stages it alongside a Census state boundary for source/QA review only and never writes to `public/data`. The official [NCWRC Boating Access Areas metadata](https://www.arcgis.com/sharing/rest/content/items/825b21606e2040aabed210d878b2f3e5/info/metadata/metadata.xml?format=default&output=html) carries the same non-commercial restriction. Because Longleaf Atlas has a donation-support option, do not ingest either feed into public catalogs until NCWRC clarifies whether this app qualifies or a different source with suitable terms is found. Fish-attractor export is a separate source and requires its own item-level terms review; public CSV/GPX export is not itself redistribution permission.

The first NC release should be limited to sources whose use terms are documented and whose records can be consistently normalized to existing water, access, restroom, habitat, species, and source-provenance schemas. Keep source IDs in staging; assign Longleaf IDs only after identity, duplicate, cross-border, county, status, and access relationships have been reviewed. Do not set NC to available or expose it as a complete destination region until the integrated catalogs, cards, shared Maki symbols, region filtering, and offline downloads are ready.

## Publication safeguards

- Candidate and raw source files stay under ignored `pipeline/staging/<state>/` directories.
- Existing AL/GA/SC record IDs and region behavior remain stable.
- New points use the shared global symbol registry and the existing destination, access, habitat, gauge, search, trip, popup, and offline workflows.
- Recompute coverage totals from final catalog payloads and report source dates and limitations.
- Keep regional PMTiles and preview offline-cache namespaces unchanged unless their separate rebuild process is explicitly part of the reviewed scope.
- Publish development changes only to the isolated preview. Production remains untouched until explicitly requested.
