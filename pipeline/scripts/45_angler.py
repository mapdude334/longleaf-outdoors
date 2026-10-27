"""Build fish-structure and restroom catalogs for the map and its offline tiles."""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from common import OUT, bbox, http_get, sources, write_geojson

ROOT = OUT.parent.parent
PUBLIC_DATA = ROOT / "public" / "data"
CHUNK = 500
KEEP_OSM = {
    "name", "operator", "access", "fee", "opening_hours", "wheelchair", "description",
    "amenity", "leisure", "tourism", "toilets", "toilets:access", "toilets:wheelchair",
    "changing_table", "unisex", "addr:street", "addr:city", "website", "phone",
}
PRIVATE_ACCESS = {"private", "customers", "no", "employees", "permit", "members", "restricted"}


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def convert_feature(raw: dict, ident: str, name: str, props: dict) -> dict:
    geometry = raw.get("geometry") or {}
    return {
        "type": "Feature",
        "id": ident,
        "geometry": {"type": "Point", "coordinates": [geometry["x"], geometry["y"]]},
        "properties": {"name": name, **props},
    }


def fetch_arcgis_structures() -> list[dict]:
    cfg = sources()["angler_data"]["fish_attractors"]
    url = cfg["url"].rstrip("/")
    xmin, ymin, xmax, ymax = bbox()
    envelope = {"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax, "spatialReference": {"wkid": 4326}}
    params = {
        "where": "1=1", "geometry": json.dumps(envelope), "geometryType": "esriGeometryEnvelope",
        "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "returnIdsOnly": "true", "f": "json",
    }
    ids_doc = json.loads(http_get(url + "/query", params))
    if "error" in ids_doc:
        raise RuntimeError(f"ADCNR fish-attractor query failed: {ids_doc['error']}")
    ids = sorted(ids_doc.get("objectIds") or [])
    features: list[dict] = []
    for offset in range(0, len(ids), CHUNK):
        chunk = ids[offset:offset + CHUNK]
        params = {
            "objectIds": ",".join(map(str, chunk)), "outFields": cfg["out_fields"],
            "outSR": 4326, "returnGeometry": "true", "geometryPrecision": 6, "f": "json",
        }
        data = json.loads(http_get(url + "/query", data=urlencode(params).encode()))
        if "error" in data:
            raise RuntimeError(f"ADCNR fish-attractor page failed: {data['error']}")
        if len(data.get("features", [])) != len(chunk):
            raise RuntimeError("ADCNR fish-attractor service returned an incomplete page")
        for row in data["features"]:
            p = row.get("attributes") or {}
            water = str(p.get("Waterbody") or "Alabama lake")
            structure = str(p.get("Structure") or "Fish-attractor structure")
            name = f"{water} · {structure}"
            props = {
                "kind": "fish_structure", "waterbody": water, "structure": structure,
                "quantity": p.get("Amount"), "installed": p.get("Installati"),
                "depth_ft": p.get("Depth_at_F"), "data_source": "Alabama DCNR",
                "source_url": "https://outdooralabama.com/FreshwaterFishingStructure",
                "source_detail": "ADCNR freshwater fish-attractor GIS service",
            }
            features.append(convert_feature(row, f"al-dcnr-{p.get('OBJECTID')}", name, props))
    print(f"[angler] {len(features):,} Alabama DCNR fish-attractor records")
    return features


def dms(degrees: str, minutes: str, seconds: str, sign: float) -> float:
    return sign * (float(degrees) + float(minutes) / 60 + float(seconds) / 3600)


def fetch_usace_west_point() -> list[dict]:
    cfg = sources()["angler_data"]["usace_west_point"]
    csv_path = OUT.parent / "data" / cfg["coordinate_file"]
    features = []
    with csv_path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            lat = dms(row["lat_deg"], row["lat_min"], row["lat_sec"], 1)
            lon = dms(row["lon_deg"], row["lon_min"], row["lon_sec"], -1)
            features.append({
                "type": "Feature", "id": f"usace-west-point-{row['id']}",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "name": f"West Point fish attractor {row['id']}", "kind": "fish_structure",
                    "waterbody": "West Point Lake", "structure": row["comments"],
                    "data_source": "USACE Mobile District", "source_url": cfg["url"],
                    "source_detail": "USACE fish-attractor coordinate list, published circa 2012",
                    "source_note": "Legacy coordinate list. Verify current buoy markers and conditions with USACE before relying on this point.",
                },
            })
    return features


def fetch_osm_restrooms() -> list[dict]:
    cfg = sources()["angler_data"]["restrooms"]
    x0, y0, x1, y1 = bbox()
    selectors = cfg["queries"]
    body = "[out:json][timeout:180];(" + "".join(f"{q}({y0},{x0},{y1},{x1});" for q in selectors) + ");out center tags;"
    data = json.loads(http_get(sources()["overpass"]["url"], data=urlencode({"data": body}).encode(), timeout=240))
    if data.get("remark"):
        raise RuntimeError("Overpass returned incomplete restroom data: " + data["remark"])
    features = []
    seen = set()
    for el in data.get("elements", []):
        osm_id = f"{el['type']}/{el['id']}"
        if osm_id in seen:
            continue
        seen.add(osm_id)
        tags = el.get("tags") or {}
        if tags.get("access", "").lower() in PRIVATE_ACCESS or tags.get("toilets:access", "").lower() in PRIVATE_ACCESS:
            continue
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        if lon is None or lat is None:
            continue
        is_point = tags.get("amenity") == "toilets"
        feature_type = tags.get("leisure") or tags.get("amenity") or "recreation facility"
        if not is_point and tags.get("amenity") == "boat_ramp":
            feature_type = "boat ramp"
        label = tags.get("name") or tags.get("operator")
        name = f"{label} restroom" if label and not is_point else (label or "Public restroom")
        if not is_point and not label:
            name = "Restroom reported at recreation facility"
        props = {k: v for k, v in tags.items() if k in KEEP_OSM}
        props.update({
            "kind": "restroom", "facility": feature_type,
            "location_accuracy": "restroom point" if is_point else "facility point (restroom may be nearby)",
            "data_source": "OpenStreetMap", "osm": osm_id,
            "source_url": "https://www.openstreetmap.org/" + osm_id,
        })
        features.append({"type": "Feature", "id": osm_id, "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": {"name": name, **props}})
    print(f"[angler] {len(features):,} public restroom / restroom-equipped recreation records")
    return features


def write_catalog(path: Path, features: list[dict], source: str, source_url: str, updated: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {"type": "FeatureCollection", "updated": updated, "source": source, "sourceUrl": source_url, "features": features}
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {len(features):,} features -> {path.relative_to(ROOT)}")


def main() -> None:
    updated = now()
    sources_config = sources()["angler_data"]
    structures = fetch_arcgis_structures() + fetch_usace_west_point()
    restrooms = fetch_osm_restrooms()
    write_geojson(OUT / "fish_structures.geojson", structures)
    write_geojson(OUT / "restrooms.geojson", restrooms)
    write_catalog(PUBLIC_DATA / "fish-structures.json", structures, "Alabama DCNR; USACE Mobile District", sources_config["fish_attractors"]["url"], updated)
    write_catalog(PUBLIC_DATA / "restrooms.json", restrooms, "OpenStreetMap contributors", sources()["overpass"]["url"], updated)


if __name__ == "__main__":
    main()
