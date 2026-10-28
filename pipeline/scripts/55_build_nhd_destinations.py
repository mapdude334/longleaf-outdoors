"""Build a searchable, state-scoped NHD waterbody destination supplement.

The large source FileGDBs and Census county boundaries stay in pipeline/cache.
This script packages only named Lake/Pond, Reservoir and Estuary records of at
least five mapped acres, with public-data caveats and stable GNIS-based IDs.

Prerequisites:
  * Download the 2023 state FileGDB products from USGS TNM into
    pipeline/cache/nhd-destinations/<State>-gdb/.
  * Install GDAL/ogr2ogr and pass its path with --ogr2ogr when it is not on PATH.
  * County boundaries are fetched from the 2025 Census Cartographic Boundary file.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import unicodedata
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data"
CACHE = ROOT / "pipeline" / "cache" / "nhd-destinations"
STATE_BOUNDARIES = DATA / "state-boundaries.json"
COUNTY_URL = "https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_500k.zip"
COUNTY_ZIP = CACHE / "cb_2025_us_county_500k.zip"
COUNTIES = CACHE / "counties-2025.geojson"
NHD_LAYER_URL = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12"
NHD_EDITION = "2023-12-27"
NHD_RETIRED = "2023-10-01"
MIN_AREA_SQKM = 0.02  # approximately five acres
MIN_AREA_ACRES = 5
DEDUP_RADIUS_KM = 20
STATES = {
    "AL": {"name": "Alabama", "fips": "01", "gdb": "NHD_H_Alabama_State_GDB.gdb", "regulations": [
        {"label": "Alabama freshwater fishing regulations", "url": "https://www.outdooralabama.com/fishing/freshwater-fishing-regulations"},
        {"label": "Alabama fishing licenses", "url": "https://www.outdooralabama.com/license-information"},
    ]},
    "GA": {"name": "Georgia", "fips": "13", "gdb": "NHD_H_Georgia_State_GDB.gdb", "regulations": [
        {"label": "Georgia fishing regulations", "url": "https://georgiawildlife.com/fishing/regulations"},
        {"label": "Georgia fishing licenses", "url": "https://gooutdoorsgeorgia.com/"},
    ]},
    "SC": {"name": "South Carolina", "fips": "45", "gdb": "NHD_H_South_Carolina_State_GDB.gdb", "regulations": [
        {"label": "South Carolina fishing regulations", "url": "https://www.dnr.sc.gov/regs/fishing.html"},
        {"label": "South Carolina fishing licenses", "url": "https://www.dnr.sc.gov/licenses/genlicense.html"},
    ]},
}
FTYPES = {390: "Lake or pond", 436: "Reservoir", 493: "Coastal estuary"}
EXPORT_SQL = (
    "SELECT permanent_identifier, gnis_id, gnis_name, areasqkm, ftype, "
    "ST_X(ST_PointOnSurface(SHAPE)) AS lon, ST_Y(ST_PointOnSurface(SHAPE)) AS lat, "
    "ST_MinX(SHAPE) AS west, ST_MinY(SHAPE) AS south, "
    "ST_MaxX(SHAPE) AS east, ST_MaxY(SHAPE) AS north "
    "FROM NHDWaterbody WHERE ftype IN (390,436,493) "
    "AND gnis_name IS NOT NULL AND TRIM(gnis_name) <> '' AND areasqkm >= 0.02"
)


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    value = re.sub(r"\b(lake|pond|reservoir|impoundment)\b", "", value)
    return re.sub(r"[^a-z0-9]", "", value)


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    for i, point in enumerate(ring):
        previous = ring[i - 1]
        if (point[1] > lat) != (previous[1] > lat):
            crossing = (previous[0] - point[0]) * (lat - point[1]) / (previous[1] - point[1]) + point[0]
            if lon < crossing:
                inside = not inside
    return inside


def geometry_parts(geometry: dict) -> list[list[list[list[float]]]]:
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def geometry_bounds(geometry: dict) -> tuple[float, float, float, float]:
    points = [point for polygon in geometry_parts(geometry) for ring in polygon for point in ring]
    return min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)


def point_in_geometry(lon: float, lat: float, geometry: dict) -> bool:
    for polygon in geometry_parts(geometry):
        if not polygon or not point_in_ring(lon, lat, polygon[0]):
            continue
        if not any(point_in_ring(lon, lat, hole) for hole in polygon[1:]):
            return True
    return False


def haversine_km(a: list[float], b: list[float]) -> float:
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, math.radians(b[0] - a[0])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def find_ogr2ogr(value: str | None) -> str:
    candidate = value or os.environ.get("OGR2OGR") or shutil.which("ogr2ogr")
    if candidate and Path(candidate).exists():
        return candidate
    raise RuntimeError("GDAL ogr2ogr was not found. Install GDAL or run with --ogr2ogr <path>.")


def gdb_path(state: str) -> Path:
    expected = STATES[state]["gdb"]
    matches = list(CACHE.glob(f"**/{expected}"))
    if not matches:
        raise RuntimeError(f"Missing {expected}. Download the USGS state FileGDB to {CACHE} before rebuilding.")
    return matches[0]


def export_csv(ogr: str, state: str) -> Path:
    src = gdb_path(state)
    output = CACHE / f"{state}.csv"
    env = os.environ.copy()
    env["OGR_ORGANIZE_POLYGONS"] = "SKIP"
    subprocess.run([ogr, "-f", "CSV", str(output), str(src), "-dialect", "SQLite", "-sql", EXPORT_SQL], check=True, env=env)
    return output


def export_counties(ogr: str) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    if not COUNTY_ZIP.exists():
        print("Downloading 2025 Census county boundaries…")
        urllib.request.urlretrieve(COUNTY_URL, COUNTY_ZIP)
    vsi_zip = "/vsizip/" + COUNTY_ZIP.resolve().as_posix()
    subprocess.run([
        ogr, "-f", "GeoJSON", str(COUNTIES), vsi_zip,
        "-where", "STATEFP IN ('01','13','45')", "-select", "GEOID,NAME,STATEFP",
        "-lco", "COORDINATE_PRECISION=6",
    ], check=True)


def load_counties() -> dict[str, list[dict]]:
    counties: dict[str, list[dict]] = defaultdict(list)
    payload = json.loads(COUNTIES.read_text(encoding="utf-8"))
    for feature in payload["features"]:
        props, geometry = feature["properties"], feature["geometry"]
        state = next((code for code, item in STATES.items() if item["fips"] == str(props["STATEFP"])), None)
        if not state:
            continue
        counties[state].append({"name": props["NAME"], "bounds": geometry_bounds(geometry), "geometry": geometry})
    return counties


def county_at(point: list[float], counties: list[dict]) -> str | None:
    lon, lat = point
    for county in counties:
        west, south, east, north = county["bounds"]
        if west <= lon <= east and south <= lat <= north and point_in_geometry(lon, lat, county["geometry"]):
            return f"{county['name']} County"
    return None


def source_key(row: dict[str, str]) -> str:
    return (row.get("permanent_identifier") or "").strip().strip("{}").upper()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ogr2ogr", help="Path to GDAL ogr2ogr executable")
    args = parser.parse_args()
    ogr = find_ogr2ogr(args.ogr2ogr)
    CACHE.mkdir(parents=True, exist_ok=True)
    export_counties(ogr)

    state_geo = json.loads(STATE_BOUNDARIES.read_text(encoding="utf-8"))
    state_shapes = {feature["properties"]["STUSAB"]: feature["geometry"] for feature in state_geo["features"]}
    county_shapes = load_counties()
    curated = json.loads((DATA / "waters.json").read_text(encoding="utf-8"))["waters"]
    curated_index: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for water in curated:
        if not water.get("center"):
            continue
        for state in re.split(r"[/,]", water.get("state", "")):
            for name in [water["name"], *water.get("gnis_names", [])]:
                key = (state.strip().upper(), normalize(name))
                if key[1]:
                    curated_index[key].append(water)

    # Waterbodies can be repeated in adjacent state FileGDBs. Permanent NHD IDs
    # make source-edge duplicates deterministic before GNIS records are grouped.
    seen_permanent: set[str] = set()
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    state_shape_bounds = {code: geometry_bounds(shape) for code, shape in state_shapes.items()}
    for state in STATES:
        csv_path = export_csv(ogr, state)
        rows_read = 0
        accepted = 0
        with csv_path.open(newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                rows_read += 1
                name = (row.get("gnis_name") or "").strip()
                if not name:
                    continue
                try:
                    lon, lat = float(row["lon"]), float(row["lat"])
                    area = float(row["areasqkm"])
                    ftype = int(float(row["ftype"]))
                except (KeyError, TypeError, ValueError):
                    continue
                if not (-180 <= lon <= 180 and -90 <= lat <= 90) or area < MIN_AREA_SQKM or ftype not in FTYPES:
                    continue
                west, south, east, north = (float(row[key]) for key in ("west", "south", "east", "north"))
                sw, ss, se, sn = state_shape_bounds[state]
                if not (sw <= lon <= se and ss <= lat <= sn and point_in_geometry(lon, lat, state_shapes[state])):
                    continue
                perm_key = source_key(row)
                if perm_key and perm_key in seen_permanent:
                    continue
                if perm_key:
                    seen_permanent.add(perm_key)
                accepted += 1
                record = {
                    "permanent_identifier": (row.get("permanent_identifier") or "").strip(),
                    "gnis_id": (row.get("gnis_id") or "").strip(),
                    "name": name,
                    "area_sqkm": area,
                    "ftype": ftype,
                    "point": [lon, lat],
                    "bounds": [west, south, east, north],
                }
                identity = record["gnis_id"] or perm or hashlib.sha1(f"{state}:{name}:{lon:.6f}:{lat:.6f}".encode()).hexdigest()[:16]
                grouped[(state, identity)].append(record)
        print(f"{state}: {accepted:,} named NHD polygons retained from {rows_read:,} candidates")

    retrieved = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    output: list[dict] = []
    counts = {state: 0 for state in STATES}
    duplicate_count = 0
    for (state, identity), parts in grouped.items():
        parts.sort(key=lambda row: row["area_sqkm"], reverse=True)
        main = parts[0]
        name = main["name"]
        key = (state, normalize(name))
        repeats = curated_index.get(key, [])
        if any(haversine_km(main["point"], water["center"]) <= DEDUP_RADIUS_KM for water in repeats):
            duplicate_count += 1
            continue
        ids = sorted({row["permanent_identifier"] for row in parts if row["permanent_identifier"]})
        if main["gnis_id"]:
            local_id = f"nhd-{state.lower()}-{re.sub(r'[^a-zA-Z0-9-]', '', main['gnis_id'])}"
        else:
            digest = hashlib.sha1((parts[0]["permanent_identifier"] or identity).encode()).hexdigest()[:16]
            local_id = f"nhd-{state.lower()}-{digest}"
        total_sqkm = sum(row["area_sqkm"] for row in parts)
        area_acres = max(1, round(total_sqkm * 247.105381))
        bounds = [
            min(row["bounds"][0] for row in parts),
            min(row["bounds"][1] for row in parts),
            max(row["bounds"][2] for row in parts),
            max(row["bounds"][3] for row in parts),
        ]
        point = [round(main["point"][0], 6), round(main["point"][1], 6)]
        county = county_at(point, county_shapes[state])
        item = {
            "id": local_id,
            "name": name,
            "state": state,
            "type": FTYPES[main["ftype"]],
            "acres": area_acres,
            "center": point,
            "bounds": [[round(bounds[0], 6), round(bounds[1], 6)], [round(bounds[2], 6), round(bounds[3], 6)]],
            "county": county,
            "nhd_gnis_id": main["gnis_id"] or None,
            "nhd_permanent_identifiers": ids,
        }
        item = {key: value for key, value in item.items() if value is not None}
        output.append(item)
        counts[state] += 1

    output.sort(key=lambda row: (row["state"], row["name"].casefold(), row["id"]))
    ids = [row["id"] for row in output]
    if len(ids) != len(set(ids)):
        raise RuntimeError("Duplicate generated destination IDs; refusing to write the catalog.")
    if not output or not all(counts.values()):
        raise RuntimeError(f"Generated catalog is incomplete by state: {counts}")
    payload = {
        "schema_version": 1,
        "source": {
            "name": "USGS National Hydrography Dataset (NHD), Waterbody Large Scale layer",
            "source_url": NHD_LAYER_URL,
            "source_updated": NHD_EDITION,
            "retired_date": NHD_RETIRED,
            "retired_note": "USGS retired NHD from active maintenance in 2023; 3DHP is its successor.",
            "minimum_area_sqkm": MIN_AREA_SQKM,
            "minimum_area_acres_approx": MIN_AREA_ACRES,
            "included_ftype": FTYPES,
            "state_counts": counts,
            "duplicate_curated_entities_removed": duplicate_count,
            "state_regulations": {state: item["regulations"] for state, item in STATES.items()},
            "area_note": "Approximate mapped area from the legacy NHD edition.",
            "species_note": "NHD does not report fish species; none are verified for this water in this record.",
            "notes": "This named waterbody is mapped by USGS NHD. Its record does not confirm fishing quality, public access, navigability, or current conditions.",
            "location_note": "Representative point and approximate extent from legacy NHD mapping. Shoreline may be dated or change with water levels; public access is not verified.",
            "county_source": "2025 U.S. Census Cartographic Boundary File, 1:500,000",
            "county_source_url": COUNTY_URL,
            "catalog_source": {
                "label": "USGS National Hydrography Dataset · 2023 legacy edition",
                "url": NHD_LAYER_URL,
                "source_updated": NHD_EDITION,
            },
        },
        "retrieved_at": retrieved,
        "waters": output,
    }
    (DATA / "nhd-destinations.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    coverage_path = DATA / "coverage.json"
    coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
    coverage["updated"] = retrieved
    coverage.setdefault("sources", {})["nhd_destinations"] = {
        "record_count": len(output),
        "state_counts": counts,
        "url": NHD_LAYER_URL,
        "source_updated": NHD_EDITION,
        "retired_date": NHD_RETIRED,
        "minimum_area_acres_approx": MIN_AREA_ACRES,
        "county_source_url": COUNTY_URL,
        "note": "Named Lake/Pond, Reservoir, and Estuary NHD features with mapped area of at least about five acres. NHD was retired in 2023; it does not establish current conditions, fish species, or public access.",
    }
    coverage_path.write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(output):,} new named destinations; {duplicate_count:,} curated matches removed; counts {counts}")


if __name__ == "__main__":
    main()
