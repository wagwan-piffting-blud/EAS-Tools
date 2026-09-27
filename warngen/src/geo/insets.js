(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenInsets = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    /**
     * Alaska, Hawaii and the territories are drawn as insets: shifted and scaled in lon/lat.
     * Georeferenced layers (satellite, radar) have to follow them. The inset transform is
     * linear per axis, so real lon depends only on inset lon and real lat only on inset lat,
     * and a tile can be remapped with one lookup per column and one per row.
     */

    var MAX_SOURCE_ZOOM = 13;
    var MAX_SOURCE_TILES = 48;

    function realLon(t, lon) {
        return (lon - t.dst[0]) / t.scaleLon + t.src[0];
    }

    function realLat(t, lat) {
        return (lat - t.dst[1]) / t.scaleLat + t.src[1];
    }

    function insetLon(t, lon) {
        if (t.normalizePositiveLon && lon > 0) lon -= 360;
        return (lon - t.src[0]) * t.scaleLon + t.dst[0];
    }

    function insetLat(t, lat) {
        return (lat - t.src[1]) * t.scaleLat + t.dst[1];
    }

    function inRealBbox(t, lon, lat) {
        var boxes = [t.realBbox, t.realBboxAlt].filter(Boolean);
        return boxes.some(function (b) {
            return lon >= b[0] && lat >= b[1] && lon <= b[2] && lat <= b[3];
        });
    }

    function territoryForPoint(transforms, lon, lat) {
        for (var i = 0; i < transforms.length; i++) {
            if (inRealBbox(transforms[i], lon, lat)) return transforms[i];
        }
        return null;
    }

    function lonToWorld(lon) {
        return (lon + 180) / 360;
    }

    function latToWorld(lat) {
        var s = Math.sin(lat * Math.PI / 180);
        return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    }

    function worldToLon(x) {
        return x * 360 - 180;
    }

    function worldToLat(y) {
        return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
    }

    function ringsByTerritory(geojson, transforms) {
        var out = {};
        transforms.forEach(function (t) { out[t.name] = []; });
        (geojson && geojson.features || []).forEach(function (f) {
            var list = out[f.properties && f.properties.state];
            if (!list || !f.geometry) return;
            var polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
            polys.forEach(function (poly) {
                poly.forEach(function (ring) {
                    var box = [Infinity, Infinity, -Infinity, -Infinity];
                    ring.forEach(function (p) {
                        if (p[0] < box[0]) box[0] = p[0];
                        if (p[1] < box[1]) box[1] = p[1];
                        if (p[0] > box[2]) box[2] = p[0];
                        if (p[1] > box[3]) box[3] = p[1];
                    });
                    list.push({ ring: ring, box: box });
                });
            });
        });
        return out;
    }

    function overlaps(a, b) {
        return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
    }

    var MAX_ANCESTOR_STEPS = MAX_SOURCE_ZOOM;

    // A missing tile is drawn from the matching part of its nearest stored ancestor.
    function decodeTile(archive, z, x, y) {
        var n = Math.pow(2, z);
        var wrapped = ((x % n) + n) % n;
        function attempt(step) {
            var az = z - step;
            if (az < 0 || step > MAX_ANCESTOR_STEPS) return Promise.resolve(null);
            var ax = wrapped >> step;
            var ay = y >> step;
            return archive.getZxy(az, ax, ay).then(function (res) {
                if (!res || !res.data) return attempt(step + 1);
                return createImageBitmap(new Blob([res.data])).then(function (bitmap) {
                    var part = 256 / (1 << step);
                    return {
                        bitmap: bitmap,
                        sx: (wrapped - (ax << step)) * part,
                        sy: (y - (ay << step)) * part,
                        size: part
                    };
                });
            }).catch(function () { return attempt(step + 1); });
        }
        return attempt(0);
    }

    // Real imagery for one territory, remapped into the part of an output tile it covers.
    function renderTerritory(archive, t, rings, coords, size) {
        var n = Math.pow(2, coords.z);
        var x0 = coords.x / n;
        var y0 = coords.y / n;
        var span = 1 / n;
        var b = t.compositeBbox;
        var lons = [Math.max(worldToLon(x0), b[0]), Math.min(worldToLon(x0 + span), b[2])];
        var lats = [Math.max(worldToLat(y0 + span), b[1]), Math.min(worldToLat(y0), b[3])];
        var realW = realLon(t, lons[0]);
        var realE = realLon(t, lons[1]);
        var realS = realLat(t, lats[0]);
        var realN = realLat(t, lats[1]);

        var zs = Math.round(coords.z + Math.log2(Math.max(t.scaleLon, t.scaleLat)));
        return renderAtZoom(archive, t, rings, coords, size, Math.max(0, Math.min(MAX_SOURCE_ZOOM, zs)),
            x0, y0, span, b, realW, realE, realS, realN);
    }

    // Falls back a zoom at a time when the archive has nothing at the ideal source zoom.
    function renderAtZoom(archive, t, rings, coords, size, zs, x0, y0, span, b, realW, realE, realS, realN) {
        var sx0;
        var sx1;
        var sy0;
        var sy1;
        for (;;) {
            var ns = Math.pow(2, zs);
            sx0 = Math.floor(lonToWorld(realW) * ns);
            sx1 = Math.floor(lonToWorld(realE) * ns - 1e-9);
            sy0 = Math.floor(latToWorld(realN) * ns);
            sy1 = Math.floor(latToWorld(realS) * ns - 1e-9);
            if ((sx1 - sx0 + 1) * (sy1 - sy0 + 1) <= MAX_SOURCE_TILES || zs === 0) break;
            zs--;
        }
        var jobs = [];
        for (var sy = sy0; sy <= sy1; sy++) {
            for (var sx = sx0; sx <= sx1; sx++) {
                jobs.push({ x: sx, y: sy, bitmap: decodeTile(archive, zs, sx, sy) });
            }
        }
        return Promise.all(jobs.map(function (j) { return j.bitmap; })).then(function (bitmaps) {
            if (!bitmaps.some(Boolean)) {
                return zs > 0
                    ? renderAtZoom(archive, t, rings, coords, size, zs - 1, x0, y0, span, b, realW, realE, realS, realN)
                    : null;
            }
            var srcSize = 256;
            var scratch = document.createElement("canvas");
            scratch.width = (sx1 - sx0 + 1) * srcSize;
            scratch.height = (sy1 - sy0 + 1) * srcSize;
            var sctx = scratch.getContext("2d", { willReadFrequently: true });
            bitmaps.forEach(function (src, i) {
                if (!src) return;
                sctx.drawImage(src.bitmap, src.sx, src.sy, src.size, src.size,
                    (jobs[i].x - sx0) * srcSize, (jobs[i].y - sy0) * srcSize, srcSize, srcSize);
                if (src.bitmap.close) src.bitmap.close();
            });
            var src = new Uint32Array(sctx.getImageData(0, 0, scratch.width, scratch.height).data.buffer);
            var ns = Math.pow(2, zs);

            var colIndex = new Int32Array(size);
            for (var i = 0; i < size; i++) {
                var lon = worldToLon(x0 + (i + 0.5) / size * span);
                var px = Math.floor((lonToWorld(realLon(t, lon)) * ns - sx0) * srcSize);
                colIndex[i] = lon < b[0] || lon > b[2] || px < 0 || px >= scratch.width ? -1 : px;
            }
            var out = new ImageData(size, size);
            var dst = new Uint32Array(out.data.buffer);
            for (var j = 0; j < size; j++) {
                var lat = worldToLat(y0 + (j + 0.5) / size * span);
                if (lat < b[1] || lat > b[3]) continue;
                var py = Math.floor((latToWorld(realLat(t, lat)) * ns - sy0) * srcSize);
                if (py < 0 || py >= scratch.height) continue;
                var srcRow = py * scratch.width;
                var dstRow = j * size;
                for (var c = 0; c < size; c++) {
                    if (colIndex[c] >= 0) dst[dstRow + c] = src[srcRow + colIndex[c]];
                }
            }
            var warped = document.createElement("canvas");
            warped.width = size;
            warped.height = size;
            warped.getContext("2d").putImageData(out, 0, 0);
            return { canvas: warped, rings: rings };
        });
    }

    // Main imagery; a tile outside what was fetched falls back to its nearest stored ancestor.
    function createBaseLayer(L, archive, options) {
        var Layer = L.GridLayer.extend({
            createTile: function (coords, done) {
                var tile = document.createElement("canvas");
                var size = this.getTileSize().x;
                tile.width = size;
                tile.height = size;
                decodeTile(archive, coords.z, coords.x, coords.y).then(function (src) {
                    if (src) {
                        tile.getContext("2d").drawImage(src.bitmap, src.sx, src.sy, src.size, src.size, 0, 0, size, size);
                        if (src.bitmap.close) src.bitmap.close();
                    }
                    done(null, tile);
                }, function (err) {
                    done(err, tile);
                });
                return tile;
            }
        });
        return new Layer(Object.assign({ maxNativeZoom: MAX_SOURCE_ZOOM, maxZoom: 22 }, options || {}));
    }

    function createSatelliteLayer(L, archive, transforms, geojson, options) {
        var rings = ringsByTerritory(geojson, transforms);
        var fillBoxes = (options && options.fillBoxes) || [];
        var Layer = L.GridLayer.extend({
            createTile: function (coords, done) {
                var tile = document.createElement("canvas");
                var size = this.getTileSize().x;
                tile.width = size;
                tile.height = size;
                var n = Math.pow(2, coords.z);
                var tileBox = [
                    worldToLon(coords.x / n), worldToLat((coords.y + 1) / n),
                    worldToLon((coords.x + 1) / n), worldToLat(coords.y / n)
                ];
                var active = transforms.filter(function (t) {
                    if (!overlaps(tileBox, t.compositeBbox)) return false;
                    return fillBoxes.indexOf(t.name) !== -1 || rings[t.name].some(function (r) {
                        return overlaps(tileBox, r.box);
                    });
                });
                var work = active.map(function (t) {
                    return renderTerritory(archive, t, rings[t.name], coords, size);
                });
                Promise.all(work).then(function (parts) {
                    var ctx = tile.getContext("2d");
                    // Whole boxes first, so a neighbouring box can't cover another territory's land.
                    parts.forEach(function (part, i) {
                        if (part && fillBoxes.indexOf(active[i].name) !== -1) ctx.drawImage(part.canvas, 0, 0);
                    });
                    parts.forEach(function (part) {
                        if (!part) return;
                        ctx.save();
                        ctx.beginPath();
                        part.rings.forEach(function (r) {
                            if (!overlaps(tileBox, r.box)) return;
                            r.ring.forEach(function (p, k) {
                                var x = (lonToWorld(p[0]) * n - coords.x) * size;
                                var y = (latToWorld(p[1]) * n - coords.y) * size;
                                if (k) ctx.lineTo(x, y);
                                else ctx.moveTo(x, y);
                            });
                            ctx.closePath();
                        });
                        ctx.clip("evenodd");
                        ctx.drawImage(part.canvas, 0, 0);
                        ctx.restore();
                    });
                    done(null, tile);
                }, function (err) {
                    done(err, tile);
                });
                return tile;
            }
        });
        return new Layer(Object.assign({ zIndex: 2, maxZoom: 22 }, options || {}));
    }

    return {
        createBaseLayer: createBaseLayer,
        createSatelliteLayer: createSatelliteLayer,
        territoryForPoint: territoryForPoint,
        realLon: realLon,
        realLat: realLat,
        insetLon: insetLon,
        insetLat: insetLat
    };
}));
