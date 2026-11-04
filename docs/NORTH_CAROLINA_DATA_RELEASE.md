# North Carolina Data Expansion

This is a source-limited first statewide NC release. It adds North Carolina to the existing destination, access, restroom, map-outline, and region-filter workflows without replacing the existing Alabama, Georgia, South Carolina, or Florida catalogs.

## Included data

- **176 mapped-water destinations** derived from 313 named NC OneMap hydrography polygons. Same-name, nearby polygons are grouped; the source object IDs are retained so the selected water can request its mapped outline. These are reference waters, not a complete fishing-water inventory, public-access confirmation, bathymetry, or surveyed shoreline.
- **522 NCWRC access records:** 267 boating access areas and 261 public fishing areas, with six co-located PFA records attached to the matching ramp record to avoid duplicate map symbols. The source status, source link, source edition, county, water label, and available facility attributes are retained.
- **162 facility-level restroom flags** from NCWRC boating access and public fishing area records. Their coordinates identify the facility, not the restroom building.
- **One generalized Census TIGERweb NC state outline** for map context and the shared state-boundary layer. State zoom bounds derive from the supplied Census boundary extent; no source geometry is used as a filled polygon overlay.

## Source and use terms

- [NC OneMap major hydrography](https://services.nconemap.gov/secure/rest/services/NC1Map_Hydrography/FeatureServer/2) and [NC OneMap terms](https://www.nconemap.gov/pages/terms). NCCGIA source credit and links are retained on water records. The layer is a subset and does not establish fishing access, current conditions, or navigability.
- [NCWRC boating access](https://services1.arcgis.com/YfqBAUM5nWR3yhGP/ArcGIS/rest/services/NCWRC_Boating_Access_Areas_view/FeatureServer/0) and [NCWRC public fishing areas](https://services1.arcgis.com/YfqBAUM5nWR3yhGP/ArcGIS/rest/services/NCWRC_Public_Fishing_Areas_view/FeatureServer/0). The item terms restrict these datasets to **free, public, non-commercial use** and disclaim warranty and liability. Location cards retain this restriction and the source disclaimer; verify current status with NCWRC before travel.
- [NCWRC Where to Fish](https://www.ncwildlife.gov/fishing/where-fish) is linked from water cards for its official access and fish-attractor maps.
- NCWRC fish-attractor coordinates are **not** redistributed in this release because that service did not state item-level reuse terms. No NC species lists or bathymetry were inferred from access or hydrography records.

## Safeguards and regeneration

`pipeline/scripts/51_stage_nc_hydrography.py` stages NC OneMap water data; `pipeline/scripts/52_stage_nc_access.py` stages NCWRC records and verifies source terms, required fields, record completeness, point geometry, and containment by the Census NC boundary. The ignored `pipeline/staging/north-carolina/` folder holds snapshots for review. `pipeline/scripts/53_build_nc_catalogs.py` produces only the additive NC catalogs, updates NC coverage metadata, and adds the NC reference outline. Existing multi-state water, access, restroom, regional offline-pack, and PMTiles records are preserved.

Generated catalogs: `public/data/nc-destinations.json`, `public/data/nc-access.json`, and `public/data/nc-restrooms.json`.
