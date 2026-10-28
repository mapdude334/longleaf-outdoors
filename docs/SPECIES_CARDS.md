# Species field guide

Updated October 27, 2026.

- The guide contains 29 species profiles. All 25 distinct fish labels in the South Carolina destination catalog now open a species card or an explicit choice when the catalog uses an ambiguous name. The overall waters catalog is checked as well.
- Shared freshwater species switch to South Carolina-specific size, season, diet, habitat and behavior notes when opened from a South Carolina water. Other destinations retain their existing regional guidance.
- Added South Carolina profiles for smallmouth bass, chain pickerel, brook trout, brown trout, rainbow trout, warmouth, yellow perch, walleye, red drum, sheepshead, spotted seatrout, southern flounder and summer flounder. A generic “Flounder” label offers both coastal species rather than guessing which one the catalog meant.
- Exact “Black crappie” and “White crappie” labels now open only their own cards; generic “Crappie” and combined crappie labels still offer both.
- Cards include identification, reference sizes, spawning, diet, habitat, behavior and linked agency sources. South Carolina facts are paraphrases from SCDNR species pages. SCDNR freshwater pages may cite the agency’s 2009 freshwater fish guide, so timing is presented as guidance and the card directs users to current regulations.
- Local photographs are shown only when a species match and reuse provenance were already verified. The South Carolina additions reuse cleared photos for smallmouth bass, walleye, yellow perch and southern flounder. Other new profiles intentionally have no photo until a suitable species-specific image is verified. Existing local photos remain packaged with the app for offline display.

## Gauge names and trends

- The USGS station-name request uses the supported agency filter. Local aliases for stations 02339400 and 02339402 were checked against USGS monitoring-location metadata: West Point Lake near West Point, GA, and Chattahoochee River below West Point Dam, GA. Station IDs remain in expanded records.
- Gauge trend requests start when the destination's gauge panels open. Late identify responses no longer replace a panel after the user navigates elsewhere.

Reproduction: run the development server, then open `tools/species-checks.html`. Catalogue: `src/species-data.ts`. Label handling and rendering: `src/species.ts`. Photo credits: `src/data/species-photos.json`.
