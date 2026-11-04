"""Stage North Carolina water polygons from NC OneMap and USGS 3DHP for review.

The two source snapshots and comparison report are written only to the ignored
pipeline/staging/north-carolina/ directory. This script never edits public/data,
map tiles, regional archives, or offline packs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "pipeline" / "staging" / "north-carolina"
CACHE = ROOT / "pipeline" / "cache" / "nc-hydrography"
BOUNDARY_PATH = STAGING / "state-boundary.geojson"

NC_ONEMAP_URL = "https://services.nconemap.gov/secure/rest/services/NC1Map_Hydrography/FeatureServer/2"
NC_ONEMAP_TERMS_URL = "https://www.nconemap.gov/pages/terms"
USGS_3DHP_URL = "https://hydro.nationalmap.gov/arcgis/rest/services/3DHP_all/FeatureServer/60"
USGS_3DHP_CREDIT = "U.S. Geological Survey, The National Map / 3D Hydrography Program (3DHP)"
MAX_PAGE_SIZE = 2000
CACHE_SECONDS = 12 * 60 * 60


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def source_edit_time(metadata: dict) -> str | None:
    value = (metadata.get("editingInfo") or {}).get("lastEditDate")
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return datetime.fromtimestamp(value / 1000, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def request_json(url: str, params: dict, *, refresh: bool = False) -> dict:
    """GET short ArcGIS requests; POST long spatial filters and cache responses."""
    encoded = urlencode(params, doseq=True)
    cache_key = hashlib.sha256((url + "?" + encoded).encode("utf-8")).hexdigest()
    cached = CACHE / f"{cache_key}.json"
    if not refresh and cached.exists() and time.time() - cached.stat().st_mtime < CACHE_SECONDS:
        return json.loads(cached.read_text(encoding="utf-8"))

    for attempt in range(3):
        try:
            headers = {"User-Agent": "LongleafAtlas-NC-Hydrography-Review/1.0"}
            if len(url) + len(encoded) + 1 > 1800:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
                request = Request(url, data=encoded.encode("utf-8"), headers=headers)
            else:
                request = Request(url + "?" + encoded, headers=headers)
            with urlopen(request, timeout=90) as response:
                value = json.load(response)
            if value.get("error"):
                raise RuntimeError(f"ArcGIS error for {url}: {value['error']}")
            CACHE.mkdir(parents=True, exist_ok=True)
            cached.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
            return value
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
            if attempt == 2:
                raise RuntimeError(f"Could not retrieve {url}: {error}") from error
            time.sleep(attempt + 1)
    raise AssertionError("unreachable")


def arcgis_polygon(geometry: dict) -> dict:
    """Convert a GeoJSON polygon boundary to the rings form expected by ArcGIS."""
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "Polygon":
        rings = coords
    elif kind == "MultiPolygon":
        rings = [ring for polygon in coords for ring in polygon]
    else:
        raise RuntimeError(f"Expected polygon state boundary, found {kind!r}")
    if not rings:
        raise RuntimeError("North Carolina boundary has no polygon rings")
    return {"rings": rings, "spatialReference": {"wkid": 4326}}


def get_oid_field(metadata: dict) -> str:
    field = metadata.get("objectIdField") or metadata.get("objectIdFieldName")
    if field:
        return field
    for item in metadata.get("fields", []):
        if item.get("type") == "esriFieldTypeOID":
            return item["name"]
    raise RuntimeError(f"Source has no object ID field: {metadata.get('name')}")


def fetch_layer(url: str, *, boundary_geometry: dict, refresh: bool) -> tuple[dict, list[dict]]:
    metadata = request_json(url, {"f": "json"}, refresh=refresh)
    oid_field = get_oid_field(metadata)
    # Use the service's own feature limit where it is below our conservative cap.
    # The USGS statewide intersection is large, so tiny 200-feature pages would
    # need hundreds of requests without improving the integrity checks.
    page_size = min(
        MAX_PAGE_SIZE,
        int(metadata.get("standardMaxRecordCount") or metadata.get("maxRecordCount") or MAX_PAGE_SIZE),
    )
    if page_size < 1:
        page_size = MAX_PAGE_SIZE
    spatial = {
        "geometry": json.dumps(boundary_geometry, separators=(",", ":")),
        "geometryType": "esriGeometryPolygon",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
    }
    id_result = request_json(url + "/query", {
        "f": "json", "where": "1=1", "returnIdsOnly": "true", **spatial,
    }, refresh=refresh)
    object_ids = id_result.get("objectIds") or []
    if not object_ids:
        raise RuntimeError(f"Spatial query returned no features from {url}")

    features: list[dict] = []

    def fetch_batch(batch: list) -> list[dict]:
        try:
            response = request_json(url + "/query", {
                "f": "geojson", "objectIds": ",".join(map(str, batch)),
                "outFields": "*", "outSR": 4326, "returnGeometry": "true",
                "returnZ": "false", "geometryPrecision": 7,
            }, refresh=refresh)
        except RuntimeError:
            # Large/complex USGS geometry pages can intermittently fail at the
            # service. Split only the failing page; successful pages remain in
            # the local response cache and are reused on the next run.
            if len(batch) <= 100:
                raise
            midpoint = len(batch) // 2
            return fetch_batch(batch[:midpoint]) + fetch_batch(batch[midpoint:])

        page = response.get("features") or []
        returned = set()
        for feature in page:
            properties = feature.get("properties") or {}
            value = properties.get(oid_field)
            if value is None:
                value = next((v for k, v in properties.items() if k.lower() == oid_field.lower()), None)
            if value is not None:
                returned.add(str(value))
        if returned != {str(value) for value in batch}:
            raise RuntimeError(
                f"Incomplete feature page from {url}: expected {len(batch)}, got {len(returned)}"
            )
        return page

    for offset in range(0, len(object_ids), page_size):
        batch = object_ids[offset:offset + page_size]
        page = fetch_batch(batch)
        features.extend(page)
        print(f"  {metadata.get('name', url)}: {len(features):,}/{len(object_ids):,}", flush=True)

    if len(features) != len(object_ids):
        raise RuntimeError(f"Fetched {len(features)} of {len(object_ids)} IDs from {url}")
    return {"metadata": metadata, "object_id_field": oid_field, "source_count": len(object_ids)}, features


def property_value(properties: dict, candidates: tuple[str, ...]):
    lower = {key.lower(): value for key, value in properties.items()}
    for key in candidates:
        value = lower.get(key.lower())
        if value is not None and str(value).strip():
            return value
    return None


def positions(value):
    if isinstance(value, (list, tuple)):
        if len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
            yield value[0], value[1]
        else:
            for child in value:
                yield from positions(child)


def feature_bbox(feature: dict) -> list[float] | None:
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates")
    points = list(positions(coords)) if coords is not None else []
    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def geometry_issues(feature: dict) -> list[str]:
    geometry = feature.get("geometry") or {}
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind not in {"Polygon", "MultiPolygon"}:
        return [f"unexpected_geometry_{kind or 'missing'}"]
    polygons = [coords] if kind == "Polygon" else coords
    problems = []
    if not polygons:
        return ["empty_polygon"]
    for polygon in polygons:
        if not polygon:
            problems.append("empty_polygon_part")
        for ring in polygon:
            if len(ring) < 4:
                problems.append("short_ring")
                continue
            if ring[0][:2] != ring[-1][:2]:
                problems.append("unclosed_ring")
            for point in ring:
                if len(point) < 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in point[:2]):
                    problems.append("invalid_coordinate")
                    break
                if not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
                    problems.append("coordinate_outside_lonlat")
                    break
    return problems


def normalized_name(value) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\b(lake|reservoir|pond|river|creek|stream|branch|run|bay|sound|estuary|canal)\b", " ", text)
    return re.sub(r"[^a-z0-9]", "", text)


def safe_name(feature: dict, source: str) -> str:
    properties = feature.get("properties") or {}
    if source == "nc_onemap":
        # STREAM_NAM is the service's display field and generally carries the
        # fuller label; WATERBODY can be a truncated/alternate water name.
        value = property_value(properties, ("stream_nam", "waterbody"))
    else:
        value = property_value(properties, ("gnisidlabel", "name", "gnis_name"))
    return str(value).strip() if value is not None else ""


def bbox_intersects(a: list[float] | None, b: list[float] | None) -> bool:
    if not a or not b:
        return False
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def summarize_source(source: str, features: list[dict]) -> tuple[dict, dict[str, list[dict]]]:
    names: dict[str, list[dict]] = defaultdict(list)
    types = Counter()
    named = 0
    invalid = Counter()
    extents = []
    for feature in features:
        props = feature.get("properties") or {}
        name = safe_name(feature, source)
        key = normalized_name(name)
        bbox = feature_bbox(feature)
        issues = geometry_issues(feature)
        invalid.update(issues)
        if bbox:
            extents.append(bbox)
        # NC OneMap has no feature-kind field; WATERBODY is a name field, not a
        # type. Do not misreport names or water-quality class as geometry type.
        feature_type = property_value(props, ("featuretypelabel",)) if source == "usgs_3dhp" else None
        if feature_type:
            types[str(feature_type)] += 1
        if key:
            named += 1
            names[key].append({
                "name": name,
                "source_id": feature.get("id") or property_value(props, ("objectid", "OBJECTID", "id3dhp")),
                "bbox": bbox,
                "feature_type": str(feature_type),
            })
    bbox = None
    if extents:
        bbox = [min(x[0] for x in extents), min(x[1] for x in extents), max(x[2] for x in extents), max(x[3] for x in extents)]
    summary = {
        "feature_count": len(features),
        "named_feature_count": named,
        "unnamed_feature_count": len(features) - named,
        "geometry_types": dict(Counter((f.get("geometry") or {}).get("type", "missing") for f in features)),
        "feature_type_field": "featuretypelabel" if source == "usgs_3dhp" else None,
        "feature_type_counts": dict(types.most_common()),
        "dwq_class_counts": dict(Counter(
            str(value) for feature in features
            if (value := property_value(feature.get("properties") or {}, ("dwq_class",))) is not None
        ).most_common()) if source == "nc_onemap" else {},
        "bounding_box_wgs84": bbox,
        "geometry_issues": dict(invalid),
        "unique_normalized_names": len(names),
    }
    if source == "usgs_3dhp":
        workunits = Counter(
            str(property_value(feature.get("properties") or {}, ("workunitid",)) or "(blank)")
            for feature in features
        )
        feature_dates = [
            int(value) for feature in features
            if (value := property_value(feature.get("properties") or {}, ("featuredate",))) is not None
        ]
        summary["workunitid_counts"] = dict(workunits.most_common())
        summary["legacy_nhd_feature_count"] = workunits.get("NHD", 0)
        summary["featuredate_utc_range"] = (
            [datetime.fromtimestamp(min(feature_dates) / 1000, timezone.utc).date().isoformat(),
             datetime.fromtimestamp(max(feature_dates) / 1000, timezone.utc).date().isoformat()]
            if feature_dates else None
        )
    return summary, names


def compare_sources(nc_summary, usgs_summary, nc_names, usgs_names) -> dict:
    shared = sorted(set(nc_names) & set(usgs_names))
    same_name_pairs = 0
    bbox_candidates = 0
    samples = []
    for key in shared:
        # Very short roots such as "new" or "white" create generic collisions
        # after stripping waterbody suffixes. Preserve those in totals but do not
        # promote them as useful review candidates.
        if len(key) < 6:
            continue
        left = nc_names[key]
        right = usgs_names[key]
        same_name_pairs += len(left) * len(right)
        overlaps = []
        for a in left:
            for b in right:
                if bbox_intersects(a.get("bbox"), b.get("bbox")):
                    bbox_candidates += 1
                    if len(overlaps) < 8:
                        overlaps.append({"nc_onemap": a["name"], "usgs_3dhp": b["name"], "bbox_intersects": True})
        if len(samples) < 50:
            samples.append({
                "normalized_name": key,
                "nc_onemap_records": len(left),
                "usgs_3dhp_records": len(right),
                "bbox_intersection_candidate_pairs": len(overlaps),
                "examples": overlaps,
            })

    return {
        "method": "Normalized-name intersection plus bounding-box overlap screen. Name roots shorter than six characters are excluded from candidate counts because they produce generic collisions. Candidate pairs are not verified feature matches; polygon intersection/topology and stable identity still require GIS review.",
        "shared_normalized_names": len(shared),
        "short_generic_name_roots_excluded": len([key for key in shared if len(key) < 6]),
        "same_name_record_pairs": same_name_pairs,
        "same_name_pairs_with_intersecting_bounding_boxes": bbox_candidates,
        "sample_shared_names": samples,
        "nc_only_normalized_name_count": len(set(nc_names) - set(usgs_names)),
        "usgs_only_normalized_name_count": len(set(usgs_names) - set(nc_names)),
        "nc_onemap_unique_names": nc_summary["unique_normalized_names"],
        "usgs_3dhp_unique_names": usgs_summary["unique_normalized_names"],
    }


def atomic_json(path: Path, value: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="ignore the 12-hour response cache")
    args = parser.parse_args()
    if not BOUNDARY_PATH.exists():
        raise SystemExit("Missing the review-only Census boundary. Run pipeline/scripts/49_stage_nc.py first.")

    boundary_collection = json.loads(BOUNDARY_PATH.read_text(encoding="utf-8"))
    boundary_features = [feature for feature in boundary_collection.get("features", []) if (feature.get("properties") or {}).get("STUSAB") == "NC"]
    if len(boundary_features) != 1:
        raise RuntimeError("Expected exactly one staged Census boundary for North Carolina")
    boundary_geometry = arcgis_polygon(boundary_features[0].get("geometry") or {})
    retrieved_at = now_iso()

    print("Fetching statewide NC OneMap major water polygons…", flush=True)
    nc_source, nc_features = fetch_layer(NC_ONEMAP_URL, boundary_geometry=boundary_geometry, refresh=args.refresh)
    print(f"Retrieved {len(nc_features):,} NC OneMap polygons.", flush=True)
    print("Fetching the corresponding USGS 3DHP waterbody polygons…", flush=True)
    usgs_source, usgs_features = fetch_layer(USGS_3DHP_URL, boundary_geometry=boundary_geometry, refresh=args.refresh)
    print(f"Retrieved {len(usgs_features):,} USGS 3DHP polygons.", flush=True)

    nc_summary, nc_names = summarize_source("nc_onemap", nc_features)
    usgs_summary, usgs_names = summarize_source("usgs_3dhp", usgs_features)
    issues = {
        "nc_onemap": nc_summary["geometry_issues"],
        "usgs_3dhp": usgs_summary["geometry_issues"],
    }
    fatal = {source: values for source, values in issues.items() if values}
    if fatal:
        raise RuntimeError(f"Polygon QA found geometry problems; no candidate snapshots written: {fatal}")

    nc_collection = {
        "type": "FeatureCollection", "source": "NC OneMap / North Carolina Center for Geographic Information and Analysis",
        "sourceUrl": NC_ONEMAP_URL, "retrievedAt": retrieved_at, "features": nc_features,
    }
    usgs_collection = {
        "type": "FeatureCollection", "source": USGS_3DHP_CREDIT,
        "sourceUrl": USGS_3DHP_URL, "retrievedAt": retrieved_at, "features": usgs_features,
    }

    STAGING.mkdir(parents=True, exist_ok=True)
    atomic_json(STAGING / "nc-onemap-waterbodies.geojson", nc_collection)
    atomic_json(STAGING / "usgs-3dhp-waterbodies.geojson", usgs_collection)
    atomic_json(STAGING / "nc-hydrography-source-metadata.json", {
        "retrieved_at": retrieved_at,
        "nc_onemap": nc_source["metadata"],
        "usgs_3dhp": usgs_source["metadata"],
    })

    report = {
        "state": "NC", "retrieved_at": retrieved_at,
        "status": "review only; neither source is written to app catalogs, map tiles, regional archives, or offline packs",
        "boundary": {
            "source": boundary_collection.get("source_url") or "U.S. Census Bureau TIGERweb",
            "geometry_source": "pipeline/staging/north-carolina/state-boundary.geojson",
            "purpose": "spatial request filter only; it is not used to clip source polygons",
        },
        "sources": {
            "nc_onemap": {
                "agency": "North Carolina Center for Geographic Information and Analysis / NC OneMap",
                "url": NC_ONEMAP_URL,
                "service_item_id": nc_source["metadata"].get("serviceItemId"),
                "terms_url": NC_ONEMAP_TERMS_URL,
                "source_updated": source_edit_time(nc_source["metadata"]),
                "object_id_field": nc_source["object_id_field"], "record_count_reported": nc_source["source_count"],
                "record_count_staged": len(nc_features),
                "reuse_review": "NC OneMap's published policy says data, web services, and applications provided directly by its geoportal are free to use without restriction and do not require written release agreements. Retain the layer's service metadata, source credit, and disclaimer when redistributing.",
            },
            "usgs_3dhp": {
                "agency": "U.S. Geological Survey",
                "url": USGS_3DHP_URL,
                "source_updated": source_edit_time(usgs_source["metadata"]),
                "object_id_field": usgs_source["object_id_field"], "record_count_reported": usgs_source["source_count"],
                "record_count_staged": len(usgs_features),
                "reuse_review": "USGS source is public domain; preserve the service credit and its accuracy/use limitations.",
            },
        },
        "nc_onemap": nc_summary,
        "usgs_3dhp": usgs_summary,
        "comparison": compare_sources(nc_summary, usgs_summary, nc_names, usgs_names),
        "limitations": [
            "The NC OneMap major hydrography layer is described as a subset of detailed 1:24,000-scale hydrography, not a complete angler-access inventory.",
            "The 3DHP service can combine newly derived hydrography with legacy NHD where replacement data are not available; inspect workunitid and featuredate before describing a feature as newly surveyed.",
            "For this North Carolina intersection, every returned 3DHP waterbody has workunitid=NHD and featuredate=2023-09-14; this is legacy hydrography, not evidence of new 3DHP coverage in NC.",
            "Name and bounding-box matches are review candidates only. They do not prove identical waterbodies, legal boundaries, current shorelines, public access, fish species, or navigability.",
            "Source polygons are selected by intersection with the staged Census boundary and are retained without clipping so shared/cross-border features remain intact.",
        ],
        "outputs": [
            "pipeline/staging/north-carolina/nc-onemap-waterbodies.geojson",
            "pipeline/staging/north-carolina/usgs-3dhp-waterbodies.geojson",
            "pipeline/staging/north-carolina/nc-hydrography-source-metadata.json",
            "pipeline/staging/north-carolina/hydrography-comparison.json",
        ],
    }
    atomic_json(STAGING / "hydrography-comparison.json", report)
    print(f"NC OneMap: {nc_summary['feature_count']:,} polygons; {nc_summary['named_feature_count']:,} named.")
    print(f"USGS 3DHP: {usgs_summary['feature_count']:,} polygons; {usgs_summary['named_feature_count']:,} named.")
    print(f"Possible same-name candidates: {report['comparison']['shared_normalized_names']:,}; "
          f"bbox-overlap pairs: {report['comparison']['same_name_pairs_with_intersecting_bounding_boxes']:,}.")
    print(f"Review-only report: {STAGING / 'hydrography-comparison.json'}")
    print("No application catalogs or map assets were changed.")


if __name__ == "__main__":
    main()
