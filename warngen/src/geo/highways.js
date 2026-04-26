
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./intersect"));
    } else {
        root.WarngenHighways = factory(root.WarngenIntersect);
    }
}(typeof self !== "undefined" ? self : this, function (Intersect) {
    "use strict";

    function haversineMiles(a, b) {
        var R = 3958.8;
        var lat1 = a[1] * Math.PI / 180;
        var lat2 = b[1] * Math.PI / 180;
        var dLat = (b[1] - a[1]) * Math.PI / 180;
        var dLon = (b[0] - a[0]) * Math.PI / 180;
        var sinDLat = Math.sin(dLat / 2);
        var sinDLon = Math.sin(dLon / 2);
        var h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function pointToSegMiles(p, a, b) {
        var midLat = ((a[1] + b[1]) / 2) * Math.PI / 180;
        var mx = 69.0 * Math.cos(midLat);
        var my = 69.0;
        var ax = a[0] * mx, ay = a[1] * my;
        var bx = b[0] * mx, by = b[1] * my;
        var px = p[0] * mx, py = p[1] * my;
        var dx = bx - ax, dy = by - ay;
        var len2 = dx * dx + dy * dy;
        if (len2 === 0) {

            var ddx = px - ax, ddy = py - ay;
            return Math.sqrt(ddx * ddx + ddy * ddy);
        }
        var t = ((px - ax) * dx + (py - ay) * dy) / len2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        var qx = ax + t * dx, qy = ay + t * dy;
        var ex = px - qx, ey = py - qy;
        return Math.sqrt(ex * ex + ey * ey);
    }

    function pointToRingMiles(p, ring) {
        var best = Infinity;
        for (var i = 0; i < ring.length - 1; i++) {
            var d = pointToSegMiles(p, ring[i], ring[i + 1]);
            if (d < best) best = d;
        }
        return best;
    }

    function lineStringInside(line, ring, bufferMiles) {
        if (bufferMiles == null) bufferMiles = 1.0;
        function classify(p) {

            if (Intersect.pointInRing(p, ring)) return 2;
            if (bufferMiles <= 0) return 0;
            return pointToRingMiles(p, ring) <= bufferMiles ? 1 : 0;
        }
        var ranges = [];
        var cumulative = 0;
        var cls = classify(line[0]);
        var inside = cls > 0;
        var currentStart = inside ? 0 : null;
        var currentStrict = cls === 2;
        for (var i = 1; i < line.length; i++) {
            cumulative += haversineMiles(line[i - 1], line[i]);
            var nowCls = classify(line[i]);
            var nowInside = nowCls > 0;
            if (nowInside && !inside) {

                currentStart  = cumulative - haversineMiles(line[i - 1], line[i]) / 2;
                currentStrict = nowCls === 2;
            } else if (!nowInside && inside) {

                var exitMile = cumulative - haversineMiles(line[i - 1], line[i]) / 2;
                if (currentStart != null) {
                    ranges.push({ start: currentStart, end: exitMile, strict: currentStrict });
                }
                currentStart  = null;
                currentStrict = false;
            } else if (nowInside && nowCls === 2) {

                currentStrict = true;
            }
            inside = nowInside;
        }
        if (inside && currentStart != null) {
            ranges.push({ start: currentStart, end: cumulative, strict: currentStrict });
        }
        return ranges;
    }

    function findHighwaysInPolygon(ring, highwaysDb, opts) {
        if (!ring || ring.length < 4 || !highwaysDb || !highwaysDb.features) return [];
        opts = opts || {};
        var anchors = (opts.anchors && opts.anchors.anchors) || opts.anchors || {};

        var polyBbox = Intersect.bbox(ring);

        var byRoute = {};

        highwaysDb.features.forEach(function (feat) {
            if (!feat.geometry) return;

            var lines = feat.geometry.type === "LineString"
                ? [feat.geometry.coordinates]
                : feat.geometry.coordinates;

            for (var li = 0; li < lines.length; li++) {
                var line = lines[li];
                if (!line || line.length < 2) continue;

                var fb = Intersect.bbox(line);
                if (fb[2] < polyBbox[0] || fb[0] > polyBbox[2] ||
                    fb[3] < polyBbox[1] || fb[1] > polyBbox[3]) continue;

                var ranges = lineStringInside(line, ring);
                if (ranges.length === 0) continue;

                var k0 = feat.properties.cls + ":" + feat.properties.num + ":"
                       + line[0][0].toFixed(3) + ":" + line[0][1].toFixed(3);
                var anchor = anchors[k0];
                var offset;
                if (anchor) {
                    offset = anchor.mm;
                } else if (typeof feat.properties.mmOffset === "number") {
                    offset = feat.properties.mmOffset;
                } else {
                    offset = 0;
                }

                var stateSuffix = feat.properties.state || "";
                var key = feat.properties.cls + "|" + feat.properties.num + "|" + stateSuffix;
                if (!byRoute[key]) {
                    byRoute[key] = {
                        cls:         feat.properties.cls,
                        num:         feat.properties.num,
                        state:       stateSuffix,
                        displayName: feat.properties.displayName,
                        mileStart:   Infinity,
                        mileEnd:     -Infinity,
                        anchored:    false,
                        strict:      false
                    };
                }
                var acc = byRoute[key];
                if (anchor) acc.anchored = true;
                for (var r = 0; r < ranges.length; r++) {
                    var ms = ranges[r].start + offset;
                    var me = ranges[r].end + offset;
                    if (ms < acc.mileStart) acc.mileStart = ms;
                    if (me > acc.mileEnd)   acc.mileEnd   = me;
                    if (ranges[r].strict)   acc.strict    = true;
                }
            }
        });

        var classRank = { interstate: 0, us: 1, state: 2 };
        var out = [];
        Object.keys(byRoute).forEach(function (k) { out.push(byRoute[k]); });
        out.sort(function (a, b) {
            if (classRank[a.cls] !== classRank[b.cls]) return classRank[a.cls] - classRank[b.cls];
            return parseInt(a.num, 10) - parseInt(b.num, 10);
        });

        out.forEach(function (h) {
            h.mileStart = Math.max(0, Math.round(h.mileStart));
            h.mileEnd   = Math.max(h.mileStart, Math.round(h.mileEnd));
        });
        return out;
    }

    function formatHighwayBullet(hits, leadIn) {
        if (!hits || hits.length === 0) return null;
        leadIn = leadIn || "This includes the following highways...";
        var lines = [leadIn];
        hits.forEach(function (h) {
            var span = h.mileEnd - h.mileStart;
            var mid  = Math.round((h.mileStart + h.mileEnd) / 2);
            if (!h.strict) {
                lines.push(" " + h.displayName + " near mile marker " + mid + ".");
            } else if (span < 2) {
                lines.push(" " + h.displayName + " near mile marker " + h.mileEnd + ".");
            } else {
                lines.push(" " + h.displayName + " between mile markers "
                         + h.mileStart + " and " + h.mileEnd + ".");
            }
        });
        return lines.join("\n");
    }

    return {
        findHighwaysInPolygon: findHighwaysInPolygon,
        formatHighwayBullet:   formatHighwayBullet,
        haversineMiles:        haversineMiles
    };
}));
