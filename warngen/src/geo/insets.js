(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenInsets = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    /**
     * The map draws everything at its real coordinates. Longitudes east of 180 (the western
     * Aleutians, Guam and the Marianas) are unwrapped below -180 so shapes stay continuous across
     * the antimeridian; anything printed or handed out is wrapped back to [-180, 180].
     *
     * The data files still lay Alaska, Hawaii and the territories out as the old map's insets:
     * shifted, and for Alaska squashed, in lon/lat. Those are put back when they load.
     */

    var MAX_SOURCE_ZOOM = 13;
    var MAX_SOURCE_TILES = 48;

    var DATA_INSETS = [
        {
            name: "AK", offices: ["AFC", "AFG", "AJK"], open: true,
            src: [-152, 63], dst: [-117, 21], scaleLon: 0.35, scaleLat: 0.75,
            realBoxes: [[-180, 50, -125, 73], [150, 50, 180, 73]],
            compositeBbox: [-130, 11.5, -109, 29]
        },
        {
            name: "HI", offices: ["HFO"], open: true,
            src: [-157, 20], dst: [-105, 26], scaleLon: 1, scaleLat: 1,
            realBoxes: [[-161, 18, -154, 23]],
            compositeBbox: [-109, 24, -102, 28.9]
        },
        {
            name: "AS", offices: ["PPG"],
            src: [-170, -14], dst: [-101, 24], scaleLon: 1, scaleLat: 1,
            realBoxes: [[-172, -15, -168, -11]],
            compositeBbox: [-102.1, 23, -99, 27]
        },
        {
            name: "GU", offices: ["GUM"],
            src: [144, 13], dst: [-112, 32], scaleLon: 1, scaleLat: 1,
            realBoxes: [[143, 13, 146.5, 14]],
            compositeBbox: [-113, 31, -110, 33]
        },
        {
            name: "MP", offices: ["GUM"],
            src: [145, 16], dst: [-112, 34], scaleLon: 1, scaleLat: 1,
            realBoxes: [[143, 14, 146.5, 21]],
            compositeBbox: [-113, 31, -110, 39]
        },
        {
            name: "PR", offices: ["SJU"], open: true,
            src: [-66, 18], dst: [-76, 25], scaleLon: 1, scaleLat: 1,
            realBoxes: [[-68, 17, -65.15, 19]],
            compositeBbox: [-78, 24, -75.15, 26]
        },
        {
            name: "VI", offices: ["SJU"], open: true,
            src: [-65, 18], dst: [-75, 26], scaleLon: 1, scaleLat: 1,
            realBoxes: [[-65.15, 17, -64, 19]],
            compositeBbox: [-75.15, 25, -74, 27]
        }
    ];

    function unwrapLon(lon) {
        return lon > 0 ? lon - 360 : lon;
    }

    function wrapLon(lon) {
        return lon < -180 ? lon + 360 : (lon > 180 ? lon - 360 : lon);
    }

    function realLon(t, lon) {
        return (lon - t.dst[0]) / t.scaleLon + t.src[0];
    }

    function realLat(t, lat) {
        return (lat - t.dst[1]) / t.scaleLat + t.src[1];
    }

    function inBox(b, lon, lat) {
        return lon >= b[0] && lat >= b[1] && lon <= b[2] && lat <= b[3];
    }

    function insetNamed(name) {
        for (var i = 0; i < DATA_INSETS.length; i++) {
            if (DATA_INSETS[i].name === name) return DATA_INSETS[i];
        }
        return null;
    }

    function fromInset(t) {
        return function (p) { return [unwrapLon(realLon(t, p[0])), realLat(t, p[1])]; };
    }

    function unwrapPoint(p) {
        return [unwrapLon(p[0]), p[1]];
    }

    /**
     * How to bring a data file's coordinate to the map, judged from one sample point. A known
     * territory is either already real or in its old inset. Anything else is only moved out of
     * the Alaska, Hawaii and Puerto Rico boxes, which sit on no state; the Guam and Samoa boxes
     * cover Arizona and Mexico.
     */
    function mapperFor(state, p) {
        var own = insetNamed(state);
        if (own) {
            var real = own.realBoxes.some(function (b) { return inBox(b, p[0], p[1]); });
            return real ? unwrapPoint : fromInset(own);
        }
        for (var i = 0; i < DATA_INSETS.length; i++) {
            var t = DATA_INSETS[i];
            if (t.open && inBox(t.compositeBbox, p[0], p[1])) return fromInset(t);
        }
        return unwrapPoint;
    }

    function firstCoord(coords) {
        while (coords && typeof coords[0] !== "number") coords = coords[0];
        return coords;
    }

    function mapCoords(coords, fn) {
        return typeof coords[0] === "number" ? fn(coords) : coords.map(function (c) { return mapCoords(c, fn); });
    }

    /** Nested [lon, lat] arrays of one state's shape, at map coordinates. */
    function toMapCoordinates(coords, state) {
        var p = coords && firstCoord(coords);
        return p ? mapCoords(coords, mapperFor(state, p)) : coords;
    }

    function toMapGeometry(geometry, state) {
        if (!geometry) return geometry;
        var multi = /^Multi/.test(geometry.type);
        // Merged basemap layers carry every region in one feature, so each part is placed alone.
        var coords = multi && !insetNamed(state)
            ? geometry.coordinates.map(function (part) { return toMapCoordinates(part, state); })
            : toMapCoordinates(geometry.coordinates, state);
        return { type: geometry.type, coordinates: coords };
    }

    /** A copy of a data file's collection at map coordinates. */
    function toMapFeatures(geojson) {
        return Object.assign({}, geojson, {
            features: (geojson && geojson.features || []).map(function (f) {
                if (!f.geometry) return f;
                return Object.assign({}, f, { geometry: toMapGeometry(f.geometry, f.properties && f.properties.state) });
            })
        });
    }

    /** Moves { state, lat, lon } points to map coordinates in place; returns the list. */
    function toMapPoints(list) {
        (list || []).forEach(function (c) {
            var q = mapperFor(c.state, [c.lon, c.lat])([c.lon, c.lat]);
            c.lon = q[0];
            c.lat = q[1];
        });
        return list;
    }

    function ringCenter(ring) {
        var n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
            ? ring.length - 1 : ring.length;
        var x = 0;
        var y = 0;
        for (var i = 0; i < n; i++) {
            x += ring[i][0];
            y += ring[i][1];
        }
        return [x / n, y / n];
    }

    /**
     * Which old inset a polygon saved by the composite map was drawn in. stateAt(lon, lat) names
     * the state of the county under a real point. Guam's old box sits over Tucson, so a box alone
     * only counts for the office that owns it, or for All US when no state is underneath.
     */
    function savedInset(ring, office, stateAt) {
        var c = ringCenter(ring);
        var landState = stateAt(c[0], c[1]);
        var fallback = null;
        for (var i = 0; i < DATA_INSETS.length; i++) {
            var t = DATA_INSETS[i];
            if (!inBox(t.compositeBbox, c[0], c[1])) continue;
            var r = fromInset(t)(c);
            if (stateAt(r[0], r[1]) === t.name && (t.offices.indexOf(office) !== -1 || office === "_ALL_US_")) return t;
            if (!fallback && (t.offices.indexOf(office) !== -1 || (office === "_ALL_US_" && !landState))) fallback = t;
        }
        return fallback;
    }

    function convertPair(fn, lat, lon) {
        var q = fn([lon, lat]);
        return [q[1], wrapLon(q[0])];
    }

    /**
     * Puts a saved session from the composite map back at real coordinates, once: the result is
     * marked, and a marked session is returned untouched.
     */
    function migrateSavedState(saved, stateAt) {
        if (!saved || saved.geo) return saved;
        var base = saved.followupBaseline;
        var ring = (saved.polygon && saved.polygon.length) ? saved.polygon : (base && (base.ring || base.drawnRing));
        var form = saved.form || {};
        var t = ring && ring.length ? savedInset(ring, form.office, stateAt) : null;
        if (t) {
            var fn = fromInset(t);
            var move = function (r) { return r ? r.map(fn) : r; };
            saved.polygon = move(saved.polygon);
            if (base) {
                base.ring = move(base.ring);
                base.drawnRing = move(base.drawnRing);
            }
            var lat = parseFloat(form.centroidLat);
            var lon = parseFloat(form.centroidLon);
            if (isFinite(lat) && isFinite(lon)) {
                var c = convertPair(fn, lat, lon);
                form.centroidLat = c[0].toFixed(3);
                form.centroidLon = c[1].toFixed(3);
            }
            if (form.lineVerts) {
                form.lineVerts = String(form.lineVerts).split(",").map(function (pair) {
                    var nums = pair.trim().split(/\s+/).map(parseFloat);
                    if (nums.length !== 2 || !isFinite(nums[0]) || !isFinite(nums[1])) return pair.trim();
                    var v = convertPair(fn, nums[0], nums[1]);
                    return v[0].toFixed(3) + " " + v[1].toFixed(3);
                }).join(", ");
            }
        }
        saved.geo = 1;
        return saved;
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

    // Only the page bundled in the apps, which still draws the old insets, calls this.
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
        DATA_INSETS: DATA_INSETS,
        unwrapLon: unwrapLon,
        wrapLon: wrapLon,
        toMapFeatures: toMapFeatures,
        toMapPoints: toMapPoints,
        toMapCoordinates: toMapCoordinates,
        migrateSavedState: migrateSavedState,
        createBaseLayer: createBaseLayer,
        createSatelliteLayer: createSatelliteLayer
    };
}));
