"""Pull angler-relevant OpenStreetMap features via Overpass: boat ramps, fishing piers,
canoe put-ins, marinas, campsites, trailheads, dams.

Writes out/access.geojson and out/osm_dams.geojson. Ways/relations are reduced to
their center point (Overpass `out center`).
"""
from __future__ import annotations

import json
from urllib.parse import urlencode

from common import OUT, bbox, http_get, sources, write_geojson

KEEP = {"name", "operator", "access", "fee", "opening_hours", "surface", "lanes", "website",
        "phone", "description", "parking", "toilets", "fishing", "boat", "canoe", "lit",
        "leisure", "amenity", "man_made", "tourism", "highway", "waterway", "power",
        "plant:source", "plant:output:electricity", "ref"}


def classify(t: dict) -> str:
    if t.get("leisure") == "slipway" or t.get("amenity") == "boat_ramp":
        return "boat_ramp"
    if t.get("canoe") == "put_in" or t.get("waterway") == "access_point":
        return "paddle_launch"
    if t.get("man_made") == "pier" or t.get("leisure") == "fishing":
        return "fishing"
    if t.get("leisure") == "marina":
        return "marina"
    if t.get("tourism") == "camp_site":
        return "campground"
    if t.get("highway") == "trailhead":
        return "trailhead"
    if t.get("amenity") == "parking":
        return "parking"
    if t.get("waterway") in ("dam", "weir") or t.get("power") == "plant":
        return "dam"
    return "other"


def run(name: str, selectors: list[str]) -> list[dict]:
    s, w, n, e = bbox()[1], bbox()[0], bbox()[3], bbox()[2]
    body = "[out:json][timeout:180];(" + "".join(f"{q}({s},{w},{n},{e});" for q in selectors) + ");out center tags;"
    print(f"[osm:{name}] {len(selectors)} selectors")
    data = json.loads(http_get(sources()["overpass"]["url"], data=urlencode({"data": body}).encode(), timeout=240))
    if data.get("remark"):
        raise RuntimeError("Overpass returned incomplete results: " + data["remark"])
    feats = []
    for el in data.get("elements", []):
        t = el.get("tags", {})
        lon = el.get("lon") or el.get("center", {}).get("lon")
        lat = el.get("lat") or el.get("center", {}).get("lat")
        if lon is None:
            continue
        props = {k: v for k, v in t.items() if k in KEEP}
        props.update(kind=classify(t), osm=f"{el['type']}/{el['id']}", _src="osm")
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props})
    return feats


def main() -> None:
    q = sources()["overpass"]["queries"]
    write_geojson(OUT / "access.geojson", run("access", q["access"]))
    write_geojson(OUT / "osm_dams.geojson", run("dams", q["dams"]))


if __name__ == "__main__":
    main()
