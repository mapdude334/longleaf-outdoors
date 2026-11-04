"""Stage current NCWRC boating-access and public-fishing-area layers for review.

The output stays under ignored pipeline/staging/north-carolina. The source
items explicitly limit use to free, public, non-commercial use; the catalog
builder can consume this only with source credits and liability disclaimers.
"""
from __future__ import annotations

import html
import json
import math
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "pipeline" / "staging" / "north-carolina"
BOUNDARY_PATH = STAGING / "state-boundary.geojson"
BOUNDARY_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0"
COUNTY_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1"
SOURCES = {
    "baa": {
        "url": "https://services1.arcgis.com/YfqBAUM5nWR3yhGP/ArcGIS/rest/services/NCWRC_Boating_Access_Areas_view/FeatureServer/0",
        "item_id": "825b21606e2040aabed210d878b2f3e5",
        "required": {"BAA_Name", "Water_Access", "County", "Site_Status", "Restroom", "Latitude", "Longitude"},
    },
    "pfa": {
        "url": "https://services1.arcgis.com/YfqBAUM5nWR3yhGP/ArcGIS/rest/services/NCWRC_Public_Fishing_Areas_view/FeatureServer/0",
        "item_id": "8f95684ae6ad4f6f95532100c6e41b79",
        "required": {"PFA_Name", "Water_Access", "Waterbody_Type", "County", "Site_Status", "Restroom", "Latitude", "Longitude"},
    },
}
PAGE_SIZE = 500


def request_json(url: str, params: dict | None = None) -> dict:
    full_url = url + ("?" + urlencode(params) if params else "")
    for attempt in range(3):
        try:
            req = Request(full_url, headers={"User-Agent": "LongleafAtlas-NC-Data/1.0"})
            with urlopen(req, timeout=60) as response:
                payload = json.load(response)
            if payload.get("error"):
                raise RuntimeError(f"ArcGIS error: {payload['error']}")
            return payload
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise AssertionError("unreachable")


def iso_ms(value):
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return datetime.fromtimestamp(value / 1000, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    for index, point in enumerate(ring):
        previous = ring[index - 1]
        if (point[1] > lat) != (previous[1] > lat):
            crossing = (previous[0] - point[0]) * (lat - point[1]) / (previous[1] - point[1]) + point[0]
            if lon < crossing:
                inside = not inside
    return inside


def point_in_geometry(lon: float, lat: float, geometry: dict) -> bool:
    polygons = [geometry.get("coordinates", [])] if geometry.get("type") == "Polygon" else geometry.get("coordinates", [])
    for polygon in polygons:
        if not polygon or not point_in_ring(lon, lat, polygon[0]):
            continue
        if not any(point_in_ring(lon, lat, hole) for hole in polygon[1:]):
            return True
    return False


def fetch_source(key: str, cfg: dict, retrieved_at: str, state_geometry: dict) -> tuple[dict, list[dict]]:
    metadata = request_json(cfg["url"], {"f": "json"})
    fields = {field["name"] for field in metadata.get("fields", [])}
    missing = sorted(cfg["required"] - fields)
    if missing:
        raise RuntimeError(f"{key} source schema changed; required fields missing: {missing}")
    oid = metadata.get("objectIdField") or metadata.get("objectIdFieldName")
    if not oid:
        raise RuntimeError(f"{key} layer did not publish an object ID field")
    ids = request_json(cfg["url"] + "/query", {"f": "json", "where": "1=1", "returnIdsOnly": "true"}).get("objectIds") or []
    if not ids:
        raise RuntimeError(f"{key} layer returned no record IDs")
    rows = []
    for offset in range(0, len(ids), PAGE_SIZE):
        batch = ids[offset:offset + PAGE_SIZE]
        page = request_json(cfg["url"] + "/query", {
            "f": "json", "objectIds": ",".join(map(str, batch)), "outFields": "*",
            "outSR": 4326, "returnGeometry": "true", "geometryPrecision": 7,
        }).get("features", [])
        returned = {str((row.get("attributes") or {}).get(oid)) for row in page}
        if returned != {str(value) for value in batch}:
            raise RuntimeError(f"Incomplete {key} page at {offset}: expected {len(batch)} records, got {len(returned)}")
        rows.extend(page)
    if len(rows) != len(ids):
        raise RuntimeError(f"{key} feature count mismatch: {len(rows)} of {len(ids)}")

    item = request_json(f"https://www.arcgis.com/sharing/rest/content/items/{cfg['item_id']}", {"f": "json"})
    license_text = html.unescape(re.sub(r"<[^>]+>", " ", str(item.get("licenseInfo") or "")))
    license_text = re.sub(r"\s+", " ", license_text).strip()
    if "free, public, non-commercial use only" not in license_text.lower():
        raise RuntimeError(f"{key} terms changed or could not be confirmed; refusing to stage for redistribution")

    features = []
    outside = []
    duplicate_ids = set()
    seen = set()
    for row in rows:
        attrs = row.get("attributes") or {}
        source_id = attrs.get(oid)
        if source_id is None or str(source_id) in seen:
            duplicate_ids.add(str(source_id))
            continue
        seen.add(str(source_id))
        geom = row.get("geometry") or {}
        try:
            lon, lat = float(geom["x"]), float(geom["y"])
        except (KeyError, TypeError, ValueError):
            raise RuntimeError(f"{key} object {source_id} has no valid point geometry")
        if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
            raise RuntimeError(f"{key} object {source_id} has invalid lon/lat")
        if not point_in_geometry(lon, lat, state_geometry):
            outside.append({"object_id": source_id, "coordinates": [lon, lat]})
            continue
        clean = {name: value for name, value in attrs.items() if value is not None}
        clean.update({
            "source_layer": key,
            "source_object_id": str(source_id),
            "source_url": cfg["url"],
            "source_item_url": f"https://www.arcgis.com/home/item.html?id={cfg['item_id']}",
            "source_license": license_text,
            "source_updated": iso_ms((metadata.get("editingInfo") or {}).get("lastEditDate")),
            "retrieved_at": retrieved_at,
        })
        features.append({
            "type": "Feature", "id": f"ncwrc-{key}-{source_id}",
            "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            "properties": clean,
        })
    if duplicate_ids:
        raise RuntimeError(f"{key} duplicate object IDs found: {sorted(duplicate_ids)[:8]}")
    if outside:
        raise RuntimeError(f"{key} contains {len(outside)} point(s) outside North Carolina; refusing a partial snapshot: {outside[:8]}")
    info = {
        "agency": "North Carolina Wildlife Resources Commission",
        "title": item.get("title") or metadata.get("name"),
        "layer_name": metadata.get("name"),
        "url": cfg["url"],
        "item_url": f"https://www.arcgis.com/home/item.html?id={cfg['item_id']}",
        "source_updated": iso_ms((metadata.get("editingInfo") or {}).get("lastEditDate")),
        "record_count_reported": len(ids), "record_count_staged": len(features),
        "object_id_field": oid, "fields": sorted(fields),
        "item_license_info": license_text,
        "terms": "free, public, non-commercial use only",
        "disclaimer": "NCWRC makes no warranty as to accuracy, reliability, or completeness; conditions and accessibility can change; NCWRC disclaims liability for improper or incorrect use.",
    }
    return info, features


def main() -> None:
    if not BOUNDARY_PATH.exists():
        raise SystemExit("Missing Census boundary; run pipeline/scripts/49_stage_nc.py first")
    boundary_fc = json.loads(BOUNDARY_PATH.read_text(encoding="utf-8"))
    matches = [feature for feature in boundary_fc.get("features", []) if (feature.get("properties") or {}).get("STUSAB") == "NC"]
    if len(matches) != 1:
        raise RuntimeError("Expected one staged Census North Carolina boundary")
    boundary = matches[0].get("geometry") or {}
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    county_fc = request_json(COUNTY_URL + "/query", {
        "f": "geojson", "where": "STATE = '37'", "outFields": "NAME,STATE,COUNTY,GEOID",
        "outSR": 4326, "returnGeometry": "true", "maxAllowableOffset": 0.0015, "geometryPrecision": 6,
    })
    county_features = county_fc.get("features", [])
    if len(county_features) != 100 or any((feature.get("properties") or {}).get("STATE") != "37" for feature in county_features):
        raise RuntimeError(f"Expected 100 Census NC county polygons, received {len(county_features)}")
    (STAGING / "nc-county-boundaries.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "source": "U.S. Census Bureau TIGERweb", "retrievedAt": retrieved_at, "features": county_features}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    metadata, all_features = {}, []
    for key, cfg in SOURCES.items():
        print(f"Fetching current NCWRC {key.upper()} data…", flush=True)
        info, features = fetch_source(key, cfg, retrieved_at, boundary)
        metadata[key] = info
        all_features.extend(features)
        status_field = "Site_Status"
        print(f"  {len(features):,} verified points; statuses={dict(Counter(str(f['properties'].get(status_field, '(blank)')) for f in features))}", flush=True)
    STAGING.mkdir(parents=True, exist_ok=True)
    collection = {
        "type": "FeatureCollection", "source": "North Carolina Wildlife Resources Commission",
        "retrievedAt": retrieved_at, "features": all_features,
    }
    (STAGING / "ncwrc-access-review.geojson").write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    report = {
        "state": "NC", "retrieved_at": retrieved_at,
        "status": "review snapshot; coordinates verified against the Census NC boundary; use permitted only for free, public, non-commercial applications",
        "sources": metadata,
        "county_boundaries": {"source": COUNTY_URL, "record_count": len(county_features), "retrieved_at": retrieved_at},
        "combined_record_count": len(all_features),
        "limitations": [
            "The PFA and BAA are distinct agency layers; coincident locations must be reviewed before rendering to avoid duplicate symbols.",
            "Restroom and accessibility values are facility-level attributes; a point does not mark the restroom or accessible feature's exact position.",
            "Conditions, ownership, open status, hours, and access can change; verify with NCWRC before travel.",
            "The public-fishing-area and boating-access metadata explicitly limits use to free, public, non-commercial use only.",
        ],
    }
    (STAGING / "ncwrc-access-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Staged {len(all_features):,} NCWRC features. No app catalogs were changed.", flush=True)


if __name__ == "__main__":
    main()
