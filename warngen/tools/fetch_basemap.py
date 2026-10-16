#!/usr/bin/env python3
"""
Pull the D2D map overlays the WarnGen map can't derive from its own county outlines (time
zones, major rivers, lakes) from the mapdata.* tables on Unidata's public EDEX, and lay them
out the way the map does: CONUS at true coordinates, Alaska, Hawaii and the territories moved
into their insets. State and CWA borders come from us_counties.geojson in the page instead,
so they sit exactly on the county lines.

    C:/tmp/awenv/Scripts/python warngen/tools/fetch_basemap.py [timezones|rivers|lakes ...]

Needs python-awips, six and shapely. One request per table, spaced out; Unidata's server is
shared. Raw rows are cached in tools/output, so reruns only redo the geometry. Writes
warngen/data/basemap/<layer>.geojson, one merged feature per file.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

from awips.dataaccess import DataAccessLayer
from shapely import affinity, make_valid, wkb
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon, box
from shapely.ops import linemerge, unary_union

EDEX_HOST = "edex-cloud.unidata.ucar.edu"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "data", "basemap")
CACHE_DIR = os.path.join(HERE, "output")
PLACES = 3
FETCHED = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# COMPOSITE_TRANSFORMS in warngen/index.html.
INSETS = [
    {"name": "AK", "src": (-152, 63), "dst": (-117, 21), "scale": (0.35, 0.75),
     "boxes": [(-180, 50, -125, 72), (150, 50, 180, 72)]},
    {"name": "HI", "src": (-157, 20), "dst": (-105, 26), "scale": (1, 1), "boxes": [(-161, 18, -154, 23)]},
    {"name": "AS", "src": (-170, -14), "dst": (-101, 24), "scale": (1, 1), "boxes": [(-172, -15, -169, -13)]},
    {"name": "GU", "src": (144, 13), "dst": (-112, 32), "scale": (1, 1), "boxes": [(143, 13, 146, 14)]},
    {"name": "MP", "src": (145, 16), "dst": (-112, 34), "scale": (1, 1), "boxes": [(143, 14, 146, 21)]},
    {"name": "PR", "src": (-66, 18), "dst": (-76, 25), "scale": (1, 1), "boxes": [(-68, 17, -65, 19)]},
    {"name": "VI", "src": (-65, 18), "dst": (-75, 26), "scale": (1, 1), "boxes": [(-65, 17, -64, 19)]},
]
CONUS_BOX = box(-126, 24, -66, 50)


def fetch(table, geom_field, fields):
    """Rows as (geometry, attributes)."""
    cache = os.path.join(CACHE_DIR, f"edex_{table}_{geom_field}.json")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            rows = json.load(f)
        print(f"  {table}: {len(rows)} rows (cached)")
    else:
        req = DataAccessLayer.newDataRequest("maps")
        req.addIdentifier("table", table)
        req.addIdentifier("geomField", geom_field)
        req.setParameters(*fields)
        data = DataAccessLayer.getGeometryData(req, [])
        if not data:
            sys.exit(f"{EDEX_HOST} returned no rows for {table}")
        rows = [{"wkb": g.getGeometry().wkb_hex, "attrs": {f: (g.getString(f) or "").strip() for f in fields}}
                for g in data]
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(cache, "w", encoding="utf-8") as f:
            json.dump(rows, f)
        print(f"  {table}: {len(rows)} rows")
        time.sleep(2)
    return [(make_valid(wkb.loads(r["wkb"], hex=True)), r["attrs"]) for r in rows]


def composite(geom):
    """Clip a true-coordinate geometry into its CONUS and inset pieces, insets moved into place."""
    parts = [geom.intersection(CONUS_BOX)]
    for t in INSETS:
        for b in t["boxes"]:
            piece = geom.intersection(box(*b))
            if piece.is_empty:
                continue
            if b[0] > 0 and t["name"] == "AK":
                piece = affinity.translate(piece, xoff=-360)
            sx, sy = t["scale"]
            piece = affinity.scale(piece, xfact=sx, yfact=sy, origin=t["src"])
            piece = affinity.translate(piece, xoff=t["dst"][0] - t["src"][0], yoff=t["dst"][1] - t["src"][1])
            parts.append(piece)
    return unary_union([p for p in parts if not p.is_empty])


def flatten(geom, kinds):
    if geom.is_empty:
        return []
    if isinstance(geom, kinds):
        return [geom]
    if hasattr(geom, "geoms"):
        return [g for part in geom.geoms for g in flatten(part, kinds)]
    return []


def lines_of(geom):
    return [g for part in flatten(geom, (LineString, MultiLineString)) for g in getattr(part, "geoms", [part])]


def polys_of(geom):
    return [g for part in flatten(geom, (Polygon, MultiPolygon)) for g in getattr(part, "geoms", [part])]


def rounded(coords):
    out = []
    for x, y in coords:
        p = [round(x, PLACES), round(y, PLACES)]
        if not out or out[-1] != p:
            out.append(p)
    return out


def line_feature(lines, layer, tolerance, min_length=0.0):
    merged = linemerge(lines).simplify(tolerance, preserve_topology=False)
    coords = [rounded(l.coords) for l in lines_of(merged) if l.length >= min_length]
    return {"type": "Feature", "properties": {"layer": layer},
            "geometry": {"type": "MultiLineString", "coordinates": [c for c in coords if len(c) >= 2]}}


def poly_feature(polys, layer, tolerance):
    out = []
    for p in polys:
        for q in polys_of(p.simplify(tolerance, preserve_topology=True)):
            rings = [rounded(q.exterior.coords)] + [rounded(r.coords) for r in q.interiors]
            rings = [r for r in rings if len(r) >= 4]
            if rings:
                out.append(rings)
    return {"type": "Feature", "properties": {"layer": layer},
            "geometry": {"type": "MultiPolygon", "coordinates": out}}


def write(name, feature, source):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name + ".geojson")
    doc = {"type": "FeatureCollection", "source": f"{EDEX_HOST} {source}", "fetched": FETCHED, "features": [feature]}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"  -> {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KiB)")


def build_timezones():
    rows = fetch("mapdata.timezones", "the_geom_0_004", ["time_zone", "standard"])
    edges = unary_union([g.boundary for g, _ in rows])
    # Only the borders between two zones; coastlines and the national edge are not drawn.
    outer = unary_union([g for g, _ in rows]).boundary.buffer(0.02)
    # The table covers Canada and Mexico too, and Mexico's zones sit where the insets go.
    us = unary_union([g for g, _ in fetch("mapdata.states", "the_geom_0_004", ["state"])]).buffer(0.01)
    inner = edges.difference(outer).intersection(us)
    lines = [x for l in lines_of(inner) for x in lines_of(composite(l))]
    write("timezones", line_feature(lines, "timezones", 0.004), "mapdata.timezones")


def build_rivers():
    rows = fetch("mapdata.majorrivers", "the_geom_0_004", ["pname"])
    lines = [x for g, _ in rows for x in lines_of(composite(g))]
    write("rivers", line_feature(lines, "rivers", 0.01, 0.12), "mapdata.majorrivers")


def build_lakes():
    rows = fetch("mapdata.lake", "the_geom_0_004", ["name"])
    polys = [p for g, _ in rows if g.area >= 0.008 for p in polys_of(composite(g))]
    write("lakes", poly_feature(polys, "lakes", 0.006), "mapdata.lake")


BUILDERS = {"timezones": build_timezones, "rivers": build_rivers, "lakes": build_lakes}


def main():
    DataAccessLayer.changeEDEXHost(EDEX_HOST)
    for name in sys.argv[1:] or list(BUILDERS):
        print(name)
        BUILDERS[name]()


if __name__ == "__main__":
    main()
