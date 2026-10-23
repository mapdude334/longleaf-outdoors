"""Download NHD High Resolution (HU4 file geodatabases) and extract named lakes,
ponds/reservoirs and named streams for the AOI with GDAL/ogr2ogr.

Outputs out/water_bodies.geojson and out/streams.geojson.
"""
from __future__ import annotations

import subprocess
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


def ogr(src, layer, dst, where, fields, append: bool):
    w, s, e, n = map(str, bbox())
    cmd = ["ogr2ogr", "-f", "GeoJSON", str(dst), str(src), layer,
           "-spat", w, s, e, n, "-spat_srs", "EPSG:4326", "-t_srs", "EPSG:4326",
           "-where", where, "-select", fields, "-lco", "COORDINATE_PRECISION=6",
           "-nlt", "PROMOTE_TO_MULTI", "-dim", "XY", "-makevalid"]
    if append:
        cmd[1:1] = ["-append"]
    print(" ", " ".join(cmd[:6]), "...")
    subprocess.run(cmd, check=True)


def main() -> None:
    cfg = sources()["nhd_hu4"]
    wb, fl = OUT / "water_bodies.geojson", OUT / "streams.geojson"
    wb.unlink(missing_ok=True)
    fl.unlink(missing_ok=True)
    for i, huc in enumerate(cfg["hucs"]):
        gdb = ensure_gdb(huc, cfg["url_template"])
        # 390 Lake/Pond, 436 Reservoir. Drop tiny farm ponds (<1 ha) unless named.
        ogr(gdb, "NHDWaterbody", wb, "ftype IN (390,436) AND (areasqkm >= 0.01 OR gnis_name IS NOT NULL)",
            FIELDS_WB, append=i > 0)
        # 460 StreamRiver, 558 ArtificialPath (river centerline through lakes). Named only.
        ogr(gdb, "NHDFlowline", fl, "ftype IN (460,558) AND gnis_name IS NOT NULL", FIELDS_FL, append=i > 0)


if __name__ == "__main__":
    main()
