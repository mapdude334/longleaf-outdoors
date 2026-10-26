"""Shared helpers for the Longleaf Outdoors data pipeline (stdlib only)."""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
CACHE = ROOT / "cache"
OUT.mkdir(exist_ok=True)
CACHE.mkdir(exist_ok=True)

UA = "LongleafOutdoors-pipeline/1.0 (+https://github.com/mapdude334/longleaf-outdoors; regional offline maps)"


def sources() -> dict:
    return json.loads((ROOT / "sources.json").read_text())


def bbox() -> list[float]:
    return sources()["aoi"]["bbox"]


def http_get(url: str, params: dict | None = None, data: bytes | None = None,
             retries: int = 4, timeout: int = 120) -> bytes:
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    last = None
    for attempt in range(retries):
        try:
            headers = {"User-Agent": UA}
            if data is not None:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            wait = 2 ** attempt * 3
            print(f"  ! {e} — retry in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"GET failed after {retries} tries: {url}\n{last}")


def write_geojson(path: Path, features: list[dict]) -> None:
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"  wrote {len(features):,} features -> {path.relative_to(ROOT)}")
