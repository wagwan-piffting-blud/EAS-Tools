(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./layer.js"), require("./palette.js"), require("./level2.js"));
    } else {
        root.WarngenRadarExport = factory(root.WarngenRadarLayer, root.WarngenRadarPalette, root.WarngenLevel2);
    }
}(typeof self !== "undefined" ? self : this, function (Layer, Palette, Level2) {
    "use strict";

    var EARTH_RADIUS = 6371000;
    var MERCATOR_CIRCUMFERENCE = 2 * Math.PI * 6378137;
    var DEG = Math.PI / 180;
    var PNG_SIZE = 2048;
    var SVG_BANDS = 32;

    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    function scanTime(volume) {
        return volume.time instanceof Date ? volume.time : new Date(volume.time);
    }

    function describe(volume, sweep, moment, table) {
        var info = (Level2.MOMENT_INFO && Level2.MOMENT_INFO[moment]) || { label: moment, units: "" };
        var t = scanTime(volume);
        var stamp = t.getUTCFullYear() + pad2(t.getUTCMonth() + 1) + pad2(t.getUTCDate()) + "T" +
            pad2(t.getUTCHours()) + pad2(t.getUTCMinutes()) + "Z";
        var when = t.toISOString().replace("T", " ").slice(0, 19) + "Z";
        var elevation = sweep.elevation.toFixed(1);
        var synthetic = !!volume.synthetic;
        var units = (table && table.units) || info.units || "";
        var title = volume.icao + " " + info.label + " (" + moment + ") " + elevation + "° " + when +
            (volume.vcp ? " VCP " + volume.vcp : "");
        return {
            icao: volume.icao,
            moment: moment,
            label: info.label,
            units: units,
            elevation: elevation,
            time: when,
            iso: t.toISOString(),
            stamp: stamp,
            vcp: volume.vcp || null,
            synthetic: synthetic,
            syntheticLabel: synthetic && volume.synthetic.label ? volume.synthetic.label : "",
            title: synthetic ? "SYNTHETIC " + title : title,
            note: synthetic ? "Made-up practice data from the EAS Tools WarnGen storm generator, not a real radar scan." : ""
        };
    }

    function fileName(volume, sweep, moment, ext) {
        var d = describe(volume, sweep, moment, null);
        var icao = String(d.icao || "RADR").replace(/[^A-Za-z0-9]/g, "") || "RADR";
        return icao + (d.synthetic ? "_SYNTH" : "") + "_" + moment + "_" + d.elevation + "_" + d.stamp + "." + ext;
    }

    function destination(lat, lon, bearingDeg, distance) {
        var d = distance / EARTH_RADIUS;
        var t = bearingDeg * DEG;
        var p1 = lat * DEG;
        var l1 = lon * DEG;
        var p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
        var l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
        return { lat: p2 / DEG, lon: l2 / DEG };
    }

    function mercX(lon) {
        return (lon + 180) / 360;
    }

    function mercY(lat) {
        var s = Math.sin(lat * DEG);
        return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    }

    function unmercY(y) {
        return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / DEG;
    }

    // A square in Web Mercator around the coverage circle; tileX/tileY may be fractional.
    function mercatorFrame(site, range, size) {
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (var b = 0; b < 360; b += 2) {
            var p = destination(site.lat, site.lon, b, range);
            var x = mercX(p.lon);
            var y = mercY(p.lat);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        var span = Math.max(maxX - minX, maxY - minY) * 1.02;
        var left = (minX + maxX) / 2 - span / 2;
        var top = (minY + maxY) / 2 - span / 2;
        var metersPerPixel = MERCATOR_CIRCUMFERENCE * span / size;
        return {
            size: size,
            span: span,
            left: left,
            top: top,
            zoom: Math.log(1 / span) / Math.LN2,
            west: left * 360 - 180,
            east: (left + span) * 360 - 180,
            north: unmercY(top),
            south: unmercY(top + span),
            metersPerPixel: metersPerPixel,
            originX: (left - 0.5) * MERCATOR_CIRCUMFERENCE + metersPerPixel / 2,
            originY: (0.5 - top) * MERCATOR_CIRCUMFERENCE - metersPerPixel / 2
        };
    }

    function worldFile(frame) {
        return [frame.metersPerPixel, 0, 0, -frame.metersPerPixel, frame.originX, frame.originY]
            .map(function (v) { return v.toFixed(6); }).join("\n");
    }

    function fmt(v) {
        var s = Math.abs(v) >= 100 ? v.toFixed(0) : (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
        return s.indexOf(".") !== -1 ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
    }

    function legendTicks(table) {
        return table.entries.map(function (e) { return e.value; });
    }

    function rgbaString(c) {
        return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (c[3] / 255).toFixed(3) + ")";
    }

    function drawLegendStrip(ctx, d, table, y, width, height) {
        var padX = 24;
        ctx.fillStyle = "rgb(17,19,23)";
        ctx.fillRect(0, y, width, height);
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgb(255,255,255)";
        ctx.font = "bold 30px Consolas, Menlo, monospace";
        ctx.fillText(d.title, padX, y + 14);
        var barTop = y + 58;
        if (d.synthetic) {
            ctx.fillStyle = "rgb(250,189,47)";
            ctx.font = "bold 22px Consolas, Menlo, monospace";
            ctx.fillText(d.note, padX, y + 52);
            barTop = y + 88;
        }
        var ticks = legendTicks(table);
        var lo = ticks[0];
        var hi = ticks[ticks.length - 1];
        if (hi <= lo) hi = lo + 1;
        var unitsWidth = 120;
        var barX = padX;
        var barW = width - padX * 2 - unitsWidth;
        var barH = 26;
        for (var i = 0; i < barW; i++) {
            var c = Palette.colorAt(table, lo + (hi - lo) * (i + 0.5) / barW);
            if (!c) continue;
            ctx.fillStyle = rgbaString(c);
            ctx.fillRect(barX + i, barTop, 1, barH);
        }
        ctx.strokeStyle = "rgb(200,200,200)";
        ctx.lineWidth = 1;
        ctx.strokeRect(barX + 0.5, barTop + 0.5, barW - 1, barH - 1);
        ctx.fillStyle = "rgb(230,230,230)";
        ctx.font = "20px Consolas, Menlo, monospace";
        ctx.textAlign = "center";
        var lastRight = -Infinity;
        ticks.forEach(function (v) {
            var x = barX + (v - lo) / (hi - lo) * barW;
            var text = fmt(v);
            var w = ctx.measureText(text).width;
            if (x - w / 2 < lastRight + 8) return;
            ctx.fillRect(Math.round(x), barTop + barH, 1, 6);
            ctx.fillText(text, Math.min(barX + barW - w / 2, Math.max(barX + w / 2, x)), barTop + barH + 8);
            lastRight = x + w / 2;
        });
        ctx.textAlign = "left";
        ctx.fillText(d.units || "", barX + barW + 16, barTop + 2);
    }

    /**
     * The sweep alone, in Web Mercator (EPSG:3857), on a transparent square around the coverage
     * circle, with a title and color bar strip below it. The square's top-left is the georeference
     * origin, so the world file in the text chunks stays valid with the strip attached.
     */
    function png(volume, sweep, moment, table, options) {
        options = options || {};
        var raster = Layer.buildRaster(volume, sweep, moment, table);
        if (!raster) return null;
        raster = Object.assign({}, raster, { inset: null });
        var size = options.size || PNG_SIZE;
        var frame = mercatorFrame(volume.site, raster.maxRange, size);
        var pixels = new Uint32Array(size * size);
        var painted = Layer.paintTile(raster, pixels, size, size, frame.left / frame.span, frame.top / frame.span, frame.zoom, size);
        var d = describe(volume, sweep, moment, table);
        var legend = options.legend === false ? 0 : (d.synthetic ? 160 : 130);
        var canvas = (options.document || document).createElement("canvas");
        canvas.width = size;
        canvas.height = size + legend;
        var ctx = canvas.getContext("2d");
        ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), size, size), 0, 0);
        if (legend) drawLegendStrip(ctx, d, table, size, size, legend);
        var georef = {
            crs: "EPSG:3857",
            pixels: [size, size],
            bounds: { west: frame.west, south: frame.south, east: frame.east, north: frame.north },
            metersPerPixel: frame.metersPerPixel,
            site: { lat: volume.site.lat, lon: volume.site.lon },
            maxRangeMeters: raster.maxRange,
            legendRows: legend
        };
        var text = [
            ["Title", d.title],
            ["Software", "EAS Tools WarnGen"],
            ["Source", (d.synthetic ? "Synthetic " : "NEXRAD Level II ") + d.icao + " " + d.label + " " + d.elevation + " deg, " + d.iso],
            ["Creation Time", new Date().toUTCString()],
            ["Description", "Radar sweep in Web Mercator (EPSG:3857). The top " + size + " rows are the radar square; " +
                (legend ? "the " + legend + " rows below are the legend strip. " : "") +
                "Bounds W " + frame.west.toFixed(6) + " S " + frame.south.toFixed(6) + " E " + frame.east.toFixed(6) +
                " N " + frame.north.toFixed(6) + "."],
            ["WorldFile", worldFile(frame)],
            ["Georeference", JSON.stringify(georef)]
        ];
        if (d.synthetic) text.push(["Warning", d.note]);
        return {
            canvas: canvas,
            painted: painted,
            text: text,
            georef: georef,
            worldFile: worldFile(frame),
            fileName: fileName(volume, sweep, moment, "png")
        };
    }

    var CRC_TABLE = null;

    function crc32(bytes, start, end) {
        if (!CRC_TABLE) {
            CRC_TABLE = new Uint32Array(256);
            for (var n = 0; n < 256; n++) {
                var c = n;
                for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
                CRC_TABLE[n] = c >>> 0;
            }
        }
        var crc = 0xffffffff;
        for (var i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    function latin1(text) {
        var out = new Uint8Array(text.length);
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            out[i] = c < 256 ? c : 63;
        }
        return out;
    }

    // tEXt chunks go straight after IHDR, which a canvas encoder always writes first.
    function withPngText(bytes, entries) {
        var chunks = entries.map(function (entry) {
            var key = latin1(String(entry[0]).slice(0, 79));
            var value = latin1(String(entry[1]));
            var length = key.length + 1 + value.length;
            var chunk = new Uint8Array(12 + length);
            var view = new DataView(chunk.buffer);
            view.setUint32(0, length);
            chunk.set(latin1("tEXt"), 4);
            chunk.set(key, 8);
            chunk.set(value, 9 + key.length);
            view.setUint32(8 + length, crc32(chunk, 4, 8 + length));
            return chunk;
        });
        var ihdrEnd = 8 + 12 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(8);
        var total = bytes.length + chunks.reduce(function (n, c) { return n + c.length; }, 0);
        var out = new Uint8Array(total);
        out.set(bytes.subarray(0, ihdrEnd), 0);
        var pos = ihdrEnd;
        chunks.forEach(function (c) {
            out.set(c, pos);
            pos += c.length;
        });
        out.set(bytes.subarray(ihdrEnd), pos);
        return out;
    }

    function hex2(n) {
        return (n < 16 ? "0" : "") + n.toString(16);
    }

    function xml(text) {
        return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    /**
     * Color bands: each table segment is cut into steps of 1/SVG_BANDS of the table's span and
     * painted with the color at the step's middle, so runs of gates merge into one wedge.
     */
    function buildBands(table, moment, sample, codes) {
        var entries = table.entries;
        var lo = entries[0].value;
        var hi = entries[entries.length - 1].value;
        var step = (hi - lo) / SVG_BANDS || 1;
        var bands = [];
        var byKey = {};
        var classOf = new Int32Array(codes).fill(-1);

        function band(key, from, to, color) {
            if (!color || !color[3]) return -1;
            if (byKey[key] === undefined) {
                byKey[key] = bands.length;
                bands.push({ from: from, to: to, color: color, runs: [] });
            }
            return byKey[key];
        }

        for (var code = 1; code < codes; code++) {
            if (code === 1) {
                classOf[1] = table.rangeFolded ? band("RF", null, null, table.rangeFolded) : -1;
                continue;
            }
            var v = Palette.toTableUnits(table, moment, (code - sample.offset) / sample.scale);
            if (!(v >= lo)) continue;
            var i = entries.length - 1;
            while (i > 0 && v < entries[i].value) i--;
            var entry = entries[i];
            var next = entries[i + 1];
            if (!next) {
                classOf[code] = band(i + ":0", entry.value, null, Palette.colorAt(table, entry.value));
                continue;
            }
            var k = Math.floor((v - entry.value) / step);
            var from = entry.value + k * step;
            var to = Math.min(entry.value + (k + 1) * step, next.value);
            classOf[code] = band(i + ":" + k, from, to, Palette.colorAt(table, Math.min((from + to) / 2, next.value - 1e-9)));
        }
        bands.forEach(function (b) {
            b.fill = "#" + hex2(b.color[0]) + hex2(b.color[1]) + hex2(b.color[2]);
            b.opacity = b.color[3] / 255;
        });
        return { bands: bands, classOf: classOf };
    }

    function num(v) {
        var r = Math.round(v * 100) / 100;
        return String(r === 0 ? 0 : r);
    }

    function point(rangeKm, sinA, cosA) {
        return num(rangeKm * sinA) + " " + num(-rangeKm * cosA);
    }

    function wedge(inner, outer, a0, a1) {
        var s0 = Math.sin(a0), c0 = Math.cos(a0), s1 = Math.sin(a1), c1 = Math.cos(a1);
        if (inner <= 0) {
            return "M0 0L" + point(outer, s0, c0) + "L" + point(outer, s1, c1) + "Z";
        }
        return "M" + point(inner, s0, c0) + "L" + point(outer, s0, c0) + "L" + point(outer, s1, c1) +
            "L" + point(inner, s1, c1) + "Z";
    }

    /**
     * The sweep as vector wedges in an azimuthal equidistant frame centred on the radar, in
     * kilometres, x east and y south (SVG's y runs down). One path per run of same-band gates
     * along a radial, grouped by band. Chords stand in for the arcs: under 20 m off at 460 km.
     */
    function svg(volume, sweep, moment, table) {
        var raster = Layer.buildRaster(volume, sweep, moment, table);
        if (!raster) return null;
        var sample = raster.radials[0].moments[moment];
        var built = buildBands(table, moment, sample, raster.colors.length);
        var bands = built.bands;
        var classOf = built.classOf;
        var edgeKm = Array.prototype.map.call(raster.edgeRange, function (m) { return m / 1000; });
        var paths = 0;

        raster.radials.forEach(function (radial, r) {
            var half = radial.azimuthResolution / 2;
            var a0 = (radial.azimuth - half) * DEG;
            var a1 = (radial.azimuth + half) * DEG;
            var bytes = raster.data[r];
            var gates = raster.gates[r];
            var runClass = -1;
            var runStart = 0;
            for (var g = 0; g <= gates; g++) {
                var cls = -1;
                if (g < gates) {
                    var code = raster.wide ? (bytes[g * 2] << 8) | bytes[g * 2 + 1] : bytes[g];
                    cls = classOf[code];
                }
                if (cls === runClass) continue;
                if (runClass >= 0) {
                    bands[runClass].runs.push(wedge(edgeKm[runStart], edgeKm[g], a0, a1));
                    paths++;
                }
                runClass = cls;
                runStart = g;
            }
        });

        var d = describe(volume, sweep, moment, table);
        var R = Math.ceil(raster.maxRange / 1000);
        var font = Math.max(4, Math.round(R * 0.035));
        var legendH = font * (d.synthetic ? 8.5 : 7);
        var minX = -R - font, minY = -R - font;
        var width = 2 * (R + font);
        var height = 2 * (R + font) + legendH;
        var pxWidth = 2048;
        var pxHeight = Math.round(pxWidth * height / width);
        var proj = "+proj=aeqd +lat_0=" + volume.site.lat + " +lon_0=" + volume.site.lon +
            " +x_0=0 +y_0=0 +R=" + EARTH_RADIUS + " +units=km +no_defs";

        var out = [];
        out.push('<?xml version="1.0" encoding="UTF-8"?>');
        out.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:warngen="https://eas.tools/warngen/radar" version="1.1"' +
            ' width="' + pxWidth + '" height="' + pxHeight + '" viewBox="' + [minX, minY, width, height].join(" ") + '">');
        out.push("<title>" + xml(d.title) + "</title>");
        out.push("<desc>" + xml((d.note ? d.note + " " : "") + "Azimuthal equidistant projection centred on the radar at " +
            volume.site.lat + ", " + volume.site.lon + "; units are kilometres, x east, y south. PROJ: " + proj) + "</desc>");
        out.push("<metadata>");
        out.push('<warngen:radar icao="' + xml(d.icao) + '" product="' + xml(moment) + '" label="' + xml(d.label) +
            '" units="' + xml(d.units) + '" elevation="' + d.elevation + '" time="' + d.iso + '"' +
            (d.vcp ? ' vcp="' + d.vcp + '"' : "") + ' synthetic="' + d.synthetic + '"' +
            (d.syntheticLabel ? ' syntheticType="' + xml(d.syntheticLabel) + '"' : "") + "/>");
        out.push('<warngen:georef crs="' + xml(proj) + '" siteLat="' + volume.site.lat + '" siteLon="' + volume.site.lon +
            '" siteHeight="' + (volume.site.height || 0) + '" units="km" xAxis="east" yAxis="south" maxRangeKm="' +
            (raster.maxRange / 1000).toFixed(3) + '"/>');
        out.push("</metadata>");
        out.push('<g id="radar" stroke-width="0.06" stroke-linejoin="round">');
        bands.forEach(function (b, i) {
            if (!b.runs.length) return;
            var range = b.from === null ? "range folded" : fmt(b.from) + (b.to === null ? "+" : " to " + fmt(b.to)) + " " + d.units;
            out.push('<g id="band-' + i + '" fill="' + b.fill + '" stroke="' + b.fill + '"' +
                (b.opacity < 1 ? ' fill-opacity="' + b.opacity.toFixed(3) + '" stroke-opacity="' + b.opacity.toFixed(3) + '"' : "") +
                "><title>" + xml(range.trim()) + "</title>");
            b.runs.forEach(function (p) { out.push('<path d="' + p + '"/>'); });
            out.push("</g>");
        });
        out.push("</g>");
        out.push('<g id="site" fill="none" stroke="#888888" stroke-width="' + (font / 12).toFixed(2) + '">');
        out.push('<circle cx="0" cy="0" r="' + (raster.maxRange / 1000).toFixed(2) + '" stroke-dasharray="' + font + " " + font / 2 + '"/>');
        out.push('<path d="M-' + font / 2 + " 0H" + font / 2 + "M0 -" + font / 2 + "V" + font / 2 + '"/>');
        out.push("</g>");

        var ticks = legendTicks(table);
        var lo = ticks[0];
        var hi = ticks[ticks.length - 1] > lo ? ticks[ticks.length - 1] : lo + 1;
        var lx = -R;
        var ly = R + font * 1.5;
        var barW = 2 * R - font * 5;
        var barH = font * 1.2;
        out.push('<g id="legend" font-family="Consolas, Menlo, monospace" font-size="' + font + '">');
        out.push('<rect x="' + minX + '" y="' + (R + font * 0.5) + '" width="' + width + '" height="' + (legendH + font * 0.5) +
            '" fill="#111317"/>');
        out.push('<text x="' + lx + '" y="' + (ly + font) + '" fill="#ffffff" font-weight="bold">' + xml(d.title) + "</text>");
        var barY = ly + font * 1.8;
        if (d.synthetic) {
            out.push('<text x="' + lx + '" y="' + (ly + font * 2.4) + '" fill="#fabd2f" font-size="' + (font * 0.8).toFixed(2) + '">' +
                xml(d.note) + "</text>");
            barY = ly + font * 3.2;
        }
        out.push('<g id="legend-bar">');
        bands.forEach(function (b) {
            if (b.from === null) return;
            var to = b.to === null ? hi : b.to;
            var x0 = lx + (b.from - lo) / (hi - lo) * barW;
            var x1 = lx + (to - lo) / (hi - lo) * barW;
            if (x1 <= x0) return;
            out.push('<rect x="' + num(x0) + '" y="' + num(barY) + '" width="' + num(x1 - x0 + 0.05) + '" height="' + num(barH) +
                '" fill="' + b.fill + '"' + (b.opacity < 1 ? ' fill-opacity="' + b.opacity.toFixed(3) + '"' : "") + "/>");
        });
        out.push("</g>");
        out.push('<rect x="' + lx + '" y="' + num(barY) + '" width="' + num(barW) + '" height="' + num(barH) +
            '" fill="none" stroke="#c8c8c8" stroke-width="' + (font / 20).toFixed(2) + '"/>');
        out.push('<g id="legend-ticks" fill="#e6e6e6" text-anchor="middle" font-size="' + (font * 0.8).toFixed(2) + '">');
        var lastRight = -Infinity;
        ticks.forEach(function (v) {
            var x = lx + (v - lo) / (hi - lo) * barW;
            var label = fmt(v);
            var w = label.length * font * 0.5;
            if (x - w / 2 < lastRight + font * 0.3) return;
            out.push('<text x="' + num(x) + '" y="' + num(barY + barH + font) + '">' + xml(label) + "</text>");
            lastRight = x + w / 2;
        });
        out.push("</g>");
        out.push('<text x="' + num(lx + barW + font * 0.6) + '" y="' + num(barY + barH * 0.85) + '" fill="#e6e6e6">' +
            xml(d.units) + "</text>");
        out.push("</g>");
        out.push("</svg>");

        return {
            text: out.join("\n") + "\n",
            paths: paths,
            bands: bands.filter(function (b) { return b.runs.length; }).length,
            fileName: fileName(volume, sweep, moment, "svg")
        };
    }

    return {
        png: png,
        svg: svg,
        withPngText: withPngText,
        fileName: fileName,
        describe: describe,
        mercatorFrame: mercatorFrame
    };
}));
