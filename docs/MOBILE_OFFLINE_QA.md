# Mobile and offline verification

Tested October 26, 2026 in the desktop app's Chromium browser. These results do not establish physical iPhone or Android compatibility.

## Results

- Production TypeScript and Vite/PWA build: passed.
- Original reliability checks: 8 passed (`tools/reliability.html`).
- Additional offline checks: 13 passed (`tools/offline-checks.html`).
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

- No regional PMTiles packs are published in this checkout. Archive tests used a small valid synthetic PMTiles archive, not the full regional build. Area download tests used real map services.
- Test the installed app in airplane mode on a physical phone, including panning across saved-area edges and label rendering at different zooms.
- Physical GPS, background/screen-lock behavior, OS keyboard behavior, storage eviction, and Safari-specific behavior remain unverified. GPS recording still requires keeping the app open.
- Browser storage may be cleared unless persistence is granted. Archive verification does not establish source-data completeness, freshness, or legal access.
