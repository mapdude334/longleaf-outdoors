# Species field guide and gauge names

Implemented October 26, 2026.

- All 17 distinct labels in the lake catalogue resolve to 16 individual species profiles. The combined crappie labels offer separate black and white crappie profiles; seasonal striped bass uses the striped bass profile.
- Cards include locally packaged real photographs, scientific names, identification, reference adult sizes, spawning, diet, habitat and behavior. Each card links its agency sources and its photograph's source and reuse license. Photographs were resized and converted to JPEG for the app; no animal features were generated or altered.
- Source facts are short paraphrases of the linked Outdoor Alabama, Georgia DNR and other agency profiles. Seasonal windows identify their regional context. Tallapoosa bass spawning and diet are explicitly marked unavailable in the linked profile; these details were not inferred from related species.
- Local photos are included in the PWA precache along with the compiled fact sheets, so an installed, fully cached app can display these cards without requesting remote images.
- The USGS station-name request now uses the supported agency filter. Local aliases for stations 02339400 and 02339402 were checked against USGS monitoring-location metadata: West Point Lake near West Point, GA, and Chattahoochee River below West Point Dam, GA. Station IDs remain in expanded records.
- Gauge trend requests now start when the destination's gauge panels open. Late identify responses no longer replace a panel after the user navigates elsewhere.

Validation: production build passed; `tools/species-checks.html` passed all 37 assertions and loaded all 16 local photographs. Browser checks exercised the lake-to-species flow, the crappie chooser and back navigation, and verified the two friendly gauge headings.

Reproduction: run the development server, then open `tools/species-checks.html`. Catalogue: `src/species-data.ts`. Photo credits: `src/data/species-photos.json`. Download preparation preserves source metadata in `tools/species-photo-candidates.json`; original downloads are in `tools/species-originals`. Regenerate web-sized photographs with `tools/prepare_species_photos.ps1`.
