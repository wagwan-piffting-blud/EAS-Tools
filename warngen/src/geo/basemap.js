
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenBasemap = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    /**
     * Map overlays in the spirit of D2D's Maps menu. State and CWA borders are the county
     * edges whose two sides disagree, so they land exactly on the county outlines; edges
     * with only one county (coasts, the national border) belong to every group.
     */

    function polygonsOf(geometry) {
        if (!geometry) return [];
        return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    }

    function chainSegments(segments) {
        var byPoint = new Map();
        segments.forEach(function (s, i) {
            [s[0], s[1]].forEach(function (p) {
                var k = p[0] + "," + p[1];
                var list = byPoint.get(k);
                if (list) list.push(i);
                else byPoint.set(k, [i]);
            });
        });
        var used = new Uint8Array(segments.length);

        function extend(line, fromEnd) {
            for (;;) {
                var tip = fromEnd ? line[line.length - 1] : line[0];
                var next = (byPoint.get(tip[0] + "," + tip[1]) || []).filter(function (i) { return !used[i]; });
                if (next.length !== 1) return;
                used[next[0]] = 1;
                var s = segments[next[0]];
                var other = (s[0][0] === tip[0] && s[0][1] === tip[1]) ? s[1] : s[0];
                if (fromEnd) line.push(other);
                else line.unshift(other);
            }
        }

        var lines = [];
        segments.forEach(function (s, i) {
            if (used[i]) return;
            used[i] = 1;
            var line = [s[0], s[1]];
            extend(line, true);
            extend(line, false);
            lines.push(line);
        });
        return lines;
    }

    /** MultiLineString coordinates of every edge between areas that groupOf tells apart. */
    function groupBorders(geojson, groupOf) {
        var edges = new Map();
        (geojson && geojson.features || []).forEach(function (f) {
            var group = groupOf(f);
            polygonsOf(f.geometry).forEach(function (poly) {
                poly.forEach(function (ring) {
                    for (var i = 0; i + 1 < ring.length; i++) {
                        var a = ring[i], b = ring[i + 1];
                        var ka = a[0] + "," + a[1], kb = b[0] + "," + b[1];
                        if (ka === kb) continue;
                        var key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
                        var e = edges.get(key);
                        if (e) e.groups.push(group);
                        else edges.set(key, { a: a, b: b, groups: [group] });
                    }
                });
            });
        });
        var segments = [];
        edges.forEach(function (e) {
            var g = e.groups;
            if (g.length === 1 || g.some(function (x) { return x !== g[0]; })) segments.push([e.a, e.b]);
        });
        return chainSegments(segments);
    }

    function ringArea(ring) {
        var s = 0;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
        }
        return Math.abs(s / 2);
    }

    function insideRing(p, ring) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    function edgeDistance(p, ring) {
        var best = Infinity;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var ax = ring[j][0], ay = ring[j][1], dx = ring[i][0] - ax, dy = ring[i][1] - ay;
            var len2 = dx * dx + dy * dy;
            var t = len2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
            var ex = ax + t * dx - p[0], ey = ay + t * dy - p[1];
            var d = ex * ex + ey * ey;
            if (d < best) best = d;
        }
        return best;
    }

    /**
     * Where an area's name goes: the centroid of its largest piece when that falls inside,
     * otherwise the grid point deepest inside it (crescent and hooked counties).
     */
    function labelAnchor(feature) {
        var outer = null, area = -1;
        polygonsOf(feature.geometry).forEach(function (poly) {
            var a = ringArea(poly[0]);
            if (a > area) { area = a; outer = poly[0]; }
        });
        if (!outer) return null;
        var cx = 0, cy = 0, s = 0;
        for (var i = 0, j = outer.length - 1; i < outer.length; j = i++) {
            var f = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
            cx += (outer[j][0] + outer[i][0]) * f;
            cy += (outer[j][1] + outer[i][1]) * f;
            s += f;
        }
        if (s) {
            var c = [cx / (3 * s), cy / (3 * s)];
            if (insideRing(c, outer) && edgeDistance(c, outer) > 1e-4) return c;
        }
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        outer.forEach(function (p) {
            b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]);
            b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]);
        });
        var best = null, bestD = -1, n = 12;
        for (var x = 0; x < n; x++) {
            for (var y = 0; y < n; y++) {
                var p = [b[0] + (b[2] - b[0]) * (x + 0.5) / n, b[1] + (b[3] - b[1]) * (y + 0.5) / n];
                if (!insideRing(p, outer)) continue;
                var d = edgeDistance(p, outer);
                if (d > bestD) { bestD = d; best = p; }
            }
        }
        return best || outer[0];
    }

    /** One representative point along a line feature: the vertex nearest its middle by length. */
    function lineMidpoint(geometry) {
        var lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
        var longest = null, longestLen = -1;
        lines.forEach(function (l) {
            var len = 0;
            for (var i = 1; i < l.length; i++) len += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
            if (len > longestLen) { longestLen = len; longest = l; }
        });
        if (!longest || !longest.length) return null;
        var half = longestLen / 2, run = 0;
        for (var k = 1; k < longest.length; k++) {
            run += Math.hypot(longest[k][0] - longest[k - 1][0], longest[k][1] - longest[k - 1][1]);
            if (run >= half) return longest[k];
        }
        return longest[longest.length - 1];
    }

    /** Lat/lon line spacing in degrees for a zoom level. */
    function gridStep(zoom) {
        if (zoom < 5) return 10;
        if (zoom < 6.5) return 5;
        if (zoom < 8) return 2;
        if (zoom < 9.5) return 1;
        if (zoom < 11) return 0.5;
        return 0.25;
    }

    function gridLines(bounds, zoom) {
        var step = gridStep(zoom);
        var w = Math.floor(bounds.west / step) * step, e = Math.ceil(bounds.east / step) * step;
        var s = Math.max(-85, Math.floor(bounds.south / step) * step), n = Math.min(85, Math.ceil(bounds.north / step) * step);
        var lines = [];
        for (var lon = w; lon <= e + 1e-9; lon += step) lines.push({ kind: "lon", value: lon, coords: [[lon, s], [lon, n]] });
        for (var lat = s; lat <= n + 1e-9; lat += step) lines.push({ kind: "lat", value: lat, coords: [[w, lat], [e, lat]] });
        return { step: step, lines: lines };
    }

    function gridLabel(kind, value, step) {
        var v = step < 1 ? Math.abs(value).toFixed(2).replace(/\.?0+$/, "") : String(Math.abs(value));
        if (kind === "lat") return v + "°" + (value < 0 ? "S" : value > 0 ? "N" : "");
        return v + "°" + (value < 0 ? "W" : value > 0 ? "E" : "");
    }

    /**
     * Screen-space label layer. Providers hand back candidates for the current view; the
     * layer places them in priority order and drops any that would overlap one already
     * placed, the way D2D thins a map's labels as you zoom out.
     */
    function createLabelLayer(L, options) {
        var measureCtx = null;
        var widthCache = new Map();

        function textWidth(text, font) {
            var key = font + "|" + text;
            var w = widthCache.get(key);
            if (w != null) return w;
            if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
            measureCtx.font = font;
            w = Math.ceil(measureCtx.measureText(text).width);
            widthCache.set(key, w);
            return w;
        }

        var Layer = L.Layer.extend({
            initialize: function () {
                this._providers = {};
                this._fonts = {};
                this._maxLabels = options.maxLabels || 450;
            },

            setProvider: function (name, fn) {
                if (fn) this._providers[name] = fn;
                else delete this._providers[name];
                this.redraw();
            },

            hasProviders: function () {
                return Object.keys(this._providers).length > 0;
            },

            onAdd: function (map) {
                this._container = L.DomUtil.create("div", "wg-map-labels", map.getPane(options.pane));
                this._container.setAttribute("aria-hidden", "true");
                map.on("moveend", this.redraw, this);
                map.on("zoomstart", this._hide, this);
                this.redraw();
            },

            onRemove: function (map) {
                map.off("moveend", this.redraw, this);
                map.off("zoomstart", this._hide, this);
                L.DomUtil.remove(this._container);
                this._container = null;
            },

            _hide: function () {
                if (this._container) this._container.style.visibility = "hidden";
            },

            _font: function (cls) {
                if (this._fonts[cls]) return this._fonts[cls];
                var probe = L.DomUtil.create("span", "wg-map-label " + cls, this._container);
                var cs = getComputedStyle(probe);
                var font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
                var pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
                var h = (parseFloat(cs.fontSize) || 11) + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
                L.DomUtil.remove(probe);
                this._fonts[cls] = { font: font, pad: pad, height: h };
                return this._fonts[cls];
            },

            redraw: function () {
                if (!this._map || !this._container) return;
                var map = this._map;
                var box = this._container;
                box.textContent = "";
                box.style.visibility = "";
                var b = map.getBounds().pad(0.05);
                var view = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
                var zoom = map.getZoom();
                var size = map.getSize();
                var candidates = [];
                var self = this;
                Object.keys(this._providers).forEach(function (name) {
                    var list = self._providers[name](view, zoom) || [];
                    for (var i = 0; i < list.length; i++) candidates.push(list[i]);
                });
                candidates.sort(function (a, b2) { return a.priority - b2.priority; });

                var CELL = 64;
                var grid = new Map();
                function hits(r) {
                    for (var gx = Math.floor(r[0] / CELL); gx <= Math.floor(r[2] / CELL); gx++) {
                        for (var gy = Math.floor(r[1] / CELL); gy <= Math.floor(r[3] / CELL); gy++) {
                            var cell = grid.get(gx + ":" + gy);
                            if (!cell) continue;
                            for (var k = 0; k < cell.length; k++) {
                                var o = cell[k];
                                if (r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]) return true;
                            }
                        }
                    }
                    return false;
                }
                function occupy(r) {
                    for (var gx = Math.floor(r[0] / CELL); gx <= Math.floor(r[2] / CELL); gx++) {
                        for (var gy = Math.floor(r[1] / CELL); gy <= Math.floor(r[3] / CELL); gy++) {
                            var key = gx + ":" + gy;
                            var cell = grid.get(key);
                            if (cell) cell.push(r);
                            else grid.set(key, [r]);
                        }
                    }
                }

                var frag = document.createDocumentFragment();
                var placed = 0;
                var GAP = 3;
                for (var i = 0; i < candidates.length && placed < this._maxLabels; i++) {
                    var c = candidates[i];
                    var pt = map.latLngToContainerPoint([c.lat, c.lon]);
                    if (c.screen) pt = L.point(c.screen.x != null ? c.screen.x : pt.x, c.screen.y != null ? c.screen.y : pt.y);
                    if (pt.x < -50 || pt.y < -20 || pt.x > size.x + 50 || pt.y > size.y + 20) continue;
                    var f = this._font(c.cls);
                    var w = textWidth(c.text, f.font) + f.pad + (c.dot ? 7 : 0);
                    var h = f.height;
                    var x0 = c.align === "left" ? pt.x - (c.dot ? 3 : 0) : pt.x - w / 2;
                    var y0 = pt.y - h / 2;
                    var r = [x0 - GAP, y0 - GAP, x0 + w + GAP, y0 + h + GAP];
                    if (hits(r)) continue;
                    occupy(r);
                    var el = document.createElement("span");
                    el.className = "wg-map-label " + c.cls + (c.dot ? " wg-map-label-dot" : "");
                    el.textContent = c.text;
                    var lp = map.containerPointToLayerPoint([x0, y0]);
                    el.style.transform = "translate(" + Math.round(lp.x) + "px," + Math.round(lp.y) + "px)";
                    frag.appendChild(el);
                    placed++;
                }
                box.appendChild(frag);
            }
        });
        return new Layer();
    }

    return {
        groupBorders: groupBorders,
        labelAnchor: labelAnchor,
        lineMidpoint: lineMidpoint,
        gridLines: gridLines,
        gridLabel: gridLabel,
        createLabelLayer: createLabelLayer
    };
}));
