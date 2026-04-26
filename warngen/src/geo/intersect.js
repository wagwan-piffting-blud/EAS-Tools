

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenIntersect = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    function bbox(ring) {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < ring.length; i++) {
            var p = ring[i];
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        }
        return [minX, minY, maxX, maxY];
    }

    function bboxOverlap(a, b) {
        return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
    }

    function pointInRing(point, ring) {
        var x = point[0], y = point[1];
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1];
            var xj = ring[j][0], yj = ring[j][1];
            var intersects = ((yi > y) !== (yj > y)) &&
                             (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function segmentsCross(a, b, c, d) {
        function ccw(p1, p2, p3) {
            return (p3[1] - p1[1]) * (p2[0] - p1[0]) >
                   (p2[1] - p1[1]) * (p3[0] - p1[0]);
        }
        return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
    }

    function ringsCross(ringA, ringB) {
        for (var i = 0; i < ringA.length - 1; i++) {
            for (var j = 0; j < ringB.length - 1; j++) {
                if (segmentsCross(ringA[i], ringA[i + 1], ringB[j], ringB[j + 1])) {
                    return true;
                }
            }
        }
        return false;
    }

    function ringsIntersect(ringA, ringB) {
        var bbA = bbox(ringA), bbB = bbox(ringB);
        if (!bboxOverlap(bbA, bbB)) return false;

        for (var i = 0; i < ringA.length - 1; i++) {
            if (pointInRing(ringA[i], ringB)) return true;
        }
        for (var j = 0; j < ringB.length - 1; j++) {
            if (pointInRing(ringB[j], ringA)) return true;
        }
        return ringsCross(ringA, ringB);
    }

    function overlapRatio(warningRing, feat, N) {
        if (!feat.geometry) return 0;
        N = N || 20;
        var polys = feat.geometry.type === "Polygon"
            ? [feat.geometry.coordinates]
            : feat.geometry.coordinates;
        var totalInCounty = 0, totalInBoth = 0;
        for (var p = 0; p < polys.length; p++) {
            var poly = polys[p];
            var outer = poly[0];
            var b = bbox(outer);
            if (b[2] - b[0] <= 0 || b[3] - b[1] <= 0) continue;
            var dx = (b[2] - b[0]) / N;
            var dy = (b[3] - b[1]) / N;
            for (var i = 0; i < N; i++) {
                for (var j = 0; j < N; j++) {
                    var pt = [b[0] + (i + 0.5) * dx, b[1] + (j + 0.5) * dy];
                    if (!pointInRing(pt, outer)) continue;

                    var inHole = false;
                    for (var h = 1; h < poly.length; h++) {
                        if (pointInRing(pt, poly[h])) { inHole = true; break; }
                    }
                    if (inHole) continue;
                    totalInCounty += 1;
                    if (pointInRing(pt, warningRing)) totalInBoth += 1;
                }
            }
        }
        return totalInCounty === 0 ? 0 : totalInBoth / totalInCounty;
    }

    function directionalSubdivision(warningRing, feat, opts) {
        opts = opts || {};
        var N                 = opts.N                 || 20;
        var majorityThreshold = opts.majorityThreshold || 0.75;
        var quadrantThreshold = opts.quadrantThreshold || 0.33;
        var extremeThreshold  = opts.extremeThreshold  || 0.70;
        if (!feat.geometry) return [];

        var polys = feat.geometry.type === "Polygon"
            ? [feat.geometry.coordinates]
            : feat.geometry.coordinates;

        var totalInCounty = 0, totalInBoth = 0;
        var sumX = 0, sumY = 0;

        var countyMinX = Infinity, countyMinY = Infinity;
        var countyMaxX = -Infinity, countyMaxY = -Infinity;

        for (var p = 0; p < polys.length; p++) {
            var poly = polys[p];
            var outer = poly[0];
            var b = bbox(outer);
            if (b[2] - b[0] <= 0 || b[3] - b[1] <= 0) continue;
            if (b[0] < countyMinX) countyMinX = b[0];
            if (b[1] < countyMinY) countyMinY = b[1];
            if (b[2] > countyMaxX) countyMaxX = b[2];
            if (b[3] > countyMaxY) countyMaxY = b[3];
            var dx = (b[2] - b[0]) / N;
            var dy = (b[3] - b[1]) / N;
            for (var i = 0; i < N; i++) {
                for (var j = 0; j < N; j++) {
                    var pt = [b[0] + (i + 0.5) * dx, b[1] + (j + 0.5) * dy];
                    if (!pointInRing(pt, outer)) continue;
                    var inHole = false;
                    for (var h = 1; h < poly.length; h++) {
                        if (pointInRing(pt, poly[h])) { inHole = true; break; }
                    }
                    if (inHole) continue;
                    totalInCounty += 1;
                    if (pointInRing(pt, warningRing)) {
                        totalInBoth += 1;
                        sumX += pt[0];
                        sumY += pt[1];
                    }
                }
            }
        }
        if (totalInCounty === 0 || totalInBoth === 0) return [];

        var fraction = totalInBoth / totalInCounty;
        if (fraction >= majorityThreshold) return [];

        var intersectCx = sumX / totalInBoth;
        var intersectCy = sumY / totalInBoth;
        var countyCx = (countyMinX + countyMaxX) / 2;
        var countyCy = (countyMinY + countyMaxY) / 2;
        var halfW = (countyMaxX - countyMinX) / 2;
        var halfH = (countyMaxY - countyMinY) / 2;
        if (halfW <= 0 || halfH <= 0) return [];

        var offsetX = (intersectCx - countyCx) / halfW;
        var offsetY = (intersectCy - countyCy) / halfH;
        var absX = Math.abs(offsetX);
        var absY = Math.abs(offsetY);

        if (absX < quadrantThreshold && absY < quadrantThreshold) {
            return ["CENTRAL"];
        }

        var dirs = [];
        if (absY >= quadrantThreshold) dirs.push(offsetY > 0 ? "NORTH" : "SOUTH");
        if (absX >= quadrantThreshold) dirs.push(offsetX > 0 ? "EAST"  : "WEST");

        if (absX >= extremeThreshold && absY >= extremeThreshold) {
            dirs.unshift("EXTREME");
        }
        return dirs;
    }

    function findIntersectingFeatures(warningRing, geojson, minOverlap) {
        if (!geojson || !geojson.features) return [];
        if (minOverlap == null) minOverlap = 0.01;
        var hits = [];
        for (var k = 0; k < geojson.features.length; k++) {
            var feat = geojson.features[k];
            if (!feat.geometry) continue;
            var coords = feat.geometry.coordinates;
            var candidate = false;
            if (feat.geometry.type === "Polygon") {
                if (ringsIntersect(warningRing, coords[0])) candidate = true;
            } else if (feat.geometry.type === "MultiPolygon") {
                for (var m = 0; m < coords.length; m++) {
                    if (ringsIntersect(warningRing, coords[m][0])) { candidate = true; break; }
                }
            }
            if (!candidate) continue;
            if (minOverlap > 0 && overlapRatio(warningRing, feat) < minOverlap) continue;
            hits.push(feat);
        }
        return hits;
    }

    function findFeatureContaining(point, geojson) {
        if (!geojson || !geojson.features) return null;
        for (var k = 0; k < geojson.features.length; k++) {
            var feat = geojson.features[k];
            if (!feat.geometry) continue;
            var coords = feat.geometry.coordinates;
            if (feat.geometry.type === "Polygon") {
                if (!pointInRing(point, coords[0])) continue;

                var inHole = false;
                for (var h = 1; h < coords.length; h++) {
                    if (pointInRing(point, coords[h])) { inHole = true; break; }
                }
                if (!inHole) return feat;
            } else if (feat.geometry.type === "MultiPolygon") {
                for (var m = 0; m < coords.length; m++) {
                    var poly = coords[m];
                    if (!pointInRing(point, poly[0])) continue;
                    var inHole2 = false;
                    for (var h2 = 1; h2 < poly.length; h2++) {
                        if (pointInRing(point, poly[h2])) { inHole2 = true; break; }
                    }
                    if (!inHole2) return feat;
                }
            }
        }
        return null;
    }

    return {
        findIntersectingFeatures: findIntersectingFeatures,
        findFeatureContaining:    findFeatureContaining,
        overlapRatio:             overlapRatio,
        directionalSubdivision:   directionalSubdivision,
        ringsIntersect:           ringsIntersect,
        pointInRing:              pointInRing,
        bbox:                     bbox
    };
}));
