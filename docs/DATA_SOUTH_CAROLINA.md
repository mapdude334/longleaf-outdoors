# South Carolina catalog phase

The South Carolina phase extends the existing statewide catalog and destination workflow while leaving the original East Alabama / West Georgia regional map packs unchanged.

## Sources and handling

- SCDNR public water-access layer: https://services.arcgis.com/acgZYxoN5Oj8pDLa/ArcGIS/rest/services/South_Carolina_Public_Water_Access_PUBLIC_VIEW/FeatureServer/0
- SCDNR fish-attractor and habitat-project layer: https://services.arcgis.com/acgZYxoN5Oj8pDLa/ArcGIS/rest/services/SCDNR_Freshwater_Fish_Attractors_Public_Web_App/FeatureServer/0
- Census TIGERweb state outline: https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0
- SCDNR access guidance: https://dnr.sc.gov/lakes/access.html
- SCDNR fishing regulations: https://www.dnr.sc.gov/regs/fishing.html
- SCDNR license guidance: https://www.dnr.sc.gov/licenses/genlicense.html

The audited SCDNR access release contained 1,030 records: 1,027 listed open, 2 closed, and 1 with limited access. The app preserves the agency status on each point and prevents closed points from being selected as trip launches. The 265 access records with a restroom flag are represented as facility restroom locations, with a card note that the restroom itself may be elsewhere on the property.

The access catalog contributes 287 new named destination groups after merging geographically matching cross-border waters into their existing curated destination IDs and separating distant same-named lakes by county. A generic `Pond` label is deliberately not promoted to a destination. Destination centers and extents are calculated from agency access points; they are not shoreline boundaries or surveyed waterbody centers. Species chips are limited to species explicitly listed by SCDNR at access records.

The SCDNR habitat layer contains 129 `Fish Habitat Project` and 257 `Non-Fish Habitat Project` records. SCDNR's public app describes those records as reflecting agency information as of June 2023. Both categories remain visible with this age caveat and a warning that materials and positions may have changed; the points are not sonar, depth, or navigation data.

All point types use the app's shared Maki-style symbol registry. South Carolina points, trip launch choices, destination cards, source attribution, and agency links remain in the same app catalogs and are included in browser offline data. Regional PMTiles are not extended by this change; users can save a view area through the existing offline-area workflow.

## Rebuild and safeguards

1. Run `python pipeline/scripts/47_stage_sc.py` to fetch the complete SCDNR layers and simplified Census outline into the ignored `pipeline/staging/south-carolina/` review folder. Partial pages, duplicate GlobalIDs, invalid coordinates, and out-of-state records are reported or rejected before staging.
2. Run `python pipeline/scripts/48_build_sc_preview.py` to write candidate catalogs to the same ignored staging folder without changing `public/data`.
3. Review `candidate/south-carolina-report.json`, counts, statuses, duplicate names, geometry, and source-age notes. Run `python pipeline/scripts/48_build_sc_preview.py --apply` only after that review; it replaces its generated SC slice so reruns do not duplicate points.
4. Run `npm run test:statewide`, `npm run test:regions`, `npm run test:preview`, and `npm run build` before publishing to the isolated preview.

No SC data is added to production unless production promotion is separately requested.
