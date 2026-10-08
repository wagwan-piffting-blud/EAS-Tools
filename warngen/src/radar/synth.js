(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenRadarSynth = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    /**
     * Synthetic NEXRAD volumes for people without Level II files. The result has the same shape
     * WarngenLevel2.parse returns, so the radar layer, tilt/product pickers, probe and color tables
     * treat it like real data. Storms are built in storm-relative kilometres (x along the storm
     * motion, y to its left, z above the radar) and sampled at each gate's beam height.
     */

    var EARTH_RADIUS = 6371000;
    var EFFECTIVE_RADIUS = EARTH_RADIUS * 4 / 3;
    var DEG = Math.PI / 180;
    var MPH_TO_MPS = 0.44704;

    var RADIALS = 720;
    var GATES = 920;
    var FIRST_GATE = 2125;
    var GATE_SPACING = 250;
    var MAX_STORM_RANGE = 220000;
    var ELEVATIONS = [0.5, 0.9, 1.3, 1.8, 2.4, 3.1];
    var SWEEP_MS = 13000;
    var VCP = 212;
    var ECHO_FLOOR_DBZ = 10;

    var MOMENTS = ["REF", "VEL", "SW", "ZDR", "RHO"];
    var ENCODING = {
        REF: { scale: 2, offset: 66 },
        VEL: { scale: 2, offset: 129 },
        SW: { scale: 2, offset: 129 },
        ZDR: { scale: 16, offset: 128 },
        RHO: { scale: 300, offset: -60.5 }
    };

    var INTENSITY = {
        weak: { db: -6, top: 10, wind: 0.65 },
        moderate: { db: 0, top: 13, wind: 1 },
        strong: { db: 5, top: 15.5, wind: 1.3 }
    };

    var TYPES = {
        supercell: "classic supercell",
        qlcs: "QLCS / bow echo"
    };

    function hash2(ix, iy, seed) {
        var h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }

    function valueNoise(x, y, seed) {
        var ix = Math.floor(x);
        var iy = Math.floor(y);
        var fx = x - ix;
        var fy = y - iy;
        var sx = fx * fx * (3 - 2 * fx);
        var sy = fy * fy * (3 - 2 * fy);
        var a = hash2(ix, iy, seed);
        var b = hash2(ix + 1, iy, seed);
        var c = hash2(ix, iy + 1, seed);
        var d = hash2(ix + 1, iy + 1, seed);
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }

    // Fractal noise in [-1, 1].
    function fbm(x, y, seed) {
        var sum = 0;
        var amp = 0.5;
        var norm = 0;
        for (var o = 0; o < 3; o++) {
            sum += (valueNoise(x, y, seed + o * 1013) * 2 - 1) * amp;
            norm += amp;
            x *= 2.03;
            y *= 2.03;
            amp *= 0.5;
        }
        return sum / norm;
    }

    function toLinear(dbz) {
        return Math.pow(10, dbz / 10);
    }

    function gauss(d2, sigma) {
        return Math.exp(-d2 / (2 * sigma * sigma));
    }

    // Rankine vortex, cyclonic (counterclockwise) in the right-handed storm frame.
    function addVortex(out, x, y, cx, cy, radius, vmax, weight) {
        if (!weight) return 0;
        var dx = x - cx;
        var dy = y - cy;
        var r = Math.sqrt(dx * dx + dy * dy);
        if (r < 1e-6) return 0;
        var vt = (r < radius ? vmax * r / radius : vmax * radius / r) * Math.exp(-Math.pow(r / (radius * 8), 2)) * weight;
        out.u += -vt * dy / r;
        out.v += vt * dx / r;
        return r;
    }

    // Ground-relative environmental wind in the storm frame: backed and slower near the ground,
    // veering and strengthening with height.
    function addEnvironment(out, z, motion) {
        var angle = (60 - 9 * z) * DEG;
        var speed = motion * (0.35 + 0.15 * Math.min(z, 12)) + 3;
        out.u += speed * Math.cos(angle);
        out.v += speed * Math.sin(angle);
    }

    function polishDualPol(out, z, seed, x, y) {
        var dbz = out.dbz;
        var n = fbm(x * 0.7 + 31, y * 0.7 - 17, seed + 41);
        var rho = 0.985 + 0.008 * n;
        if (dbz > 52) rho -= (dbz - 52) * 0.007;
        if (dbz < 22) rho -= (22 - dbz) * 0.006 + 0.02 * Math.abs(n);
        rho -= 0.045 * Math.exp(-Math.pow((z - 3.8) / 0.35, 2));
        var zdr;
        if (z > 4.3) {
            zdr = 0.2 + 0.25 * n;
        } else {
            zdr = Math.max(0.2, Math.min(3.2, 0.4 + 0.07 * (dbz - 20))) + 0.3 * n;
            if (dbz > 56) zdr = 0.3 + 0.4 * n;
        }
        out.rho = rho;
        out.zdr = zdr;
    }

    function blendDebris(out, weight, seed, x, y) {
        if (weight < 0.01) return;
        var n = fbm(x * 3 + 5, y * 3 - 9, seed + 77);
        out.rho = out.rho * (1 - weight) + (0.74 + 0.05 * n) * weight;
        out.zdr = out.zdr * (1 - weight) + (0.1 + 0.6 * n) * weight;
    }

    function finishReflectivity(out, linear, x, y, z, seed) {
        if (linear <= 0) return false;
        var dbz = 10 * Math.log10(linear);
        dbz += 4 * fbm(x / 6 + z * 0.08, y / 6, seed) + 2 * fbm(x * 0.9, y * 0.9 + z * 0.3, seed + 7);
        if (dbz < 38) dbz += (38 - dbz) * 0.45 * fbm(x / 2.5 - z * 0.1, y / 2.5, seed + 23);
        if (dbz < ECHO_FLOOR_DBZ) return false;
        out.dbz = dbz;
        return true;
    }

    // Soft edge: 0 dB inside [lo, hi], falling off quadratically outside it.
    function band(value, lo, hi, falloff) {
        if (value < lo) return -falloff * (lo - value) * (lo - value);
        if (value > hi) return -falloff * (value - hi) * (value - hi);
        return 0;
    }

    function addTexture(out, x, y, z, seed, amp) {
        var vn = fbm(x * 0.6 - 3, y * 0.6 + z * 0.2, seed + 13);
        out.u += amp * vn + 2.5 * fbm(x / 9, y / 9 + z * 0.1, seed + 19);
        out.v += amp * fbm(x * 0.6 + 9, y * 0.6 - z * 0.2, seed + 17) + 2.5 * fbm(x / 9 + 4, y / 9, seed + 29);
        return vn;
    }

    function supercellModel(p) {
        var k = p.intensity;
        var seed = p.seed;
        var motion = p.motionMps;
        var meso0 = { x: -10, y: -9 };
        var hookStart = 8.0;
        var hookEnd = p.tornadic ? 0.8 : 2.2;

        function mesoAt(z) {
            return { x: meso0.x + 0.35 * z, y: meso0.y + 0.3 * z };
        }

        function sample(x, y, z, out) {
            var aloft = Math.max(0, z - k.top);
            var m = mesoAt(z);

            var cx = 0.5 * z;
            var cy = -0.45 * Math.max(0, z - 3);
            var core = 62 + k.db - 6 * ((x - cx) * (x - cx) / 36 + (y - cy) * (y - cy) / 16) - aloft * 14;
            var linear = toLinear(core);

            var a = (x + 3) / 45;
            var yff = 3 + 8 * Math.max(0, a);
            var wff = 4.5 + 7 * Math.max(0, a);
            var ff = 48 + k.db - 20 * Math.max(0, Math.min(1, a)) - 8 * Math.pow((y - yff) / wff, 2) +
                band(a, 0, 1, 60) - (a < 0 ? 190 * a * a : 0) - Math.max(0, z - 7) * 8;
            linear += toLinear(ff);

            if (z > 5) {
                var b = x / 65;
                var anvil = 27 + k.db / 2 - 12 * Math.max(0, Math.min(1, b)) - 6 * Math.pow((y - 5) / (10 + 8 * Math.max(0, b)), 2) +
                    band(b, 0, 1, 50) - aloft * 10 + band(z, 8, 40, 4);
                linear += toLinear(anvil);
            }

            var notchWeight = z < 3 ? 1 : Math.exp(-Math.pow((z - 3) / 0.7, 2));
            var nx = m.x + 6 * Math.cos(-10 * DEG);
            var ny = m.y + 6 * Math.sin(-10 * DEG);
            linear *= 1 - 0.995 * notchWeight * gauss((x - nx) * (x - nx) + (y - ny) * (y - ny), 2.8);

            var ux = m.x + 3.5;
            var uy = m.y + 1.6;
            linear *= 1 - 0.97 * Math.exp(-Math.pow((z - 4.5) / 2, 2)) * gauss((x - ux) * (x - ux) + (y - uy) * (y - uy), 2.5);

            var hx = x - m.x;
            var hy = y - m.y;
            var hr = Math.sqrt(hx * hx + hy * hy);
            if (z < 6) {
                var phi = Math.atan2(hy, hx) / DEG;
                var t = ((phi - 40) % 360 + 360) % 360 / 290;
                if (t <= 1) {
                    var rh = hookStart - (hookStart - hookEnd) * t;
                    var w = 2.4 - 1.2 * t;
                    var hook = 52 + k.db - 8 * t - 8 * Math.pow((hr - rh) / w, 2) - Math.max(0, z - 2.5) * 10;
                    linear += toLinear(hook);
                }
            }

            var debrisWeight = 0;
            if (p.tornadic && z < 4) {
                var vert = z < 2 ? 1 : Math.exp(-Math.pow((z - 2) / 0.6, 2));
                linear += toLinear(59 + k.db / 2 - 10 * Math.pow(hr / 1.0, 2)) * vert;
                debrisWeight = Math.exp(-Math.pow(hr / 1.0, 2)) * vert;
            }

            if (!finishReflectivity(out, linear, x, y, z, seed)) return false;

            out.u = 0;
            out.v = 0;
            addEnvironment(out, z, motion);
            var mesoWeight = Math.exp(-Math.pow((z - 4) / 4.5, 2));
            var rm = addVortex(out, x, y, m.x, m.y, 3.5, 26 * k.wind, mesoWeight);
            var rt = 99;
            if (p.tornadic && z < 4) {
                rt = addVortex(out, x, y, m.x, m.y, 0.4, 42 * k.wind, z < 2.5 ? 1 : Math.exp(-Math.pow((z - 2.5) / 0.6, 2)));
            }
            if (z < 3) {
                var rx = m.x - 4.5;
                var ry = m.y - 1.5;
                var rfd = 12 * k.wind * gauss((x - rx) * (x - rx) + (y - ry) * (y - ry), 4);
                out.u += rfd * Math.cos(-30 * DEG);
                out.v += rfd * Math.sin(-30 * DEG);
                var ix = ux - x;
                var iy = uy - y;
                var id = Math.sqrt(ix * ix + iy * iy);
                if (id > 0.5) {
                    var inflow = 6 * k.wind * Math.exp(-Math.pow(id / 12, 2));
                    out.u += inflow * ix / id;
                    out.v += inflow * iy / id;
                }
            }
            var vn = addTexture(out, x, y, z, seed, 1.5);
            out.sw = 1.6 + 1.4 * Math.abs(vn) + 4 * Math.exp(-Math.pow(rm / 4, 2)) * mesoWeight + 9 * Math.exp(-rt * rt);

            polishDualPol(out, z, seed, x, y);
            blendDebris(out, debrisWeight, seed, x, y);
            return true;
        }

        var lowMeso = mesoAt(0.5);
        return {
            sample: sample,
            bound: { x: 20, y: 0, radius: 80000 },
            features: {
                core: { x: 0, y: 0 },
                meso: lowMeso,
                tornado: p.tornadic ? lowMeso : null
            }
        };
    }

    function qlcsModel(p) {
        var k = p.intensity;
        var seed = p.seed;
        var motion = p.motionMps;
        var half = 75;

        function linePos(y) {
            var x = 26 * Math.exp(-Math.pow(y / 20, 2)) + 3 * fbm(y / 12, 3.7, seed + 3);
            if (y > 0.6 * half) x -= Math.pow((y - 0.6 * half) / (0.4 * half), 2) * 25;
            if (y < -0.7 * half) x -= Math.pow((-y - 0.7 * half) / (0.3 * half), 2) * 10;
            return x;
        }

        var apexX = linePos(0);
        var vortex = { x: apexX - 2, y: 5 };
        var bookend = { x: linePos(0.75 * half) - 18, y: 0.75 * half };

        function sample(x, y, z, out) {
            var aloft = Math.max(0, z - (k.top - 1));
            var xl = linePos(y);
            var dx = x - xl;
            var ends = band(Math.abs(y), 0, half, 0.02) - Math.max(0, Math.abs(y) - half) * 0.6;

            var cell = 55 + k.db + 7 * fbm(y / 5, z * 0.2, seed + 5) + ends - aloft * 14;
            var conv = cell - 6 * Math.pow(dx / (dx > 0 ? 2.2 : 7), 2);
            var linear = toLinear(conv);

            var s = Math.max(0, -dx - 6);
            var strat = 31 + k.db / 2 - 10 * Math.pow(s / 55, 2) + ends;
            strat -= 10 * Math.exp(-Math.pow((dx + 12) / 4, 2));
            strat += 5 * Math.exp(-Math.pow((z - 3.6) / 0.4, 2));
            strat -= Math.max(0, z - 7) * 8;
            var sl = toLinear(strat) / (1 + Math.exp((dx + 5) / 1.5));
            sl *= 1 - 0.95 * Math.exp(-Math.pow(y / 10, 2)) * Math.exp(-Math.pow((dx + 22) / 12, 2));
            linear += sl;

            var hx = x - vortex.x;
            var hy = y - vortex.y;
            var hr = Math.sqrt(hx * hx + hy * hy);
            var debrisWeight = 0;
            if (p.tornadic && z < 3) {
                var vert = z < 2 ? 1 : Math.exp(-Math.pow((z - 2) / 0.5, 2));
                linear += toLinear(55 + k.db / 2 - 10 * Math.pow(hr / 0.8, 2)) * vert;
                debrisWeight = Math.exp(-Math.pow(hr / 0.9, 2)) * vert;
            }

            if (!finishReflectivity(out, linear, x, y, z, seed)) return false;

            out.u = 0;
            out.v = 0;
            addEnvironment(out, z, motion);
            var jet = 22 * k.wind * Math.exp(-Math.pow(y / 16, 2)) *
                Math.exp(-Math.pow((dx + 6 + 4 * z) / 9, 2)) * Math.exp(-Math.pow((z - 1.5) / 2.5, 2));
            out.u += jet;
            if (z > 4) out.u -= 8 * k.wind * Math.exp(-Math.pow((dx + 15) / 15, 2)) * Math.min(1, (z - 4) / 3);
            var rb = addVortex(out, x, y, bookend.x, bookend.y, 7, 16 * k.wind, z < 6 ? 1 : 0.3);
            var rt = 99;
            if (p.tornadic && z < 3.5) {
                rt = addVortex(out, x, y, vortex.x, vortex.y, 0.6, 34 * k.wind, z < 2.5 ? 1 : 0.4);
            }
            var vn = addTexture(out, x, y, z, seed, 1.5);
            out.sw = 1.8 + 1.4 * Math.abs(vn) + 3 * Math.exp(-Math.pow(dx / 3, 2)) +
                3 * Math.exp(-Math.pow(rb / 8, 2)) + 8 * Math.exp(-rt * rt);

            polishDualPol(out, z, seed, x, y);
            blendDebris(out, debrisWeight, seed, x, y);
            return true;
        }

        return {
            sample: sample,
            bound: { x: -30, y: 0, radius: 125000 },
            features: {
                core: { x: apexX, y: 0 },
                apex: { x: apexX, y: 0 },
                meso: p.tornadic ? vortex : null,
                tornado: p.tornadic ? vortex : null
            }
        };
    }

    function bearingDistance(lat1, lon1, lat2, lon2) {
        var p1 = lat1 * DEG;
        var p2 = lat2 * DEG;
        var dl = (lon2 - lon1) * DEG;
        var a = Math.sin((p2 - p1) / 2);
        var b = Math.sin(dl / 2);
        var h = a * a + Math.cos(p1) * Math.cos(p2) * b * b;
        var distance = 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
        var y = Math.sin(dl) * Math.cos(p2);
        var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
        return { bearing: (Math.atan2(y, x) / DEG + 360) % 360, distance: distance };
    }

    function destination(lat, lon, bearing, distance) {
        var d = distance / EARTH_RADIUS;
        var t = bearing * DEG;
        var p1 = lat * DEG;
        var l1 = lon * DEG;
        var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
        var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
        return { lat: p2 / DEG, lon: ((l2 / DEG + 540) % 360) - 180 };
    }

    function encode(value, enc) {
        var code = Math.round(value * enc.scale + enc.offset);
        return code < 2 ? 2 : (code > 255 ? 255 : code);
    }

    function buildSweep(sweepIndex, elevation, frame, model, startMs, last) {
        var e = elevation * DEG;
        var sinE = Math.sin(e);
        var cosE = Math.cos(e);
        var ground = new Float64Array(GATES);
        var height = new Float64Array(GATES);
        for (var g = 0; g < GATES; g++) {
            var slant = FIRST_GATE + g * GATE_SPACING;
            var h = Math.sqrt(slant * slant + EFFECTIVE_RADIUS * EFFECTIVE_RADIUS + 2 * slant * EFFECTIVE_RADIUS * sinE) - EFFECTIVE_RADIUS;
            ground[g] = EFFECTIVE_RADIUS * Math.asin(slant * cosE / (EFFECTIVE_RADIUS + h));
            height[g] = h / 1000;
        }

        var buffers = {};
        MOMENTS.forEach(function (m) { buffers[m] = new Uint8Array(RADIALS * GATES); });
        var bound = model.bound;
        var be = frame.px + (bound.x * frame.fx + bound.y * frame.lx) * 1000;
        var bn = frame.py + (bound.x * frame.fy + bound.y * frame.ly) * 1000;
        var out = { dbz: 0, u: 0, v: 0, sw: 0, zdr: 0, rho: 0 };
        var sweepStart = startMs + sweepIndex * SWEEP_MS;
        var radials = [];

        for (var i = 0; i < RADIALS; i++) {
            var azimuth = (i + 0.5) * 0.5;
            var ux = Math.sin(azimuth * DEG);
            var uy = Math.cos(azimuth * DEG);
            var along = be * ux + bn * uy;
            var perp = Math.abs(be * uy - bn * ux);
            var base = i * GATES;
            if (perp < bound.radius) {
                var reach = Math.sqrt(bound.radius * bound.radius - perp * perp);
                var s0 = along - reach;
                var s1 = along + reach;
                for (var gi = 0; gi < GATES; gi++) {
                    var s = ground[gi];
                    if (s < s0) continue;
                    if (s > s1) break;
                    var dx = s * ux - frame.px;
                    var dy = s * uy - frame.py;
                    var x = (dx * frame.fx + dy * frame.fy) / 1000;
                    var y = (dx * frame.lx + dy * frame.ly) / 1000;
                    if (!model.sample(x, y, height[gi], out)) continue;
                    var we = out.u * frame.fx + out.v * frame.lx;
                    var wn = out.u * frame.fy + out.v * frame.ly;
                    buffers.REF[base + gi] = encode(out.dbz, ENCODING.REF);
                    buffers.VEL[base + gi] = encode((we * ux + wn * uy) * cosE, ENCODING.VEL);
                    buffers.SW[base + gi] = encode(Math.max(0, out.sw), ENCODING.SW);
                    buffers.ZDR[base + gi] = encode(out.zdr, ENCODING.ZDR);
                    buffers.RHO[base + gi] = encode(Math.min(1.05, out.rho), ENCODING.RHO);
                }
            }

            var status = 1;
            if (i === 0) status = sweepIndex === 0 ? 3 : 0;
            else if (i === RADIALS - 1) status = last ? 4 : 2;
            var moments = {};
            MOMENTS.forEach(function (m) {
                moments[m] = {
                    name: m,
                    gates: GATES,
                    first: FIRST_GATE,
                    spacing: GATE_SPACING,
                    wordSize: 8,
                    scale: ENCODING[m].scale,
                    offset: ENCODING[m].offset,
                    data: buffers[m].subarray(base, base + GATES)
                };
            });
            radials.push({
                time: sweepStart + Math.round(i / RADIALS * (SWEEP_MS - 1000)),
                azimuth: azimuth,
                azimuthResolution: 0.5,
                status: status,
                elevationNumber: sweepIndex + 1,
                elevation: elevation,
                moments: moments
            });
        }

        return {
            elevationNumber: sweepIndex + 1,
            radials: radials,
            time: sweepStart,
            index: sweepIndex,
            elevation: Math.round(elevation * 10) / 10,
            moments: MOMENTS.slice()
        };
    }

    function finiteOr(value, fallback) {
        var n = Number(value);
        return isFinite(n) ? n : fallback;
    }

    /**
     * options: site {lat, lon, height?}, icao, storm {lat, lon}, motionBearing (deg, toward),
     * motionSpeedMph, type ("supercell" | "qlcs"), tornadic, intensity ("weak" | "moderate" |
     * "strong"), seed, time (Date or ms).
     */
    function generate(options) {
        options = options || {};
        var site = options.site || {};
        var storm = options.storm || {};
        if (!isFinite(site.lat) || !isFinite(site.lon)) throw new Error("The radar site needs a latitude and longitude.");
        if (!isFinite(storm.lat) || !isFinite(storm.lon)) throw new Error("The storm needs a latitude and longitude.");
        var type = TYPES[options.type] ? options.type : "supercell";
        var intensityName = INTENSITY[options.intensity] ? options.intensity : "moderate";
        var seed = finiteOr(options.seed, 1) >>> 0;
        var bearing = ((finiteOr(options.motionBearing, 45) % 360) + 360) % 360;
        var speedMph = Math.max(0, finiteOr(options.motionSpeedMph, 35));

        var bd = bearingDistance(site.lat, site.lon, storm.lat, storm.lon);
        if (bd.distance > MAX_STORM_RANGE) {
            throw new Error("The storm is " + Math.round(bd.distance / 1609.344) + " mi from the radar. Keep it within " +
                Math.floor(MAX_STORM_RANGE / 1609.344) + " mi.");
        }
        if (bd.distance < 15000) throw new Error("The storm is too close to the radar. Move it at least 10 mi away.");

        var fx = Math.sin(bearing * DEG);
        var fy = Math.cos(bearing * DEG);
        var frame = {
            px: bd.distance * Math.sin(bd.bearing * DEG),
            py: bd.distance * Math.cos(bd.bearing * DEG),
            fx: fx,
            fy: fy,
            lx: -fy,
            ly: fx
        };
        var params = {
            seed: seed,
            tornadic: !!options.tornadic,
            intensity: INTENSITY[intensityName],
            motionMps: speedMph * MPH_TO_MPS
        };
        var model = type === "qlcs" ? qlcsModel(params) : supercellModel(params);

        var startMs = options.time != null ? new Date(options.time).getTime() : Date.now();
        startMs = Math.floor(startMs / 1000) * 1000;
        var sweeps = ELEVATIONS.map(function (elevation, i) {
            return buildSweep(i, elevation, frame, model, startMs, i === ELEVATIONS.length - 1);
        });

        var siteLat = Number(site.lat);
        var siteLon = Number(site.lon);
        var features = {};
        Object.keys(model.features).forEach(function (name) {
            var f = model.features[name];
            if (!f) {
                features[name] = null;
                return;
            }
            var e = frame.px + (f.x * frame.fx + f.y * frame.lx) * 1000;
            var n = frame.py + (f.x * frame.fy + f.y * frame.ly) * 1000;
            features[name] = destination(siteLat, siteLon, (Math.atan2(e, n) / DEG + 360) % 360, Math.sqrt(e * e + n * n));
        });

        return {
            icao: String(options.icao || "SYNT").toUpperCase().slice(0, 4),
            time: new Date(startMs),
            vcp: VCP,
            site: { lat: siteLat, lon: siteLon, height: finiteOr(site.height, 0) },
            sweeps: sweeps,
            synthetic: {
                type: type,
                label: TYPES[type],
                tornadic: params.tornadic,
                intensity: intensityName,
                seed: seed,
                motionBearing: bearing,
                motionSpeedMph: speedMph,
                features: features
            }
        };
    }

    return {
        generate: generate,
        TYPES: TYPES,
        INTENSITIES: Object.keys(INTENSITY),
        MOMENTS: MOMENTS,
        ELEVATIONS: ELEVATIONS,
        MAX_STORM_RANGE: MAX_STORM_RANGE
    };
}));
