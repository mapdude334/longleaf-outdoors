"""Build a reviewable South Carolina preview catalog from staged SCDNR data.

Default mode writes only pipeline/staging/south-carolina/candidate. Pass
--apply only after reviewing the candidate and changing the statewide app
catalogs is explicitly intended. Source records and existing curated water IDs
are preserved; this script never generates tiles or modifies regional packs.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from coverage_manifest import build_coverage_manifest

ROOT = Path(__file__).resolve().parents[2]
STAGE = ROOT / "pipeline/staging/south-carolina"
DATA = ROOT / "public/data"
CANDIDATE = STAGE / "candidate"
ACCESS_URL = "https://services.arcgis.com/acgZYxoN5Oj8pDLa/ArcGIS/rest/services/South_Carolina_Public_Water_Access_PUBLIC_VIEW/FeatureServer/0"
HABITAT_URL = "https://services.arcgis.com/acgZYxoN5Oj8pDLa/ArcGIS/rest/services/SCDNR_Freshwater_Fish_Attractors_Public_Web_App/FeatureServer/0"
BOUNDARY_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0"
SC_BOUNDS = (-83.55, 31.85, -78.4, 35.25)
NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
AUDIT = json.loads((STAGE / "report.json").read_text(encoding="utf-8-sig"))
ACCESS_UPDATED = (AUDIT.get("layers", {}).get("access", {}).get("source_edited_at") or "").split("T")[0]

SPECIES = {
    "largemouthbass": "Largemouth bass", "smallmouthbass": "Smallmouth bass",
    "spottedbass": "Spotted bass", "shoalbass": "Shoal bass", "stripedbass": "Striped bass",
    "stripedbassxwhitebasshybrid": "Hybrid striped bass", "hybridstripedbass": "Hybrid striped bass",
    "whitebass": "White bass", "blackcrappie": "Black crappie", "whitecrappie": "White crappie",
    "bluegill": "Bluegill", "redearsunfish": "Redear sunfish", "redbreastsunfish": "Redbreast sunfish",
    "warmouth": "Warmouth", "channelcatfish": "Channel catfish", "flatheadcatfish": "Flathead catfish",
    "bluecatfish": "Blue catfish", "chainpickerel": "Chain pickerel", "yellowperch": "Yellow perch",
    "walleye": "Walleye", "browntrout": "Brown trout", "rainbowtrout": "Rainbow trout",
}


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def norm(text: str) -> str:
    text = re.sub(r"\b(lake|reservoir|public fishing area|pfa|public fishing|county public fishing)\b", "", text.lower())
    return re.sub(r"[^a-z0-9]", "", text)


def distance(a, b) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * math.cos(lat), a[1] - b[1]) * 111.195


def medoid(points):
    return min(points, key=lambda candidate: sum(distance(candidate, other) for other in points))


def species_from(text: str) -> list[str]:
    parsed = []
    for value in re.split(r"[,;]", text or ""):
        key = re.sub(r"[^a-z0-9]", "", value.lower().replace("*", ""))
        if key in SPECIES and SPECIES[key] not in parsed:
            parsed.append(SPECIES[key])
    return parsed


def useful(value):
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip().lower() not in {"", "none", "null", "unknown", "n/a", "not provided", "(empty)"}
    return True


def unique_id(name: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return "sc-water-" + key


def collect_access(features):
    grouped = defaultdict(list)
    output, restrooms = [], []
    type_map = {"Boat Ramp": "boat_ramp", "Bank": "fishing", "Pier": "fishing", "Paddle Launch": "paddle_launch", "Other (See Comments)": "other"}
    for source in features:
        p, xy = source["properties"], source["geometry"]["coordinates"]
        name, water = (p.get("WaterAccessName") or "").strip(), (p.get("Waterbody") or "").strip()
        raw_type = p.get("WaterAccessType") or "Other (See Comments)"
        if raw_type not in type_map or not water or not name:
            raise ValueError(f"Unexpected access row: {source['id']}")
        source_status = (p.get("PublicAccess") or "").strip()
        status = "Closed" if source_status.lower() == "closed" else "Limited access" if source_status.lower() == "limited" else "Open" if source_status.lower() == "open" else f"Agency status: {source_status or 'not supplied'}"
        global_id = p["source_global_id"]
        ident = "sc-access-" + global_id
        species = species_from(p.get("SpeciesList", ""))
        props = {
            "record_id": ident, "name": name, "kind": type_map[raw_type], "source_access_type": raw_type,
            "source_access_subtype": p.get("WaterAccessSubType"), "waterbody": water, "waterbody_type": p.get("WaterbodyType"),
            "water_type": p.get("WaterType"), "state": "SC", "county": p.get("County"), "operator": p.get("Owner"),
            "maintenance": p.get("Maintenance"), "status": status, "agency_status": p.get("Status"),
            "public_access": source_status, "parking": p.get("Parking"), "parking_surface": p.get("ParkingSurface"),
            "lanes": p.get("LaunchLanes"), "courtesy_dock": p.get("CourtesyDock"), "fishing_pier": p.get("FishingPier"),
            "picnic_area": p.get("PicnicArea"), "accessibility": p.get("AccessibleDescription"), "game_zone": p.get("GameZone"),
            "directions": p.get("Directions"), "description": p.get("Comments"), "species_summary": ", ".join(species),
            "data_source": "South Carolina Department of Natural Resources", "source_url": ACCESS_URL,
            "source_updated": ACCESS_UPDATED, "retrieved_at": p.get("retrieved_at"), "source_global_id": global_id,
        }
        props = {k: v for k, v in props.items() if useful(v)}
        output.append({"type": "Feature", "id": ident, "geometry": source["geometry"], "properties": props})
        grouped[water].append((xy, species, p))
        if str(p.get("Restrooms", "")).strip().lower() == "yes":
            restroom_id = ident + "-restroom"
            restrooms.append({"type": "Feature", "id": restroom_id, "geometry": source["geometry"], "properties": {
                "record_id": restroom_id, "name": "Restrooms at " + name, "kind": "restroom", "facility": name,
                "waterbody": water, "state": "SC", "county": p.get("County"), "operator": p.get("Owner"),
                "location_accuracy": "facility point (restroom may be nearby)", "data_source": "South Carolina Department of Natural Resources",
                "source_url": ACCESS_URL, "source_updated": ACCESS_UPDATED, "retrieved_at": p.get("retrieved_at"), "source_global_id": global_id,
            }})
    return output, restrooms, grouped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write reviewed catalog candidates to public/data")
    args = parser.parse_args()
    access_source, attractor_source, boundary_source = (read(STAGE / name) for name in ("access.geojson", "fish_attractors.geojson", "state-boundary.geojson"))
    for collection, expected in ((access_source, 1030), (attractor_source, 386)):
        if collection.get("type") != "FeatureCollection" or len(collection.get("features", [])) != expected:
            raise ValueError("Source staging is incomplete; refusing to build catalogs")
    if len(boundary_source.get("features", [])) != 1 or boundary_source["features"][0].get("properties", {}).get("STUSAB") != "SC":
        raise ValueError("South Carolina state-boundary source is incomplete")
    access, sc_restrooms, grouped = collect_access(access_source["features"])
    old_access, old_structures, old_restrooms = (read(DATA / f"{name}.json") for name in ("access", "fish-structures", "restrooms"))
    old_waters = read(DATA / "waters.json")
    old_habitat = read(DATA / "habitat.json")
    old_coverage = read(DATA / "coverage.json")
    # Remove the previous generated slice before rebuilding so this can safely
    # refresh from new staging without duplicating points or destinations.
    old_access["features"] = [f for f in old_access["features"] if not str(f.get("id", "")).startswith("sc-access-")]
    old_structures["features"] = [f for f in old_structures["features"] if not str(f.get("id", "")).startswith("sc-attractor-")]
    old_restrooms["features"] = [f for f in old_restrooms["features"] if not str(f.get("id", "")).startswith("sc-access-")]
    old_habitat["features"] = [f for f in old_habitat["features"] if not str(f.get("id", "")).startswith("sc-attractor-")]
    kept_waters = []
    for water in old_waters["waters"]:
        if water.get("id", "").startswith("sc-water-"):
            continue
        sources = water.get("catalog_sources", [])
        if any(source.get("label") == "SCDNR public water-access catalog" for source in sources):
            codes = water.get("state", "").split("/")
            water["state"] = "/".join(code for code in codes if code != "SC") or water.get("state", "")
            water["catalog_sources"] = [source for source in sources if source.get("label") != "SCDNR public water-access catalog"]
        kept_waters.append(water)
    old_waters["waters"] = kept_waters
    waters = old_waters["waters"]
    by_norm = defaultdict(list)
    for water in waters:
        for name in [water["name"], *water.get("gnis_names", [])]:
            by_norm[norm(name)].append(water)
    new_waters, matched, water_destination = [], {}, {}
    grouped_specs = []
    for name, entries in grouped.items():
        if norm(name) in {"pond", "lake", "river", "water", "ocean", "unknown", "unnamed"}:
            continue
        points = [entry[0] for entry in entries]
        center = medoid(points)
        water_type = (entries[0][2].get("WaterbodyType") or "").lower()
        counties = sorted({str(row.get("County", "")).strip() for _, _, row in entries if row.get("County")})
        # A same-named lake far apart in multiple counties is ambiguous; keep
        # those as separate destinations rather than joining unrelated lakes.
        if re.search(r"lake|reservoir|pond", water_type) and counties and max(distance(center, point) for point in points) > 60 and len(counties) > 1:
            for county in counties:
                subset = [entry for entry in entries if str(entry[2].get("County", "")).strip() == county]
                if subset:
                    grouped_specs.append((f"{name} · {county} County", name, county, subset))
        elif norm(name) not in {"pond", "lake", "river", "water", "ocean", "unknown", "unnamed"}:
            grouped_specs.append((name, name, None, entries))

    for display_name, source_name, county_key, entries in grouped_specs:
        name = display_name
        points = [entry[0] for entry in entries]
        center = medoid(points)
        species = sorted({sp for _, row_species, _ in entries for sp in row_species})
        candidates = {w["id"]: w for w in by_norm[norm(source_name)] if norm(source_name)}
        ranked = [(distance(center, candidate["center"]), candidate)
                  for candidate in candidates.values() if candidate.get("center")]
        ranked.sort(key=lambda item: item[0])
        # Keep similarly named, distant reservoirs/rivers separate. Exact matches
        # are only joined when source points are geographically near the curated one.
        threshold = 65 if re.search(r"lake|reservoir|pond", name, re.I) else 80
        if ranked and ranked[0][0] <= threshold:
            water = ranked[0][1]
            matched[(source_name, county_key)] = water
            water_destination[(source_name, county_key)] = water["id"]
            states = set(water["state"].replace(",", "/").split("/"))
            states.add("SC")
            water["state"] = "/".join(sorted(states))
            water.setdefault("catalog_sources", []).append({"label": "SCDNR public water-access catalog", "url": ACCESS_URL, "source_updated": ACCESS_UPDATED})
            water["catalog_sources"] = list({item["url"]: item for item in water["catalog_sources"]}.values())
            continue
        kind_counts = defaultdict(int)
        counties = sorted({str(row.get("County", "")).strip() for _, _, row in entries if row.get("County")})
        water_types = sorted({str(row.get("WaterbodyType", "")).strip() for _, _, row in entries if row.get("WaterbodyType")})
        access_bounds = [[round(min(p[0] for p in points), 6), round(min(p[1] for p in points), 6)], [round(max(p[0] for p in points), 6), round(max(p[1] for p in points), 6)]]
        dest_id = unique_id(name)
        if any(w["id"] == dest_id for w in waters + new_waters):
            dest_id += "-" + re.sub(r"[^a-z0-9]+", "-", counties[0].lower()).strip("-") if counties else "-sc"
        new_waters.append({
            "id": dest_id, "name": name, "state": "SC", "type": water_types[0] if len(water_types) == 1 else "Waterbody",
            "center": [round(center[0], 6), round(center[1], 6)], "species": [{"name": sp} for sp in species],
            "species_note": "Fish species are compiled from SCDNR species lists attached to mapped access records. They are not a complete survey or catch forecast." if species else "SCDNR access records did not provide a usable fish-species list for this water.",
            "notes": f"SCDNR lists {len(points)} public access location(s) across {', '.join(counties) if counties else 'South Carolina'}. Access points are not a surveyed shoreline or waterbody boundary.",
            "location_note": "Overview point is the medoid of SCDNR-mapped public access locations, not the waterbody center. The displayed extent covers those access points only.",
            **({"bounds": access_bounds} if max(distance(center, point) for point in points) <= 50 else {}),
            "links": [
                {"label": "SCDNR public access information", "url": "https://dnr.sc.gov/lakes/access.html"},
                {"label": "South Carolina fishing regulations", "url": "https://www.dnr.sc.gov/regs/fishing.html"},
                {"label": "South Carolina fishing licenses", "url": "https://www.dnr.sc.gov/licenses/genlicense.html"},
            ],
            "catalog_sources": [{"label": "SCDNR public water-access catalog", "url": ACCESS_URL, "source_updated": ACCESS_UPDATED}],
            "retrieved_at": access_source.get("retrievedAt"),
        })
        water_destination[(source_name, county_key)] = dest_id
    for feature in access:
        name = feature["properties"]["waterbody"]
        county_key = str(feature["properties"].get("county", "")).strip() or None
        target = water_destination.get((name, county_key)) or water_destination.get((name, None))
        if target:
            feature["properties"]["waterbody_id"] = target

    structures, habitat = [], []
    for source in attractor_source["features"]:
        p, xy = source["properties"], source["geometry"]["coordinates"]
        fish_project = p.get("FishAttractorType") == "Fish Habitat Project"
        ident = "sc-attractor-" + p["source_global_id"]
        feature = {"type": "Feature", "id": ident, "geometry": source["geometry"], "properties": {
            "record_id": ident, "name": p.get("FishAttractorName") or f"{p.get('Waterbody', 'South Carolina water')} habitat project",
            "kind": "fish_structure" if fish_project else "habitat", "waterbody": p.get("Waterbody"), "state": "SC",
            "structure": p.get("Material") or "Reported habitat installation", "habitat_type": p.get("FishAttractorType"),
            "data_source": "South Carolina Department of Natural Resources", "source_url": HABITAT_URL,
            "source_updated": "2023-06", "retrieved_at": p.get("retrieved_at"), "source_global_id": p["source_global_id"],
            "source_note": "SCDNR's public app describes these locations as reflecting agency information as of June 2023. Materials and positions may have changed. This is not a current sonar survey, depth survey, navigation chart, or guarantee the structure remains intact.",
        }}
        (structures if fish_project else habitat).append(feature)

    bounds = read(DATA / "state-boundaries.json")
    sc_feature = boundary_source["features"][0]
    all_coords = []
    def collect(coords):
        if isinstance(coords, list) and coords and isinstance(coords[0], (int, float)):
            all_coords.append(coords)
        elif isinstance(coords, list):
            for item in coords: collect(item)
    collect(sc_feature.get("geometry", {}).get("coordinates"))
    if not all_coords or min(x[0] for x in all_coords) < SC_BOUNDS[0] or max(x[0] for x in all_coords) > SC_BOUNDS[2] or min(x[1] for x in all_coords) < SC_BOUNDS[1] or max(x[1] for x in all_coords) > SC_BOUNDS[3]:
        raise ValueError("State boundary geometry lies outside the expected SC envelope")
    bounds["features"] = [f for f in bounds["features"] if f.get("properties", {}).get("STUSAB") != "SC"] + [sc_feature]
    bounds.update({"source_url": BOUNDARY_URL, "retrieved_at": NOW})

    products = {
        "access": {**old_access, "updated": NOW, "source": old_access.get("source", "") + "; South Carolina Department of Natural Resources", "coverage": "Alabama, Georgia, and South Carolina agency catalogs; OSM supplementation retains its original regional coverage.", "features": old_access["features"] + access},
        "restrooms": {**old_restrooms, "updated": NOW, "source": old_restrooms.get("source", "") + "; South Carolina Department of Natural Resources", "coverage": "Agency facility inventories for Alabama, Georgia and South Carolina; OSM supplementation retains its original regional coverage.", "features": old_restrooms["features"] + sc_restrooms},
        "fish-structures": {**old_structures, "updated": NOW, "source": old_structures.get("source", "") + "; South Carolina Department of Natural Resources", "features": old_structures["features"] + structures},
        "habitat": {**old_habitat, "updated": NOW, "source": "Georgia DNR aquatic vegetation survey; South Carolina DNR habitat project points", "features": old_habitat["features"] + habitat},
        "waters": {**old_waters, "waters": waters + new_waters},
        "state-boundaries": bounds,
    }
    access_audit = AUDIT.get("layers", {}).get("access", {})
    attractor_audit = AUDIT.get("layers", {}).get("fish_attractors", {})
    source_updates = {
        "sc_access": {
            "source_count": access_audit.get("record_count_reported", len(access)),
            "accepted": len(access), "url": ACCESS_URL,
            "agency": "South Carolina Department of Natural Resources",
            "source_updated": access_audit.get("source_edited_at"),
            "reuse_terms_reviewed": bool(access_audit.get("reuse_terms_reviewed", False)),
        },
        "sc_attractors": {
            "source_count": attractor_audit.get("record_count_reported", len(structures) + len(habitat)),
            "accepted": len(structures) + len(habitat), "url": HABITAT_URL,
            "agency": "South Carolina Department of Natural Resources",
            "source_updated": attractor_audit.get("source_edited_at"),
            "data_vintage": "2023-06", "reuse_terms_reviewed": bool(attractor_audit.get("reuse_terms_reviewed", False)),
        },
        "state-boundaries": {"url": BOUNDARY_URL, "agency": "U.S. Census Bureau TIGERweb", "states_in_catalog": len(bounds["features"])},
    }
    products["coverage"] = build_coverage_manifest(
        products, old_coverage, updated=NOW,
        scope="Alabama and Georgia statewide agency catalogs, plus selected South Carolina agency catalogs; records are source-limited and not an exhaustive inventory. Adjacent coastal and offshore sources are included where documented.",
        source_updates=source_updates,
    )
    products["coverage"]["offline_packs"] = old_coverage.get("offline_packs", "Existing regional archives are unchanged. Save map areas separately for expanded geography.")
    # Validate stable IDs, explicit links, statewide map bounds, and references.
    for name, collection in (("access", products["access"]), ("restrooms", products["restrooms"]), ("fish-structures", products["fish-structures"]), ("habitat", products["habitat"])):
        ids = [f.get("properties", {}).get("record_id") or f.get("properties", {}).get("osm") or f.get("id") for f in collection["features"]]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Duplicate stable identity in {name}")
        for f in collection["features"]:
            x, y = f["geometry"]["coordinates"][:2]
            if not (-89 <= x <= -78.25 and 28 <= y <= 35.6):
                raise ValueError(f"{name} point falls outside navigable map: {f.get('id')}")
    water_ids = {w["id"] for w in products["waters"]["waters"]}
    missing_destinations = sorted({f["properties"].get("waterbody", "") for f in access if f["properties"].get("waterbody_id") and f["properties"].get("waterbody_id") not in water_ids})
    if missing_destinations:
        raise ValueError(f"An access feature refers to a missing water destination: {missing_destinations[:10]}")

    output = DATA if args.apply else CANDIDATE
    for name, product in products.items():
        write(output / f"{name}.json", product)
    report = {
        "mode": "applied" if args.apply else "candidate only",
        "retrieved_at": access_source.get("retrievedAt"), "access_added": len(access),
        "restroom_facility_points_added": len(sc_restrooms), "fish_structure_points_added": len(structures),
        "historical_habitat_points_added": len(habitat), "new_destinations_added": len(new_waters),
        "existing_destination_matches": {f"{name}{f' ({county} County)' if county else ''}": water["id"] for (name, county), water in matched.items()},
        "excluded_generic_destination_labels": sorted(name for name in grouped if norm(name) in {"pond", "lake", "river", "water", "ocean", "unknown", "unnamed"}),
        "notes": ["All mapped access records retain agency status; only PublicAccess=Open means agency reports open access.", "Facility restroom points indicate a facility with reported restrooms, not the exact restroom building.", "SCDNR habitat/attractor records carry a June 2023 age caveat.", "Water overview points and access-point bounds are not waterbody shoreline boundaries.", "No regional PMTiles or download packs are rebuilt by this script."],
    }
    write(CANDIDATE / "south-carolina-report.json", report)
    print(json.dumps(report, indent=2))
    print(f"Wrote {output.relative_to(ROOT)}; {'public catalogs changed' if args.apply else 'no public catalogs changed'}.")


if __name__ == "__main__":
    main()
