#!/usr/bin/env python3
"""
Pull WarnGen's point source (mapdata.warngenloc, the table geospatialConfig_*.xml names as
<pointSource>WarnGenLoc</pointSource>) from Unidata's public EDEX and dump it for
tools/build_cities.mjs.

    python -m venv C:/tmp/awenv
    C:/tmp/awenv/Scripts/python -m pip install python-awips six shapely
    C:/tmp/awenv/Scripts/python warngen/tools/fetch_warngenloc.py

One request for the whole table. edex-cloud is a shared academic server, so don't loop this.

Every row's the_geom is a MultiPolygon (the place outline). WarnGen's AREA-type point
sources test those outlines against the warning polygon (inclusionPercent), derive
partOfArea from them, and call a storm "over" a usedirs place whose outline contains it,
so the outlines come along, simplified to OUTLINE_TOLERANCE degrees. The the_geom*
columns can't be requested as parameters (Hibernate "No Dialect mapping for JDBC type:
1111"); the geometry arrives through geomField instead.
"""

import json
import os
import sys
from datetime import datetime, timezone

from awips.dataaccess import DataAccessLayer

EDEX_HOST = "edex-cloud.unidata.ucar.edu"
TABLE = "mapdata.warngenloc"
FIELDS = ["gid", "name", "st", "population", "warngenlev", "cwa", "lat", "lon",
          "landwater", "usedirs", "supdirs"]
OUTLINE_TOLERANCE = 0.001
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output", "warngenloc.json")


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def outline(geom):
    if geom is None or geom.is_empty:
        return None
    simple = geom.simplify(OUTLINE_TOLERANCE, preserve_topology=True)
    polys = list(simple.geoms) if simple.geom_type == "MultiPolygon" else [simple]
    rings = []
    for p in polys:
        if p.is_empty or p.geom_type != "Polygon":
            continue
        ring = [[round(x, 4), round(y, 4)] for x, y in p.exterior.coords]
        if len(ring) >= 4:
            rings.append(ring)
    return rings or None


def main():
    DataAccessLayer.changeEDEXHost(EDEX_HOST)
    req = DataAccessLayer.newDataRequest("maps")
    req.addIdentifier("table", TABLE)
    req.addIdentifier("geomField", "the_geom")
    req.setParameters(*FIELDS)
    geoms = DataAccessLayer.getGeometryData(req, [])
    if not geoms:
        sys.exit(f"{EDEX_HOST} returned no rows for {TABLE}")

    rows = []
    for g in geoms:
        r = {f: g.getString(f) for f in FIELDS}
        supdirs = (r["supdirs"] or "").strip()
        rows.append({
            "gid": int(num(r["gid"]) or 0),
            "name": (r["name"] or "").strip(),
            "st": (r["st"] or "").strip(),
            "population": int(num(r["population"]) or 0),
            "warngenlev": int(num(r["warngenlev"]) or 0),
            "cwa": (r["cwa"] or "").strip(),
            "lat": num(r["lat"]),
            "lon": num(r["lon"]),
            "landwater": (r["landwater"] or "").strip(),
            "usedirs": int(num(r["usedirs"]) or 0),
            "supdirs": "" if supdirs in ("", "None") else supdirs,
            "rings": outline(g.getGeometry()),
        })
    rows.sort(key=lambda r: r["gid"])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({
            "source": f"{EDEX_HOST} {TABLE}",
            "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "outlineTolerance": OUTLINE_TOLERANCE,
            "rows": rows,
        }, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rows)} rows -> {OUT}")


if __name__ == "__main__":
    main()
