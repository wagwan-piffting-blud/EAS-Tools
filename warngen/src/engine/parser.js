(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenParser = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    var PHENOMENON_NAMES = {
        TO: "Tornado",
        SV: "Severe Thunderstorm",
        EW: "Extreme Wind",
        FF: "Flash Flood",
        FA: "Flood",
        MA: "Marine",
        SM: "Special Marine",
        SQ: "Snow Squall",
        DS: "Dust Storm"
    };

    var SIGNIFICANCE_NAMES = {
        W: "Warning",
        A: "Watch",
        Y: "Advisory",
        S: "Statement"
    };

    var PRODUCT_BY_PHENSIG = {
        "TO.W": "TOR",
        "SV.W": "SVR",
        "EW.W": "EWW",
        "FF.W": "FFW",
        "FA.W": "FLW",
        "MA.W": "MWW",
        "SM.W": "SMW",
        "SQ.W": "SQW",
        "DS.W": "DSW"
    };

    function parseVtecDate(token) {
        var m = /^(\d{2})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/.exec(token);
        if (!m) return null;
        var yy = parseInt(m[1], 10);
        var year = 2000 + yy;
        var mon = parseInt(m[2], 10) - 1;
        var day = parseInt(m[3], 10);
        var hh = parseInt(m[4], 10);
        var mm = parseInt(m[5], 10);
        return new Date(Date.UTC(year, mon, day, hh, mm, 0));
    }

    function parsePolygon(lines, startIdx) {
        var nums = [];
        var first = lines[startIdx].replace(/^LAT\.\.\.LON\s*/, "");
        var collect = function (line) {
            var toks = line.trim().split(/\s+/);
            for (var i = 0; i < toks.length; i++) {
                if (/^\d{3,5}$/.test(toks[i])) {
                    nums.push(parseInt(toks[i], 10));
                }
            }
        };
        collect(first);
        for (var i = startIdx + 1; i < lines.length; i++) {
            var line = lines[i];
            if (line === "" || /^[A-Z]/.test(line) || /^\$\$/.test(line) ||
                /^&&/.test(line)) {
                break;
            }
            collect(line);
        }
        if (nums.length < 6 || nums.length % 2 !== 0) return null;
        var polygon = [];
        for (var j = 0; j < nums.length; j += 2) {
            var lat = nums[j] / 100;
            var lon = nums[j + 1] / 100;
            if (lon > 0) lon = -lon;
            polygon.push([lat, lon]);
        }
        var f = polygon[0], l = polygon[polygon.length - 1];
        if (f[0] !== l[0] || f[1] !== l[1]) {
            polygon.push([f[0], f[1]]);
        }
        return polygon;
    }

    function parseTML(line) {
        var m = /TIME\.\.\.MOT\.\.\.LOC\s+(\d{4})Z\s+(\d{1,3})DEG\s+(\d{1,3})KT\s+(\d{3,4})\s+(\d{3,5})/.exec(line);
        if (!m) return null;
        var hh = parseInt(m[1].slice(0, 2), 10);
        var mm = parseInt(m[1].slice(2, 4), 10);
        var lon = parseInt(m[5], 10) / 100;
        if (lon > 0) lon = -lon;
        return {
            timeHHMM: m[1],
            hour: hh,
            minute: mm,
            bearingFrom: parseInt(m[2], 10),
            speedKt: parseInt(m[3], 10),
            location: [parseInt(m[4], 10) / 100, lon]
        };
    }

    function parseUgc(line) {
        var withoutTrail = line.replace(/-\d{6}-?\s*$/, "");
        var entries = [];
        var currentState = null;
        var currentKind = null;
        var parts = withoutTrail.split("-");
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (!p) continue;
            var sm = /^([A-Z]{2})([CZ])(\d{3})$/.exec(p);
            if (sm) {
                currentState = sm[1];
                currentKind = sm[2];
                entries.push({ state: currentState, kind: currentKind, code: sm[3] });
                continue;
            }
            if (/^\d{3}$/.test(p) && currentState) {
                entries.push({ state: currentState, kind: currentKind, code: p });
                continue;
            }
            var rm = /^(\d{3})>(\d{3})$/.exec(p);
            if (rm && currentState) {
                var a = parseInt(rm[1], 10), b = parseInt(rm[2], 10);
                for (var n = a; n <= b; n++) {
                    var pad = n < 10 ? "00" + n : (n < 100 ? "0" + n : "" + n);
                    entries.push({ state: currentState, kind: currentKind, code: pad });
                }
            }
        }
        return entries;
    }

    function parseTags(text) {
        var tags = {};
        var simple = [
            "TORNADO", "HAIL", "WIND", "FLASH FLOOD",
            "TORNADO DAMAGE THREAT", "THUNDERSTORM DAMAGE THREAT",
            "FLASH FLOOD DAMAGE THREAT",
            "SOURCE", "HAZARD", "IMPACT"
        ];
        for (var i = 0; i < simple.length; i++) {
            var key = simple[i];
            var re = new RegExp("^" + key.replace(/ /g, "\\s+") + "\\.\\.\\.(.+)$", "im");
            var m = re.exec(text);
            if (m) tags[key] = m[1].trim();
        }
        var hail = /^MAX\s+HAIL\s+SIZE\.\.\.(.+)$/im.exec(text);
        if (hail) tags["MAX HAIL SIZE"] = hail[1].trim();
        var wind = /^MAX\s+WIND\s+GUST\.\.\.(.+)$/im.exec(text);
        if (wind) tags["MAX WIND GUST"] = wind[1].trim();
        return tags;
    }

    function findEventName(lines, headerIdx) {
        for (var i = headerIdx; i < lines.length && i < headerIdx + 8; i++) {
            var line = lines[i].trim();
            if (/^[A-Z][a-z]/.test(line) && /(Warning|Watch|Advisory|Statement|Emergency)$/.test(line)) {
                return line;
            }
        }
        return null;
    }

    function parseBulletin(bulletin) {
        if (typeof bulletin !== "string" || bulletin.length === 0) {
            module_state.last = null;
            return null;
        }

        var lines = bulletin.replace(/\r\n?/g, "\n").split("\n").map(function (l) {
            return l.replace(/[ \t]+$/, "").replace(/^[ \t]+/, "");
        });

        var wmoIdx = -1, wmoMatch = null;
        for (var i = 0; i < lines.length; i++) {
            var wm = /^([A-Z]{4}\d{1,2})\s+([A-Z]{4})\s+(\d{6})$/.exec(lines[i]);
            if (wm) { wmoIdx = i; wmoMatch = wm; break; }
        }
        if (!wmoMatch) {
            module_state.last = null;
            return null;
        }

        var WMOId = wmoMatch[1];
        var vtecOffice = wmoMatch[2];
        var siteId = vtecOffice.length === 4 ? vtecOffice.slice(1) : vtecOffice;
        var wmoDDHHMM = wmoMatch[3];

        var awipsId = null;
        if (wmoIdx + 1 < lines.length && /^[A-Z0-9]{4,6}$/.test(lines[wmoIdx + 1])) {
            awipsId = lines[wmoIdx + 1];
        }

        var ugcLine = null;
        var vtecLine = null;
        var vtecMatch = null;
        var vtecRe = /\/([OTEX])\.([A-Z]+)\.([A-Z]{4})\.([A-Z]{2})\.([WAYS])\.(\d{4})\.(\d{6}T\d{4}Z)-(\d{6}T\d{4}Z)\//;
        for (var j = wmoIdx + 1; j < lines.length; j++) {
            if (!vtecMatch) {
                var vm = vtecRe.exec(lines[j]);
                if (vm) {
                    vtecMatch = vm;
                    vtecLine = lines[j];
                    if (j > 0) ugcLine = lines[j - 1];
                }
            }
            if (vtecMatch) break;
        }
        if (!vtecMatch) {
            module_state.last = null;
            return null;
        }

        var productClass = vtecMatch[1];
        var action = vtecMatch[2];
        var phenomenon = vtecMatch[4];
        var significance = vtecMatch[5];
        var etn = vtecMatch[6];
        var startTime = parseVtecDate(vtecMatch[7]);
        var endTime = parseVtecDate(vtecMatch[8]);

        var phensig = phenomenon + "." + significance;
        var product = PRODUCT_BY_PHENSIG[phensig]
            || (awipsId ? awipsId.slice(0, 3) : null);

        var areas = ugcLine ? parseUgc(ugcLine) : [];

        var polyIdx = -1;
        for (var k = 0; k < lines.length; k++) {
            if (/^LAT\.\.\.LON\b/.test(lines[k])) { polyIdx = k; break; }
        }
        var polygon = polyIdx >= 0 ? parsePolygon(lines, polyIdx) : null;
        if (!polygon) {
            module_state.last = null;
            return null;
        }

        var tmlIdx = -1;
        for (var t = polyIdx; t < lines.length; t++) {
            if (/^TIME\.\.\.MOT\.\.\.LOC\b/.test(lines[t])) { tmlIdx = t; break; }
        }
        var motion = tmlIdx >= 0 ? parseTML(lines[tmlIdx]) : null;

        var eventName = findEventName(lines, wmoIdx + (awipsId ? 2 : 1));
        if (!eventName && PHENOMENON_NAMES[phenomenon] && SIGNIFICANCE_NAMES[significance]) {
            eventName = PHENOMENON_NAMES[phenomenon] + " " + SIGNIFICANCE_NAMES[significance];
        }

        var tags = parseTags(bulletin);

        var result = {
            valid: true,
            raw: bulletin,
            polygon: polygon,
            product: product,
            awipsId: awipsId,
            office: vtecOffice,
            siteId: siteId,
            wmoId: WMOId,
            wmoIssuance: wmoDDHHMM,
            event: eventName,
            phenomenon: phenomenon,
            significance: significance,
            productClass: productClass,
            action: action,
            etn: etn,
            startTime: startTime,
            endTime: endTime,
            ugcLine: ugcLine,
            areas: areas,
            motion: motion,
            tags: tags
        };

        module_state.last = result;
        return result;
    }

    var module_state = { last: null };

    return {
        parseBulletin: parseBulletin,
        get last() { return module_state.last; },
        _parseVtecDate: parseVtecDate,
        _parseUgc: parseUgc,
        _parsePolygon: parsePolygon,
        _parseTML: parseTML,
        _parseTags: parseTags
    };

}));
