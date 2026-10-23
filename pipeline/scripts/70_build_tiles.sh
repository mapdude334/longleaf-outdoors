#!/usr/bin/env bash
# Build vector overlay tilesets with tippecanoe -> PMTiles.
#   overlays.pmtiles : public_lands(+_labels), water_bodies, streams, access, osm_dams   (~20-80 MB)
#   parcels.pmtiles  : county parcels (only where free public services exist)  (~50-300 MB)
set -euo pipefail
cd "$(dirname "$0")/../out"

layer() { [ -s "$2" ] && echo "-L" "{\"layer\":\"$1\",\"file\":\"$2\"}" || true; }

# shellcheck disable=SC2046
tippecanoe -o overlays.pmtiles --force \
  --name="Valley Waters overlays" \
  --attribution="USGS PAD-US 4.1; USGS NHD; © OpenStreetMap contributors (ODbL)" \
  -Z6 -z14 --drop-densest-as-needed --detect-shared-borders --simplify-only-low-zooms -r1 \
  $(layer public_lands public_lands.geojson) \
  $(layer public_lands_labels public_lands_labels.geojson) \
  $(layer water_bodies water_bodies.geojson) \
  $(layer streams streams.geojson) \
  -L'{"layer":"access","file":"access.geojson"}' \
  $(layer osm_dams osm_dams.geojson)

PARCEL_FILES=$(ls parcels_*.geojson 2>/dev/null || true)
if [ -n "$PARCEL_FILES" ]; then
  # shellcheck disable=SC2086
  tippecanoe -o parcels.pmtiles --force --name="Parcels (public county GIS)" \
    --attribution="County GIS (Lee Co. AL via City of Opelika; Columbus/Muscogee GA)" \
    -l parcels -Z12 -z15 --detect-shared-borders --drop-densest-as-needed $PARCEL_FILES
fi
ls -lh ./*.pmtiles
