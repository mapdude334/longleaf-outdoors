"""QGIS QA helper — paste into the QGIS Python Console (Plugins ▸ Python Console ▸ Show Editor ▸ Run).

Loads every pipeline output (pipeline/out/*.geojson, *.pmtiles) plus the live source services,
so you can eyeball coverage, attributes and gaps before publishing tiles.

Tested with QGIS 3.34+ (PMTiles vector tiles need QGIS 3.32 or newer).
"""
from pathlib import Path

from qgis.core import (QgsCoordinateReferenceSystem, QgsProject, QgsRasterLayer, QgsVectorLayer,
                       QgsVectorTileLayer)

# ---- edit these ----
REPO = Path.home() / "longleaf-outdoors"          # where you cloned the repo
PROJECT_CRS = "EPSG:3857"                     # or "ESRI:102629" (NAD83 StatePlane AL East, US ft)
# --------------------

OUT = REPO / "pipeline" / "out"
proj = QgsProject.instance()
root = proj.layerTreeRoot()
proj.setCrs(QgsCoordinateReferenceSystem(PROJECT_CRS))


def group(name):
    return root.findGroup(name) or root.addGroup(name)


def add(layer, grp):
    if layer.isValid():
        proj.addMapLayer(layer, False)
        group(grp).addLayer(layer)
    else:
        print("!! could not load", layer.name())


# Basemaps (USGS The National Map, public domain)
for name, svc in [("USGS Topo", "USGSTopo"), ("USGS Imagery", "USGSImageryOnly")]:
    uri = f"type=xyz&url=https://basemap.nationalmap.gov/arcgis/rest/services/{svc}/MapServer/tile/%7Bz%7D/%7By%7D/%7Bx%7D&zmax=16"
    add(QgsRasterLayer(uri, name, "wms"), "Basemaps")

# Pipeline outputs
for pm in sorted(OUT.glob("*.pmtiles")):
    if pm.stem in ("overlays", "parcels", "basemap"):
        add(QgsVectorTileLayer(f"type=pmtiles&url={pm.as_posix()}", f"{pm.stem}.pmtiles"), "Tiles (as published)")
for gj in sorted(OUT.glob("*.geojson")):
    add(QgsVectorLayer(gj.as_posix(), gj.stem, "ogr"), "Pipeline GeoJSON")

# Live sources for comparison
add(QgsVectorLayer("crs='EPSG:4326' url='https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0'",
                   "PAD-US 4.1 Fee (live)", "arcgisfeatureserver"), "Live services")
add(QgsVectorLayer("crs='EPSG:4326' url='https://explore.opelika-al.gov/server/rest/services/Lee_County_Parcels/MapServer/0'",
                   "Lee Co. parcels (live)", "arcgisfeatureserver"), "Live services")

print("Loaded Longleaf Outdoors layers. Zoom to the AOI: -86.35, 31.55, -84.35, 33.85")
