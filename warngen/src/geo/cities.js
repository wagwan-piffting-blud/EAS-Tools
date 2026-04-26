

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./intersect"));
    } else {
        root.WarngenCities = factory(root.WarngenIntersect);
    }
}(typeof self !== "undefined" ? self : this, function (Intersect) {

    var MILES_PER_DEG_LAT = 69.0;
    var EARTH_RADIUS_MI   = 3958.8;
    var DEG2RAD           = Math.PI / 180;

    function toLL(p) {
        if (Array.isArray(p)) return { lon: p[0], lat: p[1] };
        return p;
    }

    function distanceMiles(a, b) {
        a = toLL(a); b = toLL(b);
        var lat1 = a.lat * DEG2RAD, lat2 = b.lat * DEG2RAD;
        var dLat = (b.lat - a.lat) * DEG2RAD;
        var dLon = (b.lon - a.lon) * DEG2RAD;
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
              + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
    }

    function bearingDeg(a, b) {
        a = toLL(a); b = toLL(b);
        var lat1 = a.lat * DEG2RAD, lat2 = b.lat * DEG2RAD;
        var dLon = (b.lon - a.lon) * DEG2RAD;
        var y = Math.sin(dLon) * Math.cos(lat2);
        var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        var br = Math.atan2(y, x) * 180 / Math.PI;
        return (br + 360) % 360;
    }

    function roundTo45(deg) {
        var r = Math.round(deg / 45) * 45;
        if (r === 0) r = 360;
        return r;
    }

    function citiesInPolygon(cities, ring) {
        var out = [];
        for (var i = 0; i < cities.length; i++) {
            var c = cities[i];
            if (Intersect.pointInRing([c.lon, c.lat], ring)) out.push(c);
        }
        return out;
    }

    function nearestCity(cities, point, minPop) {
        minPop = minPop || 0;
        var best = null, bestD = Infinity;
        for (var i = 0; i < cities.length; i++) {
            var c = cities[i];
            if (c.pop < minPop) continue;
            var d = distanceMiles(c, point);
            if (d < bestD) { bestD = d; best = c; }
        }
        return best ? { city: best, distance: bestD } : null;
    }

    function toClosestPoint(city, stormPos) {
        var d = distanceMiles(city, stormPos);
        var b = bearingDeg(city, stormPos);
        return {
            name:                   city.name,
            roundedDistance:        Math.round(d),
            oppositeRoundedAzimuth: roundTo45(b)
        };
    }

    function polygonRearPoint(ring, motionFromDeg) {
        if (!ring || ring.length === 0) return null;
        var pts = ring;
        if (pts.length > 1
            && pts[0][0] === pts[pts.length - 1][0]
            && pts[0][1] === pts[pts.length - 1][1]) {
            pts = pts.slice(0, -1);
        }
        var theta = motionFromDeg * DEG2RAD;
        var ux = Math.sin(theta), uy = Math.cos(theta);

        var cLat = 0;
        for (var i = 0; i < pts.length; i++) cLat += pts[i][1];
        cLat /= pts.length;
        var mpLat = MILES_PER_DEG_LAT;
        var mpLon = MILES_PER_DEG_LAT * Math.cos(cLat * DEG2RAD);
        var bestScore = -Infinity, bestPt = null;
        for (var j = 0; j < pts.length; j++) {
            var x = pts[j][0] * mpLon;
            var y = pts[j][1] * mpLat;
            var score = x * ux + y * uy;
            if (score > bestScore) { bestScore = score; bestPt = pts[j]; }
        }
        return { lon: bestPt[0], lat: bestPt[1] };
    }

    function computePathCast(cities, ring, stormPos, stormDirFrom, speedMph, now, timeZone, opts) {
        opts = opts || {};
        var maxMinutes = opts.maxMinutes    || 45;
        var bucketMin  = opts.bucketMinutes || 5;
        var maxCities  = opts.maxCities     || 20;

        if (!ring) return { pathCast: [], otherPoints: [] };
        if (!speedMph || speedMph <= 0) {

            var everyone = citiesInPolygon(cities, ring).map(function (c) {
                return { name: c.name, partOfArea: [] };
            });
            return { pathCast: [], otherPoints: everyone };
        }

        var stormDirTo = (stormDirFrom + 180) % 360;
        var thetaRad   = stormDirTo * DEG2RAD;
        var ux = Math.sin(thetaRad);
        var uy = Math.cos(thetaRad);
        var perpX = uy, perpY = -ux;

        var mpLat = MILES_PER_DEG_LAT;
        var mpLon = MILES_PER_DEG_LAT * Math.cos(stormPos.lat * DEG2RAD);

        var pathWidth;
        if (opts.pathWidthMi != null) {
            pathWidth = opts.pathWidthMi;
        } else {
            var maxVertPerp = 0;
            for (var k = 0; k < ring.length - 1; k++) {
                var vx = (ring[k][0] - stormPos.lon) * mpLon;
                var vy = (ring[k][1] - stormPos.lat) * mpLat;
                var vperp = Math.abs(vx * perpX + vy * perpY);
                if (vperp > maxVertPerp) maxVertPerp = vperp;
            }
            pathWidth = Math.max(20, maxVertPerp + 5);
        }

        var candidates = citiesInPolygon(cities, ring);
        var hits = [];
        var other = [];

        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var dx = (c.lon - stormPos.lon) * mpLon;
            var dy = (c.lat - stormPos.lat) * mpLat;
            var along = dx * ux + dy * uy;
            var perp  = Math.abs(dx * perpX + dy * perpY);
            var minutes = along > 0 ? (along / speedMph) * 60 : -1;

            if (along < 0 || perp > pathWidth || minutes > maxMinutes) {
                other.push({ name: c.name, partOfArea: [] });
                continue;
            }
            hits.push({ city: c, minutes: minutes });
        }

        hits.sort(function (a, b) { return a.minutes - b.minutes; });
        hits = hits.slice(0, maxCities);

        var bucketsByBin = {};
        var binOrder = [];
        hits.forEach(function (h) {
            var bin = Math.round(h.minutes / bucketMin) * bucketMin;
            if (!bucketsByBin[bin]) {
                bucketsByBin[bin] = [];
                binOrder.push(bin);
            }
            bucketsByBin[bin].push({ name: h.city.name, partOfArea: [] });
        });
        binOrder.sort(function (a, b) { return a - b; });

        var baseMs = now.getTime();
        var pathCast = binOrder.map(function (bin) {
            return {
                time:     new Date(baseMs + bin * 60000),
                timeZone: timeZone,
                points:   bucketsByBin[bin]
            };
        });

        return { pathCast: pathCast, otherPoints: other };
    }

    function polygonCentroid(ring) {
        if (!ring || ring.length === 0) return null;

        var pts = ring;
        if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
            pts = pts.slice(0, -1);
        }
        var sx = 0, sy = 0;
        for (var i = 0; i < pts.length; i++) {
            sx += pts[i][0];
            sy += pts[i][1];
        }
        return { lon: sx / pts.length, lat: sy / pts.length };
    }

    function guessMotionToDeg(ring) {
        if (!ring || ring.length < 3) return 45;
        var centroid = polygonCentroid(ring);
        var maxD = -1, tip = null;
        var pts = ring;
        if (pts.length > 1
            && pts[0][0] === pts[pts.length - 1][0]
            && pts[0][1] === pts[pts.length - 1][1]) {
            pts = pts.slice(0, -1);
        }
        for (var i = 0; i < pts.length; i++) {
            var d = distanceMiles({ lon: pts[i][0], lat: pts[i][1] }, centroid);
            if (d > maxD) { maxD = d; tip = pts[i]; }
        }
        if (!tip) return 45;
        return bearingDeg(centroid, { lon: tip[0], lat: tip[1] });
    }

    return {
        distanceMiles:    distanceMiles,
        bearingDeg:       bearingDeg,
        roundTo45:        roundTo45,
        citiesInPolygon:  citiesInPolygon,
        nearestCity:      nearestCity,
        toClosestPoint:   toClosestPoint,
        computePathCast:  computePathCast,
        polygonCentroid:  polygonCentroid,
        polygonRearPoint: polygonRearPoint,
        guessMotionToDeg: guessMotionToDeg
    };
}));
