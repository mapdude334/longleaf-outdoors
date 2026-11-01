# Florida Panhandle pilot

Longleaf's first Florida expansion is limited to the Florida Fish and Wildlife Conservation Commission (FWC) Northwest Region. It is a regional pilot, not statewide Florida coverage. The source region covers 16 counties: Escambia, Santa Rosa, Okaloosa, Walton, Holmes, Washington, Bay, Jackson, Calhoun, Gulf, Liberty, Franklin, Leon, Wakulla, Jefferson, and Gadsden.

## Included data

- 18 FWC Northwest destination guides, each with a representative point, county assignment from U.S. Census county polygons, official FWC forecast link, and Florida fishing-regulation and license links.
- Fish species shown only when a sport fish in Longleaf's existing species guide was recorded in an FWC community-fish survey from 2016 onward. Survey presence is not a current population estimate, catch rate, or forecast.
- 485 boat ramps selected from the FWC facility layer only when its record is marked both “Open for Business” and “Verified.” Fees, hours, facility conditions, and access can change; anglers should confirm before traveling.
- 442 restroom records where a restroom type is reported at a verified FWC boat-ramp facility. The point marks the facility; the restroom may be elsewhere within it.
- 47 FWC freshwater fish-attractor records. These are agency-reported locations, not live sonar or navigation information.
- FWC depth-band polygons and contours for Lake Jackson and Hurricane Lake only. These are packaged with the app for offline viewing. Survey age and vertical reference are not consistently supplied; they are not navigation charts.
- A generalized Census Florida outline is retained as reference geometry. It is hidden from map rendering because this pilot does not claim full-state data coverage.

Source reuse terms for the added FWC catalogs have not been formally reviewed; this is recorded in `public/data/coverage.json` rather than presented as a license conclusion.

Agency water names are linked to a destination only when they match one guide uniquely. In this snapshot, 112 of 485 verified ramps, 43 of 47 attractors, and 108 of 442 restroom records link to a guide; the other records retain their source water name and are not assigned a guessed destination. Restroom records inherit only the host ramp's verified association.

## Sources

- [FWC Northwest-region fishing forecasts](https://myfwc.com/fishing/freshwater/sites-forecasts/nw/)
- [FWC Northwest waters, public boat ramps, fish attractors, community fish surveys, and bathymetry](https://ocean.floridamarine.org/arcgis/rest/services/Projects_FWC/WhatsHappeningOnMyLake/MapServer)
- [FWC freshwater fishing regulations](https://myfwc.com/fishing/freshwater/regulations/)
- [U.S. Census TIGERweb state and county boundaries](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer)

## Rebuild and review

Run `python pipeline/scripts/54_build_florida_panhandle.py` to fetch a candidate under `pipeline/staging/florida-panhandle/candidate`. Inspect the report and data before applying. Run the same command with `--apply` to replace only the Florida-derived records and append the destinations while preserving existing destination IDs and non-Florida features. The Florida destination IDs are stable FWC forecast slugs prefixed with `florida-panhandle-`.
