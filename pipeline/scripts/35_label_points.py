"""Create one label point per public-land unit (avoids repeated labels at tile seams).

Uses the area-weighted centroid of each polygon's largest ring; falls back to a ring vertex if
the centroid falls outside (C-shaped units). Pure Python — no GDAL/shapely needed.
"""
from __future__ import annotations

import json

from common import OUT, write_geojson


def ring_area_centroid(r):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(r, r[1:]):
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if a == 0:
        return 0.0, r[0]
    return abs(a / 2), (cx / (3 * a), cy / (3 * a))


def inside(pt, r):
    x, y = pt
    c = False
    for (x0, y0), (x1, y1) in zip(r, r[1:]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def main():
    src = OUT / "public_lands.geojson"
    if not src.exists():
        print("  skip (run 30_fetch_arcgis.py first)")
        return
    fc = json.loads(src.read_text())
    best: dict[str, tuple[float, list, dict]] = {}
    for f in fc["features"]:
        g = f.get("geometry") or {}
        polys = [g["coordinates"]] if g.get("type") == "Polygon" else g.get("coordinates", []) if g.get("type") == "MultiPolygon" else []
        p = f["properties"]
        name = p.get("Unit_Nm") or p.get("Loc_Nm")
        if not name:
            continue
        for poly in polys:
            outer = poly[0]
            area, c = ring_area_centroid(outer)
            if not inside(c, outer):
                c = outer[len(outer) // 2]
            key = f"{name}|{p.get('Mang_Name', '')}"
            if key not in best or area > best[key][0]:
                best[key] = (area, list(c), {k: p.get(k) for k in ("Unit_Nm", "Loc_Nm", "Mang_Type", "Pub_Access")})
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": c}, "properties": {**props, "area": a}} for a, c, props in best.values()]
    write_geojson(OUT / "public_lands_labels.geojson", feats)


if __name__ == "__main__":
    main()
