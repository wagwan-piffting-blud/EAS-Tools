(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./intersect.js"));
    } else {
        root.WarngenRedraw = factory(root.WarngenIntersect);
    }
}(typeof self !== "undefined" ? self : this, function (Intersect) {

    /**
     * WarnGen redraws a new warning's polygon from the area it hatches before making the text
     * (WarngenDialog.redrawFromWarned -> WarngenLayer.redrawBoxFromHatched ->
     * PolygonUtil.hatchWarningArea). Both are rasterized on a grid 600 cells across the
     * office's area; if the drawn polygon covers the same cells as the hatched area it is
     * kept, otherwise the hatched area is contoured and cut back to 20 vertices. Either way
     * the AreaHatcher then rounds to 0.01 degrees and cleans the ring.
     *
     * The contouring and awips1PointReduction steps are approximated here: marching squares
     * over the same raster, then area-based vertex removal that keeps points matching the
     * drawn polygon's vertices.
     */
    var GRID_CELLS = 600;
    var MAX_VERTICES = 20;

    function ringBbox(ring) {
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        ring.forEach(function (c) {
            if (c[0] < b[0]) b[0] = c[0];
            if (c[1] < b[1]) b[1] = c[1];
            if (c[0] > b[2]) b[2] = c[0];
            if (c[1] > b[3]) b[3] = c[1];
        });
        return b;
    }

    function featuresBbox(features) {
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        features.forEach(function (f) {
            var polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
            polys.forEach(function (p) {
                var rb = ringBbox(p[0]);
                b = [Math.min(b[0], rb[0]), Math.min(b[1], rb[1]), Math.max(b[2], rb[2]), Math.max(b[3], rb[3])];
            });
        });
        return b;
    }

    // WarngenLayer's grid: 600 cells on the long side, square cells, padded by one.
    function makeGrid(extent) {
        var width = extent[2] - extent[0];
        var height = extent[3] - extent[1];
        var nx = GRID_CELLS, ny = GRID_CELLS;
        if (width > height) ny = Math.floor(height * nx / width);
        else if (height > width) nx = Math.floor(width * ny / height);
        var inc = width / nx;
        return { x0: extent[0] - inc, y0: extent[1] - inc, inc: inc, nx: nx + 2, ny: ny + 2 };
    }

    function featureContains(f, pt) {
        var polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (var i = 0; i < polys.length; i++) {
            if (!Intersect.pointInRing(pt, polys[i][0])) continue;
            var inHole = false;
            for (var h = 1; h < polys[i].length; h++) {
                if (Intersect.pointInRing(pt, polys[i][h])) { inHole = true; break; }
            }
            if (!inHole) return true;
        }
        return false;
    }

    function rasterize(grid, ring, features, window, clipRing) {
        var masks = { poly: new Uint8Array(grid.nx * grid.ny), area: new Uint8Array(grid.nx * grid.ny) };
        var boxes = features.map(function (f) { return featuresBbox([f]); });
        for (var i = window.i0; i <= window.i1; i++) {
            var x = grid.x0 + (i + 0.5) * grid.inc;
            for (var j = window.j0; j <= window.j1; j++) {
                var y = grid.y0 + (j + 0.5) * grid.inc;
                var pt = [x, y];
                if (!Intersect.pointInRing(pt, ring)) continue;
                var k = j * grid.nx + i;
                masks.poly[k] = 1;
                if (clipRing && !Intersect.pointInRing(pt, clipRing)) continue;
                for (var f = 0; f < features.length; f++) {
                    var b = boxes[f];
                    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
                    if (featureContains(features[f], pt)) { masks.area[k] = 1; break; }
                }
            }
        }
        return masks;
    }

    function masksEqual(a, b) {
        for (var k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
        return true;
    }

    // Keep only the largest 4-connected blob, as the longest contour is what WarnGen keeps.
    function largestBlob(mask, nx, ny) {
        var label = new Int32Array(mask.length);
        var best = 0, bestSize = 0, next = 0;
        var stack = [];
        for (var k = 0; k < mask.length; k++) {
            if (!mask[k] || label[k]) continue;
            next++;
            var size = 0;
            stack.push(k);
            label[k] = next;
            while (stack.length) {
                var c = stack.pop();
                size++;
                var ci = c % nx, cj = (c - ci) / nx;
                var nbrs = [ci > 0 ? c - 1 : -1, ci < nx - 1 ? c + 1 : -1, cj > 0 ? c - nx : -1, cj < ny - 1 ? c + nx : -1];
                for (var n = 0; n < 4; n++) {
                    var d = nbrs[n];
                    if (d >= 0 && mask[d] && !label[d]) { label[d] = next; stack.push(d); }
                }
            }
            if (size > bestSize) { bestSize = size; best = next; }
        }
        var out = new Uint8Array(mask.length);
        for (var m = 0; m < mask.length; m++) out[m] = label[m] === best ? 1 : 0;
        return out;
    }

    // Outer boundary of a blob, traced along cell edges and returned as cell-corner
    // coordinates, collinear runs merged.
    function traceBoundary(mask, nx, ny) {
        function at(i, j) { return i >= 0 && j >= 0 && i < nx && j < ny && mask[j * nx + i] === 1; }
        var start = -1;
        for (var k = 0; k < mask.length && start < 0; k++) if (mask[k]) start = k;
        if (start < 0) return null;
        var si = start % nx, sj = (start - si) / nx;
        // Walk corners with the blob on the left; start at the lower-left corner of the
        // lowest, leftmost cell heading east.
        var x = si, y = sj, dir = 0;
        var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
        var pts = [[x, y]];
        var guard = mask.length * 4 + 8;
        do {
            // Cells ahead-left and ahead-right of the current edge direction.
            var li, lj, ri, rj;
            if (dir === 0) { li = x; lj = y; ri = x; rj = y - 1; }
            else if (dir === 1) { li = x - 1; lj = y; ri = x; rj = y; }
            else if (dir === 2) { li = x - 1; lj = y - 1; ri = x - 1; rj = y; }
            else { li = x; lj = y - 1; ri = x - 1; rj = y - 1; }
            var L = at(li, lj), R = at(ri, rj);
            if (L && !R) {
                x += DX[dir]; y += DY[dir];
            } else if (R) {
                dir = (dir + 3) % 4;
                continue;
            } else {
                dir = (dir + 1) % 4;
                continue;
            }
            var last = pts[pts.length - 1];
            var prev = pts[pts.length - 2];
            if (prev && (prev[0] === last[0] && last[0] === x || prev[1] === last[1] && last[1] === y)) {
                last[0] = x; last[1] = y;
            } else {
                pts.push([x, y]);
            }
        } while ((x !== si || y !== sj || dir !== 0) && --guard > 0);
        if (pts.length > 1 && pts[pts.length - 1][0] === pts[0][0] && pts[pts.length - 1][1] === pts[0][1]) pts.pop();
        return pts;
    }

    function triArea(a, b, c) {
        return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    }

    // Visvalingam-Whyatt, never dropping a fixed point while an unfixed one remains.
    function reduce(pts, fixed, maxVertices) {
        var ring = pts.map(function (p, i) { return { p: p, fixed: fixed[i] }; });
        while (ring.length > maxVertices) {
            var bestI = -1, bestA = Infinity, anyFree = ring.some(function (v) { return !v.fixed; });
            for (var i = 0; i < ring.length; i++) {
                if (anyFree && ring[i].fixed) continue;
                var a = triArea(ring[(i - 1 + ring.length) % ring.length].p, ring[i].p, ring[(i + 1) % ring.length].p);
                if (a < bestA) { bestA = a; bestI = i; }
            }
            ring.splice(bestI, 1);
        }
        return ring.map(function (v) { return v.p; });
    }

    /**
     * ring: the drawn polygon (closed, [lon, lat]); features: the hatched areas;
     * extentFeatures: the office's areas (sets the grid). Returns the redrawn closed ring,
     * or null when the drawn polygon already hatches exactly the warned area.
     */
    function hatchWarningArea(ring, features, extentFeatures, clipRing) {
        if (!ring || ring.length < 4 || !features.length) return null;
        var grid = makeGrid(featuresBbox(extentFeatures && extentFeatures.length ? extentFeatures : features));
        if (!(grid.inc > 0)) return null;
        var rb = ringBbox(ring);
        var window = {
            i0: Math.max(0, Math.floor((rb[0] - grid.x0) / grid.inc) - 1),
            i1: Math.min(grid.nx - 1, Math.ceil((rb[2] - grid.x0) / grid.inc) + 1),
            j0: Math.max(0, Math.floor((rb[1] - grid.y0) / grid.inc) - 1),
            j1: Math.min(grid.ny - 1, Math.ceil((rb[3] - grid.y0) / grid.inc) + 1)
        };
        var masks = rasterize(grid, ring, features, window, clipRing);
        if (masksEqual(masks.poly, masks.area)) return null;

        var blob = largestBlob(masks.area, grid.nx, grid.ny);
        var corners = traceBoundary(blob, grid.nx, grid.ny);
        if (!corners || corners.length < 3) return null;
        var pts = corners.map(function (c) { return [grid.x0 + c[0] * grid.inc, grid.y0 + c[1] * grid.inc]; });

        var tol = grid.inc * 1.5;
        var verts = ring.slice(0, -1);
        var fixed = pts.map(function (p) {
            return verts.some(function (v) { return Math.abs(v[0] - p[0]) <= tol && Math.abs(v[1] - p[1]) <= tol; });
        });
        var reduced = reduce(pts, fixed, MAX_VERTICES);
        reduced.push([reduced[0][0], reduced[0][1]]);
        return reduced;
    }

    // PolygonUtil.round(coords, 2)
    function round2(coords) {
        coords.forEach(function (c) {
            c[0] = Math.round(c[0] * 100) / 100;
            c[1] = Math.round(c[1] * 100) / 100;
        });
    }

    // PolygonUtil.computeSlope
    function computeSlope(c, i) {
        var dx = c[i][0] - c[i + 1][0];
        return Math.abs(dx) > 1.0E-8 ? (c[i][1] - c[i + 1][1]) / dx : 1.0E08;
    }

    // PolygonUtil.computeCoordinate: nudge vertex j off edge i when it sits within 0.005.
    function computeCoordinate(c, i, j) {
        var slope = computeSlope(c, i);
        var ip1 = i + 1;
        if (!(c[j][0] >= c[i][0] && c[j][0] <= c[ip1][0] || c[j][0] >= c[ip1][0] && c[j][0] <= c[i][0])) return;
        var min1 = 0.005, min2 = 1.0E-8, delta = 0.005, dyMin = 0.01;
        var x, y = slope * (c[j][0] - c[i][0]) + c[i][1];
        if (Math.abs(y - c[j][1]) > min1) return;
        var jm1 = j - 1;
        if (jm1 < 0) jm1 = c.length - 2;
        var jp1 = j + 1;
        if (!(Math.abs(y - c[j][1]) < min1)) return;
        var dy1 = Math.abs(c[jm1][1] - y);
        var dy2 = Math.abs(c[jp1][1] - y);

        function viaPrev() {
            if (c[jm1][1] < c[j][1]) delta = -delta;
            slope = computeSlope(c, jm1);
            y = c[j][1] + delta;
            x = Math.abs(slope) > min2 ? (y - c[jm1][1]) / slope + c[jm1][0] : c[j][0];
        }
        function viaNext() {
            if (c[jp1][1] < c[j][1]) delta = -delta;
            slope = computeSlope(c, j);
            y = c[j][1] + delta;
            x = Math.abs(slope) > min2 ? (y - c[jp1][1]) / slope + c[jp1][0] : c[j][0];
        }

        if (dy1 >= dy2 && (dy1 > dyMin || dy2 > dyMin)) {
            if (c[j][1] === c[jm1][1] && Math.abs(c[j][0] - c[jm1][0]) > min2) viaNext();
            else viaPrev();
        } else if (dy1 > dyMin || dy2 > dyMin) {
            if (c[j][1] === c[jp1][1] && Math.abs(c[j][0] - c[jp1][0]) > min2) viaPrev();
            else viaNext();
        } else {
            x = c[j][0];
            y = c[j][1];
        }
        c[j][0] = x;
        c[j][1] = y;
        if (j === 0) c[c.length - 1] = c[j];
        if (j === c.length - 1) c[0] = c[j];
    }

    // PolygonUtil.adjustPolygon
    function adjustPolygon(c) {
        var n = c.length;
        for (var i = 0; i < n - 1; ++i) {
            var j;
            for (j = i + 2; j <= n - 2; j++) computeCoordinate(c, i, j);
            if (i <= n - 3) {
                for (j = 0; j < i; j++) computeCoordinate(c, i, j);
            } else {
                for (j = 1; j < i; j++) computeCoordinate(c, i, j);
            }
        }
    }

    // PolygonUtil.removeDuplicateCoordinate(Coordinate[])
    function removeDuplicateCoordinate(verts) {
        if (verts.length <= 4) return verts;
        var seen = {};
        var unique = [];
        verts.forEach(function (c) {
            var key = c[0] + "," + c[1];
            if (!seen[key]) {
                seen[key] = true;
                unique.push(c);
            }
        });
        if (verts.length - unique.length < 2) return verts;
        var out = unique.map(function (c) { return [c[0], c[1]]; });
        out.push([out[0][0], out[0][1]]);
        return out.length <= 3 ? verts : out;
    }

    // PolygonUtil.removeOverlaidLinesegments: drop the middle of three collinear points.
    function removeOverlaidLinesegments(coords) {
        if (coords.length <= 4) return coords;
        var flag = true;
        while (flag) {
            if (coords.length <= 4) return coords;
            var ex = coords.map(function (c) { return [c[0], c[1]]; });
            ex.push([coords[1][0], coords[1][1]]);
            flag = false;
            var m = ex.length, count = 0, slope1 = 0;
            for (var i = 0; i < m - 1; i++) {
                var slope = computeSlope(ex, i);
                if (count === 0) {
                    slope1 = slope;
                    count = 1;
                } else if (Math.abs(slope - slope1) <= 1.0E-8) {
                    count += 1;
                } else {
                    count = 1;
                    slope1 = slope;
                }
                if (count === 2) {
                    var next = [];
                    var j;
                    if (i === m - 2) {
                        for (j = 1; j <= m - 3; j++) next.push([ex[j][0], ex[j][1]]);
                    } else {
                        for (j = 0; j < i; j++) next.push([ex[j][0], ex[j][1]]);
                        for (j = i + 1; j < ex.length - 2; j++) next.push([ex[j][0], ex[j][1]]);
                    }
                    next.push([next[0][0], next[0][1]]);
                    coords = next;
                    flag = true;
                    break;
                }
            }
        }
        return coords;
    }

    /** The AreaHatcher clean-up applied to every redrawn (or kept) polygon. */
    function finalize(ring) {
        var c = ring.map(function (p) { return [p[0], p[1]]; });
        var n = c.length;
        if (n > 1 && (c[0][0] !== c[n - 1][0] || c[0][1] !== c[n - 1][1])) c.push([c[0][0], c[0][1]]);
        round2(c);
        adjustPolygon(c);
        round2(c);
        c = removeDuplicateCoordinate(c);
        c = removeOverlaidLinesegments(c);
        return c;
    }

    return {
        hatchWarningArea: hatchWarningArea,
        finalize: finalize,
        adjustPolygon: adjustPolygon,
        removeDuplicateCoordinate: removeDuplicateCoordinate,
        removeOverlaidLinesegments: removeOverlaidLinesegments,
        MAX_VERTICES: MAX_VERTICES
    };
}));
