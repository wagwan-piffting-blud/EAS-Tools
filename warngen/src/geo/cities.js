


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

    // AbstractDbSourceDataAdaptor/DbAreaSourceDataAdaptor/GisUtil constants.
    var INCLUSION_PERCENT         = 1;
    var PORTION_TOLERANCE         = 0.60;
    var DIRECTION_DELTA           = 15;
    var CLOSEST_SEARCH_MILES      = 100;

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

    function destinationPoint(a, bearing, miles) {
        a = toLL(a);
        var d = miles / EARTH_RADIUS_MI;
        var br = bearing * DEG2RAD;
        var lat1 = a.lat * DEG2RAD, lon1 = a.lon * DEG2RAD;
        var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
        var lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1),
                                     Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
        return { lon: lon2 / DEG2RAD, lat: lat2 / DEG2RAD };
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

    // WARNGENLEV filter from the geospatialConfig pointSources. Points without a lev pass,
    // so a dataset that predates it still works.
    function withLevel(cities, levels) {
        return cities.filter(function (c) { return c.lev == null || levels.indexOf(c.lev) !== -1; });
    }

    function outlineFeature(c) {
        if (!c.rings) return null;
        if (!c._feature) {
            c._feature = {
                geometry: {
                    type: "MultiPolygon",
                    coordinates: c.rings.map(function (r) { return [r]; })
                }
            };
            var b = [Infinity, Infinity, -Infinity, -Infinity];
            c.rings.forEach(function (r) {
                var rb = Intersect.bbox(r);
                if (rb[0] < b[0]) b[0] = rb[0];
                if (rb[1] < b[1]) b[1] = rb[1];
                if (rb[2] > b[2]) b[2] = rb[2];
                if (rb[3] > b[3]) b[3] = rb[3];
            });
            c._bbox = b;
        }
        return c._feature;
    }

    function suppressDirections(dirs, supdirs) {
        if (!supdirs) return dirs;
        var drop = { n: "NORTH", s: "SOUTH", e: "EAST", w: "WEST" };
        return dirs.filter(function (d) {
            for (var i = 0; i < supdirs.length; i++) {
                if (drop[supdirs.charAt(i)] === d) return false;
            }
            return true;
        });
    }

    /*
     * WarnGen's AREA-type point sources: a place counts when at least INCLUSION_PERCENT of
     * its outline is inside the polygon. Places flagged usedirs that are only partly
     * covered get a partOfArea (the "southwestern Lawton" wording). Places without an
     * outline fall back to their point.
     */
    function placesInPolygon(cities, ring) {
        var rb = Intersect.bbox(ring);
        var out = [];
        for (var i = 0; i < cities.length; i++) {
            var c = cities[i];
            var feat = outlineFeature(c);
            if (!feat) {
                if (Intersect.pointInRing([c.lon, c.lat], ring)) out.push(c);
                continue;
            }
            var b = c._bbox;
            if (b[2] < rb[0] || b[0] > rb[2] || b[3] < rb[1] || b[1] > rb[3]) continue;
            var ratio = Intersect.overlapRatio(ring, feat, 20);
            if (ratio <= 0 || ratio * 100 < INCLUSION_PERCENT) continue;
            if (!c.ud || ratio >= PORTION_TOLERANCE) {
                out.push(c);
                continue;
            }
            var dirs = Intersect.directionalSubdivision(ring, feat, { majorityThreshold: PORTION_TOLERANCE })
                .filter(function (d) { return d !== "CENTRAL" && d !== "EXTREME"; });
            dirs = suppressDirections(dirs, c.sd);
            if (!dirs.length) {
                out.push(c);
                continue;
            }
            var copy = Object.create(c);
            copy.partOfArea = dirs;
            out.push(copy);
        }
        return out;
    }

    function ringContaining(point, rings) {
        for (var i = 0; i < rings.length; i++) {
            if (Intersect.pointInRing([point.lon, point.lat], rings[i])) return rings[i];
        }
        return null;
    }

    // GisUtil.calculateLocationPortion: where in a usedirs place the storm sits.
    function locationPortion(ring, point) {
        var b = Intersect.bbox(ring);
        var az = bearingDeg({ lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 }, point);
        if (az > 180) az -= 360;
        var dirs = [];
        if (Math.abs(az) < 90 - DIRECTION_DELTA) dirs.push("NORTH");
        else if (Math.abs(az) > 90 + DIRECTION_DELTA) dirs.push("SOUTH");
        if (az < 180 - DIRECTION_DELTA && az > DIRECTION_DELTA) dirs.push("EAST");
        else if (az < -DIRECTION_DELTA && az > DIRECTION_DELTA - 180) dirs.push("WEST");
        return dirs;
    }

    // Distance from the storm to a place, zero when the storm is inside a usedirs outline.
    function distanceTo(c, point) {
        if (c.ud && c.rings) {
            var ring = ringContaining(point, c.rings);
            if (ring) return { distance: 0, partOfArea: suppressDirections(locationPortion(ring, point), c.sd) };
        }
        return { distance: distanceMiles(c, point), partOfArea: null };
    }

    // ClosestPointComparator: sortBy distance, warngenlev, population.
    function compareClosest(a, b) {
        return (a.distance - b.distance)
            || ((a.city.lev || 0) - (b.city.lev || 0))
            || ((b.city.pop || 0) - (a.city.pop || 0));
    }

    // Runs on every map-cursor move over ~31k places, so it allocates nothing per place and
    // skips anything whose latitude gap alone already exceeds the best distance.
    function nearestCity(cities, point, minPop) {
        minPop = minPop || 0;
        var best = null, bestD = Infinity, bestPart = null;
        for (var i = 0; i < cities.length; i++) {
            var c = cities[i];
            if (c.pop < minPop) continue;
            if (Math.abs(c.lat - point.lat) * MILES_PER_DEG_LAT > bestD) continue;
            var d, part = null;
            if (c.ud && c.rings) {
                var r = distanceTo(c, point);
                d = r.distance;
                part = r.partOfArea;
            } else {
                d = distanceMiles(c, point);
            }
            if (d < bestD || (d === bestD && best
                    && (((c.lev || 0) - (best.lev || 0)) || ((best.pop || 0) - (c.pop || 0))) < 0)) {
                best = c;
                bestD = d;
                bestPart = part;
            }
        }
        return best ? { city: best, distance: bestD, partOfArea: bestPart } : null;
    }

    // Wx.createClosestPoint truncates (int) rather than rounding.
    function toClosestPoint(city, stormPos, distance, partOfArea) {
        var d = distance != null ? distance : distanceMiles(city, stormPos);
        var b = bearingDeg(stormPos, city);
        var cp = {
            name:                   city.name,
            distance:               d,
            roundedDistance:        Math.floor(d),
            oppositeRoundedAzimuth: roundTo45(b)
        };
        if (partOfArea && partOfArea.length) cp.partOfArea = partOfArea;
        return cp;
    }

    function nearbyCandidates(cities, vertices, miles) {
        var minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
        vertices.forEach(function (v) {
            if (v.lat < minLat) minLat = v.lat;
            if (v.lat > maxLat) maxLat = v.lat;
            if (v.lon < minLon) minLon = v.lon;
            if (v.lon > maxLon) maxLon = v.lon;
        });
        var dLat = miles / MILES_PER_DEG_LAT;
        var dLon = miles / (MILES_PER_DEG_LAT * Math.max(0.2, Math.cos(((minLat + maxLat) / 2) * DEG2RAD)));
        return cities.filter(function (c) {
            return c.lat >= minLat - dLat && c.lat <= maxLat + dLat
                && c.lon >= minLon - dLon && c.lon <= maxLon + dLon;
        });
    }

    function sameClosest(a, b) {
        return a.city.name === b.city.name && a.city.lat === b.city.lat && a.city.lon === b.city.lon;
    }

    /*
     * Wx.getClosestPoints for a line of storms: one sorted list per vertex, then a point
     * that shows up near several vertices stays only with the vertex it is closest to, and
     * each list is cut to maxCount. The template's #lineOfStorms walks the result.
     */
    function closestPointsForLine(cities, vertices, maxCount, thresholdMiles) {
        thresholdMiles = thresholdMiles || CLOSEST_SEARCH_MILES;
        var pool = nearbyCandidates(cities, vertices, thresholdMiles);
        var lists = vertices.map(function (v) {
            var pts = [];
            for (var i = 0; i < pool.length; i++) {
                var d = distanceTo(pool[i], v);
                if (d.distance <= thresholdMiles) {
                    pts.push({ city: pool[i], distance: d.distance, partOfArea: d.partOfArea, vertex: v });
                }
            }
            pts.sort(compareClosest);
            return pts;
        });

        var queue = lists.slice();
        while (queue.length) {
            var pts = queue.shift();
            var maxIndex = Math.min(pts.length, maxCount);
            for (var i = 0; i < maxIndex; i++) {
                var cp = pts[i];
                for (var q = 0; q < queue.length; q++) {
                    var other = queue[q];
                    var foundAt = -1;
                    for (var k = 0; k < other.length && k < maxCount; k++) {
                        if (sameClosest(cp, other[k])) { foundAt = k; break; }
                    }
                    if (foundAt === -1) continue;
                    if (other[foundAt].distance < cp.distance) {
                        pts.splice(i, 1);
                        i--;
                        if (pts.length < maxIndex) maxIndex--;
                        break;
                    }
                    other.splice(foundAt, 1);
                }
            }
            if (pts.length > maxIndex) pts.length = maxIndex;
        }

        return lists.map(function (pts) {
            return pts.map(function (p) {
                return toClosestPoint(p.city, p.vertex, p.distance, p.partOfArea);
            });
        });
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

    /*
     * A default line of storms like CAVE's two-point drag-me line: perpendicular to the
     * motion, across the rear of the polygon, spanning its width across the track.
     */
    function polygonStormLine(ring, stormPos, motionFromDeg) {
        if (!ring || ring.length < 4) return null;
        var origin = polygonCentroid(ring);
        var mpLat = MILES_PER_DEG_LAT;
        var mpLon = MILES_PER_DEG_LAT * Math.cos(origin.lat * DEG2RAD);
        var theta = ((motionFromDeg + 180) % 360) * DEG2RAD;
        var ux = Math.sin(theta), uy = Math.cos(theta);
        var px = uy, py = -ux;
        var aLo = Infinity, aHi = -Infinity, pLo = Infinity, pHi = -Infinity;
        for (var i = 0; i < ring.length - 1; i++) {
            var x = (ring[i][0] - origin.lon) * mpLon;
            var y = (ring[i][1] - origin.lat) * mpLat;
            var a = x * ux + y * uy;
            var p = x * px + y * py;
            if (a < aLo) aLo = a;
            if (a > aHi) aHi = a;
            if (p < pLo) pLo = p;
            if (p > pHi) pHi = p;
        }
        var along = aLo + 0.15 * (aHi - aLo);
        var inset = 0.15 * (pHi - pLo);
        function at(p) {
            var x = along * ux + p * px;
            var y = along * uy + p * py;
            return { lon: origin.lon + x / mpLon, lat: origin.lat + y / mpLat };
        }
        return [at(pLo + inset), at(pHi - inset)];
    }

    /*
     * Along-track distance from the storm (a point, or a line of storms) to a city, and the
     * cross-track miss. For a line, the city is measured against the stretch of the line
     * directly upstream of it; beyond the ends the nearest end stands in.
     */
    function trackOffsets(c, stormPos, stormLine, ux, uy, mpLon, mpLat) {
        var dx = (c.lon - stormPos.lon) * mpLon;
        var dy = (c.lat - stormPos.lat) * mpLat;
        var along = dx * ux + dy * uy;
        var perp = dx * uy - dy * ux;
        if (!stormLine || stormLine.length < 2) return { along: along, perp: Math.abs(perp) };

        var verts = stormLine.map(function (v) {
            var vx = (v.lon - stormPos.lon) * mpLon;
            var vy = (v.lat - stormPos.lat) * mpLat;
            return { along: vx * ux + vy * uy, perp: vx * uy - vy * ux };
        }).sort(function (a, b) { return a.perp - b.perp; });

        var first = verts[0], last = verts[verts.length - 1];
        if (perp <= first.perp) return { along: along - first.along, perp: first.perp - perp };
        if (perp >= last.perp) return { along: along - last.along, perp: perp - last.perp };
        for (var i = 0; i < verts.length - 1; i++) {
            var a = verts[i], b = verts[i + 1];
            if (perp >= a.perp && perp <= b.perp) {
                var t = b.perp === a.perp ? 0 : (perp - a.perp) / (b.perp - a.perp);
                return { along: along - (a.along + t * (b.along - a.along)), perp: 0 };
            }
        }
        return { along: along, perp: 0 };
    }

    // geospatialConfig_*.xml <pathcastConfig>; the same in COUNTY and ZONE.
    var PATHCAST = {
        distanceThreshold:    4.0,
        distanceThresholdLOS: 4.0,
        intervalMin:          5,
        deltaMin:             5,
        maxResults:           10,
        maxGroup:             8,
        inclusionPercent:     1
    };

    function segDist(px, py, ax, ay, bx, by) {
        var dx = bx - ax, dy = by - ay;
        var len = dx * dx + dy * dy;
        var t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
        var ex = px - (ax + t * dx), ey = py - (ay + t * dy);
        return Math.sqrt(ex * ex + ey * ey);
    }

    function inPolyXY(x, y, poly) {
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }

    function nearPolyXY(x, y, poly, r) {
        if (inPolyXY(x, y, poly)) return true;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            if (segDist(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]) <= r) return true;
        }
        return false;
    }

    /*
     * Wx.pathcast ported. Works in a local plane in miles; the JTS polygons become
     * point-inside tests, and a place (its warngenloc outline, or its point) is sampled
     * on a grid wherever JTS would intersect or measure area.
     *
     * stormPts is one point, or the vertices of a line of storms. toDeg is the direction
     * of motion. stormTime is "now" in Wx (the time the text is built); stopTime is the
     * warning expiration. Returns [{ time, timeZone, points: [{ name, partOfArea }] }].
     */
    function awipsPathCast(places, ring, stormPts, toDeg, speedMph, stormTime, stopTime, timeZone, config) {
        if (!ring || ring.length < 4 || !stormPts || !stormPts.length) return [];
        var PC = Object.assign({}, PATHCAST, config || {});
        var lat0 = stormPts[0].lat, lon0 = stormPts[0].lon;
        var kx = MILES_PER_DEG_LAT * Math.cos(lat0 * DEG2RAD);
        function xy(lon, lat) { return [(lon - lon0) * kx, (lat - lat0) * MILES_PER_DEG_LAT]; }
        var poly = ring.map(function (p) { return xy(p[0], p[1]); });

        var ux = Math.sin(toDeg * DEG2RAD), uy = Math.cos(toDeg * DEG2RAD);
        var px = uy, py = -ux;
        var locs = stormPts.map(function (p) { return xy(p.lon, p.lat); });
        function move(c, d) { return [c[0] + ux * d, c[1] + uy * d]; }
        function side(c, d) { return [c[0] + px * d, c[1] + py * d]; }

        var lineOfStorms = locs.length > 1;
        var T = lineOfStorms ? PC.distanceThresholdLOS : PC.distanceThreshold;
        var intervalMs = PC.intervalMin * 60000;
        var stormMs = stormTime.getTime(), stopMs = stopTime.getTime();
        var mpm = speedMph / 60000 / 60;

        var casts = [];
        var areaTest;
        if (speedMph > 0) {
            var t0 = stormMs + PC.deltaMin * 60000;
            var lower = t0 - (t0 % intervalMs);
            var start = (t0 - lower > lower + intervalMs - t0) ? lower + intervalMs : lower;
            var deltaDistance = mpm * (start - stormMs);
            var intervalDistance = mpm * intervalMs;
            var distanceOfExpiration = mpm * (stopMs - start);

            if (!lineOfStorms) {
                var loc = locs[0];
                var c1first = move(loc, mpm * (start - stormMs) - intervalDistance / 2);
                var endVec = move(loc, distanceOfExpiration + intervalDistance);
                var rect = [side(c1first, T), side(endVec, T), side(endVec, -T), side(c1first, -T)];
                areaTest = function (x, y) { return inPolyXY(x, y, rect); };
            } else {
                var startBound = locs.map(function (v) { return move(v, (deltaDistance - intervalDistance / 2) + T); });
                var endBound = locs.slice().reverse().map(function (v) {
                    return move(v, (distanceOfExpiration + intervalDistance / 2) - T);
                });
                var sweep = startBound.concat(endBound);
                areaTest = function (x, y) { return nearPolyXY(x, y, sweep, T); };
            }

            for (var instant = start, idx = 0; instant <= stopMs; instant += intervalMs, idx++) {
                var dist = mpm * (instant - stormMs) - intervalDistance / 2;
                var test;
                if (!lineOfStorms) {
                    var a = move(locs[0], dist), b = move(a, intervalDistance);
                    test = (function (a, b) {
                        return function (x, y) { return segDist(x, y, a[0], a[1], b[0], b[1]) <= T; };
                    })(a, b);
                } else {
                    var b1 = locs.map(function (v) { return move(v, dist); });
                    var b2 = b1.map(function (v) { return move(v, intervalDistance); }).reverse();
                    var band = b1.concat(b2);
                    test = (function (band) {
                        return function (x, y) { return nearPolyXY(x, y, band, T); };
                    })(band);
                }
                casts.push({ time: new Date(instant), index: idx, test: test });
            }
        } else {
            areaTest = function () { return true; };
            casts.push({ time: new Date(stormMs), index: 0, test: function () { return true; } });
        }

        // withinPolygon: every returned point must lie inside the warning polygon.
        function inArea(x, y) { return inPolyXY(x, y, poly) && areaTest(x, y); }

        var pb = Intersect.bbox(ring);
        var candidates = [];
        places.forEach(function (c) {
            var parts = c.rings && c.rings.length ? c.rings : null;
            if (parts) {
                outlineFeature(c);
                var b = c._bbox;
                if (b[2] < pb[0] || b[0] > pb[2] || b[3] < pb[1] || b[1] > pb[3]) return;
            } else if (c.lon < pb[0] || c.lon > pb[2] || c.lat < pb[1] || c.lat > pb[3]) {
                return;
            }
            var samples = [];
            if (parts) {
                parts.forEach(function (r) {
                    var rb = Intersect.bbox(r);
                    var n = 12;
                    for (var i = 0; i < n; i++) {
                        for (var j = 0; j < n; j++) {
                            var sx = rb[0] + (i + 0.5) * (rb[2] - rb[0]) / n;
                            var sy = rb[1] + (j + 0.5) * (rb[3] - rb[1]) / n;
                            if (Intersect.pointInRing([sx, sy], r)) samples.push(xy(sx, sy));
                        }
                    }
                    if (!samples.length) r.forEach(function (q) { samples.push(xy(q[0], q[1])); });
                });
            } else {
                samples.push(xy(c.lon, c.lat));
            }
            var inside = samples.filter(function (s) { return inArea(s[0], s[1]); });
            if (!inside.length) return;
            if (parts && (100 * inside.length / samples.length) < PC.inclusionPercent) return;
            candidates.push({ city: c, samples: samples, inside: inside });
        });

        var perCast = casts.map(function (pc) {
            var pts = candidates.filter(function (cand) {
                return cand.inside.some(function (s) { return pc.test(s[0], s[1]); });
            });
            pts.sort(function (a, b) {
                return ((a.city.lev || 0) - (b.city.lev || 0)) || ((b.city.pop || 0) - (a.city.pop || 0));
            });
            return pts;
        });

        // Earliest pathcast keeps a place; later ones drop it. Then maxResults per group,
        // never repeating a place, and empty groups fall away.
        var used = new Set();
        var out = [];
        for (var k = 0; k < casts.length; k++) {
            var list = perCast[k].filter(function (cand) { return !used.has(cand.city); });
            var chosen = list.slice(0, PC.maxResults);
            chosen.forEach(function (cand) { used.add(cand.city); });
            if (!chosen.length) continue;
            out.push({
                time: casts[k].time,
                timeZone: timeZone,
                points: chosen.map(function (cand) {
                    return { name: cand.city.name, partOfArea: pathcastPortion(cand) };
                })
            });
        }
        return out.slice(0, PC.maxGroup);

        // DbAreaSourceDataAdaptor.getPartOfArea against the pathcast search area.
        function pathcastPortion(cand) {
            var c = cand.city;
            if (!c.ud || !c.rings) return [];
            var frac = cand.inside.length / cand.samples.length;
            if (frac >= PORTION_TOLERANCE || frac >= 1) return [];
            var mx = 0, my = 0;
            cand.inside.forEach(function (s) { mx += s[0]; my += s[1]; });
            mx /= cand.inside.length;
            my /= cand.inside.length;
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            cand.samples.forEach(function (s) {
                if (s[0] < minX) minX = s[0];
                if (s[0] > maxX) maxX = s[0];
                if (s[1] < minY) minY = s[1];
                if (s[1] > maxY) maxY = s[1];
            });
            var hw = (maxX - minX) / 2, hh = (maxY - minY) / 2;
            if (hw <= 0 || hh <= 0) return [];
            var ox = (mx - (minX + maxX) / 2) / hw, oy = (my - (minY + maxY) / 2) / hh;
            var dirs = [];
            if (Math.abs(oy) >= 0.33) dirs.push(oy > 0 ? "NORTH" : "SOUTH");
            if (Math.abs(ox) >= 0.33) dirs.push(ox > 0 ? "EAST" : "WEST");
            return suppressDirections(dirs, c.sd);
        }
    }

    function computePathCast(cities, ring, stormPos, stormDirFrom, speedMph, now, timeZone, opts) {
        opts = opts || {};
        var maxMinutes = opts.maxMinutes    || 45;
        var bucketMin  = opts.bucketMinutes || 5;
        var maxCities  = opts.maxCities     || 20;
        var stormLine  = opts.stormLine     || null;

        if (!ring) return { pathCast: [], otherPoints: [] };
        var candidates = opts.candidates || citiesInPolygon(cities, ring);
        function entry(c) {
            return { name: c.name, partOfArea: c.partOfArea || [] };
        }
        if (!speedMph || speedMph <= 0) {
            return { pathCast: [], otherPoints: candidates.map(entry) };
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
        } else if (stormLine && stormLine.length > 1) {
            pathWidth = 4;
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

        var hits = [];
        var other = [];

        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var off = trackOffsets(c, stormPos, stormLine, ux, uy, mpLon, mpLat);
            var minutes = off.along > 0 ? (off.along / speedMph) * 60 : -1;

            if (off.along < 0 || off.perp > pathWidth || minutes > maxMinutes) {
                other.push(entry(c));
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
            bucketsByBin[bin].push(entry(h.city));
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
        distanceMiles:        distanceMiles,
        bearingDeg:           bearingDeg,
        destinationPoint:     destinationPoint,
        roundTo45:            roundTo45,
        citiesInPolygon:      citiesInPolygon,
        placesInPolygon:      placesInPolygon,
        withLevel:            withLevel,
        nearestCity:          nearestCity,
        toClosestPoint:       toClosestPoint,
        closestPointsForLine: closestPointsForLine,
        computePathCast:      computePathCast,
        awipsPathCast:        awipsPathCast,
        polygonCentroid:      polygonCentroid,
        polygonRearPoint:     polygonRearPoint,
        polygonStormLine:     polygonStormLine,
        guessMotionToDeg:     guessMotionToDeg
    };
}));
