"""Build coverage metadata from the exact catalog payloads being published."""
from __future__ import annotations

import re


COUNT_KEYS = {
    "access": "access",
    "fish-structures": "fish-structures",
    "restrooms": "restrooms",
    "habitat": "habitat",
    "state-boundaries": "state-boundaries",
    "waters": "waters",
}


def _states(value):
    if not value:
        return ()
    return tuple(code for code in (part.strip().upper() for part in re.split(r"[/,;]", str(value))) if code)


def catalog_counts(products):
    counts = {}
    state_counts = {}
    for product_name, count_name in COUNT_KEYS.items():
        product = products[product_name]
        features = product.get("waters", []) if product_name == "waters" else product.get("features", [])
        counts[count_name] = len(features)
        for feature in features:
            properties = feature.get("properties", feature)
            if product_name == "state-boundaries":
                state = properties.get("STUSAB")
                states = (str(state).upper(),) if state else ()
            else:
                states = _states(properties.get("state"))
            for state in states:
                state_counts.setdefault(state, {})[count_name] = state_counts.setdefault(state, {}).get(count_name, 0) + 1
    return counts, state_counts


def build_coverage_manifest(products, previous, *, updated, scope, source_updates=None):
    """Keep provenance entries while recomputing totals from shipped catalogs."""
    counts, state_counts = catalog_counts(products)
    sources = dict(previous.get("sources", {}))
    sources.update(source_updates or {})
    manifest = {key: value for key, value in previous.items() if key not in {"updated", "scope", "sources", "counts", "state_counts"}}
    manifest.update({
        "updated": updated,
        "scope": scope,
        "sources": sources,
        "counts": counts,
        "state_counts": state_counts,
    })
    return manifest
