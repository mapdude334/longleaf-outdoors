"""Add county descriptions to South Carolina waters from already cataloged access points.

Default mode writes a candidate to ignored review staging. --apply changes only
county metadata for SC-only water records; it does not add or refresh source
features, change IDs, or touch other states.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data"
STAGE = ROOT / "pipeline" / "staging" / "south-carolina" / "candidate"


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write county metadata into public/data/waters.json")
    args = parser.parse_args()

    water_path = DATA / "waters.json"
    water_payload = read(water_path)
    access_payload = read(DATA / "access.json")
    counties_by_water: dict[str, set[str]] = defaultdict(set)
    for feature in access_payload.get("features", []):
        properties = feature.get("properties", {})
        if properties.get("state") != "SC":
            continue
        water_id = str(properties.get("waterbody_id") or "").strip()
        county = str(properties.get("county") or "").strip()
        if water_id and county:
            counties_by_water[water_id].add(county.removesuffix(" County").strip())

    waters = water_payload.get("waters")
    if not isinstance(waters, list):
        raise ValueError("Water catalog has no waters list")
    before_ids = [water.get("id") for water in waters]
    changed = []
    skipped = []
    for water in waters:
        if water.get("state") != "SC":
            continue
        counties = sorted(counties_by_water.get(str(water.get("id")), set()), key=str.casefold)
        if not counties:
            skipped.append(water.get("id"))
            continue
        new_value = "; ".join(counties)
        if water.get("county") != new_value:
            changed.append({"id": water["id"], "from": water.get("county"), "to": new_value})
            water["county"] = new_value

    sc_water_count = sum(1 for water in waters if water.get("state") == "SC")
    if skipped:
        raise ValueError(f"No linked SCDNR county metadata for {len(skipped)} South Carolina destinations: {skipped[:12]}")
    if before_ids != [water.get("id") for water in waters]:
        raise ValueError("Destination IDs or order changed unexpectedly")

    report = {
        "mode": "applied" if args.apply else "candidate only",
        "method": "County names already present on linked South Carolina agency access records",
        "sc_destinations": sc_water_count,
        "county_labels_changed": len(changed),
        "destinations_spanning_multiple_access_counties": sum(1 for water in waters if water.get("state") == "SC" and ";" in str(water.get("county", ""))),
        "other_states_changed": 0,
        "destination_ids_changed": 0,
        "sample": changed[:12],
    }
    write(STAGE / "waters-with-counties.json", water_payload)
    write(STAGE / "county-enrichment-report.json", report)
    if args.apply:
        write(water_path, water_payload)
    print(json.dumps(report, indent=2))
    target = water_path if args.apply else STAGE / "waters-with-counties.json"
    print(f"Wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
