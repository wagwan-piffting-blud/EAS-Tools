(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenUtils = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    var TZ_OFFSETS = {

        EST: -300, EDT: -240,
        CST: -360, CDT: -300,
        MST: -420, MDT: -360,
        PST: -480, PDT: -420,
        AKST: -540, AKDT: -480,
        HST: -600,
        AST: -240, ADT: -180,
        SST: -660, GST:  600,
        CHST: 600,
        UTC: 0,    GMT: 0,
        Z:   0
    };

    function isUsDst(utcDate) {
        var y = utcDate.getUTCFullYear();
        var march = new Date(Date.UTC(y, 2, 1));
        var marchDow = march.getUTCDay();
        var dstStart = new Date(Date.UTC(y, 2, 1 + ((7 - marchDow) % 7) + 7, 7, 0, 0));
        var nov = new Date(Date.UTC(y, 10, 1));
        var novDow = nov.getUTCDay();
        var dstEnd = new Date(Date.UTC(y, 10, 1 + ((7 - novDow) % 7), 6, 0, 0));
        return utcDate >= dstStart && utcDate < dstEnd;
    }

    function effectiveZone(baseZone, utcDate, dstLess) {
        if (dstLess) return baseZone;
        var observesDst = (baseZone !== "HST" && baseZone !== "AST" && baseZone !== "GST" &&
                           baseZone !== "SST" && baseZone !== "CHST" && baseZone !== "UTC" &&
                           baseZone !== "GMT" && baseZone !== "Z");
        if (!observesDst) return baseZone;
        var inDst = isUsDst(utcDate);
        var map = {
            EST: inDst ? "EDT" : "EST",
            CST: inDst ? "CDT" : "CST",
            MST: inDst ? "MDT" : "MST",
            PST: inDst ? "PDT" : "PST",
            AKST: inDst ? "AKDT" : "AKST"
        };
        return map[baseZone] || baseZone;
    }

    function shiftMinutes(date, minutes) {
        return new Date(date.getTime() + (minutes * 60000));
    }

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }
    function pad4(n) {
        if (n < 10) return "000" + n;
        if (n < 100) return "00" + n;
        if (n < 1000) return "0" + n;
        return "" + n;
    }

    var MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun",
                       "Jul","Aug","Sep","Oct","Nov","Dec"];
    var DOW_SHORT   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

    function formatDate(date, fmt, baseZone, dstLess) {
        if (!(date instanceof Date)) date = new Date(date);
        var zone = baseZone || "UTC";
        var effZone = effectiveZone(zone, date, dstLess);
        var localOffset = TZ_OFFSETS[effZone];
        if (localOffset === undefined) localOffset = 0;
        var local = shiftMinutes(date, localOffset);

        var year = local.getUTCFullYear();
        var month = local.getUTCMonth();
        var day = local.getUTCDate();
        var hour24 = local.getUTCHours();
        var minute = local.getUTCMinutes();
        var second = local.getUTCSeconds();
        var dow = local.getUTCDay();
        var hour12 = hour24 % 12;
        if (hour12 === 0) hour12 = 12;
        var ampm = hour24 < 12 ? "AM" : "PM";

        var out = "";
        var i = 0;
        while (i < fmt.length) {
            var c = fmt.charAt(i);

            if (c === "'") {

                var end = fmt.indexOf("'", i + 1);
                if (end === -1) { out += fmt.slice(i + 1); break; }
                out += fmt.slice(i + 1, end);
                i = end + 1;
                continue;
            }

            if (fmt.substr(i, 4) === "yyyy") { out += pad4(year); i += 4; continue; }
            if (fmt.substr(i, 2) === "yy")   { out += pad2(year % 100); i += 2; continue; }
            if (fmt.substr(i, 3) === "MMM")  { out += MONTH_SHORT[month]; i += 3; continue; }
            if (fmt.substr(i, 2) === "MM")   { out += pad2(month + 1); i += 2; continue; }
            if (c === "M")                    { out += (month + 1); i += 1; continue; }
            if (fmt.substr(i, 3) === "EEE")  { out += DOW_SHORT[dow]; i += 3; continue; }
            if (fmt.substr(i, 2) === "dd")   { out += pad2(day); i += 2; continue; }
            if (c === "d")                    { out += day; i += 1; continue; }
            if (fmt.substr(i, 2) === "HH")   { out += pad2(hour24); i += 2; continue; }
            if (c === "H")                    { out += hour24; i += 1; continue; }
            if (fmt.substr(i, 2) === "hh")   { out += pad2(hour12); i += 2; continue; }
            if (c === "h")                    { out += hour12; i += 1; continue; }
            if (fmt.substr(i, 2) === "mm")   { out += pad2(minute); i += 2; continue; }
            if (fmt.substr(i, 2) === "ss")   { out += pad2(second); i += 2; continue; }
            if (c === "a" || c === "A")      { out += ampm; i += 1; continue; }
            if (c === "z")                    { out += effZone; i += 1; continue; }

            out += c;
            i += 1;
        }
        return out;
    }

    function makeDateUtil(dstLessMap) {
        var map = dstLessMap || {};
        function isDstLess(tz) { return !!map[tz]; }
        return {

            format: function (date, fmt, tz, offsetMinutes) {
                var d = (date instanceof Date) ? date : new Date(date);
                if (typeof offsetMinutes === "number" && offsetMinutes !== 0) {
                    d = shiftMinutes(d, offsetMinutes);
                }
                return formatDate(d, fmt, tz, isDstLess(tz));
            },

            formatUseNoonMidnight: function (date, fmt, intervalMinutes, tz) {
                var dstLess = isDstLess(tz);
                var d = (date instanceof Date) ? date : new Date(date);
                var ms = d.getTime();
                var step = (intervalMinutes || 1) * 60000;
                var rounded = new Date(Math.ceil(ms / step) * step);

                var effZone = effectiveZone(tz || "UTC", rounded, dstLess);
                var localOffset = TZ_OFFSETS[effZone];
                if (localOffset === undefined) localOffset = 0;
                var local = shiftMinutes(rounded, localOffset);
                var localHour = local.getUTCHours();
                var localMinute = local.getUTCMinutes();

                var formatted = formatDate(rounded, fmt, tz, dstLess);

                if (localMinute === 0) {
                    if (localHour === 12) {

                        formatted = formatted.replace(/^\d{1,2}:?00 (?:PM|AM)/, "Noon");
                    } else if (localHour === 0) {

                        formatted = formatted.replace(/^\d{1,2}:?00 (?:PM|AM)/, "Midnight");
                    }
                }
                return formatted;
            }
        };
    }

    var dateUtil = makeDateUtil({});

    var timeFormat = {
        ymdthmz: "yyMMdd'T'HHmm'Z'",
        header:  "hmm a z EEE MMM d yyyy",
        plain:   "h:mm a z",
        clock:   "hmm a z",
        time:    "HHmm"
    };

    var list = {
        contains: function (arr, item) {
            if (!arr) return false;
            if (typeof arr.indexOf === "function") return arr.indexOf(item) !== -1;
            return false;
        },
        size: function (arr) {
            if (!arr) return 0;
            if (typeof arr.length === "number") return arr.length;
            return 0;
        },
        get: function (arr, idx) {
            if (!arr) return null;
            if (typeof arr.length !== "number") return null;
            if (idx < 0 || idx >= arr.length) return null;
            return arr[idx];
        }
    };

    var mathUtil = {
        round: function (n) {
            return Math.round(Number(n));
        },
        abs: function (n) {
            return Math.abs(Number(n));
        },
        roundTo5: function (n) {
            return Math.round(Number(n) / 5) * 5;
        },

        roundAndPad: function (n) {
            var v = Math.round(Number(n));
            if (v < 0) v = 0;
            if (v < 10) return "00" + v;
            if (v < 100) return "0" + v;
            return "" + v;
        }
    };

    return {
        dateUtil:    dateUtil,
        makeDateUtil: makeDateUtil,
        timeFormat:  timeFormat,
        list:        list,
        mathUtil:    mathUtil,

        _isUsDst:        isUsDst,
        _effectiveZone:  effectiveZone,
        _formatDate:     formatDate
    };
}));
