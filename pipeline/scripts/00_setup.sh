#!/usr/bin/env bash
# Install pipeline tools on Ubuntu/Debian (GitHub Actions ubuntu-latest, WSL, or a Linux VM).
# Windows users: run inside WSL2, or install OSGeo4W (GDAL) + download pmtiles.exe and use QGIS for QA.
set -euo pipefail

sudo apt-get update -y
sudo apt-get install -y gdal-bin python3 python3-pip build-essential libsqlite3-dev zlib1g-dev git curl unzip

# tippecanoe (felt fork)
if ! command -v tippecanoe >/dev/null; then
  tmp=$(mktemp -d); git clone --depth 1 https://github.com/felt/tippecanoe.git "$tmp/tippecanoe"
  make -C "$tmp/tippecanoe" -j"$(nproc)" && sudo make -C "$tmp/tippecanoe" install
fi

# pmtiles CLI (go-pmtiles)
if ! command -v pmtiles >/dev/null; then
  # Resolve the latest release asset for Linux x86_64 (override with PMTILES_URL)
  url="${PMTILES_URL:-$(curl -fsSL https://api.github.com/repos/protomaps/go-pmtiles/releases/latest \
        | grep -o '"browser_download_url": *"[^"]*Linux_x86_64.tar.gz"' | cut -d'"' -f4)}"
  curl -fsSL -o /tmp/pmtiles.tar.gz "$url"
  tar -xzf /tmp/pmtiles.tar.gz -C /tmp pmtiles && sudo mv /tmp/pmtiles /usr/local/bin/
fi

tippecanoe --version; pmtiles version || true; ogr2ogr --version
