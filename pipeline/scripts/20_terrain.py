"""Mirror Terrarium-encoded elevation tiles for the AOI into terrain.pmtiles.

The app uses this one file for hillshade, 3D terrain and client-side contour lines
(maplibre-contour), all of which keep working offline.

z12 ≈ 38 m/pixel at this latitude — plenty for hillshade and 20-40 ft contours.
"""
from __future__ import annotations

import math
import sqlite3
import subprocess
from concurrent.futures import ThreadPoolExecutor

from common import OUT, bbox, http_get, sources


def tile_range(z: int, west: float, south: float, east: float, north: float):
    def xy(lon, lat):
        n = 2 ** z
        x = int((lon + 180) / 360 * n)
        y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
        return max(0, min(n - 1, x)), max(0, min(n - 1, y))
    x0, y0 = xy(west, north)
    x1, y1 = xy(east, south)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield z, x, y


def main() -> None:
    cfg = sources()
    maxz = cfg["aoi"]["terrain_maxzoom"]
    url = cfg["terrain"]["url"]
    w, s, e, n = bbox()
    tiles = [t for z in range(0, maxz + 1) for t in tile_range(z, w, s, e, n)]
    print(f"[terrain] {len(tiles):,} tiles z0-{maxz}")

    mb = OUT / "terrain.mbtiles"
    mb.unlink(missing_ok=True)
    db = sqlite3.connect(mb)
    db.executescript("""
      CREATE TABLE metadata (name text, value text);
      CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);
      CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row);
    """)
    meta = {"name": "terrain", "format": "png", "type": "baselayer", "minzoom": "0", "maxzoom": str(maxz),
            "bounds": ",".join(map(str, bbox())), "attribution": cfg["terrain"]["attribution"],
            "encoding": "terrarium"}
    db.executemany("INSERT INTO metadata VALUES (?,?)", meta.items())

    def get(t):
        z, x, y = t
        return t, http_get(url.format(z=z, x=x, y=y))

    done = 0
    with ThreadPoolExecutor(16) as pool:
        for (z, x, y), data in pool.map(get, tiles):
            db.execute("INSERT INTO tiles VALUES (?,?,?,?)", (z, x, (2 ** z - 1) - y, data))
            done += 1
            if done % 200 == 0:
                print(f"  {done:,}/{len(tiles):,}", end="\r")
    db.commit()
    db.close()
    out = OUT / "terrain.pmtiles"
    out.unlink(missing_ok=True)
    subprocess.run(["pmtiles", "convert", str(mb), str(out)], check=True)
    mb.unlink()
    print(f"\n  wrote {out}")


if __name__ == "__main__":
    main()
