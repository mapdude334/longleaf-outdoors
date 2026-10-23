"""Join curated fishery info (public/data/waters.json) onto NHD water bodies and streams by
GNIS name so tapping a lake or river in the app shows its species and regs link offline.
"""
from __future__ import annotations

import json

from common import OUT, ROOT

WATERS = json.loads((ROOT.parent / "public" / "data" / "waters.json").read_text())


def norm(s: str) -> str:
    return (s or "").lower().replace("lake ", "").replace(" lake", "").replace(" reservoir", "").strip()


INDEX = {}
for w in WATERS["waters"]:
    for name in [w["name"], *w.get("gnis_names", [])]:
        INDEX[norm(name)] = w


def enrich(path):
    if not path.exists():
        print(f"  skip {path.name} (run 50_nhd.py first)")
        return
    fc = json.loads(path.read_text())
    hits = 0
    for f in fc["features"]:
        p = f["properties"]
        w = INDEX.get(norm(p.get("gnis_name", "")))
        if w:
            p["water_id"] = w["id"]
            p["species"] = ", ".join(s["name"] for s in w["species"][:8])
            hits += 1
    path.write_text(json.dumps(fc))
    print(f"  {path.name}: {hits:,} features linked to fishery info")


if __name__ == "__main__":
    enrich(OUT / "water_bodies.geojson")
    enrich(OUT / "streams.geojson")
