"""Stage the official NCWRC public fishing-area layer for source review only.

The service is public to view, but its layer metadata does not state a clear
redistribution license. This script keeps the fetched copy under ignored
pipeline/staging/north-carolina/ and never changes application catalogs.
"""
from __future__ import annotations

import json
import html
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
PFA_URL = "https://services1.arcgis.com/YfqBAUM5nWR3yhGP/ArcGIS/rest/services/NCWRC_Public_Fishing_Areas_view/FeatureServer/0"
PFA_ITEM_URL = "https://www.arcgis.com/sharing/rest/content/items/8f95684ae6ad4f6f95532100c6e41b79"
BOUNDARY_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0"
NC_BOUNDS = (-84.5, 33.7, -75.3, 36.7)  # broad QA envelope, not a state boundary
PAGE_SIZE = 500
EXPECTED_FIELDS = {"PFA_Name", "County", "Waterbody_Type", "Site_Status", "Boat_Ramp", "Restroom"}


def request_json(url: str, params: dict | None = None) -> dict:
    full_url = url + ("?" + urlencode(params) if params else "")
    for attempt in range(3):
        try:
            request = Request(full_url, headers={"User-Agent": "LongleafAtlas-NC-Review/1.0"})
            with urlopen(request, timeout=60) as response:
                value = json.load(response)
            if value.get("error"):
                raise RuntimeError(f"ArcGIS error: {value['error']}")
            return value
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise AssertionError("unreachable")


def as_iso(milliseconds: int | float | None) -> str | None:
    if not milliseconds:
        return None
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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


def main() -> None:
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    metadata = request_json(PFA_URL, {"f": "json"})
    fields = {field["name"] for field in metadata.get("fields", [])}
    missing = sorted(EXPECTED_FIELDS - fields)
    if missing:
        raise RuntimeError(f"NCWRC public fishing-area service changed; expected fields missing: {missing}")
    oid_field = metadata.get("objectIdField") or metadata.get("objectIdFieldName")
    if not oid_field:
        raise RuntimeError("NCWRC layer does not expose an object ID field")

    ids_result = request_json(PFA_URL + "/query", {"f": "json", "where": "1=1", "returnIdsOnly": "true"})
    object_ids = ids_result.get("objectIds") or []
    if not object_ids:
        raise RuntimeError("NCWRC public fishing-area layer returned no records")

    raw_features = []
    for offset in range(0, len(object_ids), PAGE_SIZE):
        batch = object_ids[offset:offset + PAGE_SIZE]
        page = request_json(PFA_URL + "/query", {
            "f": "json", "objectIds": ",".join(map(str, batch)), "outFields": "*",
            "outSR": 4326, "returnGeometry": "true", "geometryPrecision": 7,
        }).get("features", [])
        returned = {str((row.get("attributes") or {}).get(oid_field)) for row in page}
        if returned != {str(value) for value in batch}:
            raise RuntimeError(f"NCWRC page at offset {offset} was incomplete; refusing to stage partial data")
        raw_features.extend(page)
    if len(raw_features) != len(object_ids):
        raise RuntimeError(f"Fetched {len(raw_features)} of {len(object_ids)} reported NCWRC points")

    features = []
    rejected = Counter()
    out_of_bounds = []
    seen_oids = set()
    for row in raw_features:
        attributes = row.get("attributes") or {}
        oid = str(attributes.get(oid_field, "")).strip()
        if not oid or oid in seen_oids:
            rejected["missing_or_duplicate_object_id"] += 1
            continue
        seen_oids.add(oid)
        geometry = row.get("geometry") or {}
        try:
            lon, lat = float(geometry["x"]), float(geometry["y"])
        except (KeyError, TypeError, ValueError):
            rejected["missing_or_invalid_point"] += 1
            continue
        if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
            rejected["invalid_coordinate_range"] += 1
            continue
        west, south, east, north = NC_BOUNDS
        if not (west <= lon <= east and south <= lat <= north):
            out_of_bounds.append({"source_object_id": oid, "coordinates": [lon, lat]})
            rejected["outside_nc_qa_envelope"] += 1
            continue
        properties = {key: value for key, value in attributes.items() if value is not None}
        properties.update({"source_object_id": oid, "source_url": PFA_URL, "retrieved_at": retrieved_at})
        features.append({
            "type": "Feature", "id": f"nc-pfa-review-{oid}",
            "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            "properties": properties,
        })
    if rejected:
        raise RuntimeError(f"Source QA rejected rows; refusing to stage incomplete layer: {dict(rejected)}")

    distribution_fields = ("Site_Status", "Waterbody_Type", "Region", "Fishing_Water_Designation", "Salinity", "Restroom", "Boat_Ramp")
    distributions = {
        field: dict(Counter(str((feature.get("attributes") or {}).get(field) or "(empty)") for feature in raw_features).most_common())
        for field in distribution_fields
    }
    item = request_json(PFA_ITEM_URL, {"f": "json"})
    license_info = html.unescape(re.sub(r"<[^>]+>", " ", str(item.get("licenseInfo") or "")))
    license_info = re.sub(r"\s+", " ", license_info).strip()
    boundary = request_json(BOUNDARY_URL + "/query", {
        "f": "geojson", "where": "STUSAB = 'NC'", "outFields": "STUSAB,NAME", "outSR": 4326,
        "returnGeometry": "true", "maxAllowableOffset": 0.003, "geometryPrecision": 5,
    })
    boundary_features = boundary.get("features", [])
    if len(boundary_features) != 1 or (boundary_features[0].get("properties") or {}).get("STUSAB") != "NC":
        raise RuntimeError("Census North Carolina boundary was missing or incomplete")
    nc_geometry = boundary_features[0].get("geometry") or {}
    outside_state = [feature["id"] for feature in features if not point_in_geometry(*feature["geometry"]["coordinates"], nc_geometry)]
    if outside_state:
        raise RuntimeError(f"{len(outside_state)} points fall outside the Census North Carolina boundary; refusing to stage: {outside_state[:12]}")

    STAGING.mkdir(parents=True, exist_ok=True)
    collection = {"type": "FeatureCollection", "source": metadata.get("copyrightText"), "sourceUrl": PFA_URL, "retrievedAt": retrieved_at, "features": features}
    (STAGING / "public-fishing-areas.geojson").write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    boundary.update({"source_url": BOUNDARY_URL, "retrieved_at": retrieved_at})
    (STAGING / "state-boundary.geojson").write_text(json.dumps(boundary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    report = {
        "state": "NC", "retrieved_at": retrieved_at,
        "status": "review only; not included in app catalogs, map tiles, or offline packs",
        "source": {
            "agency": "North Carolina Wildlife Resources Commission",
            "layer_name": metadata.get("name"), "description": metadata.get("description") or metadata.get("serviceDescription"),
            "copyright_text": metadata.get("copyrightText"), "source_updated": as_iso((metadata.get("editingInfo") or {}).get("lastEditDate")),
            "url": PFA_URL, "item_url": "https://www.arcgis.com/home/item.html?id=8f95684ae6ad4f6f95532100c6e41b79",
            "item_license_info": license_info or None, "reuse_terms_reviewed": False,
            "rights_note": "The ArcGIS item limits use to free, public, non-commercial use. Keep out of public catalogs until NCWRC clarifies whether a donation-supported app qualifies or an unrestricted source is found.",
        },
        "record_count_reported": len(object_ids), "record_count_staged": len(features),
        "object_id_field": oid_field, "fields": sorted(fields), "distributions": distributions,
        "rejected": dict(rejected), "out_of_bounds": out_of_bounds,
        "outside_state_boundary_count": len(outside_state),
        "qa_envelope_only": list(NC_BOUNDS), "boundary_source": BOUNDARY_URL,
    }
    (STAGING / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Review-only NCWRC fishing-area layer staged: {len(features):,} features.")
    print(f"No public catalogs or map tiles changed. Review report: {STAGING.relative_to(ROOT) / 'report.json'}")


if __name__ == "__main__":
    main()
