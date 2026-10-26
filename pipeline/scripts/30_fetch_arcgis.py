"""Download ArcGIS REST layers (PAD-US, county parcels, ...) clipped to the AOI as GeoJSON.

Pages through the service using objectIds so it works on MapServer layers that
cap results at maxRecordCount (typically 1000-2000) and on servers without
resultOffset support.

    python3 30_fetch_arcgis.py               # all layers in sources.json
    python3 30_fetch_arcgis.py public_lands  # one layer
"""
from __future__ import annotations

import json
import sys

from common import OUT, bbox, http_get, sources, write_geojson

CHUNK = 500  # object ids per request (keeps URLs short and responses small)


def fetch_layer(cfg: dict) -> None:
    url = cfg["url"].rstrip("/")
    xmin, ymin, xmax, ymax = bbox()
    geom = {"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax, "spatialReference": {"wkid": 4326}}
    base = {
        "where": cfg.get("where", "1=1"),
        "geometry": json.dumps(geom),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
    }
    print(f"[{cfg['id']}] {cfg['title']}")
    ids_json = json.loads(http_get(url + "/query", {**base, "returnIdsOnly": "true", "f": "json"}))
    if "error" in ids_json:
        raise RuntimeError(ids_json["error"])
    ids = sorted(ids_json.get("objectIds") or [])
    print(f"  {len(ids):,} features intersect AOI")

    features: list[dict] = []
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i:i + CHUNK]
        body = {
            "objectIds": ",".join(map(str, chunk)),
            "outFields": cfg.get("out_fields", "*"),
            "outSR": 4326,
            "returnGeometry": "true",
            "geometryPrecision": 6,
            "f": "geojson",
        }
        # POST avoids URL-length limits
        from urllib.parse import urlencode
        raw = http_get(url + "/query", data=urlencode(body).encode())
        fc = json.loads(raw)
        if "error" in fc:
            raise RuntimeError(fc["error"])
        if len(fc.get("features", [])) != len(chunk):
            raise RuntimeError(f"Incomplete batch: expected {len(chunk)} features, got {len(fc.get('features', []))}")
        for f in fc.get("features", []):
            f["properties"] = {k: v for k, v in (f.get("properties") or {}).items() if v not in (None, "", " ")}
            f["properties"]["_src"] = cfg["id"]
            if cfg.get("county"):
                f["properties"]["county"] = cfg["county"]
            features.append(f)
        print(f"  {min(i + CHUNK, len(ids)):,}/{len(ids):,}", end="\r")
    print()
    write_geojson(OUT / f"{cfg['id']}.geojson", features)


def main() -> None:
    wanted = set(sys.argv[1:])
    failures = []
    for cfg in sources()["arcgis"]:
        if wanted and cfg["id"] not in wanted:
            continue
        try:
            fetch_layer(cfg)
        except Exception as e:  # noqa: BLE001 - keep going; one county outage shouldn't kill the build
            print(f"  !! {cfg['id']} failed: {e}")
            failures.append(cfg["id"])
    if failures:
        raise RuntimeError("Incomplete source downloads: " + ", ".join(failures))


if __name__ == "__main__":
    main()
