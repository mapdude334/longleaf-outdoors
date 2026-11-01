"""Add conservative point geography and waterbody links to shipped point catalogs.

Default mode writes review copies and a compact report to ignored pipeline
staging. --apply updates only derived point_county, point_state and missing
waterbody_id fields in public point catalogs. Source state/county, record IDs,
coordinates and all other attributes remain untouched.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data"
COUNTIES_PATH = ROOT / "pipeline" / "cache" / "nhd-destinations" / "counties-2025.geojson"
STAGE = ROOT / "pipeline" / "staging" / "point-location-sync" / "candidate"
STATE_FIPS = {"AL": "01", "GA": "13", "SC": "45"}
COUNTY_URL = "https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_500k.zip"
COUNTY_SOURCE = {
    "label": "2025 U.S. Census county boundaries (1:500,000)",
    "url": COUNTY_URL,
    "method": "Point-in-polygon; county and state describe the mapped point, not the full waterbody.",
}
CATALOGS = ("access", "fish-structures", "habitat", "restrooms")
GENERIC_WATER_NAMES = {"pond", "lake", "river", "stream", "coastal", "reservoir", "waterbody", "unknown"}


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write(path: Path, value, *, pretty: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2 if pretty else None, separators=None if pretty else (",", ":")) + "\n", encoding="utf-8")


def geometry_parts(geometry: dict) -> list[list[list[list[float]]]]:
    if geometry.get("type") == "Polygon":
        return [geometry["coordinates"]]
    if geometry.get("type") == "MultiPolygon":
        return geometry["coordinates"]
    return []


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
    for polygon in geometry_parts(geometry):
        if not polygon or not point_in_ring(lon, lat, polygon[0]):
            continue
        if not any(point_in_ring(lon, lat, hole) for hole in polygon[1:]):
            return True
    return False


def coordinates(value):
    if isinstance(value, list) and len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
        yield float(value[0]), float(value[1])
    elif isinstance(value, list):
        for child in value:
            yield from coordinates(child)


def bounds(geometry: dict) -> tuple[float, float, float, float]:
    points = list(coordinates(geometry.get("coordinates", [])))
    if not points:
        return (float("inf"), float("inf"), float("-inf"), float("-inf"))
    return (min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points))


def bbox_contains(bbox: tuple[float, float, float, float], lon: float, lat: float) -> bool:
    return bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


def state_codes(value) -> set[str]:
    return {part.strip().upper() for part in re.split(r"[/,;]", str(value or "")) if part.strip().upper() in STATE_FIPS}


def load_geography():
    if not COUNTIES_PATH.exists():
        raise RuntimeError(f"Missing {COUNTIES_PATH.relative_to(ROOT)}")
    county_data = read(COUNTIES_PATH)
    counties = defaultdict(list)
    for feature in county_data.get("features", []):
        props = feature.get("properties", {})
        state = next((code for code, fips in STATE_FIPS.items() if str(props.get("STATEFP")) == fips), None)
        geometry = feature.get("geometry")
        if state and geometry:
            counties[state].append({"name": str(props["NAME"]), "geometry": geometry, "bounds": bounds(geometry)})

    state_data = read(DATA / "state-boundaries.json")
    states = {}
    for feature in state_data.get("features", []):
        code = str(feature.get("properties", {}).get("STUSAB", "")).upper()
        geometry = feature.get("geometry")
        if code in STATE_FIPS and geometry:
            states[code] = {"geometry": geometry, "bounds": bounds(geometry)}
    missing = set(STATE_FIPS) - set(states)
    if missing or not all(counties.get(code) for code in STATE_FIPS):
        raise RuntimeError(f"Boundary data is incomplete; missing states: {sorted(missing)}")
    return states, counties


def locate_point(coords, states, counties):
    lon, lat = float(coords[0]), float(coords[1])
    state_matches = [code for code, item in states.items() if bbox_contains(item["bounds"], lon, lat) and point_in_geometry(lon, lat, item["geometry"])]
    point_state = state_matches[0] if len(state_matches) == 1 else None
    search_states = [point_state] if point_state else list(STATE_FIPS)
    county_matches = []
    for code in search_states:
        for county in counties.get(code, []):
            if bbox_contains(county["bounds"], lon, lat) and point_in_geometry(lon, lat, county["geometry"]):
                county_matches.append((code, county["name"]))
    unique_counties = sorted(set(county_matches))
    point_county = unique_counties[0][1] if len(unique_counties) == 1 else None
    if not point_state and unique_counties and len({code for code, _ in unique_counties}) == 1:
        point_state = unique_counties[0][0]
    return point_state, point_county, state_matches, unique_counties


def normalize_name(value) -> str:
    value = re.sub(r"\b(lake|reservoir)\b", "", str(value or "").lower())
    return re.sub(r"[^a-z]", "", value)


def water_name_index(waters):
    index = defaultdict(list)
    for water in waters:
        for name in [water.get("name", ""), *(water.get("gnis_names") or [])]:
            key = normalize_name(name)
            if key and water not in index[key]:
                index[key].append(water)
    return index


def box_contains_water(water, lon, lat):
    value = water.get("bounds")
    if not value or len(value) != 2:
        return False
    return value[0][0] <= lon <= value[1][0] and value[0][1] <= lat <= value[1][1]


def match_water(properties, coords, geography, curated_index, nhd_index):
    name = str(properties.get("waterbody") or "").strip()
    key = normalize_name(name)
    if not key or key in {normalize_name(value) for value in GENERIC_WATER_NAMES}:
        return None, "generic water label"

    point_state = geography[0]
    source_states = state_codes(properties.get("state"))
    if not point_state and not source_states:
        return None, "no supported state match"
    lon, lat = map(float, coords[:2])

    def candidates(index):
        return [water for water in index.get(key, [])
                if (not source_states or source_states.intersection(state_codes(water.get("state"))))
                and (not point_state or point_state in state_codes(water.get("state")))
                and box_contains_water(water, lon, lat)]

    curated = candidates(curated_index)
    if len(curated) == 1:
        return curated[0]["id"], "unique curated destination name and bounds"
    if len(curated) > 1:
        return None, "multiple curated destinations contain point"
    nhd = candidates(nhd_index)
    if len(nhd) == 1:
        return nhd[0]["id"], "unique NHD destination name and bounds"
    if len(nhd) > 1:
        return None, "multiple NHD destinations contain point"
    return None, "no matching destination contains point"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="apply candidate fields to public/data catalogs")
    args = parser.parse_args()

    states, counties = load_geography()
    curated = read(DATA / "waters.json").get("waters", [])
    nhd = read(DATA / "nhd-destinations.json").get("waters", [])
    destination_ids = {water["id"] for water in curated + nhd}
    curated_index, nhd_index = water_name_index(curated), water_name_index(nhd)
    report = {
        "mode": "applied" if args.apply else "candidate only",
        "geography_source": COUNTY_SOURCE,
        "catalogs": {},
        "waterbody_ids_available": len(destination_ids),
        "notes": [
            "Source state/county and every original record are preserved.",
            "point_state and point_county describe the mapped point; they do not imply the whole waterbody is in one county or state.",
            "A waterbody_id is added only for an exact normalized source-name match whose point falls inside one unique destination bound.",
            "Generic labels and ambiguous or spatially unsupported water links remain unresolved.",
        ],
    }

    for catalog in CATALOGS:
        path = DATA / f"{catalog}.json"
        payload = read(path)
        features = payload.get("features", [])
        before_ids = [feature.get("id") for feature in features]
        counters = Counter()
        source_state_conflicts = []
        water_samples = defaultdict(list)
        for feature in features:
            props = feature.get("properties") or {}
            point_state, point_county, state_matches, county_matches = locate_point(feature["geometry"]["coordinates"], states, counties)
            counters["records"] += 1
            counters["point_state_assigned"] += bool(point_state)
            counters["point_county_assigned"] += bool(point_county)
            counters["point_state_ambiguous"] += len(state_matches) > 1
            counters["point_county_ambiguous"] += len(county_matches) > 1

            source_states = state_codes(props.get("state"))
            if point_state and source_states and point_state not in source_states:
                counters["source_state_conflict"] += 1
                if len(source_state_conflicts) < 12:
                    source_state_conflicts.append({"id": feature.get("id"), "source_state": props.get("state"), "point_state": point_state})

            if point_state:
                props["point_state"] = point_state
            if point_county:
                props["point_county"] = point_county

            current_id = str(props.get("waterbody_id") or "").strip()
            if current_id:
                if current_id not in destination_ids:
                    counters["existing_waterbody_id_invalid"] += 1
                else:
                    counters["waterbody_id_existing"] += 1
                continue
            linked_id, reason = match_water(props, feature["geometry"]["coordinates"], (point_state, point_county), curated_index, nhd_index)
            counters[f"water_link_{reason}"] += 1
            if linked_id:
                props["waterbody_id"] = linked_id
                counters["waterbody_id_added"] += 1
            elif props.get("waterbody") and len(water_samples[reason]) < 8:
                water_samples[reason].append(str(props.get("waterbody")))

        if before_ids != [feature.get("id") for feature in features]:
            raise RuntimeError(f"{catalog}: stable feature IDs or order changed unexpectedly")
        payload["location_enrichment"] = {
            **COUNTY_SOURCE,
            "waterbody_method": "Exact normalized source label, matching state, and unique containing destination bounds. Ambiguous links are left blank.",
        }
        report["catalogs"][catalog] = {
            **dict(counters),
            "source_state_conflict_examples": source_state_conflicts,
            "unlinked_water_label_examples": {key: sorted(set(values), key=str.casefold) for key, values in water_samples.items()},
        }
        if args.apply:
            write(path, payload)
        else:
            write(STAGE / f"{catalog}.json", payload)

    report_path = STAGE / "report.json"
    write(report_path, report, pretty=True)
    print(json.dumps(report, indent=2))
    print(f"Wrote {report_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
