"""Fetch South Carolina DNR layers into review-only staging files.

This script never writes public/data or tile inputs. Staged features retain the
agency fields and are not eligible for display until an explicit adapter and
data-quality review are approved.
"""
from __future__ import annotations

import json
import math
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "pipeline" / "staging" / "south-carolina"
SC_BOUNDS = (-83.6, 31.8, -78.4, 35.35)  # generous data QA envelope, not a legal boundary
SOURCES = {
    "access": {
        "url": "https://services.arcgis.com/acgZYxoN5Oj8pDLa/ArcGIS/rest/services/South_Carolina_Public_Water_Access_PUBLIC_VIEW/FeatureServer/0",
        "expected_fields": {"GlobalID", "WaterAccessType", "WaterAccessName", "Waterbody", "Status", "PublicAccess"},
    },
    "fish_attractors": {
        "url": "https://services.arcgis.com/acgZYxoN5Oj8pDLa/ArcGIS/rest/services/SCDNR_Freshwater_Fish_Attractors_Public_Web_App/FeatureServer/0",
        "expected_fields": {"GlobalID", "FishAttractorName", "FishAttractorType", "Waterbody"},
    },
}
BOUNDARY_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0"
PAGE_SIZE = 200


def request_json(url: str, params: dict | None = None) -> dict:
    full_url = url + ("?" + urlencode(params) if params else "")
    for attempt in range(3):
        try:
            req = Request(full_url, headers={"User-Agent": "LongleafAtlas-SC-Staging/1.0"})
            with urlopen(req, timeout=60) as response:
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


def in_sc_envelope(lon: float, lat: float) -> bool:
    west, south, east, north = SC_BOUNDS
    return west <= lon <= east and south <= lat <= north


def normalize_layer(name: str, config: dict, retrieved_at: str) -> tuple[dict, dict]:
    url = config["url"]
    metadata = request_json(url, {"f": "json"})
    fields = {field["name"] for field in metadata.get("fields", [])}
    missing_fields = sorted(config["expected_fields"] - fields)
    if missing_fields:
        raise RuntimeError(f"{name}: expected source fields missing: {missing_fields}")
    oid_field = metadata.get("objectIdField") or metadata.get("objectIdFieldName")
    if not oid_field:
        raise RuntimeError(f"{name}: source does not expose an object ID field")
    ids_doc = request_json(url + "/query", {"f": "json", "where": "1=1", "returnIdsOnly": "true"})
    ids = ids_doc.get("objectIds") or []
    if not ids:
        raise RuntimeError(f"{name}: source returned no object IDs")

    raw_rows = []
    for offset in range(0, len(ids), PAGE_SIZE):
        batch = ids[offset:offset + PAGE_SIZE]
        page = request_json(url + "/query", {
            "f": "json", "objectIds": ",".join(map(str, batch)), "outFields": "*",
            "outSR": 4326, "returnGeometry": "true", "geometryPrecision": 7,
        }).get("features", [])
        returned = {str((row.get("attributes") or {}).get(oid_field)) for row in page}
        if returned != {str(value) for value in batch}:
            raise RuntimeError(f"{name}: incomplete page at offset {offset}; refusing to stage partial data")
        raw_rows.extend(page)

    if len(raw_rows) != len(ids):
        raise RuntimeError(f"{name}: expected {len(ids)} rows but fetched {len(raw_rows)}")

    seen_ids: set[str] = set()
    features = []
    rejected = Counter()
    out_of_bounds = []
    geometry_vs_tabular_distance = []
    for row in raw_rows:
        attrs = row.get("attributes") or {}
        stable_id = str(attrs.get("GlobalID") or "").strip().strip("{}").lower()
        if not stable_id:
            rejected["missing_global_id"] += 1
            continue
        if stable_id in seen_ids:
            rejected["duplicate_global_id"] += 1
            continue
        seen_ids.add(stable_id)
        geom = row.get("geometry") or {}
        try:
            lon, lat = float(geom["x"]), float(geom["y"])
        except (KeyError, TypeError, ValueError):
            rejected["missing_or_invalid_point"] += 1
            continue
        if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
            rejected["invalid_coordinate_range"] += 1
            continue
        if not in_sc_envelope(lon, lat):
            out_of_bounds.append({"id": stable_id, "coordinates": [lon, lat]})
            rejected["outside_sc_qa_envelope"] += 1
            continue
        explicit_lon, explicit_lat = attrs.get("Longitude"), attrs.get("Latitude")
        if explicit_lon is None:
            explicit_lon, explicit_lat = attrs.get("lon_dd"), attrs.get("lat_dd")
        try:
            if explicit_lon is not None and explicit_lat is not None:
                x, y = float(explicit_lon), float(explicit_lat)
                if math.isfinite(x) and math.isfinite(y) and -180 <= x <= 180 and -90 <= y <= 90:
                    # Approximate local meters are sufficient for discrepancy flags.
                    meters = math.hypot((x - lon) * 111320 * math.cos(math.radians(lat)), (y - lat) * 110540)
                    if meters > 50:
                        geometry_vs_tabular_distance.append({"id": stable_id, "meters": round(meters, 1)})
        except (TypeError, ValueError):
            rejected["invalid_tabular_coordinates"] += 1
        props = {key: value for key, value in attrs.items() if value is not None}
        props.update({"source_layer": name, "source_url": url, "source_global_id": stable_id, "retrieved_at": retrieved_at})
        features.append({"type": "Feature", "id": f"scdnr-{name}-{stable_id}", "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]}, "properties": props})

    category_fields = {
        "access": ["WaterAccessType", "WaterAccessSubType", "WaterType", "WaterbodyType", "Status", "PublicAccess", "Restrooms"],
        "fish_attractors": ["FishAttractorType", "Material", "Waterbody", "county"],
    }[name]
    distributions = {}
    for field in category_fields:
        distributions[field] = dict(Counter(str((row.get("attributes") or {}).get(field) or "(empty)") for row in raw_rows).most_common())
    report = {
        "layer": name,
        "service_name": metadata.get("name"),
        "service_description": metadata.get("serviceDescription"),
        "copyright_text": metadata.get("copyrightText"),
        "url": url,
        "object_id_field": oid_field,
        "global_id_field": metadata.get("globalIdField"),
        "source_edited_at": as_iso((metadata.get("editingInfo") or {}).get("lastEditDate")),
        "record_count_reported": len(ids),
        "record_count_staged": len(features),
        "rejected": dict(rejected),
        "duplicates_global_id": len(raw_rows) - len({str((r.get("attributes") or {}).get("GlobalID", "")).strip("{}").lower() for r in raw_rows}),
        "out_of_bounds_sample": out_of_bounds[:20],
        "tabular_geometry_discrepancy_over_50m_count": len(geometry_vs_tabular_distance),
        "tabular_geometry_discrepancy_over_50m_sample": geometry_vs_tabular_distance[:20],
        "category_distributions": distributions,
        "reuse_terms_reviewed": False,
        "status": "review only; not included in app catalogs or tiles",
    }
    return {"type": "FeatureCollection", "source": metadata.get("copyrightText"), "sourceUrl": url, "sourceUpdated": report["source_edited_at"], "retrievedAt": retrieved_at, "features": features}, report


def main() -> None:
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    STAGING.mkdir(parents=True, exist_ok=True)
    products = {}
    for name, config in SOURCES.items():
        products[name], report = normalize_layer(name, config, retrieved_at)
        (STAGING / f"{name}.geojson").write_text(json.dumps(products[name], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        products[name + "_report"] = report
        print(f"{name}: staged {report['record_count_staged']}/{report['record_count_reported']} features; rejects={report['rejected']}", flush=True)
    boundary = request_json(BOUNDARY_URL + "/query", {
        "f": "geojson", "where": "STUSAB = 'SC'", "outFields": "STUSAB,NAME", "outSR": 4326,
        "returnGeometry": "true", "maxAllowableOffset": 0.003, "geometryPrecision": 5,
    })
    features = boundary.get("features", [])
    if len(features) != 1 or (features[0].get("properties") or {}).get("STUSAB") != "SC" or (features[0].get("geometry") or {}).get("type") not in {"Polygon", "MultiPolygon"}:
        raise RuntimeError("South Carolina boundary query was incomplete; refusing to stage catalogs")
    boundary.update({"source_url": BOUNDARY_URL, "retrieved_at": retrieved_at})
    (STAGING / "state-boundary.geojson").write_text(json.dumps(boundary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    audit = {"retrieved_at": retrieved_at, "state": "SC", "bounds_are_qa_envelope_only": list(SC_BOUNDS), "layers": {name: products[name + "_report"] for name in SOURCES}}
    audit["boundary_source"] = BOUNDARY_URL
    (STAGING / "report.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Review-only staging written to {STAGING.relative_to(ROOT)}; no public catalogs or map tiles were changed.", flush=True)


if __name__ == "__main__":
    main()
