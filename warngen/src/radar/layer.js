(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./level2.js"), require("./palette.js"));
    } else {
        root.WarngenRadarLayer = factory(root.WarngenLevel2, root.WarngenRadarPalette);
    }
}(typeof self !== "undefined" ? self : this, function (Level2, Palette) {
    "use strict";

    var EARTH_RADIUS = 6371000;
    var EFFECTIVE_RADIUS = EARTH_RADIUS * 4 / 3;
    var DEG = Math.PI / 180;
    var AZ_BINS = 3600;
    var RANGE_STEP = 25;

    // Ground distance under the beam for a slant range, 4/3 effective earth radius model.
    function groundRange(slant, elevationDeg) {
        var e = elevationDeg * DEG;
        var height = Math.sqrt(slant * slant + EFFECTIVE_RADIUS * EFFECTIVE_RADIUS +
            2 * slant * EFFECTIVE_RADIUS * Math.sin(e)) - EFFECTIVE_RADIUS;
        return EFFECTIVE_RADIUS * Math.asin(slant * Math.cos(e) / (EFFECTIVE_RADIUS + height));
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
        var bearing = (Math.atan2(y, x) / DEG + 360) % 360;
        return { bearing: bearing, distance: distance };
    }

    /**
     * Lookup tables for one sweep and moment: azimuth (0.1 deg bins) to radial, ground range
     * (25 m bins) to gate, and data code to packed RGBA, so a tile pixel costs one acos and
     * one atan2.
     */
    function buildRaster(volume, sweep, momentName, table) {
        var sample = null;
        var maxGates = 0;
        sweep.radials.forEach(function (r) {
            var m = r.moments[momentName];
            if (!m) return;
            if (!sample) sample = m;
            if (m.gates > maxGates) maxGates = m.gates;
        });
        if (!sample) return null;

        var edgeRange = new Float64Array(maxGates + 1);
        for (var k = 0; k <= maxGates; k++) {
            edgeRange[k] = groundRange(Math.max(0, sample.first - sample.spacing / 2 + k * sample.spacing), sweep.elevation);
        }
        var maxRange = edgeRange[maxGates];
        var gateLut = new Int32Array(Math.ceil(maxRange / RANGE_STEP) + 1).fill(-1);
        var gate = 0;
        for (var i = 0; i < gateLut.length; i++) {
            var d = (i + 0.5) * RANGE_STEP;
            while (gate < maxGates && edgeRange[gate + 1] <= d) gate++;
            if (d >= edgeRange[0] && d < maxRange) gateLut[i] = gate;
        }

        var radials = sweep.radials.filter(function (r) { return r.moments[momentName]; });
        var azLut = new Int32Array(AZ_BINS).fill(-1);
        var azGap = new Float64Array(AZ_BINS).fill(Infinity);
        radials.forEach(function (r, index) {
            var half = r.azimuthResolution / 2;
            var from = Math.floor((r.azimuth - half) * 10);
            var to = Math.ceil((r.azimuth + half) * 10);
            for (var b = from; b <= to; b++) {
                var bin = ((b % AZ_BINS) + AZ_BINS) % AZ_BINS;
                var gap = Math.abs((((bin + 0.5) / 10 - r.azimuth) + 540) % 360 - 180);
                if (gap <= half && gap < azGap[bin]) {
                    azGap[bin] = gap;
                    azLut[bin] = index;
                }
            }
        });

        var wide = sample.wordSize === 16;
        var colors = new Uint32Array(wide ? 65536 : 256);
        var rf = table.rangeFolded ? Palette.pack(table.rangeFolded) : 0;
        for (var code = 0; code < colors.length; code++) {
            if (code < 2) {
                colors[code] = code === 1 ? rf : 0;
                continue;
            }
            var value = Palette.toTableUnits(table, momentName, (code - sample.offset) / sample.scale);
            colors[code] = Palette.pack(Palette.colorAt(table, value));
        }

        var lat1 = volume.site.lat * DEG;
        return {
            site: volume.site,
            sinLat1: Math.sin(lat1),
            cosLat1: Math.cos(lat1),
            lon1: volume.site.lon * DEG,
            cosMaxRange: Math.cos(maxRange / EARTH_RADIUS),
            maxRange: maxRange,
            edgeRange: edgeRange,
            gateLut: gateLut,
            azLut: azLut,
            radials: radials,
            data: radials.map(function (r) { return r.moments[momentName].data; }),
            gates: Int32Array.from(radials, function (r) { return r.moments[momentName].gates; }),
            wide: wide,
            colors: colors,
            moment: momentName
        };
    }

    function insetForSite(insets, site) {
        var list = typeof insets === "function" ? insets() : insets;
        return (list || []).filter(function (t) {
            return [t.realBbox, t.realBboxAlt].some(function (b) {
                return b && site.lon >= b[0] && site.lat >= b[1] && site.lon <= b[2] && site.lat <= b[3];
            });
        })[0] || null;
    }

    // Map (inset) degrees to real degrees; NaN outside the inset box.
    function realLonOf(inset, lon) {
        if (!inset) return lon;
        if (lon < inset.compositeBbox[0] || lon > inset.compositeBbox[2]) return NaN;
        return (lon - inset.dst[0]) / inset.scaleLon + inset.src[0];
    }

    function realLatOf(inset, lat) {
        if (!inset) return lat;
        if (lat < inset.compositeBbox[1] || lat > inset.compositeBbox[3]) return NaN;
        return (lat - inset.dst[1]) / inset.scaleLat + inset.src[1];
    }

    function paintTile(raster, pixels, width, height, tileX, tileY, zoom, tileSize) {
        var world = tileSize * Math.pow(2, zoom);
        var inset = raster.inset;
        var sinDl = new Float64Array(width);
        var cosDl = new Float64Array(width);
        var colOk = new Uint8Array(width);
        for (var i = 0; i < width; i++) {
            var lon = realLonOf(inset, ((tileX * tileSize + (i + 0.5) * tileSize / width) / world) * 360 - 180);
            if (lon !== lon) continue;
            var dl = lon * DEG - raster.lon1;
            sinDl[i] = Math.sin(dl);
            cosDl[i] = Math.cos(dl);
            colOk[i] = 1;
        }
        var sinLat1 = raster.sinLat1;
        var cosLat1 = raster.cosLat1;
        var cosMax = raster.cosMaxRange;
        var gateLut = raster.gateLut;
        var azLut = raster.azLut;
        var data = raster.data;
        var gates = raster.gates;
        var colors = raster.colors;
        var wide = raster.wide;
        var painted = 0;
        for (var j = 0; j < height; j++) {
            var yn = (tileY * tileSize + (j + 0.5) * tileSize / height) / world;
            var lat = realLatOf(inset, Math.atan(Math.sinh(Math.PI * (1 - 2 * yn))) / DEG) * DEG;
            if (lat !== lat) continue;
            var sinLat = Math.sin(lat);
            var cosLat = Math.cos(lat);
            var row = j * width;
            for (var x = 0; x < width; x++) {
                if (!colOk[x]) continue;
                var cosC = sinLat1 * sinLat + cosLat1 * cosLat * cosDl[x];
                if (cosC < cosMax) continue;
                var range = Math.acos(cosC > 1 ? 1 : cosC) * EARTH_RADIUS;
                var gate = gateLut[(range / RANGE_STEP) | 0];
                if (gate < 0) continue;
                var az = Math.atan2(sinDl[x] * cosLat, cosLat1 * sinLat - sinLat1 * cosLat * cosDl[x]) / DEG;
                if (az < 0) az += 360;
                var radial = azLut[((az * 10) | 0) % AZ_BINS];
                if (radial < 0 || gate >= gates[radial]) continue;
                var bytes = data[radial];
                var code = wide ? (bytes[gate * 2] << 8) | bytes[gate * 2 + 1] : bytes[gate];
                var color = colors[code];
                if (color) {
                    pixels[row + x] = color;
                    painted++;
                }
            }
        }
        return painted;
    }

    function sample(raster, lat, lon) {
        if (!raster) return null;
        lat = realLatOf(raster.inset, lat);
        lon = realLonOf(raster.inset, lon);
        if (lat !== lat || lon !== lon) return null;
        var bd = bearingDistance(raster.site.lat, raster.site.lon, lat, lon);
        if (bd.distance >= raster.maxRange) return null;
        var gate = raster.gateLut[(bd.distance / RANGE_STEP) | 0];
        var radialIndex = raster.azLut[((bd.bearing * 10) | 0) % AZ_BINS];
        if (gate < 0 || radialIndex < 0) return null;
        var moment = raster.radials[radialIndex].moments[raster.moment];
        if (gate >= moment.gates) return null;
        return { value: Level2.value(moment, gate), bearing: bd.bearing, distance: bd.distance };
    }

    // Tile bounds in radians against the radar's coverage circle, as a cheap reject.
    function tileOutside(raster, tileX, tileY, zoom) {
        var n = Math.pow(2, zoom);
        var west = tileX / n * 360 - 180;
        var east = (tileX + 1) / n * 360 - 180;
        var north = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n))) / DEG;
        var south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY + 1) / n))) / DEG;
        var inset = raster.inset;
        if (inset) {
            var b = inset.compositeBbox;
            if (east < b[0] || west > b[2] || north < b[1] || south > b[3]) return true;
            west = realLonOf(inset, Math.max(west, b[0]));
            east = realLonOf(inset, Math.min(east, b[2]));
            south = realLatOf(inset, Math.max(south, b[1]));
            north = realLatOf(inset, Math.min(north, b[3]));
        }
        var lat = Math.max(south, Math.min(north, raster.site.lat));
        var lon = Math.max(west, Math.min(east, raster.site.lon));
        return bearingDistance(raster.site.lat, raster.site.lon, lat, lon).distance > raster.maxRange;
    }

    function create(L, options) {
        options = options || {};
        var RadarLayer = L.GridLayer.extend({
            initialize: function () {
                L.GridLayer.prototype.initialize.call(this, {
                    pane: options.pane || "overlayPane",
                    opacity: options.opacity == null ? 0.7 : options.opacity,
                    updateWhenZooming: false,
                    keepBuffer: 2,
                    maxZoom: 22
                });
                this._volume = null;
                this._sweepIndex = 0;
                this._moment = "REF";
                this._tables = {};
                this._raster = null;
            },

            createTile: function (coords) {
                var tile = document.createElement("canvas");
                var size = this.getTileSize();
                var dpr = Math.min(2, window.devicePixelRatio || 1);
                tile.width = Math.round(size.x * dpr);
                tile.height = Math.round(size.y * dpr);
                var raster = this._raster;
                if (!raster || tileOutside(raster, coords.x, coords.y, coords.z)) return tile;
                var ctx = tile.getContext("2d");
                var image = ctx.createImageData(tile.width, tile.height);
                var pixels = new Uint32Array(image.data.buffer);
                if (paintTile(raster, pixels, tile.width, tile.height, coords.x, coords.y, coords.z, size.x)) {
                    ctx.putImageData(image, 0, 0);
                }
                return tile;
            },

            setVolume: function (volume) {
                this._volume = volume;
                this._sweepIndex = 0;
                this._rebuild();
                return this;
            },

            setView: function (sweepIndex, moment) {
                this._sweepIndex = sweepIndex;
                this._moment = moment;
                this._rebuild();
                return this;
            },

            setTable: function (moment, table) {
                this._tables[moment] = table;
                if (moment === this._moment) this._rebuild();
                return this;
            },

            tableFor: function (moment) {
                if (!this._tables[moment]) this._tables[moment] = Palette.defaultTable(moment);
                return this._tables[moment];
            },

            sweep: function () {
                return this._volume ? this._volume.sweeps[this._sweepIndex] : null;
            },

            sampleAt: function (latlng) {
                return sample(this._raster, latlng.lat, latlng.lng);
            },

            // Where the site sits on the map: its inset position for Alaska, Hawaii and the territories.
            mapSite: function () {
                if (!this._volume) return null;
                var site = this._volume.site;
                var inset = insetForSite(options.insets, site);
                if (!inset) return { lat: site.lat, lon: site.lon };
                var lon = inset.normalizePositiveLon && site.lon > 0 ? site.lon - 360 : site.lon;
                return {
                    lat: (site.lat - inset.src[1]) * inset.scaleLat + inset.dst[1],
                    lon: (lon - inset.src[0]) * inset.scaleLon + inset.dst[0]
                };
            },

            _rebuild: function () {
                var sweep = this.sweep();
                this._raster = sweep ? buildRaster(this._volume, sweep, this._moment, this.tableFor(this._moment)) : null;
                if (this._raster) this._raster.inset = insetForSite(options.insets, this._volume.site);
                if (this._map) this.redraw();
            }
        });
        return new RadarLayer();
    }

    return {
        create: create,
        buildRaster: buildRaster,
        paintTile: paintTile,
        sample: sample,
        groundRange: groundRange,
        bearingDistance: bearingDistance
    };
}));
