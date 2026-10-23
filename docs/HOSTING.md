# Hosting the app and tiles

The app is static files, which GitHub Pages serves. The map data consists of three PMTiles archives that must be served with **HTTP range requests** and, if they're on a different origin, **CORS**.

| File | Typical size (AOI, defaults) | Notes |
|---|---|---|
| `basemap.pmtiles` | ~150–400 MB at z15, ~60–150 MB at z14 | Set `basemap_maxzoom` in `pipeline/sources.json` |
| `overlays.pmtiles` | ~20–80 MB | PAD-US, NHD, OSM access, dams |
| `parcels.pmtiles` | ~30–150 MB | Only the counties listed in `sources.json` |

## Option A: everything on GitHub Pages (simplest)

- Set the repo variable `PAGES_HOST_TILES=true`. The deploy workflow then downloads the `.pmtiles` files from the newest `tiles-*` release into `dist/tiles/`.
- Pages serves range requests on the same origin, so no CORS setup is needed.
- Limits: the published site should stay under about **1 GB**, and there's a soft bandwidth limit of about 100 GB/month. Use `basemap_maxzoom: 14` if you're close to the limit.

## Option B: Cloudflare R2 for the tiles (recommended)

1. Create a bucket and connect a public custom domain (or use the r2.dev URL).
2. Add a CORS policy that allows `GET` and `HEAD` from your Pages origin, with `Range` as an allowed header and `Content-Length`, `Content-Range` and `ETag` exposed:
   ```json
   [{"AllowedOrigins":["https://<you>.github.io"],"AllowedMethods":["GET","HEAD"],
     "AllowedHeaders":["Range","If-Match"],"ExposeHeaders":["Content-Length","Content-Range","ETag"],"MaxAgeSeconds":86400}]
   ```
3. Add these repo secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. The data workflow uploads to `valley-waters/` in the bucket.
4. Set the repo variable `VITE_TILE_BASE=https://tiles.example.com/valley-waters/` and redeploy.

The free tier covers 10 GB of storage with no egress fees. Any S3, Azure Blob or city web server with range and CORS support works the same way.

> GitHub **Release assets** can't be streamed directly by the browser: they redirect without CORS headers. Use them only as a hand-off between the workflows, as these do.

## How offline works on the device

- **App shell and curated data.** The service worker (Workbox) precaches them, so the app opens with no signal.
- **Region packs.** **Offline ▸ Download** streams each `.pmtiles` file into the Origin Private File System, or into Cache Storage on older Safari. The map then reads tiles straight from the local file. Persistent storage is requested so the browser won't evict the packs.
- **Raster areas.** **Save visible area** pre-fetches USGS topo, imagery and terrain tiles into the same cache the service worker uses, so hillshade and contours work offline too.
- **Live data.** Gauges, weather, access and the dam panels store their last response, and the panel shows how old the cached data is.

iOS note: Safari caps storage per site, and installed home-screen apps get more room. If you need multi-GB regions on iPhones, wrap the app with Capacitor (see the roadmap).
