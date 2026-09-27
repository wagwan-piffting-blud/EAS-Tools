#!/usr/bin/env python3
"""
Pull the TIME_ZONE letters WarnGen reads off its hatched areas (geospatialConfig_*.xml
<timezoneField>TIME_ZONE</timezoneField>) from Unidata's public EDEX: mapdata.county keyed
by state + fips, mapdata.zone keyed by state + zone. Split areas carry two letters ("CM").

    C:/tmp/awenv/Scripts/python warngen/tools/fetch_timezones.py

Two requests, one per table. Geometry is not needed, so the smallest simplified column
comes back as geomField.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

from awips.dataaccess import DataAccessLayer

EDEX_HOST = "edex-cloud.unidata.ucar.edu"
TABLES = {
    "county": ("mapdata.county", ["state", "fips", "time_zone"]),
    "zone": ("mapdata.zone", ["state", "zone", "time_zone"]),
}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "area_timezones.json")


def fetch(table, fields):
    req = DataAccessLayer.newDataRequest("maps")
    req.addIdentifier("table", table)
    req.addIdentifier("geomField", "the_geom_0_064")
    req.setParameters(*fields)
    rows = DataAccessLayer.getGeometryData(req, [])
    if not rows:
        sys.exit(f"{EDEX_HOST} returned no rows for {table}")
    return [{f: (g.getString(f) or "").strip() for f in fields} for g in rows]


def main():
    DataAccessLayer.changeEDEXHost(EDEX_HOST)
    out = {"source": EDEX_HOST, "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}

    counties = {}
    for r in fetch(*TABLES["county"]):
        if r["state"] and r["fips"] and r["time_zone"]:
            counties[r["state"] + r["fips"][-3:]] = r["time_zone"]
    out["county"] = counties
    time.sleep(2)

    zones = {}
    for r in fetch(*TABLES["zone"]):
        if r["state"] and r["zone"] and r["time_zone"]:
            zones[r["state"] + r["zone"][-3:]] = r["time_zone"]
    out["zone"] = zones

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
    print(f"{len(counties)} counties, {len(zones)} zones -> {OUT}")


if __name__ == "__main__":
    main()
