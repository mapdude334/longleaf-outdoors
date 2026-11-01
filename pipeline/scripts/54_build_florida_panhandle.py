"""Stage or apply a sourced Florida Panhandle catalog expansion.

Default mode fetches and writes a reviewable candidate set under
pipeline/staging/florida-panhandle/candidate. Pass --apply to append the
reviewed FWC records to the public app catalogs. Existing records and IDs are
preserved. This is intentionally a Northwest Florida pilot, not statewide
Florida coverage.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from coverage_manifest import build_coverage_manifest

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "public" / "data"
STAGE = ROOT / "pipeline" / "staging" / "florida-panhandle"
CANDIDATE = STAGE / "candidate"
CACHE = ROOT / "pipeline" / "cache" / "florida-panhandle"
CACHE.mkdir(parents=True, exist_ok=True)

FWC_SERVICE = "https://ocean.floridamarine.org/arcgis/rest/services/Projects_FWC/WhatsHappeningOnMyLake/MapServer"
FWC_WATER_URL = FWC_SERVICE + "/2"
FWC_ACCESS_URL = FWC_SERVICE + "/1"
FWC_ATTRACTOR_URL = FWC_SERVICE + "/11"
FWC_COMMUNITY_URL = FWC_SERVICE + "/38"
FWC_BATHY_CONTOUR_URL = FWC_SERVICE + "/30"
FWC_BATHY_POLYGON_URL = FWC_SERVICE + "/31"
FWC_FORECAST = "https://myfwc.com/fishing/freshwater/sites-forecasts/nw/"
FWC_REGULATIONS = "https://myfwc.com/fishing/freshwater/regulations/"
FWC_LICENSES = "https://gooutdoorsflorida.com/"
CENSUS_STATE_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0"
CENSUS_COUNTY_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1"
CENSUS_COUNTY_FILE = "https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_county_500k.zip"
STATE = "FL"
NW_COUNTIES = [
    "Escambia", "Santa Rosa", "Okaloosa", "Walton", "Holmes", "Washington",
    "Bay", "Jackson", "Calhoun", "Gulf", "Liberty", "Franklin", "Leon",
    "Wakulla", "Jefferson", "Gadsden",
]
NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

# Community-fish observations are not an exhaustive sport-fish inventory.
# Map only commonly targeted fish already covered by the app's species guides.
SPORT_SPECIES = {
    "largemouth bass": "Largemouth bass", "florida/largemouth bass": "Largemouth bass",
    "black crappie": "Black crappie", "white crappie": "White crappie",
    "spotted bass": "Spotted bass", "striped bass": "Striped bass",
    "sunshine bass": "Hybrid striped bass", "hybrid striped bass": "Hybrid striped bass",
    "white bass": "White bass", "bluegill": "Bluegill", "redear sunfish": "Redear sunfish",
    "redbreast sunfish": "Redbreast sunfish", "channel catfish": "Channel catfish",
    "blue catfish": "Blue catfish", "flathead catfish": "Flathead catfish",
    "chain pickerel": "Chain pickerel", "warmouth": "Warmouth", "yellow perch": "Yellow perch",
    "red drum": "Red drum", "sheepshead": "Sheepshead", "spotted seatrout": "Spotted seatrout",
    "southern flounder": "Southern flounder",
}


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write(path: Path, value, *, pretty=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2 if pretty else None,
                   separators=None if pretty else (",", ":")) + "\n",
        encoding="utf-8",
    )


def get_json(url: str, params: dict | None = None):
    full = url + ("?" + urlencode(params) if params else "")
    headers = {"User-Agent": "LongleafAtlasPublicCatalog/1.0"}
    # ArcGIS may return 404 for long query strings; POST keeps large object-ID
    # pages reliable while preserving the same read-only query semantics.
    if params and len(full) > 1800:
        request = Request(url, data=urlencode(params).encode("utf-8"), headers={
            **headers, "Content-Type": "application/x-www-form-urlencoded",
        })
    else:
        request = Request(full, headers=headers)
    with urlopen(request, timeout=90) as response:
        payload = json.load(response)
    if payload.get("error"):
        raise RuntimeError(f"ArcGIS source error for {url}: {payload['error']}")
    return payload


def layer_metadata(url: str):
    return get_json(url, {"f": "json"})


def records(url: str, where: str, *, geometry=True, out_fields="*", page_size=400):
    """Fetch by object IDs and fail closed if any source row is missing."""
    metadata = layer_metadata(url)
    id_result = get_json(url + "/query", {"f": "json", "where": where, "returnIdsOnly": "true"})
    ids = id_result.get("objectIds") or []
    expected = len(ids)
    if not expected:
        raise RuntimeError(f"Empty source response for {url}; refusing to publish an empty catalog.")
    features = []
    for start in range(0, expected, page_size):
        batch = ids[start:start + page_size]
        page = get_json(url + "/query", {
            "f": "geojson" if geometry else "json", "objectIds": ",".join(map(str, batch)),
            "outFields": out_fields, "returnGeometry": "true" if geometry else "false",
            "outSR": "4326", "resultRecordCount": str(page_size),
            "maxAllowableOffset": "0.00015", "geometryPrecision": "6",
            "returnZ": "false", "returnM": "false",
        })
        got = page.get("features") or []
        if len(got) != len(batch):
            raise RuntimeError(f"Incomplete ArcGIS page for {url}: expected {len(batch)}, received {len(got)}")
        features.extend(got)
    if len(features) != expected:
        raise RuntimeError(f"Incomplete catalog from {url}: expected {expected}, received {len(features)}")
    return features, metadata


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def normalize_geometry_coordinates(value):
    """FWC GeoJSON sometimes serializes coordinate pairs as "x y" strings."""
    if isinstance(value, str):
        parts = value.replace(",", " ").split()
        if len(parts) >= 2:
            x, y = number(parts[0]), number(parts[1])
            if x is not None and y is not None:
                return [x, y]
        raise RuntimeError(f"Unrecognized GeoJSON coordinate: {value!r}")
    if isinstance(value, list):
        if len(value) >= 2 and all(number(part) is not None for part in value[:2]):
            return [number(value[0]), number(value[1]), *value[2:]]
        return [normalize_geometry_coordinates(child) for child in value]
    raise RuntimeError(f"Unrecognized GeoJSON coordinate value: {value!r}")


def geometry_bounds(geometry: dict):
    points = []
    def walk(value):
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(part, (int, float)) for part in value[:2]):
            points.append((value[0], value[1]))
        elif isinstance(value, list):
            for item in value:
                walk(item)
    walk(geometry.get("coordinates", []))
    if not points:
        raise RuntimeError("A boundary geometry has no coordinates.")
    return [min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points), max(y for _, y in points)]


def point_in_ring(lon, lat, ring):
    inside = False
    for index, point in enumerate(ring):
        previous = ring[index - 1]
        if (point[1] > lat) != (previous[1] > lat):
            crossing = (previous[0] - point[0]) * (lat - point[1]) / (previous[1] - point[1]) + point[0]
            if lon < crossing:
                inside = not inside
    return inside


def point_in_polygon(lon, lat, rings):
    if not rings or not point_in_ring(lon, lat, rings[0]):
        return False
    return not any(point_in_ring(lon, lat, hole) for hole in rings[1:])


def point_in_geometry(lon, lat, geometry):
    kind, coords = geometry.get("type"), geometry.get("coordinates", [])
    polygons = [coords] if kind == "Polygon" else coords if kind == "MultiPolygon" else []
    return any(point_in_polygon(lon, lat, polygon) for polygon in polygons)


def normalized_water_name(value):
    value = re.sub(r"\([^)]*\)", " ", str(value or "").lower())
    value = re.sub(r"\b(lakes?|rivers?|ponds?|reservoirs?|fma|pfa)\b", " ", value)
    return re.sub(r"[^a-z0-9]", "", value)


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def date_from_epoch(value):
    parsed = number(value)
    if parsed is None or parsed <= 0:
        return None
    return datetime.fromtimestamp(parsed / 1000, timezone.utc).date().isoformat()


def source_date(metadata):
    millis = (metadata.get("editingInfo") or {}).get("lastEditDate")
    return date_from_epoch(millis)


def coordinate(feature):
    geom = feature.get("geometry") or {}
    coords = normalize_geometry_coordinates(geom.get("coordinates"))
    if geom.get("type") != "Point" or len(coords) < 2:
        raise RuntimeError(f"Expected a point source feature, got {geom.get('type')!r}")
    lon, lat = coords[:2]
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise RuntimeError(f"Invalid WGS84 source coordinate {coords}")
    return [round(lon, 6), round(lat, 6)]


def feature_geojson(source_feature):
    feature = dict(source_feature)
    geometry = dict(feature.get("geometry") or {})
    if geometry.get("type") and "coordinates" in geometry:
        geometry["coordinates"] = normalize_geometry_coordinates(geometry["coordinates"])
        feature["geometry"] = geometry
    return feature


def source_county_features():
    result, _ = records(
        CENSUS_COUNTY_URL, "STATE='12'", out_fields="NAME,STATE,COUNTY", page_size=200,
    )
    result = [feature for feature in result if re.sub(r"\s+County$", "", str((feature.get("properties") or {}).get("NAME") or ""), flags=re.I) in NW_COUNTIES]
    if len(result) != len(NW_COUNTIES):
        raise RuntimeError(f"Census returned {len(result)} Northwest Florida counties; expected {len(NW_COUNTIES)}")
    return [feature_geojson(feature) for feature in result]


def county_for_point(coords, counties):
    matches = []
    for feature in counties:
        geometry = feature.get("geometry") or {}
        bounds = geometry_bounds(geometry)
        if bounds[0] <= coords[0] <= bounds[2] and bounds[1] <= coords[1] <= bounds[3]:
            if point_in_geometry(coords[0], coords[1], geometry):
                matches.append(re.sub(r"\s+County$", "", str(feature.get("properties", {}).get("NAME", "")), flags=re.I))
    return matches[0] if len(matches) == 1 else None


def fish_survey_index(community_features):
    index = defaultdict(lambda: {"species": set(), "years": set()})
    for feature in community_features:
        # FWC's table endpoint returns ArcGIS JSON with an `attributes` member,
        # while its spatial layers use GeoJSON `properties`.
        p = feature.get("properties") or feature.get("attributes") or {}
        year = int(number(p.get("Year")) or 0)
        caught = number(p.get("NumberCaught")) or 0
        if year < 2016 or caught <= 0:
            continue
        common = str(p.get("SpeciesCommon") or "").strip().lower()
        species = SPORT_SPECIES.get(common)
        name = normalized_water_name(p.get("WaterBody"))
        if name and species:
            index[name]["species"].add(species)
            index[name]["years"].add(year)
    return index


def canonical_water_name(source_name):
    value = re.sub(r"\s+FMA\s*$", "", str(source_name or "").strip(), flags=re.I)
    if re.match(r"^Jackson\s*,\s*Lake(?:\s|$)", value, flags=re.I):
        return "Lake Jackson"
    if re.match(r"^Talquin\s*,\s*Lake(?:\s|$)", value, flags=re.I):
        return "Lake Talquin"
    if re.match(r"^Seminole\s*,\s*Lake", value, flags=re.I):
        return "Lake Seminole"
    return value


def water_gnis_names(source_name, display_name):
    candidates = [display_name, source_name]
    aliases = {
        "Dead Lakes": ["Dead Lake", "Dead Lakes"],
        "Lake Seminole": ["Lake Seminole", "Seminole Lake"],
        "Lake Jackson": ["Lake Jackson", "Jackson Lake"],
        "Lake Talquin": ["Lake Talquin", "Talquin Lake"],
        "Merritt's Mill Pond": ["Merritt's Mill Pond", "Merritts Mill Pond", "Merritt's Millpond"],
    }
    candidates.extend(aliases.get(display_name, []))
    return list(dict.fromkeys(item for item in candidates if item))


def make_water_catalog(water_features, survey, counties, water_source_date):
    output = []
    seen = set()
    for feature in water_features:
        p = feature.get("properties") or {}
        original_name = str(p.get("Waterbody") or "").strip()
        name = canonical_water_name(original_name)
        slug_value = slug(p.get("Brochure"))
        xy = coordinate(feature)
        if not name or not slug_value or not (-87.8 <= xy[0] <= -83.8 and 29.3 <= xy[1] <= 31.4):
            continue
        ident = "florida-panhandle-" + slug_value
        if ident in seen:
            raise RuntimeError(f"Duplicate FWC waterbody identity: {ident}")
        seen.add(ident)
        county = county_for_point(xy, counties)
        survey_row = survey.get(normalized_water_name(original_name))
        # Some agency source labels are reversed (e.g., "Talquin, Lake") or include a
        # management-area suffix. Normalize only when it produces one unique match.
        if survey_row is None:
            matching = [value for key, value in survey.items() if key and key == normalized_water_name(name)]
            if len(matching) == 1:
                survey_row = matching[0]
        species = sorted(survey_row["species"]) if survey_row else []
        years = sorted(survey_row["years"]) if survey_row else []
        year_note = f"FWC community-fish survey records from {years[0]}–{years[-1]}" if years else "FWC community-fish survey records"
        species_note = (
            f"Species chips show sport fish already covered by Longleaf species guides and recorded in {year_note}. "
            "Survey presence is not a current population estimate, catch rate, or forecast."
            if species else
            "No species from the app's current sport-fish guide set were confirmed in the recent FWC community-fish survey subset. "
            "Use the linked FWC Northwest forecast for current fishing guidance."
        )
        notes = "Use the linked FWC Northwest forecast for seasonal fishing guidance. The representative map point is not a surveyed shoreline, and public access is not confirmed by the destination record."
        if name == "Lake Seminole":
            notes += " This destination entry describes the Florida section of a lake shared with Georgia."
        path = FWC_FORECAST + slug_value + "/"
        output.append({
            "id": ident, "name": name, "gnis_names": water_gnis_names(original_name, name),
            "state": "FL", "type": "river" if "river" in name.lower() else "pond" if "pond" in name.lower() else "lake",
            "center": xy, "species": [{"name": item} for item in species], "notes": notes,
            "links": [
                {"label": f"FWC · {name} Northwest forecast", "url": path},
                {"label": "Florida freshwater fishing regulations", "url": FWC_REGULATIONS},
                {"label": "Florida fishing licenses · Go Outdoors Florida", "url": FWC_LICENSES},
            ],
            "catalog_sources": [
                {"label": "FWC Northwest waterbody catalog", "url": FWC_WATER_URL, "source_updated": water_source_date},
                {"label": "FWC community-fish survey observations", "url": FWC_COMMUNITY_URL, "source_updated": None},
            ],
            "retrieved_at": NOW,
            "species_note": species_note,
            "location_note": "FWC representative location point. A mapped point is not a surveyed shoreline, proof of navigability, or confirmation of public access.",
            "county": county,
            "county_source": {
                "label": "2025 U.S. Census county boundaries (1:500,000)",
                "url": CENSUS_COUNTY_FILE,
                "method": "County containing the FWC representative map point; the waterbody may extend into neighboring counties.",
            } if county else None,
        })
    if len(output) != len(water_features):
        raise RuntimeError(f"Only {len(output)} of {len(water_features)} FWC waterbody rows passed validation")
    return output


def map_destination(name, waters):
    key = normalized_water_name(name)
    matches = [water for water in waters if key and key in {normalized_water_name(water.get("name")), *(normalized_water_name(alias) for alias in water.get("gnis_names", []))}]
    return matches[0]["id"] if len(matches) == 1 else None


def make_attractor_features(features, waters, source_date):
    output = []
    for raw in features:
        feature = feature_geojson(raw)
        p = feature.get("properties") or {}
        xy = coordinate(feature)
        source_id = p.get("OBJECTID") or p.get("OBJECTID_1") or feature.get("id")
        if source_id is None:
            raise RuntimeError("A Florida fish-attractor record has no stable source ID")
        waterbody = str(p.get("WATERBODY") or "").strip()
        material = str(p.get("MATERIAL") or "").strip()
        built = str(p.get("BLT_REFURB") or "").strip()
        raw_name = str(p.get("NAME") or "").strip()
        label = raw_name if raw_name and raw_name.lower() not in {"na", "n/a", "unknown", "none"} else f"Fish Attractor {source_id}"
        details = [f"FWC reports {material.lower()} material" if material else "FWC fish-attractor record"]
        if built:
            details.append(f"built/refurbished {built}")
        output.append({
            "type": "Feature", "id": f"fl-fwc-attractor-{source_id}",
            "geometry": {"type": "Point", "coordinates": xy},
            "properties": {
                "record_id": f"fl-fwc-attractor-{source_id}", "name": f"{label} · {waterbody}" if waterbody else label,
                "kind": "fish_structure", "waterbody": waterbody or None, "state": "FL", "point_state": "FL",
                "point_county": str(p.get("COUNTY") or "").strip() or None,
                "structure": material or "Fish attractor", "installed": built or None,
                "data_source": "Florida Fish and Wildlife Conservation Commission",
                "source_url": FWC_ATTRACTOR_URL, "source_updated": date_from_epoch(p.get("last_edited_date")) or source_date,
                "retrieved_at": NOW, "source_global_id": str(source_id), "marine": False,
                "source_note": "; ".join(details) + ". Agency-reported fish-attractor location; the feature may have moved, deteriorated, or become buried. It is not a depth survey, live sonar, or navigation aid.",
                **({"waterbody_id": map_destination(waterbody, waters)} if map_destination(waterbody, waters) else {}),
            },
        })
    return output


def yes(value):
    return str(value or "").strip().lower() in {"yes", "y", "true", "1"}


def make_access_and_restroom_features(features, waters, source_date):
    access, restrooms = [], []
    for raw in features:
        feature = feature_geojson(raw)
        p = feature.get("properties") or {}
        if str(p.get("Status") or "").strip().lower() != "open for business":
            continue
        if str(p.get("VerificationStatus") or "").strip().lower() != "verified":
            continue
        xy = coordinate(feature)
        source_id = p.get("GlobalID") or p.get("OBJECTID") or feature.get("id")
        if not source_id:
            raise RuntimeError("A Florida public access record has no stable source ID")
        county = str(p.get("County") or "").strip()
        name = str(p.get("RampName") or "").strip()
        waterbody = str(p.get("WaterBodyName") or "").strip()
        if not name:
            name = f"Boat Ramp · {waterbody}" if waterbody else f"Boat Ramp · {county} County"
        verification_date = date_from_epoch(p.get("VerificationDate"))
        fee_raw = str(p.get("isFeeRequired") if p.get("isFeeRequired") is not None else "").strip().lower()
        fee_required = yes(fee_raw)
        fee = "Fee required" if fee_required else "No fee listed" if fee_raw in {"no", "n", "false", "0"} else "Fee status not supplied"
        if fee_required and number(p.get("FeeAmount")) is not None:
            fee += f" · ${number(p.get('FeeAmount')):g}"
        updated = date_from_epoch(p.get("DateUpdated")) or date_from_epoch(p.get("last_edited_date")) or source_date
        props = {
            "record_id": f"fl-fwc-ramp-{source_id}", "name": name, "kind": "boat_ramp",
            "operator": str(p.get("PrimaryAdminEntity") or p.get("PartnerAdminEntity") or "FWC inventory; operator not supplied").strip(),
            "maintenance": str(p.get("PartnerAdminEntity") or "").strip() or None,
            "access": str(p.get("AccessType") or "Public access per FWC inventory"),
            "status": str(p.get("Status") or "Open for Business"), "verification_status": str(p.get("VerificationStatus") or "Verified"),
            "verification_date": verification_date or "Not supplied", "public_access": "FWC public boat-ramp inventory",
            "waterbody": waterbody or None, "waterbody_type": str(p.get("WaterBodyType") or "").strip() or None,
            "water_type": str(p.get("WaterType") or "").strip() or None,
            "county": county or None, "state": "FL", "point_state": "FL", "point_county": county or None,
            "source_access_type": str(p.get("RampType") or "").strip() or None,
            "source_access_subtype": str(p.get("HydrologicalType") or "").strip() or None,
            "fee": fee, "opening_hours": str(p.get("Hours") or "").strip() or None,
            "surface": str(p.get("RampSurface") or "").strip() or None,
            "parking_surface": str(p.get("ParkingSurface") or "").strip() or None,
            "lanes": p.get("TotalLanes"), "website": str(p.get("URL") or "").strip() or None,
            "phone": str(p.get("ContactPhone") or "").strip() or None,
            "description": "FWC marks this ramp Open for Business and Verified" + (f" on {verification_date}" if verification_date else "; the verification date is not supplied") + ". Hours, fees, access, and conditions can change; confirm with the facility before traveling.",
            "parking": p.get("Vehicle"), "toilets": str(p.get("RestroomType") or "").strip() or None,
            "courtesy_dock": str(p.get("DockType") or "").strip() or None,
            "accessibility": str(p.get("AccessibilityLevel") or "").strip() or None,
            "data_source": "Florida Fish and Wildlife Conservation Commission",
            "source_url": FWC_ACCESS_URL, "source_updated": updated, "retrieved_at": NOW,
            "source_global_id": str(source_id),
        }
        linked = map_destination(waterbody, waters) if waterbody else None
        if linked:
            props["waterbody_id"] = linked
        access.append({"type": "Feature", "id": f"fl-fwc-ramp-{source_id}", "geometry": {"type": "Point", "coordinates": xy}, "properties": props})

        restroom_type = str(p.get("RestroomType") or "").strip()
        if restroom_type and restroom_type.lower() not in {"none", "no restroom", "unknown", "n/a", "not provided", "na"}:
            restrooms.append({
                "type": "Feature", "id": f"fl-fwc-restroom-{source_id}",
                "geometry": {"type": "Point", "coordinates": xy},
                "properties": {
                    "record_id": f"fl-fwc-restroom-{source_id}",
                    "name": f"Restroom at {name}", "amenity": "toilets", "kind": "restroom",
                    "facility": restroom_type, "restroom_accessible": str(p.get("isRestroomAccessible") or "").strip() or None,
                    "location_accuracy": "boat-ramp facility point (restroom may be nearby)",
                    "state": "FL", "point_state": "FL", "point_county": county or None,
                    "waterbody": waterbody or None, "data_source": "Florida Fish and Wildlife Conservation Commission",
                    "source_url": FWC_ACCESS_URL, "source_updated": updated, "retrieved_at": NOW,
                    "source_global_id": str(source_id),
                },
            })
            if linked:
                restrooms[-1]["properties"]["waterbody_id"] = linked
    return access, restrooms


def make_bathymetry(features, waters, *, contour=False):
    output = []
    for raw in features:
        feature = feature_geojson(raw)
        p = feature.get("properties") or {}
        water_name = str(p.get("Waterbody") or "").strip()
        linked = map_destination(water_name, waters)
        depth = number(p.get("Depth_feet" if contour else "Depth_Feet"))
        geometry = feature.get("geometry") or {}
        if not linked or depth is None or geometry.get("type") not in ({"LineString", "MultiLineString"} if contour else {"Polygon", "MultiPolygon"}):
            raise RuntimeError(f"Invalid or unlinked FWC bathymetry row {feature.get('id')}: {water_name}")
        feature["id"] = f"fl-fwc-depth-{'contour' if contour else 'band'}-{feature.get('id', p.get('OBJECTID'))}"
        feature["properties"] = {
            "waterbody": water_name, "waterbody_id": linked,
            "depth_ft": abs(depth), "data_source": "Florida Fish and Wildlife Conservation Commission",
            "source_url": FWC_BATHY_CONTOUR_URL if contour else FWC_BATHY_POLYGON_URL,
            "source_note": "FWC lake bathymetry derived from sonar readings logged during Long Term Monitoring vegetation-mapping operations. Available here only for Lake Jackson and Hurricane Lake in Northwest Florida. Survey age and vertical reference are not supplied consistently. Planning aid only, not navigation.",
        }
        output.append(feature)
    return output


def state_feature():
    features, metadata = records(CENSUS_STATE_URL, "STUSAB='FL'", out_fields="STUSAB,NAME", page_size=20)
    if len(features) != 1:
        raise RuntimeError(f"Census Florida state boundary returned {len(features)} features")
    feature = feature_geojson(features[0])
    # Keep this state-wide geometry as a reference for future extent work. The
    # Panhandle pilot does not draw the full-state polygon on the production map.
    feature["properties"] = {"STUSAB": "FL", "NAME": "Florida", "reference_only": True}
    return feature, metadata


def coverage_products(candidate):
    return {name: read(candidate / f"{name}.json") for name in (
        "access", "fish-structures", "restrooms", "habitat", "state-boundaries", "waters",
    )}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="append validated Florida records to public/data")
    args = parser.parse_args()

    water_features, water_meta = records(FWC_WATER_URL, "Region='NW'", page_size=100)
    attractor_features, attractor_meta = records(FWC_ATTRACTOR_URL, "REGION='NW'", page_size=100)
    access_features_source, access_meta = records(FWC_ACCESS_URL, "1=1", page_size=400)
    community_features, community_meta = records(FWC_COMMUNITY_URL, "1=1", geometry=False, page_size=400)
    # Querying the whole ramp table is deliberate: filter spatially by the agency's
    # Northwest Region county list before accepting its maintained status fields.
    county_features = source_county_features()
    water_features = [feature_geojson(feature) for feature in water_features]
    attractor_features = [feature_geojson(feature) for feature in attractor_features]
    community_features = [feature_geojson(feature) for feature in community_features]
    water_source_date = source_date(water_meta)
    attractor_source_date = source_date(attractor_meta)
    access_source_date = source_date(access_meta)
    survey = fish_survey_index(community_features)
    new_waters = make_water_catalog(water_features, survey, county_features, water_source_date)
    new_structures = make_attractor_features(attractor_features, new_waters, attractor_source_date)
    nw_set = {name.upper() for name in NW_COUNTIES}
    region_ramps = []
    for feature in access_features_source:
        props = feature.get("properties") or {}
        if str(props.get("County") or "").strip().upper() not in nw_set:
            continue
        # Restrict to actual Florida point locations inside one of FWC's Northwest counties.
        normalized = feature_geojson(feature)
        xy = coordinate(normalized)
        if county_for_point(xy, county_features) is None:
            continue
        region_ramps.append(normalized)
    new_access, new_restrooms = make_access_and_restroom_features(region_ramps, new_waters, access_source_date)
    if not new_access:
        raise RuntimeError("No verified, open FWC Northwest boat ramps passed validation.")
    if len(attractor_features) != len(new_structures):
        raise RuntimeError("A Florida fish attractor was rejected during catalog normalization.")

    bathy_water_names = ["Hurricane Lake", "Lake Jackson"]
    bathy_where = "Waterbody IN ('Hurricane Lake','Lake Jackson')"
    contours_raw, contours_meta = records(FWC_BATHY_CONTOUR_URL, bathy_where, page_size=300)
    polygons_raw, polygons_meta = records(FWC_BATHY_POLYGON_URL, bathy_where, page_size=300)
    new_contours = make_bathymetry(contours_raw, new_waters, contour=True)
    new_polygons = make_bathymetry(polygons_raw, new_waters, contour=False)
    if {feature["properties"]["waterbody"] for feature in new_polygons} != set(bathy_water_names):
        raise RuntimeError("The FWC bathymetry selection did not include both verified Northwest lakes.")
    state_boundary, _ = state_feature()

    CANDIDATE.mkdir(parents=True, exist_ok=True)
    old_products = {name: read(DATA / f"{name}.json") for name in (
        "access", "fish-structures", "restrooms", "habitat", "state-boundaries", "waters", "coverage",
    )}
    products = {}
    for name in ("access", "fish-structures", "restrooms", "habitat"):
        catalog = old_products[name]
        prefix = {"access": "fl-fwc-ramp-", "fish-structures": "fl-fwc-attractor-", "restrooms": "fl-fwc-restroom-", "habitat": "fl-fwc-habitat-"}[name]
        additions = {"access": new_access, "fish-structures": new_structures, "restrooms": new_restrooms, "habitat": []}[name]
        if name == "habitat" and not additions:
            products[name] = catalog
            continue
        existing = [feature for feature in catalog.get("features", []) if not str(feature.get("id", "")).startswith(prefix)]
        products[name] = {**catalog, "updated": NOW, "features": existing + additions}
    bounds = old_products["state-boundaries"]
    boundaries = [feature for feature in bounds.get("features", []) if feature.get("properties", {}).get("STUSAB") != "FL"]
    boundaries.append(state_boundary)
    products["state-boundaries"] = {**bounds, "retrieved_at": NOW, "features": boundaries}
    waters_doc = old_products["waters"]
    curated = [water for water in waters_doc.get("waters", []) if not str(water.get("id", "")).startswith("florida-panhandle-")]
    if {water["id"] for water in curated} & {water["id"] for water in new_waters}:
        raise RuntimeError("Florida water destination IDs collide with existing curated destinations.")
    products["waters"] = {**waters_doc, "updated": NOW, "waters": curated + new_waters}

    write(CANDIDATE / "access.json", products["access"])
    write(CANDIDATE / "fish-structures.json", products["fish-structures"])
    write(CANDIDATE / "restrooms.json", products["restrooms"])
    write(CANDIDATE / "habitat.json", products["habitat"])
    write(CANDIDATE / "state-boundaries.json", products["state-boundaries"])
    write(CANDIDATE / "waters.json", products["waters"])
    write(CANDIDATE / "florida-bathymetry.json", {"type": "FeatureCollection", "updated": NOW, "features": new_polygons,
          "source": FWC_BATHY_POLYGON_URL, "coverage": ["Lake Jackson", "Hurricane Lake"]})
    write(CANDIDATE / "florida-depth-contours.json", {"type": "FeatureCollection", "updated": NOW, "features": new_contours,
          "source": FWC_BATHY_CONTOUR_URL, "coverage": ["Lake Jackson", "Hurricane Lake"]})

    coverage_source_updates = {
        "florida_nw_waterbodies": {
            "record_count": len(new_waters), "url": FWC_WATER_URL,
            "agency": "Florida Fish and Wildlife Conservation Commission",
            "region": "FWC Northwest Region; 16 counties",
            "source_updated": water_source_date,
            "note": "FWC regional fishing destinations and linked forecast pages; a representative point does not establish public access or a surveyed shoreline.",
            "reuse_terms_reviewed": False,
        },
        "florida_nw_access": {
            "source_count": len(region_ramps), "accepted": len(new_access), "url": FWC_ACCESS_URL,
            "destination_linked": sum(bool(feature["properties"].get("waterbody_id")) for feature in new_access),
            "agency": "Florida Fish and Wildlife Conservation Commission",
            "source_updated": access_source_date,
            "filter": "Northwest counties; status Open for Business; VerificationStatus Verified; point in Census county geometry.",
            "note": "FWC status and verification do not guarantee current hours, fees, conditions, or access; confirm before travel.",
            "reuse_terms_reviewed": False,
        },
        "florida_nw_attractors": {
            "source_count": len(attractor_features), "accepted": len(new_structures), "destination_linked": sum(bool(feature["properties"].get("waterbody_id")) for feature in new_structures), "url": FWC_ATTRACTOR_URL,
            "agency": "Florida Fish and Wildlife Conservation Commission", "source_updated": attractor_source_date,
            "note": "NW-region reported freshwater fish-attractor sites; not current sonar, depth, or navigation data.",
            "reuse_terms_reviewed": False,
        },
        "florida_nw_restrooms": {
            "accepted": len(new_restrooms), "destination_linked": sum(bool(feature["properties"].get("waterbody_id")) for feature in new_restrooms), "url": FWC_ACCESS_URL,
            "agency": "Florida Fish and Wildlife Conservation Commission", "source_updated": access_source_date,
            "note": "Facility-level restroom type at boat-ramp point; restroom may be nearby rather than exactly at the point.",
            "reuse_terms_reviewed": False,
        },
        "florida_nw_species_surveys": {
            "source_records": len(community_features), "url": FWC_COMMUNITY_URL,
            "agency": "Florida Fish and Wildlife Conservation Commission", "source_updated": source_date(community_meta),
            "filter": "FWC community fish records since 2016, mapped only to existing Longleaf sport-fish profiles.",
            "note": "Survey presence is not a current population estimate, catch rate, or forecast.",
            "reuse_terms_reviewed": False,
        },
        "florida_nw_bathymetry": {
            "polygon_count": len(new_polygons), "contour_count": len(new_contours),
            "waterbodies": bathy_water_names, "polygon_url": FWC_BATHY_POLYGON_URL,
            "contour_url": FWC_BATHY_CONTOUR_URL,
            "agency": "Florida Fish and Wildlife Conservation Commission",
            "note": "Sonar readings logged during FWC Long Term Monitoring vegetation-mapping operations; only Lake Jackson and Hurricane Lake are covered in this pilot. Survey date and vertical reference are not supplied consistently; not navigation.",
            "reuse_terms_reviewed": False,
        },
        "florida_state_boundary": {
            "url": CENSUS_STATE_URL, "agency": "U.S. Census Bureau TIGERweb",
            "state": "FL", "retrieved_at": NOW,
            "note": "Generalized reference outline; used for display/context, not legal jurisdiction.",
        },
    }
    florida_scope = "Florida is partial coverage limited to FWC Northwest Region destinations and verified public data; no statewide Florida completeness claim."
    scope_base = re.sub(r"(?:;\s*)?Florida is partial coverage limited to FWC Northwest Region destinations and verified public data; no statewide Florida completeness claim\.?", "", str(old_products["coverage"].get("scope", "")))
    scope_base = re.sub(r"\s*;\s*$", "", scope_base).strip()
    scope = "; ".join(part for part in (scope_base, florida_scope) if part)
    coverage = build_coverage_manifest(products, old_products["coverage"], updated=NOW, scope=scope, source_updates=coverage_source_updates)
    write(CANDIDATE / "coverage.json", coverage, pretty=True)
    write(CANDIDATE / "report.json", {
        "mode": "applied" if args.apply else "candidate only", "region": "Florida Panhandle · FWC Northwest Region",
        "counties": NW_COUNTIES,
        "records": {"waterbodies": len(new_waters), "ramps_open_and_verified": len(new_access), "ramp_records_in_nw_counties": len(region_ramps),
                    "ramps_linked_to_guides": sum(bool(feature["properties"].get("waterbody_id")) for feature in new_access),
                    "attractors": len(new_structures), "attractors_linked_to_guides": sum(bool(feature["properties"].get("waterbody_id")) for feature in new_structures),
                    "restroom_facility_records": len(new_restrooms), "restrooms_linked_to_guides": sum(bool(feature["properties"].get("waterbody_id")) for feature in new_restrooms),
                    "bathymetry_polygons": len(new_polygons), "depth_contours": len(new_contours)},
        "catalog_state_counts": coverage.get("state_counts", {}).get("FL", {}),
        "notes": [
            "This is a Florida Panhandle pilot, not statewide Florida coverage.",
            "Boat-ramp records require FWC Open for Business and Verified status; confirm current facility conditions before traveling.",
            "Restroom locations are boat-ramp facility points and may be approximate.",
            "Species chips are common sport fish documented in FWC community-fish surveys since 2016; survey presence is not a current forecast.",
            "FWC underwater bathymetry coverage is limited here to Lake Jackson and Hurricane Lake.",
            "Existing destination IDs and all non-Florida features are retained.",
        ],
    }, pretty=True)

    if args.apply:
        for name in ("access", "fish-structures", "restrooms", "habitat", "state-boundaries", "waters", "coverage"):
            if name == "habitat" and products[name] is old_products[name]:
                # No Florida habitat layer was verified; preserve this catalog byte-for-byte.
                continue
            write(DATA / f"{name}.json", products[name] if name != "coverage" else coverage, pretty=name == "coverage")
        write(DATA / "florida-bathymetry.json", read(CANDIDATE / "florida-bathymetry.json"))
        write(DATA / "florida-depth-contours.json", read(CANDIDATE / "florida-depth-contours.json"))

    print(json.dumps(read(CANDIDATE / "report.json"), indent=2))
    print("Candidate written to pipeline/staging/florida-panhandle/candidate")
    if args.apply:
        print("Applied Florida Panhandle data to public/data; review and validate before committing.")


if __name__ == "__main__":
    main()
