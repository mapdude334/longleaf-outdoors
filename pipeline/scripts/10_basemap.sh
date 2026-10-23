#!/usr/bin/env bash
# Extract the OpenStreetMap vector basemap (Protomaps v4 schema) for the AOI.
# Uses HTTP range requests against the daily planet build — downloads only the AOI's tiles.
set -euo pipefail
cd "$(dirname "$0")/.."
BBOX=$(python3 -c "import json;print(','.join(map(str,json.load(open('sources.json'))['aoi']['bbox'])))")
MAXZ=$(python3 -c "import json;print(json.load(open('sources.json'))['aoi']['basemap_maxzoom'])")
BUILD="${PROTOMAPS_BUILD:-$(date -u -d 'yesterday' +%Y%m%d)}"
mkdir -p out
echo "Extracting Protomaps build $BUILD bbox=$BBOX maxzoom=$MAXZ"
pmtiles extract "https://build.protomaps.com/${BUILD}.pmtiles" out/basemap.pmtiles \
  --bbox="$BBOX" --maxzoom="$MAXZ" --download-threads=8
pmtiles show out/basemap.pmtiles | head -20
