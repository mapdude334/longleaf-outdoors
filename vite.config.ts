import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE: '/' for a custom domain or local dev; '/<repo>/' for https://<user>.github.io/<repo>/
const base = process.env.BASE_PATH ?? '/';

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
      includeAssets: ['icons/*.svg', 'icons/*.png', 'data/*.json'],
      manifest: {
        name: 'Longleaf Outdoors',
        short_name: 'Longleaf Outdoors',
        description: 'Offline outdoor map for the Southeast: public lands, access, lakes & species, live river gauges, dam releases and weather.',
        theme_color: '#1e3a2b',
        background_color: '#1e3a2b',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,mjs}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Never let the SW touch PMTiles range requests — they're served from OPFS or the network.
        navigateFallbackDenylist: [/\.pmtiles$/],
        runtimeCaching: [
          // Cache names must match src/offline.ts (RASTER_CACHE / STATIC_CACHE)
          tileCache(/^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/.*\/tile\//, 'vw-raster', 80000),
          tileCache(/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//, 'vw-raster', 80000),
          tileCache(/^https:\/\/protomaps\.github\.io\/basemaps-assets\//, 'vw-static', 2000),
          {
            urlPattern: /\/(MapServer|FeatureServer)\/export\?/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'vw-arcgis', expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
});
