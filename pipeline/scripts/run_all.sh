#!/usr/bin/env bash
# Full rebuild. Outputs land in pipeline/out/: basemap.pmtiles, terrain.pmtiles, overlays.pmtiles, parcels.pmtiles
set -euo pipefail
cd "$(dirname "$0")"
./10_basemap.sh
# python3 20_terrain.py   # optional: self-host terrain.pmtiles (set VITE_TERRAIN_URL accordingly)
python3 30_fetch_arcgis.py
python3 35_label_points.py
python3 40_fetch_osm.py
python3 50_nhd.py
python3 60_enrich_waters.py
./70_build_tiles.sh
ls -lh ../out/*.pmtiles
