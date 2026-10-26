"""Download NHD High Resolution (HU4 file geodatabases) and extract named lakes,
ponds/reservoirs and named streams for the AOI with GDAL/ogr2ogr.

Outputs out/water_bodies.geojson and out/streams.geojson.
"""
from __future__ import annotations

import subprocess
import json
import zipfile

from common import CACHE, OUT, bbox, http_get, sources

FIELDS_WB = "gnis_name,ftype,fcode,areasqkm,elevation,permanent_identifier"
FIELDS_FL = "gnis_name,ftype,fcode,lengthkm,permanent_identifier"


def ensure_gdb(huc: str, tmpl: str):
    z = CACHE / f"NHD_H_{huc}_HU4_GDB.zip"
    if not z.exists():
        print(f"[nhd] downloading HU4 {huc} (~0.3-1 GB)")
        z.write_bytes(http_get(tmpl.format(huc=huc), timeout=1800))
    d = CACHE / f"NHD_{huc}"
    if not d.exists():
        with zipfile.ZipFile(z) as zf:
            zf.extractall(d)
    return next(d.rglob("*.gdb"))


def ogr(src, layer, dst, where, fields):
    w, s, e, n = map(str, bbox())
    cmd = ["ogr2ogr", "-f", "GeoJSON", str(dst), str(src), layer,
           "-spat", w, s, e, n, "-spat_srs", "EPSG:4326", "-t_srs", "EPSG:4326",
           "-where", where, "-select", fields, "-lco", "COORDINATE_PRECISION=6",
           "-nlt", "PROMOTE_TO_MULTI", "-dim", "XY", "-makevalid"]
    print(" ", " ".join(cmd[:6]), "...")
    subprocess.run(cmd, check=True)


def main() -> None:
    cfg = sources()["nhd_hu4"]
    wb, fl = OUT / "water_bodies.geojson", OUT / "streams.geojson"
    wb.unlink(missing_ok=True)
    fl.unlink(missing_ok=True)
    collected = {"water_bodies": {}, "streams": {}}
    for huc in cfg["hucs"]:
        gdb = ensure_gdb(huc, cfg["url_template"])
        # 390 Lake/Pond, 436 Reservoir. Drop tiny farm ponds (<1 ha) unless named.
        water_part = OUT / f"water_bodies_{huc}.geojson"
        stream_part = OUT / f"streams_{huc}.geojson"
        water_part.unlink(missing_ok=True)
        stream_part.unlink(missing_ok=True)
        ogr(gdb, "NHDWaterbody", water_part, "ftype IN (390,436) AND (areasqkm >= 0.01 OR gnis_name IS NOT NULL)", FIELDS_WB)
        # 460 StreamRiver, 558 ArtificialPath (river centerline through lakes). Named only.
        ogr(gdb, "NHDFlowline", stream_part, "ftype IN (460,558) AND gnis_name IS NOT NULL", FIELDS_FL)
        # Convert each source separately: GDAL forbids combining -append with
        # -select. Merge by permanent identifier to avoid watershed-edge duplicates.
        for kind, part in (("water_bodies", water_part), ("streams", stream_part)):
            for feature in json.loads(part.read_text())["features"]:
                props = {k.lower(): v for k, v in feature["properties"].items()}
                key = props.get("permanent_identifier") or json.dumps(feature, sort_keys=True)
                collected[kind][key] = feature
            part.unlink()
    for kind, destination in (("water_bodies", wb), ("streams", fl)):
        if not collected[kind]:
            raise RuntimeError(f"No {kind} extracted; refusing to publish an empty archive")
        destination.write_text(json.dumps({"type": "FeatureCollection", "features": list(collected[kind].values())}))
        print(f"[nhd] {kind}: {len(collected[kind]):,} unique features")


if __name__ == "__main__":
    main()
