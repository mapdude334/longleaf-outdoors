# Longleaf Atlas

**Spatially Driven Recreation**

**Public preview:** [Open Longleaf Atlas](https://mapdude334.github.io/longleaf-outdoors/).

This is an actively developed recreation-planning preview. Live map services, species field guides, saved spots and area downloads are available; full-region offline packs are not published yet. Downloaded areas cover only the selected extent and zoom levels. Physical-phone airplane-mode and background GPS behavior still need field verification. See [mobile and offline test results](docs/MOBILE_OFFLINE_QA.md).

**An offline-first outdoor map for the Southeast, for fishing, hunting, paddling and public-land access.** The first region is East Alabama and West Georgia, covering the Tallapoosa and Middle Chattahoochee basins from Lake Wedowee and West Point Lake down to Lake Eufaula. Coverage is set in `pipeline/sources.json` and is built to grow region by region. It's an installable web app (PWA) that runs on phones, tablets and desktops. You can host it for free on GitHub Pages, and it keeps working with no cell signal once you've downloaded your region.

| | |
|---|---|
| 🗺️ **Basemaps** | Vector OpenStreetMap basemap (offline), USGS Topo, USGS Imagery, Imagery+Topo, hillshade, 3D terrain, contour lines (ft) |
| 🏞️ **Public lands** | PAD-US 4.1, which covers WMAs, national and state forests and parks, USACE project lands and NGO preserves. Colored by manager, with dashed outlines for restricted or closed access |
| 🏠 **Parcels** | Free public county parcels where they're available: Lee Co., AL (City of Opelika GIS) and Muscogee Co., GA (Columbus). Add more counties in `pipeline/sources.json` |
| 🚤 **Access** | Boat ramps, fishing piers, kayak/canoe put-ins, marinas, campgrounds and trailheads, from OpenStreetMap |
| 🐟 **Waters** | Species, notes and links for major lakes and rivers, joined to NHD lakes and streams so you can tap a water body to see its fishery info |
| 🌊 **Live water** | USGS gauges for flow, stage, lake elevation and water temperature, with 48-hour trends |
| ⚡ **Dams** | Generation and release sources for Georgia Power, Alabama Power and USACE dams, the nearest live gauges, and USACE CWMS data where it's available |
| ⛅ **Weather** | NWS forecast, hourly forecast and alerts, current conditions with barometric pressure, NEXRAD radar, sun/moon times and solunar periods |
| 📍 **My spots** | Waypoints with notes, GPS track recording, and GPX import/export for fish finders, Garmin and onX |
| 📴 **Offline** | Download region packs (PMTiles) to the device and save areas of imagery, topo or terrain. Live data falls back to the last cached values |

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

The app works right away with **live services**: USGS basemaps, PAD-US and parcel map services, and OSM access points pulled through Overpass. Building the **offline packs** adds the vector basemap and crisp vector overlays.

```bash
# Linux / WSL2 / GitHub Actions
pipeline/scripts/00_setup.sh        # gdal, tippecanoe, pmtiles CLI
pipeline/scripts/run_all.sh         # → pipeline/out/{basemap,overlays,parcels}.pmtiles
mkdir -p public/tiles && cp pipeline/out/*.pmtiles public/tiles/   # local testing
```

You can also skip local builds entirely: run **Actions ▸ Build map data** on GitHub. It publishes the `.pmtiles` files to a release, and optionally to Cloudflare R2.

## Deploy to GitHub Pages

1. Push this repo to GitHub. Then go to **Settings ▸ Pages ▸ Source: GitHub Actions**.
2. Run **Actions ▸ Build map data** once. It runs monthly after that.
3. Choose where the tiles are hosted (see [docs/HOSTING.md](docs/HOSTING.md)):
   - **Simple:** set the repo variable `PAGES_HOST_TILES=true`. The deploy workflow copies the PMTiles into the Pages site. Keep the total under about 1 GB by setting `basemap_maxzoom` to 14.
   - **Recommended for the full region at z15:** use Cloudflare R2, which has a free tier and supports range requests and CORS. Then set `VITE_TILE_BASE` to the bucket URL.
4. Push to `main` and the **Deploy app** workflow publishes `https://<you>.github.io/<repo>/`.

On a phone, open the site and choose **Add to Home Screen**. Then use **Offline ▸ Download** for each region pack before heading out.

## How it's built

```
pipeline/ (Python + GDAL + tippecanoe + pmtiles)        app/ (Vite + TypeScript + MapLibre GL)
 10 Protomaps daily OSM build ─ pmtiles extract ─┐       ┌─ basemap.pmtiles  → vector basemap
 30 PAD-US + county parcels (ArcGIS REST) ───────┤       ├─ overlays.pmtiles → lands, water, access
 35 public-land label points                     ├──▶ ──┤─ parcels.pmtiles  → parcels
 40 OSM ramps/piers/put-ins (Overpass)           │       │   (streamed by HTTP range, or saved to OPFS)
 50 NHD HR lakes + named streams (HU4 GDB)       │       ├─ USGS Water Data API, NWS API, USACE CWMS (live, cached)
 60 join waters.json species → NHD               │       ├─ USGS TNM raster tiles + AWS terrain (SW cache)
 70 tippecanoe → PMTiles ────────────────────────┘       └─ waypoints/tracks in browser storage, GPX I/O
```

**Why this stack?**

- **PMTiles** packs each tileset into one static file. It can be read over HTTP range requests or from a file on the device, so you don't need a tile server, and the files work on GitHub Pages or any bucket.
- **MapLibre GL JS** is the open-source standard for vector maps. It handles hillshade, 3D terrain and custom protocols, and through `maplibre-contour` it can draw contours client-side from the same DEM, so there's no extra download for contours.
- **Protomaps / OpenStreetMap** gives a free, ODbL-licensed global basemap, and a daily build can be clipped to the region in minutes.
- **QGIS** serves as the QA and styling bench. Run `qgis/load_longleaf_outdoors.py` in the QGIS Python console to load every output next to the live sources. You don't need a separate desktop GIS such as GeoLibre or RustGIS: the pipeline is scriptable and runs headless in CI.

## Editing content

- `public/data/waters.json` holds the species, notes and links for each water body. `gnis_names` controls how entries are joined to NHD features.
- `public/data/dams.json` holds dams, operators, release-info links, the gauge search radius and CWMS name patterns.
- `pipeline/sources.json` holds the AOI, zoom levels, and the ArcGIS layers to mirror. To add a county parcel service, add another `parcels_*` entry.

## Data sources & licenses

See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md). The short version: everything is public domain (USGS, NWS, USACE) or open (OpenStreetMap, ODbL; attribution is shown on the map). County parcel data is used under each county's public-access terms.

## Disclaimer

This map is for recreation planning. It isn't a survey, a navigation chart or a legal determination of access. Always follow posted signs, state regulations and landowner permission. Water levels below dams change rapidly.

## License

MIT for the code. Data stays under its own licenses.
