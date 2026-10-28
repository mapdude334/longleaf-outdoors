# Southeast expansion: South Carolina pilot and readiness

**Status:** The current catalogs include a partial South Carolina pilot. It is not a complete statewide fishing inventory, and source reuse review remains open for the SCDNR services used in the pilot.

## What is in the current catalogs

- **Water access:** 1,030 SCDNR locations. The source reports 1,027 as open, 2 closed, and 1 with limited access. These are agency-reported statuses, not a guarantee of current access, ownership, operating hours, or boatability.
- **Destinations:** 287 new named South Carolina destination groups were built from those access records. They are overview points derived from mapped public-access locations, not surveyed lake centers or shorelines. Cross-border waters should keep a single destination identity where the existing curated catalog match was validated.
- **Structures and habitat:** 129 fish habitat project points and 257 non-fish habitat project points from SCDNR's public attractor service. The agency app describes the content as reflecting information as of June 2023; the service's later edit timestamp does not make the individual installations current. These points are not sonar, depth, or navigation data.
- **Restrooms:** 265 facility records report restrooms. Their point geometry marks the facility; the restroom may be elsewhere on the property.
- **State outlines:** Alabama, Georgia, and South Carolina TIGERweb boundaries are available for state navigation and map fitting. They are generalized context, not water or jurisdiction boundaries.
- **Dam records:** Six South Carolina major-dam entries are present in the dam catalog. Gauge readings are a separate live-data workflow and must be verified by station and source.

Counts describe records in the current package, not the number of unique physical sites and not complete source coverage. Use the current [coverage manifest](../public/data/coverage.json) for catalog totals and per-state counts. Catalog points and map archives have separate geographic coverage; users can save a map area for offline use.

## Source and reuse gate

The staging audit for both SCDNR hosted layers currently records `reuse_terms_reviewed: false`. Public visibility or access to an ArcGIS service does not by itself document permission to redistribute its records. The catalog retains source attribution and links, but the individual service terms still need review and a recorded outcome before additional SC sources are added or the current SC slices are refreshed for wider distribution. Do not describe the pilot as a cleared, complete, or authoritative state inventory.

The audit also flags the source content date and access-status fields, which are preserved as caveats. Review source-level attribution, copyright, reuse terms, and update cadence in `pipeline/staging/south-carolina/report.json` when staging is rerun. That directory is ignored and should not be committed as raw source data.

## Safe refresh process

1. Run `python pipeline/scripts/47_stage_sc.py` to stage complete service pages and the state outline. The script stops on incomplete pages, duplicate GlobalIDs, invalid geometry, or out-of-envelope points.
2. Review `pipeline/staging/south-carolina/report.json`, especially source terms, layer dates, status distributions, rejected rows, and geometry checks. Do not treat the QA envelope as a state boundary.
3. Run `python pipeline/scripts/48_build_sc_preview.py`. Its default mode writes candidate catalogs and a candidate coverage manifest under the ignored staging folder; it does not touch `public/data`.
4. Compare the candidate report and catalogs against the current package. Check stable IDs, destination references, state labels, record counts, card and symbol categories, source notes, and cross-border destination identities.
5. Only after those checks and the reuse gate are resolved, run `python pipeline/scripts/48_build_sc_preview.py --apply`. Then run the statewide, region, preview-isolation, symbol, and production-build checks and publish only to the isolated preview for review.

The recurring AL/GA refresh now needs to preserve non-AL/GA state boundaries and habitat records and to recompute coverage totals from the actual output catalogs. That prevents a routine refresh from silently dropping SC's boundary or historical habitat records, or reverting the manifest to an AL/GA-only claim. It does not refresh the SC sources.

## Expansion sequence

1. Keep AL and GA as the established pilot footprint and treat SC as a source-limited extension with the caveats above.
2. Resolve per-layer reuse and attribution terms before extending or refreshing SC source data.
3. For North Carolina, then Virginia, inventory one official source per theme, document its terms and dates, stage it without touching catalogs, and review the candidate against shared schemas and global Maki-style symbology.
4. Preserve destination IDs and cross-border associations. State selection should filter and center the map using state boundary geometry, while app points remain independently sourced.
5. Keep regional PMTiles unchanged unless separately rebuilt and checked. Test map-area downloads on actual phones in airplane mode before claiming device-level offline reliability.

No state is considered fully covered merely because a region selector and boundary exist. Expansion is complete for a theme only when its sources, limitations, UI cards, search and trip workflows, symbology, attribution, and offline behavior have all been checked.
