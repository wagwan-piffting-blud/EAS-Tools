(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenUGC = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }
    function pad3(n) {
        if (n < 10) return "00" + n;
        if (n < 100) return "0" + n;
        return "" + n;
    }

    function collapseRanges(sortedFips) {
        var pieces = [];
        var i = 0;
        while (i < sortedFips.length) {
            var runEnd = i;
            while (runEnd + 1 < sortedFips.length &&
                   sortedFips[runEnd + 1] === sortedFips[runEnd] + 1) {
                runEnd += 1;
            }
            if (runEnd - i >= 2) {
                pieces.push(pad3(sortedFips[i]) + ">" + pad3(sortedFips[runEnd]));
            } else {
                for (var j = i; j <= runEnd; j++) pieces.push(pad3(sortedFips[j]));
            }
            i = runEnd + 1;
        }
        return pieces;
    }

    function wrapUGC(line, maxCols) {
        if (!maxCols) maxCols = 64;
        if (line.length <= maxCols) return line;
        var out = [];
        var work = line;
        while (work.length > maxCols) {
            var breakAt = work.lastIndexOf("-", maxCols);
            if (breakAt <= 0) breakAt = maxCols;
            out.push(work.slice(0, breakAt + 1));
            work = work.slice(breakAt + 1);
        }
        if (work.length > 0) out.push(work);
        return out.join("\n");
    }

    function build(areas, expireDate, formatCode) {
        formatCode = formatCode || "C";

        var stateOrder = [];
        var byState = {};
        for (var i = 0; i < areas.length; i++) {
            var a = areas[i];
            var st = String(a.state).toUpperCase();
            // County areas carry the full SSCCC code for the headline macros; the UGC line
            // only ever wants the three-digit tail.
            var fips = parseInt(String(a.fips).slice(-3), 10);
            if (isNaN(fips)) continue;
            if (!byState[st]) {
                byState[st] = [];
                stateOrder.push(st);
            }
            if (byState[st].indexOf(fips) === -1) byState[st].push(fips);
        }

        var sections = [];
        for (var i = 0; i < stateOrder.length; i++) {
            var st = stateOrder[i];
            var fipsList = byState[st].sort(function (x, y) { return x - y; });
            sections.push(st + formatCode + collapseRanges(fipsList).join("-"));
        }

        var d = expireDate.getUTCDate();
        var h = expireDate.getUTCHours();
        var m = expireDate.getUTCMinutes();
        var purge = pad2(d) + pad2(h) + pad2(m);

        var full = sections.join("-") + "-" + purge + "-";
        return wrapUGC(full, 64);
    }

    return {
        build:           build,
        collapseRanges:  collapseRanges,
        wrapUGC:         wrapUGC
    };
}));
