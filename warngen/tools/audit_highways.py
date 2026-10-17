#!/usr/bin/env python3
"""
Check the route numbers in warngen/data/us_highways.geojson against AWIPS's own interstate
map (mapdata.interstate on Unidata's public EDEX). Every interstate segment is sampled about
every 500 m; a sample counts toward each AWIPS route within ~2 km of it.

    C:/tmp/awenv/Scripts/python warngen/tools/audit_highways.py

Writes warngen/tools/output/highway_audit.json and prints the flagged segments by bucket:

    relabel         another interstate covers >= 75% of it (could be a real concurrency)
    not-interstate  AWIPS has no interstate with that number in the state
    reference-gap   the number exists in the state but AWIPS's line doesn't follow this one
    outside-us      most of the segment is outside the 50 states

The AWIPS table names one route per stretch of shared pavement and predates some newer
routes and renumberings (Maine 2004, I-49, I-22, I-69 in Texas, I-86 in New York), so every
bucket needs a person to read it. Accepted corrections go in highway_fixes.json.
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import shape
from shapely.ops import unary_union

import fetch_basemap

HERE = os.path.dirname(os.path.abspath(__file__))
HIGHWAYS = os.path.join(HERE, "..", "data", "us_highways.geojson")
OUT = os.path.join(HERE, "output", "highway_audit.json")
TOL = 0.02
STEP = 0.005


def feature_key(f):
    c = f["geometry"]["coordinates"]
    first = c[0] if f["geometry"]["type"] == "LineString" else c[0][0]
    p = f["properties"]
    return f"{p['cls']}:{p['num']}:{first[0]:.3f}:{first[1]:.3f}"


def samples_of(g):
    n = max(2, int(g.length / STEP))
    return [g.interpolate(t, normalized=True) for t in np.linspace(0, 1, n)]


def main():
    fetch_basemap.DataAccessLayer.changeEDEXHost(fetch_basemap.EDEX_HOST)
    rows = fetch_basemap.fetch("mapdata.interstate", "the_geom_0_001", ["route"])
    states = fetch_basemap.fetch("mapdata.states", "the_geom_0_004", ["state"])

    lines, nums = [], []
    for g, a in rows:
        m = re.match(r"^I[\s-]*(\d+)", a["route"] or "")
        if m:
            lines.append(g)
            nums.append(m.group(1))
    nums = np.array(nums)
    tree = STRtree(lines)

    sgeoms = [g for g, _ in states]
    skeys = [a["state"] for _, a in states]
    state_nums = defaultdict(set)
    li, si = STRtree(sgeoms).query(lines, predicate="intersects")
    for a, b in zip(li, si):
        state_nums[skeys[b]].add(nums[a])
    us = shapely.prepared.prep(unary_union(sgeoms).buffer(0.01))

    hwy = json.load(open(HIGHWAYS, encoding="utf-8"))
    feats, samples, owner = [], [], []
    for i, f in enumerate(hwy["features"]):
        g = shape(f["geometry"])
        if g.length == 0:
            continue
        pts = samples_of(g)
        feats.append((i, f, g, len(pts)))
        samples.extend(pts)
        owner.extend([len(feats) - 1] * len(pts))
    owner = np.array(owner)
    inside = np.array([us.contains(p) for p in samples])
    pi, lj = tree.query(samples, predicate="dwithin", distance=TOL)

    hits = [defaultdict(set) for _ in feats]
    for p, l in zip(pi, lj):
        hits[owner[p]][nums[l]].add(p)
    share_inside = np.bincount(owner, weights=inside.astype(float), minlength=len(feats))

    report = []
    for k, (i, f, g, n) in enumerate(feats):
        p = f["properties"]
        entry = {"key": feature_key(f), "state": p.get("state"), "cls": p["cls"], "num": p["num"],
                 "km": p.get("length_km"), "mm": p.get("mmOffset"), "at": [round(g.centroid.y, 3), round(g.centroid.x, 3)]}
        if share_inside[k] / n < 0.5:
            report.append(dict(entry, bucket="outside-us"))
            continue
        if p["cls"] != "interstate":
            continue
        base = re.sub(r"[A-Z]+$", "", p["num"])
        cov = {r: len(s) / n for r, s in hits[k].items()}
        if cov.get(base, 0) >= 0.8:
            continue
        best = sorted(cov.items(), key=lambda kv: -kv[1])[:3]
        if best and best[0][1] >= 0.75 and best[0][0] != base:
            bucket = "relabel"
        elif base not in state_nums.get(p.get("state"), set()):
            bucket = "not-interstate"
        else:
            bucket = "reference-gap"
        report.append(dict(entry, bucket=bucket, cov=round(cov.get(base, 0), 2),
                           best=[[r, round(v, 2)] for r, v in best]))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    print(dict(Counter(r["bucket"] for r in report)), "->", os.path.relpath(OUT))
    for b in ("relabel", "not-interstate", "reference-gap", "outside-us"):
        print("==", b)
        for r in report:
            if r["bucket"] == b:
                print(" ", r["key"], r["state"], f"{r['km']} km mm {r['mm']}", "cov", r.get("cov"), "best", r.get("best"), r["at"])


if __name__ == "__main__":
    sys.exit(main())
