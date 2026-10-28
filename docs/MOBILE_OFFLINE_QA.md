# Mobile and offline verification

## Trip reliability refinement pass — October 26, 2026

- Trip backup validation: seven browser checks passed (round-trip fields, schema, duplicate IDs, invalid coordinates, oversized notes, missing map view, unnamed trips).
- A draft name, date and notes survived a browser reload and were restored through My Trips.
- A ramp card's "Use as my launch" action populated that recovered draft without losing its notes.
- A map-placed pin was renamed, saved and displayed in the trip readiness summary.
- Navigation with My Trips passed overflow, visibility and 44px touch-target checks at 320 × 568, 390 × 844 and 844 × 390.
- The production build passed. These are desktop Chromium and simulated viewport checks, not physical-device evidence.

### Physical-device release checklist (still required)

On both an iPhone/Safari and Android/Chrome: install the PWA; save a trip, launch and pin; download a small topo/terrain area; then enable airplane mode, close and reopen the app. Verify the saved trip, map tiles, labels and icons across the downloaded zoom levels. Confirm failed/incomplete downloads remain clearly labeled. Separately verify GPS recording with the screen locked and the app backgrounded before claiming background recording support.

#### Repeatable area-download acceptance

1. Start online with a clean test area and confirm the app reports the selected map extent and requested layers/maximum zoom before downloading. Use a small area first to stay within browser storage limits.
2. Download the area and wait for a clear completed state. Open Saved Maps, confirm the area appears with its layer, zoom, size and status details, then reopen it once while still online.
3. Enable airplane mode and confirm cellular and Wi-Fi are both disabled. Fully close the app, relaunch it, and open the saved area from Saved Maps.
4. Pan to every edge of the saved extent and inspect each downloaded zoom. Confirm the basemap, terrain, labels, app symbols, cached catalog cards, selected destination polygon, and saved trip points render. Use a layer toggle and verify it does not imply unavailable live data is current.
5. Pan outside the saved extent and zoom above the downloaded maximum. The app should make the coverage limit clear and should not present missing tiles as a complete offline map.
6. Return online. Confirm the app recovers, retains the saved area and user data, and reports whether any live data refreshed. Repeat the full sequence separately on iPhone/Safari and Android/Chrome.
7. Attempt one deliberately interrupted or rejected download. Confirm it is marked incomplete/failed, cannot be mistaken for a ready offline area, and does not replace a previously valid saved area.

Record device model, OS/browser version, app build, download extent/layers/zoom, storage estimate, and any missing tiles or labels. Do not mark physical-device acceptance complete from desktop viewport emulation or a server-unavailable reload.

Tested October 26, 2026 in the desktop app's Chromium browser. These results do not establish physical iPhone or Android compatibility.

## Results

- Production TypeScript and Vite/PWA build: passed.
- Original reliability checks: 8 passed (`tools/reliability.html`).
- Additional offline checks: 14 passed (`tools/offline-checks.html`).
- Responsive app viewports: 320 × 568, 390 × 844, and 844 × 390 passed checks for page overflow, navigation visibility, and 44px navigation touch targets. A same-origin iframe provides repeatable viewport testing in `tools/mobile-checks.html`.
- On a 390px phone view, downloaded a small West Point Lake area with topo and terrain through zoom 13. The raster cache increased from 6 to 33 tiles. No browser errors were reported during this check.
- Stopped the local production server, verified it was unreachable, then reloaded the installed application. The app shell loaded and the temporary saved waypoint remained available. Removed the test waypoint afterward. External services were still reachable in this test: this was a server-unavailable reload, not a device airplane-mode test.
- Isolated network-failure checks verified cached live data fallback, OPFS archive reopen, preservation of valid archives during invalid/truncated replacements, and Cache Storage fallback when OPFS is unavailable. Test fixtures were restored/removed after use.

## Fixes made

- Phone tabs use two rows and 44px touch targets. The collapsed panel measures its navigation height so both rows remain reachable.
- Search can shrink on narrow screens; form inputs use a 16px font on phones. Header/map positioning includes safe-area padding; panels use dynamic viewport height and scrollable content.
- Exploring the lake collapses the phone panel and reserves space for its navigation. Desktop map padding also updates after resizing.
- Area planning includes overview zooms, handles terrain when viewing above zoom 12, and stops building oversized request lists after 15,001 tiles.
- Area controls initialize without waiting for remote pack checks. Pack checks have timeouts and skip network checks for saved archives.
- Tile requests time out. Failed, incomplete, and cancelled downloads have distinct messages. Empty or oversized selections cannot start a download.
- Offline preparation caches sprite images and metadata along with label fonts, and reports missing assets.
- Recent cached data is marked offline when the device reports no network.
- Archive validation traverses its directory in addition to checking metadata and declared byte ranges.
- Local lake notes and dam information render without waiting for slower live services. Map style restoration waits for style readiness.
- Fixed rounded coordinates displaying 60.000 minutes instead of carrying into the next degree.

## Remaining verification

- Regional release tiles-20261026-3 is published. On the live GitHub Pages app, the real 99.2 MB basemap and 28.6 MB overlay archives downloaded and passed archive validation. Both remained verified after reopening. The download regression also covers compressed HTTP transfers; archive sizes are checked against the canonical manifest rather than compressed transfer headers. Parcel coverage remains Lee County, AL and Muscogee County, GA; core regional bounds are [-86.35, 31.55, -84.35, 33.85].
- Test the installed app in airplane mode on a physical phone, including panning across saved-area edges and label rendering at different zooms.
- Physical GPS, background/screen-lock behavior, OS keyboard behavior, storage eviction, and Safari-specific behavior remain unverified. GPS recording still requires keeping the app open.
- Browser storage may be cleared unless persistence is granted. Archive verification does not establish source-data completeness, freshness, or legal access.


## Pictogram symbology pass — October 26, 2026

- Replaced map point dots with 14 locally bundled badge SVGs, using Maki CC0 glyphs plus matching custom ramp, paddle, fish, hiking and gauge glyphs. Attribution and license are in public/symbols/.
- Checked topo and imagery rendering, basemap switching, consistent legend/cards/trip symbols, and selection highlighting in desktop Chromium. No browser errors during the imagery check.
- All 14 badges are in the production service worker precache. The 320 × 568 phone preview passed overflow, visible navigation and 44px navigation target checks. Physical-device offline tests remain outstanding.
