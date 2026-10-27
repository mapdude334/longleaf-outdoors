import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE: '/' for a custom domain or local dev; '/<repo>/' for https://<user>.github.io/<repo>/
const base = process.env.BASE_PATH ?? '/';
const preview = process.env.VITE_PREVIEW === 'true';
const cacheName = (name: string) => preview ? `longleaf-preview-${name}` : name;

const tileCache = (pattern: RegExp, cacheName: string, maxEntries: number) => ({
  urlPattern: pattern,
  handler: 'CacheFirst' as const,
  options: {
    cacheName,
    expiration: { maxEntries, maxAgeSeconds: 60 * 60 * 24 * 180 },
    cacheableResponse: { statuses: [0, 200] },
  },
});

export default defineConfig({
  base,
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'data/*.json', 'species/*.jpg'],
      manifest: {
        name: preview ? 'Longleaf Atlas Preview' : 'Longleaf Atlas',
        short_name: preview ? 'Longleaf Preview' : 'Longleaf Atlas',
        description: 'Spatially Driven Recreation. Outdoor maps, destinations, fishing information and trip planning for the Southeast.',
        theme_color: '#1e3a2b',
        background_color: '#1e3a2b',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/pine-fishing-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pine-fishing-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/pine-fishing-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,json,mjs}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Never let the SW touch PMTiles range requests — they're served from OPFS or the network.
        navigateFallbackDenylist: [/\.pmtiles$/],
        runtimeCaching: [
          // Cache names must match src/offline.ts (RASTER_CACHE / STATIC_CACHE)
          tileCache(/^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/.*\/tile\//, cacheName('vw-raster'), 80000),
          tileCache(/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//, cacheName('vw-raster'), 80000),
          tileCache(/^https:\/\/protomaps\.github\.io\/basemaps-assets\//, cacheName('vw-static'), 2000),
          {
            urlPattern: /\/(MapServer|FeatureServer)\/export\?/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: cacheName('vw-arcgis'), expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
});
