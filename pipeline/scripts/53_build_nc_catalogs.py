"""Build isolated North Carolina destination/access catalogs from reviewed snapshots.

Inputs are staged from official sources under pipeline/staging/north-carolina.
Outputs are NC-only additive files in public/data and adds the reviewed NC
Census outline to the shared state reference layer. Existing water, access,
restroom, offline-map, and PMTiles records are not edited.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "pipeline" / "staging" / "north-carolina"
DATA = ROOT / "public" / "data"
COUNTIES = ROOT / "pipeline" / "cache" / "nhd-destinations" / "counties-2025.geojson"
ONEMAP_LAYER = "https://services.nconemap.gov/secure/rest/services/NC1Map_Hydrography/FeatureServer/2"
ONEMAP_TERMS = "https://www.nconemap.gov/pages/terms"
NCCGIA_CREDIT = "North Carolina Center for Geographic Information and Analysis (NCCGIA) / NC OneMap"
NCWRC_WHERE_FISH = "https://www.ncwildlife.gov/fishing/where-fish"
NCWRC_BAA_ITEM = "https://www.arcgis.com/home/item.html?id=825b21606e2040aabed210d878b2f3e5"
NCWRC_PFA_ITEM = "https://www.arcgis.com/home/item.html?id=8f95684ae6ad4f6f95532100c6e41b79"
NCWRC_NOTICE = (
    "NCWRC data is provided for free, public, non-commercial use only. "
    "NCWRC gives no warranty of accuracy, reliability, or completeness; conditions and accessibility can change; "
    "NCWRC disclaims liability for improper or incorrect use. Verify current status with the agency before travel."
)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_json(path: Path, value) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(path)


def ascii_norm(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def positions(value):
    if isinstance(value, (list, tuple)):
        if len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
            yield float(value[0]), float(value[1])
        else:
            for child in value:
                yield from positions(child)


def bbox_geometry(geometry: dict) -> tuple[float, float, float, float]:
    coords = list(positions(geometry.get("coordinates", [])))
    if not coords:
        raise RuntimeError("A source polygon has no coordinates")
    return min(x for x, _ in coords), min(y for _, y in coords), max(x for x, _ in coords), max(y for _, y in coords)


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    for index, point in enumerate(ring):
        previous = ring[index - 1]
        if (point[1] > lat) != (previous[1] > lat):
            crossing = (previous[0] - point[0]) * (lat - point[1]) / (previous[1] - point[1]) + point[0]
            if lon < crossing:
                inside = not inside
    return inside


def point_in_polygon(lon: float, lat: float, polygon: list[list[list[float]]]) -> bool:
    if not polygon or not point_in_ring(lon, lat, polygon[0]):
        return False
    return not any(point_in_ring(lon, lat, hole) for hole in polygon[1:])


def point_in_geometry(lon: float, lat: float, geometry: dict) -> bool:
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    polygons = [coords] if kind == "Polygon" else coords if kind == "MultiPolygon" else []
    return any(point_in_polygon(lon, lat, polygon) for polygon in polygons)


def ring_centroid(ring: list[list[float]]) -> tuple[float, float] | None:
    if len(ring) < 4:
        return None
    area2 = cx = cy = 0.0
    for i, p in enumerate(ring):
        q = ring[(i + 1) % len(ring)]
        cross = p[0] * q[1] - q[0] * p[1]
        area2 += cross
        cx += (p[0] + q[0]) * cross
        cy += (p[1] + q[1]) * cross
    if abs(area2) < 1e-15:
        return None
    return cx / (3 * area2), cy / (3 * area2)


def polygon_centroid(polygon: list[list[list[float]]]) -> tuple[float, float] | None:
    if not polygon:
        return None
    total_area = total_x = total_y = 0.0
    for index, ring in enumerate(polygon):
        centroid = ring_centroid(ring)
        if not centroid:
            continue
        area = abs(sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2)
        if index:
            area = -area
        total_area += area
        total_x += centroid[0] * area
        total_y += centroid[1] * area
    if total_area <= 0:
        return None
    return total_x / total_area, total_y / total_area


def polygon_parts(geometry: dict):
    if geometry.get("type") == "Polygon":
        return [geometry.get("coordinates") or []]
    if geometry.get("type") == "MultiPolygon":
        return geometry.get("coordinates") or []
    return []


def point_on_polygon(feature: dict, state_geometry: dict) -> tuple[float, float]:
    geometry = feature.get("geometry") or {}
    b = bbox_geometry(geometry)
    polygon_candidates = polygon_parts(geometry)
    candidates = []
    for polygon in polygon_candidates:
        center = polygon_centroid(polygon)
        if center:
            candidates.append(center)
        if polygon and polygon[0]:
            ring = polygon[0]
            candidates.append((sum(p[0] for p in ring[:-1]) / max(1, len(ring) - 1), sum(p[1] for p in ring[:-1]) / max(1, len(ring) - 1)))
    target = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    candidates.append(target)
    valid = [p for p in candidates if point_in_geometry(p[0], p[1], geometry) and point_in_geometry(p[0], p[1], state_geometry)]
    if valid:
        return min(valid, key=lambda p: (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2)
    # A few coastal/concave polygons have a centroid outside the land-state
    # boundary. Find an interior point on a compact grid, favoring the polygon
    # center and keeping the representative marker inside the Census state.
    for divisions in (12, 24):
        valid = []
        for ix in range(divisions + 1):
            x = b[0] + (b[2] - b[0]) * ix / divisions
            for iy in range(divisions + 1):
                y = b[1] + (b[3] - b[1]) * iy / divisions
                if point_in_geometry(x, y, geometry) and point_in_geometry(x, y, state_geometry):
                    valid.append((x, y))
        if valid:
            return min(valid, key=lambda p: (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2)
    return target


def water_groups(features: list[dict], tolerance: float = 0.01) -> list[list[dict]]:
    named: dict[str, list[tuple[dict, tuple[float, float, float, float]]]] = defaultdict(list)
    for feature in features:
        props = feature.get("properties") or {}
        name = str(props.get("stream_nam") or props.get("waterbody") or "").strip()
        key = ascii_norm(name)
        if key:
            named[key].append((feature, bbox_geometry(feature.get("geometry") or {})))
    result = []
    for values in named.values():
        parents = list(range(len(values)))
        def find(i):
            while parents[i] != i:
                parents[i] = parents[parents[i]]
                i = parents[i]
            return i
        for i, (_, a) in enumerate(values):
            for j in range(i):
                b = values[j][1]
                dx = max(0.0, a[0] - b[2], b[0] - a[2])
                dy = max(0.0, a[1] - b[3], b[1] - a[3])
                if math.hypot(dx, dy) <= tolerance:
                    pa, pb = find(i), find(j)
                    if pa != pb:
                        parents[pa] = pb
        groups: dict[int, list[dict]] = defaultdict(list)
        for i, (feature, _) in enumerate(values):
            groups[find(i)].append(feature)
        result.extend(groups.values())
    return result


def make_county_index(county_fc: dict):
    output = []
    for feature in county_fc.get("features", []):
        props = feature.get("properties") or {}
        if str(props.get("STATEFP") or props.get("STATE")) != "37":
            continue
        geom = feature.get("geometry") or {}
        name = re.sub(r"\s+County$", "", str(props.get("NAME") or ""), flags=re.I)
        output.append((name, bbox_geometry(geom), geom))
    if not output:
        raise RuntimeError("The cached Census county catalog has no North Carolina polygons")
    return output


def county_at(point: tuple[float, float], county_index) -> str | None:
    lon, lat = point
    for name, b, geom in county_index:
        if b[0] <= lon <= b[2] and b[1] <= lat <= b[3] and point_in_geometry(lon, lat, geom):
            return name
    return None


def point_to_geometry_boundary_m(point: tuple[float, float], geometry: dict) -> float:
    lon, lat = point
    x_scale = 111320 * math.cos(math.radians(lat))
    y_scale = 111320
    px, py = lon * x_scale, lat * y_scale
    minimum = math.inf
    for polygon in polygon_parts(geometry):
        for ring in polygon:
            for index, a in enumerate(ring[:-1]):
                b = ring[index + 1]
                ax, ay = a[0] * x_scale, a[1] * y_scale
                bx, by = b[0] * x_scale, b[1] * y_scale
                dx, dy = bx - ax, by - ay
                denom = dx * dx + dy * dy
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom)) if denom else 0.0
                minimum = min(minimum, math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
    return minimum


def yes(value) -> bool:
    if value is True:
        return True
    if isinstance(value, (int, float)):
        return value == 1
    return str(value or "").strip().lower() in {"1", "yes", "y", "true", "available"}


def nonempty(value):
    text = str(value or "").strip()
    return text if text and text.lower() not in {"none", "<null>", "null", "n/a"} else None


def water_catalog(onemap: dict, state_geometry: dict, counties: list, retrieved_at: str) -> tuple[list[dict], dict]:
    groups = water_groups(onemap.get("features", []))
    output = []
    county_fallbacks = []
    feature_count = 0
    for group in groups:
        entries = []
        for feature in group:
            props = feature.get("properties") or {}
            source_name = str(props.get("stream_nam") or props.get("waterbody") or "").strip()
            area = float(props.get("Shape__Area") or 0)
            center = point_on_polygon(feature, state_geometry)
            entries.append((feature, props, source_name, area, center, bbox_geometry(feature.get("geometry") or {})))
        feature_count += len(entries)
        # A group includes only same-name polygons whose mapped extents touch or
        # sit within about a kilometer. Keep separate nonadjacent same-name lakes.
        largest = max(entries, key=lambda item: item[3])
        center = largest[4]
        counties_for_point = county_at(center, counties)
        county_method = "County containing the representative destination marker; a waterbody may extend across several counties."
        if not counties_for_point:
            # A marker can fall in an open-water gap between land county polygons.
            # Use the nearest actual county boundary, and disclose that distinction.
            _, nearest = min(((point_to_geometry_boundary_m(center, geom), name) for name, _, geom in counties), key=lambda pair: pair[0])
            counties_for_point = nearest
            county_method = "Nearest county boundary to the representative water marker; the marker falls in an open-water gap. Waterbodies may extend across several counties."
            county_fallbacks.append({"name": largest[2], "source_oids": [str(e[1].get("objectid")) for e in entries], "county": nearest})
        bounds = [
            [min(e[5][0] for e in entries), min(e[5][1] for e in entries)],
            [max(e[5][2] for e in entries), max(e[5][3] for e in entries)],
        ]
        names = Counter(e[2] for e in entries)
        primary_name = sorted(names, key=lambda name: (-names[name], -len(name), name.lower()))[0]
        oids = sorted({str(e[1].get("objectid")) for e in entries if e[1].get("objectid") is not None}, key=lambda v: int(v) if v.isdigit() else v)
        if not oids:
            raise RuntimeError("NC OneMap water group is missing its stable object ID")
        basin_values = sorted({str(e[1].get("riv_basin")).strip() for e in entries if nonempty(e[1].get("riv_basin"))})
        basin = basin_values[0] if len(basin_values) == 1 else None
        low = primary_name.lower()
        kind = "coastal water" if any(term in low for term in ("sound", "estuary", "intracoastal", "bay")) else "reservoir" if any(term in low for term in ("lake", "reservoir")) else "river or stream" if any(term in low for term in ("river", "creek", "branch", "run", "fork", "swamp")) else "major mapped waterbody"
        slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", primary_name).encode("ascii", "ignore").decode("ascii").lower()).strip("-") or "water"
        id_lat = round(center[1] * 100)
        id_lon = round(center[0] * 100)
        record_id = f"nc-onemap-{slug}-{id_lat}-{id_lon}-{oids[0]}"
        output.append({
            "id": record_id,
            "name": primary_name,
            "gnis_names": sorted(names.keys()),
            "state": "NC",
            "river": basin,
            "type": kind,
            "center": [round(center[0], 6), round(center[1], 6)],
            "bounds": [[round(bounds[0][0], 6), round(bounds[0][1], 6)], [round(bounds[1][0], 6), round(bounds[1][1], 6)]],
            "species": [],
            "notes": "NC OneMap major hydrography depicts mapped streams, rivers, lakes, reservoirs, and shorelines. This map record does not verify public ownership or access, fish species, fishing suitability, current water levels, or navigability.",
            "location_note": "Representative marker and map extent derived from NC OneMap polygon geometry. The selected outline is source mapping, not a surveyed or regulatory shoreline.",
            "links": [{"label": "NCWRC fishing access & fish-attractor maps", "url": NCWRC_WHERE_FISH}],
            "catalog_sources": [{
                "label": "NC OneMap Major Hydrography - Waterbodies · NCCGIA",
                "url": ONEMAP_LAYER,
                "source_updated": None,
            }],
            "retrieved_at": onemap.get("retrievedAt") or retrieved_at,
            "location_label": f"{counties_for_point}, NC",
            "county": counties_for_point,
            "county_source": {
                "label": "U.S. Census Bureau TIGERweb county boundaries",
                "url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1",
                "method": county_method,
            },
            "onemap_object_ids": oids,
            "outline_source": "NC OneMap",
            "source_note": "Mapped water reference only; verify access, rules, and current shoreline conditions with the responsible agency.",
        })
    output.sort(key=lambda item: (item["name"].casefold(), item["county"].casefold(), item["center"][1], item["center"][0]))
    return output, {"source_polygon_count": len(onemap.get("features", [])), "named_polygon_count": feature_count, "destination_count": len(output), "county_center_fallback_count": len(county_fallbacks), "county_center_fallbacks": county_fallbacks}


def access_records(snapshot: dict, water_records: list[dict], counties: list, retrieved_at: str):
    water_index: dict[str, list[dict]] = defaultdict(list)
    for water in water_records:
        for name in [water["name"], *(water.get("gnis_names") or [])]:
            key = ascii_norm(name)
            if key and water not in water_index[key]:
                water_index[key].append(water)

    def water_link(label):
        key = ascii_norm(str(label or ""))
        choices = water_index.get(key, []) if key else []
        return choices[0]["id"] if len(choices) == 1 else None

    def common_properties(p: dict, coords: list[float]):
        lon, lat = coords
        source_county = nonempty(p.get("County"))
        mapped_county = county_at((lon, lat), counties)
        county = mapped_county or (source_county.title() if source_county else None)
        source_layer = p.get("source_layer")
        is_baa = source_layer == "baa"
        name = nonempty(p.get("BAA_Name" if is_baa else "PFA_Name")) or ("NCWRC Boating Access Area" if is_baa else "Public Fishing Area")
        waterbody = nonempty(p.get("Water_Access"))
        properties = {
            "record_id": f"ncwrc-{source_layer}-{p.get('source_object_id')}",
            "name": name,
            "kind": "boat_ramp" if is_baa else "fishing",
            "source_access_type": "Boating Access Area" if is_baa else "Public Fishing Area",
            "source_access_subtype": "Motorized boating access" if is_baa else nonempty(p.get("Waterbody_Type")),
            "status": nonempty(p.get("Site_Status")),
            "closure_reason": nonempty(p.get("Closure_Reason")),
            "caution_notes": nonempty(p.get("Caution_Notes")),
            "access_notes": nonempty(p.get("Access_Notes")),
            "public_access": "NCWRC boating access inventory" if is_baa else "NCWRC public fishing area inventory",
            "region": nonempty(p.get("Region")),
            "district": nonempty(p.get("District")),
            "operator": nonempty(p.get("Owner")) or "North Carolina Wildlife Resources Commission",
            "maintenance": nonempty(p.get("Maintenance")),
            "waterbody": waterbody,
            "waterbody_type": nonempty(p.get("Waterbody_Type")),
            "waterbody_id": water_link(waterbody),
            "county": source_county.title() if source_county else county,
            "state": "NC", "point_state": "NC", "point_county": county,
            "addr:street": nonempty(p.get("Street")), "addr:city": nonempty(p.get("City")),
            "phone": nonempty(p.get("Phone")), "website": nonempty(p.get("Website")),
            "parking_surface": nonempty(p.get("Parking_Surface")),
            "parking": ", ".join(v for v in [
                f"{p['Parking_Trailer']} trailer spaces" if p.get("Parking_Trailer") not in (None, 0) else None,
                f"{p['Parking_nonTrailer']} non-trailer spaces" if p.get("Parking_nonTrailer") not in (None, 0) else None,
                f"{p['Parking_Trailer_ADA']} accessible trailer spaces" if p.get("Parking_Trailer_ADA") not in (None, 0) else None,
                f"{p['Parking_nonTrailer_ADA']} accessible non-trailer spaces" if p.get("Parking_nonTrailer_ADA") not in (None, 0) else None,
            ] if v) or None,
            "toilets": "Reported at this facility" if yes(p.get("Restroom")) else "Not reported" if p.get("Restroom") is not None else "Unknown",
            "courtesy_dock": ", ".join(v for v in [
                f"{p['Fix_Dock_No']} fixed docks" if p.get("Fix_Dock_No") not in (None, 0) else None,
                f"{p['Float_Dock_No']} floating docks" if p.get("Float_Dock_No") not in (None, 0) else None,
                f"{p['Courtesy_Dock_No']} courtesy docks" if p.get("Courtesy_Dock_No") not in (None, 0) else None,
            ] if v) or None,
            "fishing_pier": nonempty(p.get("Fishing_Pier")),
            "accessibility": "; ".join(v for v in [
                "ADA paved walkway reported" if yes(p.get("ADA_Paved_Walkway")) else None,
                "ADA dock-to-pier access reported" if yes(p.get("ADA_Dock_To_Pier")) else None,
                nonempty(p.get("ADA_Notes")),
            ] if v) or None,
            "boat_ramp": nonempty(p.get("Boat_Ramp")),
            "source_note": NCWRC_NOTICE,
            "source_item_url": p.get("source_item_url"),
            "source_license": "free, public, non-commercial use only",
            "data_source": "North Carolina Wildlife Resources Commission (NCWRC)",
            "source_url": p.get("source_url"),
            "source_updated": p.get("source_updated"),
            "retrieved_at": p.get("retrieved_at") or retrieved_at,
        }
        return {k: v for k, v in properties.items() if v not in (None, "")}

    baa = []
    pfa = []
    for feature in snapshot.get("features", []):
        p = feature.get("properties") or {}
        coords = feature.get("geometry", {}).get("coordinates")
        if not isinstance(coords, list) or len(coords) < 2 or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in coords[:2]):
            raise RuntimeError(f"Invalid NCWRC point feature: {feature.get('id')}")
        props = common_properties(p, coords)
        item = {"type": "Feature", "id": props["record_id"], "geometry": {"type": "Point", "coordinates": [round(coords[0], 7), round(coords[1], 7)]}, "properties": props}
        (baa if p.get("source_layer") == "baa" else pfa).append(item)

    # Merge only truly co-located same-water facilities; otherwise preserve both
    # agency records as separately explorable features.
    merged = 0
    for pfa_feature in pfa:
        pp = pfa_feature["properties"]
        pfa_name_key = ascii_norm(pp.get("name", ""))
        pfa_water_key = ascii_norm(pp.get("waterbody", ""))
        pcoords = pfa_feature["geometry"]["coordinates"]
        candidate = None
        for baa_feature in baa:
            bp = baa_feature["properties"]
            bcoords = baa_feature["geometry"]["coordinates"]
            distance_m = math.hypot(
                (pcoords[0] - bcoords[0]) * 111000 * math.cos(math.radians((pcoords[1] + bcoords[1]) / 2)),
                (pcoords[1] - bcoords[1]) * 111000,
            )
            same_site = pfa_name_key and pfa_name_key == ascii_norm(bp.get("name", ""))
            same_water = pfa_water_key and pfa_water_key == ascii_norm(bp.get("waterbody", ""))
            if distance_m <= 20 and (same_site or same_water):
                if candidate is None or distance_m < candidate[0]:
                    candidate = distance_m, baa_feature
        if candidate:
            _, baa_feature = candidate
            bp = baa_feature["properties"]
            bp.update({
                "public_fishing_area": pp.get("name"),
                "pfa_status": pp.get("status"),
                "pfa_waterbody": pp.get("waterbody"),
                "pfa_record_id": pp.get("record_id"),
                "pfa_source_url": pp.get("source_url"),
                "pfa_source_item_url": pp.get("source_item_url"),
            })
            if pp.get("waterbody_id") and not bp.get("waterbody_id"):
                bp["waterbody_id"] = pp["waterbody_id"]
            if pp.get("toilets") == "Reported at this facility":
                bp["toilets"] = pp["toilets"]
            merged += 1
        else:
            baa.append(pfa_feature)
    if not baa:
        raise RuntimeError("NCWRC access conversion produced no features")
    return baa, merged


def restroom_records(snapshot: dict, counties: list, retrieved_at: str):
    output = []
    seen = set()
    for feature in snapshot.get("features", []):
        p = feature.get("properties") or {}
        if not yes(p.get("Restroom")):
            continue
        coords = feature["geometry"]["coordinates"]
        key = tuple(round(float(value), 6) for value in coords[:2])
        source_layer = p.get("source_layer")
        source_name = nonempty(p.get("BAA_Name" if source_layer == "baa" else "PFA_Name")) or "NCWRC facility"
        mapped_county = county_at((coords[0], coords[1]), counties)
        record_id = f"ncwrc-restroom-{source_layer}-{p.get('source_object_id')}"
        if key in seen:
            continue
        seen.add(key)
        county = mapped_county or (nonempty(p.get("County")) or "").title()
        output.append({
            "type": "Feature", "id": record_id,
            "geometry": {"type": "Point", "coordinates": [round(coords[0], 7), round(coords[1], 7)]},
            "properties": {
                "record_id": record_id,
                "name": f"{source_name} restroom",
                "kind": "restroom",
                "facility": source_name,
                "location_accuracy": "Restroom is reported for the facility; its exact position is not supplied.",
                "point_state": "NC", "point_county": county,
                "county": county, "state": "NC",
                "data_source": "North Carolina Wildlife Resources Commission (NCWRC)",
                "source_url": p.get("source_url"), "source_updated": p.get("source_updated"),
                "retrieved_at": p.get("retrieved_at") or retrieved_at,
                "source_note": NCWRC_NOTICE,
            },
        })
    return output


def main() -> None:
    access_snapshot = read_json(STAGING / "ncwrc-access-review.geojson")
    report = read_json(STAGING / "ncwrc-access-report.json")
    onemap = read_json(STAGING / "nc-onemap-waterbodies.geojson")
    boundary_fc = read_json(STAGING / "state-boundary.geojson")
    county_fc = read_json(COUNTIES)
    nc_county_fc = read_json(STAGING / "nc-county-boundaries.geojson")
    county_fc["features"].extend(nc_county_fc.get("features", []))
    counties = make_county_index(county_fc)
    nc_boundary = [f for f in boundary_fc.get("features", []) if (f.get("properties") or {}).get("STUSAB") == "NC"]
    if len(nc_boundary) != 1:
        raise RuntimeError("Expected one staged Census North Carolina boundary")
    state_geometry = nc_boundary[0].get("geometry") or {}
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    # Add only the reviewed Census state outline; preserve all existing state records.
    state_boundaries_path = DATA / "state-boundaries.json"
    state_boundaries = read_json(state_boundaries_path)
    state_boundaries["features"] = [
        feature for feature in state_boundaries.get("features", [])
        if (feature.get("properties") or {}).get("STUSAB") != "NC"
    ] + nc_boundary
    state_boundaries["updated"] = retrieved_at
    atomic_json(state_boundaries_path, state_boundaries)

    waters, water_report = water_catalog(onemap, state_geometry, counties, retrieved_at)
    water_ids = {water["id"] for water in waters}
    access, merged = access_records(access_snapshot, waters, counties, retrieved_at)
    restrooms = restroom_records(access_snapshot, counties, retrieved_at)
    if any(item.get("state") != "NC" for item in waters):
        raise RuntimeError("Water conversion included a non-NC state")
    if any(item["properties"].get("point_state") != "NC" for item in access + restrooms):
        raise RuntimeError("Point conversion included a non-NC state")
    for item in access + restrooms:
        link = item["properties"].get("waterbody_id")
        if link and link not in water_ids:
            raise RuntimeError(f"Access point has a dangling waterbody ID: {link}")

    access_payload = {
        "type": "FeatureCollection", "updated": retrieved_at,
        "source": "North Carolina Wildlife Resources Commission (NCWRC)",
        "coverage": "North Carolina; statewide public boating access and public fishing areas; non-commercial use only",
        "terms": "free, public, non-commercial use only",
        "license_disclaimer": NCWRC_NOTICE,
        "source_catalog": [report["sources"]["baa"], report["sources"]["pfa"]],
        "features": access,
        "location_enrichment": {"label": "U.S. Census Bureau TIGERweb county boundaries", "method": "Point-in-polygon; source county retained for source context."},
    }
    restroom_payload = {
        "type": "FeatureCollection", "updated": retrieved_at,
        "source": "North Carolina Wildlife Resources Commission (NCWRC)",
        "coverage": "Facility restroom flags from the NCWRC public boating access and public fishing area inventories; exact restroom positions are not supplied.",
        "terms": "free, public, non-commercial use only",
        "license_disclaimer": NCWRC_NOTICE,
        "features": restrooms,
    }
    water_payload = {
        "schema_version": 1,
        "updated": retrieved_at,
        "source": "NC OneMap / North Carolina Center for Geographic Information and Analysis (NCCGIA)",
        "source_url": ONEMAP_LAYER,
        "terms_url": ONEMAP_TERMS,
        "terms": "NC OneMap data and services provided directly through the geoportal are free to use without restriction; retain NCCGIA credit, service metadata, and the portal disclaimer.",
        "credit": NCCGIA_CREDIT,
        "coverage": "A subset of detailed 1:24,000-scale major hydrography in North Carolina; not a complete list of fishable waters.",
        "waters": waters,
    }
    atomic_json(DATA / "nc-access.json", access_payload)
    atomic_json(DATA / "nc-restrooms.json", restroom_payload)
    atomic_json(DATA / "nc-destinations.json", water_payload)

    # Keep the source-of-truth coverage metadata in sync with the additive NC
    # catalogs. Subtract the prior NC counts first so rerunning this builder is safe.
    coverage_path = DATA / "coverage.json"
    coverage = read_json(coverage_path)
    old_nc_counts = coverage.get("state_counts", {}).get("NC", {})
    nc_counts = {
        "access": len(access), "fish-structures": 0, "restrooms": len(restrooms),
        "habitat": 0, "state-boundaries": 1, "waters": len(waters),
    }
    for key, value in nc_counts.items():
        coverage.setdefault("counts", {})[key] = max(0, int(coverage.get("counts", {}).get(key, 0)) - int(old_nc_counts.get(key, 0))) + value
    coverage.setdefault("state_counts", {})["NC"] = nc_counts
    coverage["updated"] = retrieved_at
    scope = coverage.get("scope", "").rstrip()
    nc_scope = "North Carolina includes NC OneMap mapped-water references and NCWRC public access records; the NCWRC subset is non-commercial and source-limited, not an exhaustive fishery inventory."
    if nc_scope not in scope:
        coverage["scope"] = f"{scope} {nc_scope}".strip()
    baa_source, pfa_source = report["sources"]["baa"], report["sources"]["pfa"]
    coverage.setdefault("sources", {}).update({
        "nc_ba_area": {
            "source_count": baa_source["record_count_staged"], "accepted": baa_source["record_count_staged"],
            "url": baa_source["url"], "item_url": baa_source["item_url"], "agency": baa_source["agency"],
            "source_updated": baa_source["source_updated"], "terms": baa_source["terms"],
            "note": "Public boating access sites. Free, public, non-commercial use only; see the source disclaimer on each location card.",
        },
        "nc_public_fishing_areas": {
            "source_count": pfa_source["record_count_staged"], "accepted": pfa_source["record_count_staged"],
            "distinct_symbols": pfa_source["record_count_staged"] - merged, "merged_coincident_with_boating_access": merged,
            "url": pfa_source["url"], "item_url": pfa_source["item_url"], "agency": pfa_source["agency"],
            "source_updated": pfa_source["source_updated"], "terms": pfa_source["terms"],
            "note": "Public fishing areas; point locations are agency map locations, not surveyed fishing spots. Free, public, non-commercial use only.",
        },
        "nc_restrooms": {
            "accepted": len(restrooms), "agency": "North Carolina Wildlife Resources Commission",
            "source_urls": [baa_source["url"], pfa_source["url"]],
            "source_updated": {"baa": baa_source["source_updated"], "pfa": pfa_source["source_updated"]},
            "terms": "free, public, non-commercial use only",
            "note": "Facility-level restroom flags; exact restroom building positions are not supplied.",
        },
        "nc_onemap_waterbodies": {
            "record_count": len(waters), "source_polygon_count": water_report["source_polygon_count"],
            "named_polygon_count": water_report["named_polygon_count"],
            "url": ONEMAP_LAYER, "agency": "North Carolina Center for Geographic Information and Analysis (NCCGIA)",
            "terms_url": ONEMAP_TERMS, "retrieved_at": onemap.get("retrievedAt"), "reuse_terms_reviewed": True,
            "note": "Mapped hydrography subset, not a complete inventory of fishable waters or verified public access.",
        },
        "nc_state_boundary": {
            "url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0",
            "agency": "U.S. Census Bureau TIGERweb", "state": "NC", "retrieved_at": retrieved_at,
            "note": "Generalized state outline for map context and zoom extents; not a legal boundary.",
        },
        "nc_fish_attractors": {
            "raw_features_published": 0, "terms_status": "unconfirmed",
            "url": "https://services1.arcgis.com/YfqBAUM5nWR3yhGP/ArcGIS/rest/services/Fish_Attractors_public_view/FeatureServer/0",
            "official_map": NCWRC_WHERE_FISH,
            "note": "Raw locations excluded because the service did not state item-level redistribution terms.",
        },
    })
    coverage["sources"].setdefault("state-boundaries", {})["states_in_catalog"] = len(state_boundaries.get("features", []))
    coverage_tmp = coverage_path.with_suffix(coverage_path.suffix + ".tmp")
    coverage_tmp.write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    coverage_tmp.replace(coverage_path)

    source_counts = {key: value["record_count_staged"] for key, value in report["sources"].items()}
    status_counts = {
        key: dict(Counter(str(feature["properties"].get("Site_Status") or "(blank)") for feature in access_snapshot["features"] if feature["properties"].get("source_layer") == key))
        for key in ("baa", "pfa")
    }
    linked_access = sum(bool(feature["properties"].get("waterbody_id")) for feature in access)
    build_report = {
        "state": "NC", "built_at": retrieved_at,
        "source_snapshot_retrieved_at": access_snapshot.get("retrievedAt"),
        "status": "partial statewide catalogs; source-limited, not an exhaustive inventory",
        "inputs": {"ncwrc_baa": source_counts.get("baa"), "ncwrc_pfa": source_counts.get("pfa"), "nc_onemap_polygons": water_report["source_polygon_count"]},
        "outputs": {"destinations": len(waters), "access_features": len(access), "restroom_flags": len(restrooms)},
        "water_processing": water_report,
        "access_status_counts": status_counts,
        "co_located_pfa_records_merged_into_baa": merged,
        "access_to_destination_links": linked_access,
        "restroom_source_counts": dict(Counter(str(feature["properties"].get("source_layer") or "(blank)") for feature in access_snapshot["features"] if yes(feature["properties"].get("Restroom")))),
        "fish_attractors": {
            "raw_features_published": 0,
            "reason": "The public service exposed no item-level license/redistribution terms. NCWRC's interactive official fish-attractor map is linked from each NC destination card while terms are unresolved.",
            "service_url": "https://services1.arcgis.com/YfqBAUM5nWR3yhGP/ArcGIS/rest/services/Fish_Attractors_public_view/FeatureServer/0",
            "official_map": NCWRC_WHERE_FISH,
        },
        "limitations": [
            "NC OneMap major hydrography is a mapped-water subset, not a complete fishable-water inventory, access record, current shoreline, or depth survey.",
            "No lake-specific species list was inferred from these layers; NC destination species remain unverified unless separately sourced.",
            "NCWRC BAA/PFA records are for free, public, non-commercial use only and carry the source no-warranty/no-liability disclaimer.",
            "Restroom and accessibility flags describe the source facility; their exact positions are not supplied.",
            "Public fishing-area points represent agency map locations, not surveyed fishing-spot coordinates.",
            "NC fish-attractor raw points are not included until item-level redistribution terms are available; the official agency map is linked instead.",
        ],
    }
    atomic_json(STAGING / "nc-app-catalog-build-report.json", build_report)
    print(json.dumps({"outputs": build_report["outputs"], "water_processing": {k:v for k,v in water_report.items() if k != "county_center_fallbacks"}, "merged": merged, "access_to_destination_links": linked_access, "restroom_source_counts": build_report["restroom_source_counts"]}, indent=2))
    print("Created additive NC catalogs and updated coverage metadata and the NC Census state outline.")


if __name__ == "__main__":
    main()
