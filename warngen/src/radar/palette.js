(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenRadarPalette = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    /**
     * GRLevelX color tables (.pal): "Color: value r g b [r2 g2 b2]" blends from the first
     * color at value toward r2 g2 b2 (or the next entry's color) at the next value;
     * "Color4:" adds alpha. Values below the first entry draw nothing.
     */

    var DEFAULT_TABLES = {
        REF: [
            "; WFO EAX Base Reflectivity Color Table Modified",
            "Product: BR",
            "Units: DBZ",
            "Step: 5",
            "Color: -30 116 78 173",
            "Color: -20 150 150 82",
            "Color: -10 204 208 175",
            "Color: 0 67 94 160",
            "Color: 15 106 208 228",
            "Color: 20 20 230 20",
            "Color: 34 10 80 0",
            "Color: 40 255 225 0 255 128 0",
            "Color: 50 255 0 0 0 0 0",
            "color: 60 255 255 255 255 146 255",
            "color: 65 255 117 255 225 11 227",
            "color: 70 178 0 255 99 0 214",
            "color: 75 5 236 240 1 32 32",
            "Color: 80 0 0 0"
        ].join("\n"),
        VEL: [
            "Product: BV",
            "Units: KTS",
            "Step: 10",
            "RF: 119 0 125",
            "Color: -120 255 0 255 150 0 150",
            "Color: -100 0 255 0 0 120 0",
            "Color: -10 110 130 110 150 150 150",
            "Color: 0 150 150 150 130 110 110",
            "Color: 10 120 0 0 255 0 0",
            "Color: 100 255 255 0 255 128 0",
            "Color: 120 255 255 255"
        ].join("\n"),
        SW: [
            "Product: SW",
            "Units: KTS",
            "Step: 5",
            "RF: 119 0 125",
            "Color: 0 60 60 60 150 150 150",
            "Color: 10 0 150 0 255 255 0",
            "Color: 20 255 128 0 255 0 0",
            "Color: 30 255 255 255"
        ].join("\n"),
        ZDR: [
            "Product: ZDR",
            "Units: DB",
            "Step: 1",
            "Color: -4 0 0 0 100 100 100",
            "Color: 0 150 150 150 0 0 200",
            "Color: 1 0 200 255 0 200 0",
            "Color: 2 0 200 0 255 255 0",
            "Color: 3 255 255 0 255 0 0",
            "Color: 5 255 0 0 255 0 255",
            "Color: 8 255 255 255"
        ].join("\n"),
        RHO: [
            "Product: CC",
            "Units: ",
            "Step: 0.05",
            "Color: 0.2 20 0 50 0 0 130",
            "Color: 0.7 0 0 200 0 200 255",
            "Color: 0.85 0 220 0 255 255 0",
            "Color: 0.95 255 150 0 255 0 0",
            "Color: 0.99 150 0 70 255 255 255",
            "Color: 1.05 255 255 255"
        ].join("\n"),
        PHI: [
            "Product: PHI",
            "Units: DEG",
            "Step: 30",
            "Color: 0 0 0 130 0 200 255",
            "Color: 90 0 220 0 255 255 0",
            "Color: 180 255 150 0 255 0 0",
            "Color: 270 150 0 70 255 255 255",
            "Color: 360 255 255 255"
        ].join("\n"),
        CFP: [
            "Product: CFP",
            "Units: DB",
            "Step: 5",
            "Color: 0 60 60 60 0 120 255",
            "Color: 10 0 120 255 255 255 0",
            "Color: 20 255 255 0 255 0 0",
            "Color: 30 255 255 255"
        ].join("\n")
    };

    var MPS_TO_KTS = 1.9438445;
    var MPS_TO_MPH = 2.2369363;

    function parse(text) {
        var entries = [];
        var units = "";
        var product = "";
        var rangeFolded = null;
        String(text || "").split(/\r?\n/).forEach(function (rawLine) {
            var line = rawLine.replace(/[;#].*$/, "").trim();
            if (!line) return;
            var m = /^([A-Za-z0-9]+)\s*:\s*(.*)$/.exec(line);
            if (!m) return;
            var key = m[1].toLowerCase();
            var nums = m[2].trim().split(/[\s,]+/).map(Number);
            if (key === "units") {
                units = m[2].trim().toUpperCase();
            } else if (key === "product") {
                product = m[2].trim().toUpperCase();
            } else if (key === "rf" && nums.length >= 3) {
                rangeFolded = [nums[0], nums[1], nums[2], 255];
            } else if ((key === "color" || key === "color4") && nums.every(isFinite)) {
                var alpha = key === "color4";
                var width = alpha ? 4 : 3;
                if (nums.length < 1 + width) return;
                var entry = {
                    value: nums[0],
                    from: nums.slice(1, 1 + width),
                    to: nums.length >= 1 + width * 2 ? nums.slice(1 + width, 1 + width * 2) : null
                };
                if (!alpha) {
                    entry.from.push(255);
                    if (entry.to) entry.to.push(255);
                }
                entries.push(entry);
            }
        });
        if (!entries.length) throw new Error("No Color: lines were found in that color table.");
        entries.sort(function (a, b) { return a.value - b.value; });
        return { product: product, units: units, entries: entries, rangeFolded: rangeFolded };
    }

    // Moment values arrive in m/s, dB, dBZ or degrees; tables may be in knots or mph.
    function toTableUnits(table, moment, value) {
        if (moment !== "VEL" && moment !== "SW") return value;
        if (table.units === "KTS" || table.units === "KT" || table.units === "KNOTS") return value * MPS_TO_KTS;
        if (table.units === "MPH") return value * MPS_TO_MPH;
        return value;
    }

    function colorAt(table, value) {
        var list = table.entries;
        if (value < list[0].value) return null;
        for (var i = list.length - 1; i >= 0; i--) {
            if (value < list[i].value) continue;
            var entry = list[i];
            var next = list[i + 1];
            if (!next) return entry.from.slice();
            var target = entry.to || next.from;
            var t = (value - entry.value) / (next.value - entry.value);
            return [0, 1, 2, 3].map(function (k) {
                return Math.round(entry.from[k] + (target[k] - entry.from[k]) * t);
            });
        }
        return null;
    }

    function pack(rgba) {
        return rgba ? ((rgba[3] << 24) | (rgba[2] << 16) | (rgba[1] << 8) | rgba[0]) >>> 0 : 0;
    }

    function cssColor(packed) {
        var r = packed & 255;
        var g = (packed >>> 8) & 255;
        var b = (packed >>> 16) & 255;
        var a = (packed >>> 24) / 255;
        return a >= 1 ? "rgb(" + r + "," + g + "," + b + ")" : "rgba(" + r + "," + g + "," + b + "," + a.toFixed(3) + ")";
    }

    function defaultTable(moment) {
        return parse(DEFAULT_TABLES[moment] || DEFAULT_TABLES.REF);
    }

    return {
        parse: parse,
        colorAt: colorAt,
        toTableUnits: toTableUnits,
        pack: pack,
        cssColor: cssColor,
        defaultTable: defaultTable,
        DEFAULT_TABLES: DEFAULT_TABLES
    };
}));
