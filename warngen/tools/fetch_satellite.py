#!/usr/bin/env python3
"""
Build warngen/data/satellite.pmtiles from the USGS National Map imagery cache
(USGSImageryOnly: NAIP over CONUS, Landsat/Blue Marble at small scales; public domain).

    python warngen/tools/fetch_satellite.py              fetch z0-13, then pack
    python warngen/tools/fetch_satellite.py --pack-only  repack what is already fetched

Only tiles touching a county (plus one tile of margin) are requested, lowest zoom first, so an
interrupted run still packs a usable archive. Progress lives in tools/output/satellite.mbtiles;
rerunning resumes, and empty tiles (open water) are remembered so they are not asked for again.

From --export-from up, tiles come 16x16 at a time through the MapServer export operation: one
4096px image per block instead of 256 tile requests. The export is drawn from the same cache
(pixel-identical to /tile at an aligned bbox), so only the JPEG re-encode differs.
"""

import argparse
import io
import json
import math
import os
import sqlite3
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from PIL import Image
from tqdm import tqdm
from pmtiles.convert import mbtiles_to_pmtiles

SERVICE = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer"
TILE_URL = SERVICE + "/tile/{z}/{y}/{x}"
EXPORT_URL = SERVICE + "/export"
USER_AGENT = "eas.tools WarnGen satellite basemap builder (one-time bulk fetch, rate limited)"
HERE = os.path.dirname(os.path.abspath(__file__))
COUNTIES = os.path.join(HERE, "..", "data", "us_counties.geojson")
MBTILES = os.path.join(HERE, "output", "satellite.mbtiles")
PMTILES = os.path.join(HERE, "..", "data", "satellite.pmtiles")
ATTRIBUTION = "USGS The National Map: Orthoimagery (NAIP, USDA)"
HALF_WORLD = 20037508.342789244
BLOCK = 16
JPEG_QUALITY = 85


class RateLimiter:
    def __init__(self, per_second):
        self.interval = 1.0 / per_second
        self.lock = threading.Lock()
        self.next_slot = time.monotonic()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            slot = max(now, self.next_slot)
            self.next_slot = slot + self.interval
        if slot > now:
            time.sleep(slot - now)

    def back_off(self, seconds):
        with self.lock:
            self.next_slot = max(self.next_slot, time.monotonic() + seconds)


def lon2x(lon, z):
    return int(math.floor((lon + 180.0) / 360.0 * (1 << z)))


def lat2y(lat, z):
    r = math.radians(max(min(lat, 85.0511), -85.0511))
    return int(math.floor((1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * (1 << z)))


# Mirrors COMPOSITE_TRANSFORMS in warngen/index.html. us_counties.geojson stores these states
# at their inset positions; the imagery has to come from where they really are.
INSETS = {
    "AK": {"src": (-152, 63), "dst": (-117, 21), "scale": (0.35, 0.75)},
    "HI": {"src": (-157, 20), "dst": (-105, 26), "scale": (1.0, 1.0)},
    "AS": {"src": (-170, -14), "dst": (-101, 24), "scale": (1.0, 1.0)},
    "GU": {"src": (144, 13), "dst": (-112, 32), "scale": (1.0, 1.0)},
    "MP": {"src": (145, 16), "dst": (-112, 34), "scale": (1.0, 1.0)},
    "PR": {"src": (-66, 18), "dst": (-76, 25), "scale": (1.0, 1.0)},
    "VI": {"src": (-65, 18), "dst": (-75, 26), "scale": (1.0, 1.0)},
}


def real_boxes(state, box):
    t = INSETS[state]
    west = (box[0] - t["dst"][0]) / t["scale"][0] + t["src"][0]
    east = (box[2] - t["dst"][0]) / t["scale"][0] + t["src"][0]
    south = (box[1] - t["dst"][1]) / t["scale"][1] + t["src"][1]
    north = (box[3] - t["dst"][1]) / t["scale"][1] + t["src"][1]
    if west < -180 and east < -180:
        return [(west + 360, south, east + 360, north)]
    if west < -180:
        return [(west + 360, south, 180.0, north), (-180.0, south, east, north)]
    return [(west, south, east, north)]


def county_boxes():
    with open(COUNTIES, encoding="utf-8") as f:
        gj = json.load(f)
    boxes = []
    for feat in gj["features"]:
        geom = feat.get("geometry")
        if not geom:
            continue
        state = (feat.get("properties") or {}).get("state")
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for poly in polys:
            xs = [p[0] for ring in poly for p in ring]
            ys = [p[1] for ring in poly for p in ring]
            box = (min(xs), min(ys), max(xs), max(ys))
            if state in INSETS:
                boxes.extend(real_boxes(state, box))
            else:
                boxes.append(box)
    return boxes


def wanted_tiles(boxes, maxzoom):
    for z in range(maxzoom + 1):
        n = 1 << z
        seen = set()
        for west, south, east, north in boxes:
            for x in range(max(lon2x(west, z) - 1, 0), min(lon2x(east, z) + 1, n - 1) + 1):
                for y in range(max(lat2y(north, z) - 1, 0), min(lat2y(south, z) + 1, n - 1) + 1):
                    seen.add((x, y))
        for x, y in sorted(seen):
            yield z, x, y


def open_db():
    os.makedirs(os.path.dirname(MBTILES), exist_ok=True)
    db = sqlite3.connect(MBTILES, check_same_thread=False)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles (zoom_level, tile_column, tile_row)")
    db.execute("CREATE TABLE IF NOT EXISTS missing (z INTEGER, x INTEGER, y INTEGER, PRIMARY KEY (z, x, y))")
    return db


def write_metadata(db, boxes, maxzoom):
    west = min(b[0] for b in boxes)
    south = min(b[1] for b in boxes)
    east = max(b[2] for b in boxes)
    north = max(b[3] for b in boxes)
    meta = {
        "name": "USGS Imagery",
        "format": "jpeg",
        "type": "baselayer",
        "minzoom": "0",
        "maxzoom": str(maxzoom),
        "bounds": f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}",
        "center": "-96.2,41.4,6",
        "attribution": ATTRIBUTION,
    }
    db.executemany("INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)", meta.items())
    db.commit()


local = threading.local()


def session():
    if not hasattr(local, "s"):
        local.s = requests.Session()
        local.s.headers["User-Agent"] = USER_AGENT
    return local.s


def get_image(url, params, limiter, timeout):
    delay = 5
    for attempt in range(8):
        limiter.wait()
        try:
            r = session().get(url, params=params, timeout=timeout)
        except requests.RequestException:
            time.sleep(delay)
            delay = min(delay * 2, 300)
            continue
        if r.status_code == 200 and r.headers.get("Content-Type", "").startswith("image/"):
            return r.content
        if r.status_code == 404:
            return None
        if r.status_code in (429, 503):
            retry = r.headers.get("Retry-After", "")
            limiter.back_off(int(retry) if retry.isdigit() else delay)
        time.sleep(delay)
        delay = min(delay * 2, 300)
    raise RuntimeError(f"gave up on {url} {params or ''}")


def fetch_tile(z, x, y, limiter):
    return [(z, x, y, get_image(TILE_URL.format(z=z, x=x, y=y), None, limiter, 30))]


def is_blank(tile):
    if tile.mode == "RGBA":
        return tile.getchannel("A").getextrema()[1] == 0
    return all(hi - lo <= 2 for lo, hi in tile.getextrema())


def fetch_block(z, bx, by, tiles, limiter, fmt="jpg"):
    span = 2 * HALF_WORLD / (1 << z)
    xmin = -HALF_WORLD + bx * BLOCK * span
    ymax = HALF_WORLD - by * BLOCK * span
    params = {
        "bbox": f"{xmin},{ymax - BLOCK * span},{xmin + BLOCK * span},{ymax}",
        "bboxSR": 3857,
        "imageSR": 3857,
        "size": f"{256 * BLOCK},{256 * BLOCK}",
        "format": fmt,
        "transparent": "true" if fmt == "png32" else "false",
        "f": "image",
    }
    data = get_image(EXPORT_URL, params, limiter, 300)
    if data is None:
        return [(z, x, y, None) for x, y in tiles]
    img = Image.open(io.BytesIO(data))
    img = img.convert("RGBA" if fmt == "png32" else "RGB")
    out = []
    for x, y in tiles:
        left = (x - bx * BLOCK) * 256
        top = (y - by * BLOCK) * 256
        tile = img.crop((left, top, left + 256, top + 256))
        if is_blank(tile):
            out.append((z, x, y, None))
            continue
        buf = io.BytesIO()
        tile.convert("RGB").save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True)
        out.append((z, x, y, buf.getvalue()))
    return out


def run_fetch(db, boxes, args):
    done = set(db.execute("SELECT zoom_level, tile_column, (1 << zoom_level) - 1 - tile_row FROM tiles"))
    done.update(db.execute("SELECT z, x, y FROM missing"))
    todo = [t for t in wanted_tiles(boxes, args.maxzoom) if t not in done]
    singles = [t for t in todo if t[0] < args.export_from]
    blocks = defaultdict(list)
    for z, x, y in todo:
        if z >= args.export_from:
            blocks[(z, x // BLOCK, y // BLOCK)].append((x, y))
    print(f"{len(done)} tiles already settled, {len(todo)} to fetch: "
          f"{len(singles)} single tiles at {args.rate}/s, {len(blocks)} export blocks")
    if not todo:
        return

    jobs = [(fetch_tile, t) for t in singles]
    jobs += [(fetch_block, (z, bx, by, tiles)) for (z, bx, by), tiles in sorted(blocks.items())]
    tile_limiter = RateLimiter(args.rate)
    block_limiter = RateLimiter(args.export_rate)
    failed = 0
    pending = 0
    with ThreadPoolExecutor(max_workers=max(args.workers, args.export_workers)) as pool, \
            tqdm(total=len(todo), unit="tile", smoothing=0.02) as bar:
        block_gate = threading.Semaphore(args.export_workers)

        def run(fn, a):
            if fn is fetch_block:
                with block_gate:
                    return fn(*a, block_limiter, args.export_format)
            return fn(*a, tile_limiter)

        for start in range(0, len(jobs), 2000):
            futures = {pool.submit(run, fn, a): (fn, a) for fn, a in jobs[start:start + 2000]}
            for fut in as_completed(futures):
                fn, a = futures[fut]
                count = len(a[3]) if fn is fetch_block else 1
                try:
                    results = fut.result()
                except RuntimeError as e:
                    failed += count
                    tqdm.write(str(e))
                    bar.update(count)
                    continue
                for z, x, y, data in results:
                    if data is None:
                        db.execute("INSERT OR IGNORE INTO missing (z, x, y) VALUES (?, ?, ?)", (z, x, y))
                    else:
                        db.execute("INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)", (z, x, (1 << z) - 1 - y, data))
                pending += len(results)
                if pending >= 500:
                    db.commit()
                    pending = 0
                bar.update(count)
            db.commit()
    if failed:
        print(f"{failed} tiles failed; rerun to retry them")


def pack(maxzoom):
    tmp = PMTILES + ".tmp"
    mbtiles_to_pmtiles(MBTILES, tmp, maxzoom)
    os.replace(tmp, PMTILES)
    print(f"{os.path.getsize(PMTILES) / 1e9:.2f} GB -> {os.path.abspath(PMTILES)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--maxzoom", type=int, default=13)
    ap.add_argument("--rate", type=float, default=8.0, help="single-tile requests per second")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--export-from", type=int, default=10, help="lowest zoom fetched as export blocks")
    ap.add_argument("--export-rate", type=float, default=0.5, help="export requests per second")
    ap.add_argument("--export-workers", type=int, default=2, help="export requests in flight at once")
    ap.add_argument("--export-format", choices=("jpg", "png32"), default="jpg",
                    help="jpg is ~10x smaller on the wire; png32 skips one lossy generation")
    ap.add_argument("--pack-only", action="store_true")
    args = ap.parse_args()

    boxes = county_boxes()
    db = open_db()
    write_metadata(db, boxes, args.maxzoom)
    if not args.pack_only:
        run_fetch(db, boxes, args)
    db.close()
    pack(args.maxzoom)


if __name__ == "__main__":
    main()
