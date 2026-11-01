"""Add Census county labels to Alabama-linked curated water destinations.

County means the county containing the destination's representative map point;
reservoirs may extend across several counties. The county boundary file is the
2025 Census Cartographic Boundary File, exported to GeoJSON by the NHD catalog
pipeline. Default mode writes a review candidate under ignored staging. --apply
updates only county metadata on AL-linked records and the coverage manifest.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data"
COUNTIES = ROOT / "pipeline" / "cache" / "nhd-destinations" / "counties-2025.geojson"
STAGE = ROOT / "pipeline" / "staging" / "alabama-county-labels" / "candidate"
COUNTY_URL = "https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_500k.zip"
STATE_FIPS = {"AL": "01", "GA": "13", "SC": "45"}
COUNTY_SOURCE = {
    "label": "2025 U.S. Census county boundaries (1:500,000)",
    "url": COUNTY_URL,
    "method": "County containing this destination's representative map point; a waterbody may extend into neighboring counties.",
}


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def state_codes(value: str) -> list[str]:
    return [part.strip().upper() for part in re.split(r"[/,;]", value) if part.strip()]


def geometry_parts(geometry: dict) -> list[list[list[list[float]]]]:
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
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


def load_counties() -> dict[str, list[dict]]:
    if not COUNTIES.exists():
        raise RuntimeError(
            f"Missing {COUNTIES.relative_to(ROOT)}. Run the NHD destination pipeline once to export "
            "the 2025 Census county boundaries before creating this candidate."
        )
    payload = read(COUNTIES)
    counties: dict[str, list[dict]] = {code: [] for code in STATE_FIPS}
    for feature in payload.get("features", []):
        props = feature.get("properties", {})
        state = next((code for code, fips in STATE_FIPS.items() if str(props.get("STATEFP")) == fips), None)
        if state and feature.get("geometry"):
            counties[state].append({"name": str(props["NAME"]), "geometry": feature["geometry"]})
    if not counties["AL"] or not counties["GA"]:
        raise RuntimeError("The county boundary file is missing Alabama or Georgia features.")
    return counties


def matching_counties(point: list[float], codes: list[str], counties: dict[str, list[dict]]) -> list[str]:
    lon, lat = point
    matches = []
    for code in codes:
        for county in counties.get(code, []):
            if point_in_geometry(lon, lat, county["geometry"]):
                matches.append(county["name"])
    return sorted(set(matches), key=str.casefold)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write county labels to public/data/waters.json and update the coverage manifest")
    args = parser.parse_args()

    counties = load_counties()
    water_path = DATA / "waters.json"
    coverage_path = DATA / "coverage.json"
    water_payload = read(water_path)
    coverage = read(coverage_path)
    waters = water_payload.get("waters")
    if not isinstance(waters, list):
        raise ValueError("Water catalog has no waters list")

    before_ids = [water.get("id") for water in waters]
    centered_to_enrich = [
        water for water in waters
        if "AL" in state_codes(str(water.get("state") or "")) and water.get("center") and not water.get("county")
    ]
    assignments = []
    skipped = []
    ambiguous = []
    county_not_applicable = []
    existing_assignments = []
    for water in waters:
        codes = state_codes(str(water.get("state") or ""))
        if "AL" not in codes:
            continue
        if water.get("county"):
            if water.get("county_source"):
                existing_assignments.append({"id": water["id"], "county": water["county"], "state": water["state"]})
                continue
            skipped.append({"id": water.get("id"), "reason": "county already supplied"})
            continue
        point = water.get("center")
        if not isinstance(point, list) or len(point) != 2:
            skipped.append({"id": water.get("id"), "reason": "no mapped representative point"})
            continue
        matches = matching_counties(point, codes, counties)
        if len(matches) == 1:
            assignments.append({"id": water["id"], "county": matches[0], "state": water["state"], "center": point})
            water["county"] = matches[0]
            water["county_source"] = COUNTY_SOURCE.copy()
        elif len(matches) > 1:
            ambiguous.append({"id": water.get("id"), "matches": matches, "center": point})
        elif water.get("type") == "coastal reef area":
            county_not_applicable.append({"id": water.get("id"), "reason": "offshore reef reference point is outside county boundaries"})
        else:
            skipped.append({"id": water.get("id"), "reason": "point did not match a county in its listed state"})

    if before_ids != [water.get("id") for water in waters]:
        raise ValueError("Destination IDs or order changed unexpectedly")

    centered_al = [w for w in waters if "AL" in state_codes(str(w.get("state") or "")) and w.get("center")]
    if ambiguous:
        print(json.dumps({"ambiguous": ambiguous}, indent=2))
        if args.apply:
            raise ValueError("Ambiguous county point matches; refusing to update the catalog.")
    if args.apply and any(item["reason"] == "point did not match a county in its listed state" for item in skipped):
        raise ValueError("Some mapped Alabama-linked points did not match a county; refusing to update the catalog.")
    expected_assignments = len(centered_to_enrich) - len(county_not_applicable)
    if args.apply and len(assignments) != expected_assignments:
        raise ValueError("Not all centered Alabama-linked destinations received a county; refusing to update the catalog.")

    covered_assignments = [*existing_assignments, *assignments]
    counts = Counter(item["state"] for item in covered_assignments)
    report = {
        "mode": "applied" if args.apply else "candidate only",
        "method": COUNTY_SOURCE["method"],
        "county_source": COUNTY_SOURCE,
        "centered_alabama_linked_destinations": len(centered_al),
        "county_labels_assigned": len(covered_assignments),
        "newly_assigned_this_run": len(assignments),
        "unlocated_or_unmatched": len(skipped),
        "county_not_applicable": county_not_applicable,
        "ambiguous_matches": len(ambiguous),
        "other_state_records_changed": 0,
        "destination_ids_changed": 0,
        "state_counts": dict(sorted(counts.items())),
        "assignments": assignments,
        "existing_assignments": existing_assignments,
        "skipped": skipped,
    }
    if args.apply:
        coverage["updated"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        coverage.setdefault("sources", {})["al_destination_counties"] = {
            "record_count": len(covered_assignments),
            "state_counts": dict(sorted(counts.items())),
            "agency": "U.S. Census Bureau",
            "source_vintage": "2025 Cartographic Boundary File, 1:500,000",
            "url": COUNTY_URL,
            "method": COUNTY_SOURCE["method"],
            "note": "County refers to the representative destination point; waterbodies can cross county boundaries.",
            "unlocated_destination_count": sum(1 for item in skipped if item["reason"] == "no mapped representative point"),
            "county_not_applicable_count": len(county_not_applicable),
        }
        write(water_path, water_payload)
        coverage_path.write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        write(STAGE / "waters-with-counties.json", water_payload)
        write(STAGE / "county-enrichment-report.json", report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
