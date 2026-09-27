(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenPortions = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    /**
     * Port of com.raytheon.uf.common.dataplugin.warning.portions (PortionsUtil, GridUtil,
     * CoverageConstants and GisUtil.calculateLocationPortion): the "southeastern" in
     * "southeastern Douglas County". The area and its warned part are rasterized on
     * WarngenLayer's grid, 600 cells across the office's areas, and each cell is scaled onto
     * a 0-254 north/south and east/west ramp across the area. Area.java only asks for
     * portions when less than 60% of the area is warned.
     *
     * The grid here is plain longitude/latitude rather than the office's local projection.
     * site-level area.suppress files are not read (base installs have none).
     */
    var PORTION_TOLERANCE = 0.60;

    var C = {
        XSOUTH: 0x0001, SOUTH: 0x0002, NORTH: 0x0040, XNORTH: 0x0080,
        CENTER_NS: 0x0018, CENTRAL_NS: 0x0024, XWEST: 0x0100, WEST: 0x0200,
        EAST: 0x4000, XEAST: 0x8000, CENTER_EW: 0x1800, CENTRAL_EW: 0x2400,
        SOUTHERN: 0x0003, NORTHERN: 0x00C0, WESTERN: 0x0300, EASTERN: 0xC000,
        EXTREME: 0x8181, NOT_EXTREME: 0x7E7E, EXTREME_NS: 0x0081, EXTREME_EW: 0x8100,
        CENTRAL: 0x2424, CENTER: 0x1818, NOT_CENTRAL: 0xC3C3, NORTH_SOUTH: 0x00FF,
        EAST_WEST: 0xFF00,
        NNE: 0x0001, ENE: 0x0002, ESE: 0x0004, SSE: 0x0008,
        SSW: 0x0010, WSW: 0x0020, WNW: 0x0040, NNW: 0x0080,
        EXTREME_YES: 0xFFFF00, EXTREME_NO: 0x00FF
    };

    function buildMask(lo, xlo, hi, xhi, centerBits, centralBits) {
        var mask = new Array(256);
        mask[0] = 0;
        for (var i = 1; i < 256; i++) {
            if (i < 87) mask[i] = xlo | lo;
            else if (i > 167) mask[i] = xhi | hi;
            else if (i < 106) mask[i] = lo;
            else if (i > 148) mask[i] = hi;
            else if (i < 118) mask[i] = centralBits | lo;
            else if (i > 138) mask[i] = centralBits | hi;
            else if (i < 127) mask[i] = centerBits | centralBits | lo;
            else if (i > 127) mask[i] = centerBits | centralBits | hi;
            else mask[i] = centerBits | centralBits;
        }
        return mask;
    }
    var NS_MASK = buildMask(C.SOUTH, C.XSOUTH, C.NORTH, C.XNORTH, C.CENTER_NS, C.CENTRAL_NS);
    var EW_MASK = buildMask(C.WEST, C.XWEST, C.EAST, C.XEAST, C.CENTER_EW, C.CENTRAL_EW);

    // GisUtil.Direction order, which is also the order the names come back in.
    var ORDER = ["CENTRAL", "NORTH", "SOUTH", "EAST", "WEST", "EXTREME"];

    function toList(set) {
        return ORDER.filter(function (d) { return set[d]; });
    }

    function ringsOf(feature) {
        var g = feature.geometry;
        var polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
        var rings = [];
        polys.forEach(function (p) { p.forEach(function (r) { rings.push(r); }); });
        return rings;
    }

    function bboxOfRings(rings) {
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        rings.forEach(function (r) {
            r.forEach(function (c) {
                if (c[0] < b[0]) b[0] = c[0];
                if (c[1] < b[1]) b[1] = c[1];
                if (c[0] > b[2]) b[2] = c[0];
                if (c[1] > b[3]) b[3] = c[1];
            });
        });
        return b;
    }

    /** WarngenLayer's grid over the office's areas; row 0 is the northern edge. */
    function gridFor(features) {
        var rings = [];
        features.forEach(function (f) { if (f.geometry) rings = rings.concat(ringsOf(f)); });
        var b = bboxOfRings(rings);
        var width = b[2] - b[0], height = b[3] - b[1];
        if (!(width > 0 && height > 0)) return null;
        var nx = 600, ny = 600;
        if (width > height) ny = Math.floor(height * nx / width);
        else if (height > width) nx = Math.floor(width * ny / height);
        var inc = width / nx;
        return { x0: b[0] - inc, yTop: b[3] + inc, inc: inc, nx: nx + 2, ny: ny + 2 };
    }

    // Even-odd fill of grid nodes inside rings, restricted to a window of columns and rows.
    function rasterize(rings, grid, win) {
        var w = win.i1 - win.i0, h = win.j1 - win.j0;
        var out = new Uint8Array(w * h);
        for (var j = 0; j < h; j++) {
            var y = grid.yTop - (win.j0 + j) * grid.inc;
            var xs = [];
            rings.forEach(function (r) {
                for (var a = 0, b = r.length - 1; a < r.length; b = a++) {
                    var ya = r[a][1], yb = r[b][1];
                    if ((ya > y) !== (yb > y)) {
                        xs.push(r[a][0] + (y - ya) * (r[b][0] - r[a][0]) / (yb - ya));
                    }
                }
            });
            if (!xs.length) continue;
            xs.sort(function (p, q) { return p - q; });
            for (var k = 0; k + 1 < xs.length; k += 2) {
                var from = Math.ceil((xs[k] - grid.x0) / grid.inc) - win.i0;
                var to = Math.floor((xs[k + 1] - grid.x0) / grid.inc) - win.i0;
                if (from < 0) from = 0;
                if (to > w - 1) to = w - 1;
                for (var i = from; i <= to; i++) out[j * w + i] = 1;
            }
        }
        return out;
    }

    // GridUtil.awips1FinishAreaEntity + finishDefineArea over the window's own indices.
    function entityData(areaGrid, warnedGrid, w, h, win) {
        var min_i = Infinity, min_j = Infinity, max_i = -Infinity, max_j = -Infinity;
        var ii, jj, k;
        for (jj = 0; jj < h; jj++) {
            for (ii = 0; ii < w; ii++) {
                if (areaGrid[jj * w + ii] !== 1) continue;
                if (ii > max_i) max_i = ii;
                if (ii < min_i) min_i = ii;
                if (jj > max_j) max_j = jj;
                if (jj < min_j) min_j = jj;
            }
        }
        if (min_i === Infinity) return { meanMask: 0, coverageMask: 0, octants: 0 };
        // In the office grid's own indices, which the rotation below depends on.
        var gi0 = win.i0, gj0 = win.j0;
        var i_base = Math.floor(((min_i + gi0) + (max_i + gi0)) / 2);
        var j_base = Math.floor(((min_j + gj0) + (max_j + gj0)) / 2);
        var dx = 1, dy = 1;
        dy -= j_base - 0.5;
        var mag = Math.sqrt(dx * dx + dy * dy);
        dx /= mag;
        dy /= mag;
        var erot_i = -dy, erot_j = -dx, nrot_i = dx, nrot_j = dy;

        var ns1 = 0, ns2 = 0, ew1 = 0, ew2 = 0;
        function offsets(i, j) {
            var di = (i + gi0) - i_base, dj = (j + gj0) - j_base;
            return [Math.trunc(nrot_i * di + nrot_j * dj), Math.trunc(erot_i * di + erot_j * dj)];
        }
        for (jj = min_j; jj < max_j; jj++) {
            for (ii = min_i; ii < max_i; ii++) {
                if (areaGrid[jj * w + ii] !== 1) continue;
                var o = offsets(ii, jj);
                if (o[0] < ns1) ns1 = o[0];
                if (o[0] > ns2) ns2 = o[0];
                if (o[1] < ew1) ew1 = o[1];
                if (o[1] > ew2) ew2 = o[1];
            }
        }
        var mu_w = (87 - 127) / (ew1 + 0.5), mu_e = (167 - 127) / (ew2 - 0.5);
        var mu_s = (87 - 127) / (ns1 + 0.5), mu_n = (167 - 127) / (ns2 - 0.5);

        var ewGrid = new Int32Array(w * h), nsGrid = new Int32Array(w * h);
        for (jj = min_j; jj < max_j; jj++) {
            for (ii = min_i; ii < max_i; ii++) {
                k = jj * w + ii;
                if (areaGrid[k] !== 1) continue;
                var off = offsets(ii, jj);
                var ex = off[1] < 0 ? off[1] * mu_w : off[1] * mu_e;
                ex = Math.max(-127, Math.min(127, ex));
                ewGrid[k] = 127 + Math.trunc(ex);
                var ey = off[0] < 0 ? off[0] * mu_s : off[0] * mu_n;
                ey = Math.max(-127, Math.min(127, ey));
                nsGrid[k] = 127 + Math.trunc(ey);
            }
        }

        var coverageMask = 0, octants = 0, ewCount = 0, nsCount = 0, ewTotal = 0, nsTotal = 0;
        for (jj = min_j; jj < max_j; jj++) {
            for (ii = min_i; ii < max_i; ii++) {
                k = jj * w + ii;
                if (warnedGrid[k] !== 1) continue;
                var ei = ewGrid[k], nj = nsGrid[k];
                if (ei === 0 && nj === 0) continue;
                ewTotal += ei;
                if (ei > 0) ewCount++;
                nsTotal += nj;
                if (nj > 0) nsCount++;
                var m = EW_MASK[ei] | NS_MASK[nj];
                coverageMask |= m;
                if ((m & C.CENTRAL) === C.CENTRAL) continue;
                if (ei === 0) ei = 127;
                if (nj === 0) nj = 127;
                var e;
                if (ei < 127) {
                    e = nj < 127 ? (ei > nj ? C.SSW : C.WSW) : (ei > 254 - nj ? C.NNW : C.WNW);
                } else {
                    e = nj < 127 ? (ei < 254 - nj ? C.SSE : C.ESE) : (ei < nj ? C.NNE : C.ENE);
                }
                if ((m & C.EXTREME_NS) > 0) e <<= 8;
                if ((m & C.EXTREME_EW) > 0) e <<= 8;
                octants |= e;
            }
        }
        if (ewCount > 0) ewTotal = Math.floor((ewTotal + Math.floor(ewCount / 2)) / ewCount);
        if (nsCount > 0) nsTotal = Math.floor((nsTotal + Math.floor(nsCount / 2)) / nsCount);
        return { meanMask: NS_MASK[nsTotal] | EW_MASK[ewTotal], coverageMask: coverageMask, octants: octants };
    }

    function getPointDesc2(mask, exYes, nn, ss, ee, ww) {
        var p = {};
        if (mask === 0) return p;
        var counter = 0;
        if (!(nn !== 0 && ss !== 0)) {
            if (ss !== 0) { p.SOUTH = true; counter++; }
            else if (nn !== 0) { p.NORTH = true; counter++; }
        }
        if (!(ee !== 0 && ww !== 0)) {
            if (ww !== 0) { p.WEST = true; counter++; }
            else if (ee !== 0) { p.EAST = true; counter++; }
        }
        if (!Object.keys(p).length) return p;
        if (counter < 2 && (mask & C.CENTRAL) !== 0) p.CENTRAL = true;
        if (exYes && (mask & C.EXTREME) !== 0) p.EXTREME = true;
        return p;
    }

    // PortionsUtil.getAreaDesc
    function getAreaDesc(meanMask, areaMask, octants, exYes) {
        var p = {};
        if (meanMask === 0 || areaMask === 0) return p;
        if (octants === 0 || ((octants & C.EXTREME_YES) === 0 && (meanMask & C.CENTER) === C.CENTER)) {
            return { CENTRAL: true };
        }
        if ((octants & 0xFFFF) === 0xFFFF) return p;

        var xoctant = octants >> 8, xxoctant = octants >> 16;
        var omerge = xxoctant | xoctant | octants;
        var ne = (omerge & (C.NNE | C.ENE)) ? 1 : 0;
        var se = (omerge & (C.SSE | C.ESE)) ? 1 : 0;
        var nw = (omerge & (C.NNW | C.WNW)) ? 1 : 0;
        var sw = (omerge & (C.SSW | C.WSW)) ? 1 : 0;
        var nn = (omerge & (C.NNE | C.NNW)) ? 1 : 0;
        var ss = (omerge & (C.SSE | C.SSW)) ? 1 : 0;
        var ww = (omerge & (C.WNW | C.WSW)) ? 1 : 0;
        var ee = (omerge & (C.ENE | C.ESE)) ? 1 : 0;
        if ((areaMask & C.NORTH_SOUTH) === 0) nn = ss = ne = nw = se = sw = 0;
        if ((areaMask & C.EAST_WEST) === 0) ee = ww = ne = nw = se = sw = 0;
        var q = ne + nw + se + sw;
        var qq = nn + ss + ee + ww;

        var nnx = (areaMask & C.XNORTH) ? 1 : 0;
        var ssx = (areaMask & C.XSOUTH) ? 1 : 0;
        var wwx = (areaMask & C.XWEST) ? 1 : 0;
        var eex = (areaMask & C.XEAST) ? 1 : 0;
        var xxx = nnx + ssx + eex + wwx;

        if ((octants & C.EXTREME_NO) !== 0 && (areaMask & C.EXTREME) !== 0) {
            areaMask &= C.NOT_EXTREME;
            meanMask &= C.NOT_EXTREME;
        }
        if (q !== 0 && ((q === 2 && nw === se) || (q === 2 && ne === sw) || (qq === 2 && nn === ss) || (qq === 2 && ee === ww))) {
            if ((meanMask & C.CENTRAL) === C.CENTRAL || (nnx === ssx && wwx === eex)) return { CENTRAL: true };
            return getPointDesc2(meanMask, exYes, nn, ss, ee, ww);
        }
        if (xxx > 2 || (nnx !== ssx && wwx !== eex)) {
            areaMask &= C.NOT_CENTRAL;
            meanMask &= C.NOT_CENTRAL;
        }
        if (q === 4 && qq === 4) return {};
        if (q === 1) return getPointDesc2(meanMask, exYes, nn, ss, ee, ww);
        if (xxx >= 2) {
            areaMask &= C.NOT_CENTRAL;
            meanMask &= C.NOT_CENTRAL;
        }
        if (q < 3 && qq < 3) {
            if ((nnx !== ssx && wwx !== eex) || (meanMask & C.CENTRAL) !== 0) {
                return getPointDesc2(meanMask, exYes, nn, ss, ee, ww);
            }
            return getPointDesc2(areaMask, exYes, nn, ss, ee, ww);
        }
        if (q === 3 && qq !== 3) {
            if (ne === 0) { p.SOUTH = true; p.WEST = true; }
            else if (se === 0) { p.NORTH = true; p.WEST = true; }
            else if (nw === 0) { p.SOUTH = true; p.EAST = true; }
            else if (sw === 0) { p.NORTH = true; p.EAST = true; }
        }
        if (qq === 3 && !Object.keys(p).length) {
            if (nn === 0) p.SOUTH = true;
            else if (ss === 0) p.NORTH = true;
            else if (ww === 0) p.EAST = true;
            else if (ee === 0) p.WEST = true;
        }
        if (Object.keys(p).length) {
            if (exYes && (areaMask & C.EXTREME) !== 0) p.EXTREME = true;
            return p;
        }
        if (q === 4 || qq === 4) return {};

        nn = areaMask & C.NORTHERN;
        ss = areaMask & C.SOUTHERN;
        ee = areaMask & C.EASTERN;
        ww = areaMask & C.WESTERN;
        if ((ss !== 0 && nn !== 0) || q === 0) {
            if (ee === 0 && ww !== 0) p.WEST = true;
            if (ww === 0 && ee !== 0) p.EAST = true;
        } else if ((ee !== 0 && ww !== 0) || q === 0) {
            if (nn === 0 && ss !== 0) p.SOUTH = true;
            if (ss === 0 && nn !== 0) p.NORTH = true;
        }
        if (Object.keys(p).length) {
            if (exYes && (areaMask & C.EXTREME) !== 0) p.EXTREME = true;
            return p;
        }
        return getPointDesc2(meanMask, exYes, nn, ss, ee, ww);
    }

    // GisUtil.calculateLocationPortion: from the area's centre to the warned part's centre.
    function locationPortion(areaBbox, warnedCentroid) {
        var lat1 = (areaBbox[1] + areaBbox[3]) / 2 * Math.PI / 180;
        var lon1 = (areaBbox[0] + areaBbox[2]) / 2 * Math.PI / 180;
        var lat2 = warnedCentroid[1] * Math.PI / 180, lon2 = warnedCentroid[0] * Math.PI / 180;
        var y = Math.sin(lon2 - lon1) * Math.cos(lat2);
        var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
        var az = Math.atan2(y, x) * 180 / Math.PI;
        var p = {};
        var D = 15;
        if (az < 180 - D && az > D) p.EAST = true;
        else if (az < -D && az > D - 180) p.WEST = true;
        if (Math.abs(az) < 90 - D) p.NORTH = true;
        else if (Math.abs(az) > 90 + D) p.SOUTH = true;
        return p;
    }

    /**
     * Area.findAffectedAreas' partOfArea for one area: [] when 60% or more of it is warned,
     * otherwise PortionsUtil.getPortions with useExtreme. ring is the warning polygon.
     */
    function portions(ring, feature, grid) {
        if (!grid || !feature.geometry) return [];
        var areaRings = ringsOf(feature);
        var b = bboxOfRings(areaRings);
        var win = {
            i0: Math.max(0, Math.floor((b[0] - grid.x0) / grid.inc) - 1),
            i1: Math.min(grid.nx, Math.ceil((b[2] - grid.x0) / grid.inc) + 2),
            j0: Math.max(0, Math.floor((grid.yTop - b[3]) / grid.inc) - 1),
            j1: Math.min(grid.ny, Math.ceil((grid.yTop - b[1]) / grid.inc) + 2)
        };
        var w = win.i1 - win.i0, h = win.j1 - win.j0;
        if (w <= 0 || h <= 0) return [];
        var area = rasterize(areaRings, grid, win);
        var inPoly = rasterize([ring], grid, win);
        var warned = new Uint8Array(w * h);
        var areaCells = 0, warnedCells = 0, sx = 0, sy = 0;
        for (var k = 0; k < area.length; k++) {
            if (!area[k]) continue;
            areaCells++;
            if (inPoly[k]) {
                warned[k] = 1;
                warnedCells++;
                sx += grid.x0 + (win.i0 + (k % w)) * grid.inc;
                sy += grid.yTop - (win.j0 + Math.floor(k / w)) * grid.inc;
            }
        }
        if (!areaCells || !warnedCells || warnedCells >= areaCells * PORTION_TOLERANCE) return [];

        var ed = entityData(area, warned, w, h, win);
        var set;
        if (ed.meanMask === 0 || ed.coverageMask === 0 || ed.meanMask === ed.coverageMask) {
            set = locationPortion(b, [sx / warnedCells, sy / warnedCells]);
        } else {
            set = getAreaDesc(ed.meanMask, ed.coverageMask, ed.octants, true);
        }
        return toList(set);
    }

    return {
        gridFor: gridFor,
        portions: portions,
        PORTION_TOLERANCE: PORTION_TOLERANCE,
        _getAreaDesc: getAreaDesc,
        _entityData: entityData
    };
}));
