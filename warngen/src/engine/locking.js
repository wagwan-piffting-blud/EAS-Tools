(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenLocking = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    /*
     * Port of com.raytheon.viz.warngen.text: WarnGenPatterns, AbstractLockingBehavior,
     * InitialLockingBehavior, FollowUpLockingBehavior, CorModifyTextBehavior and the
     * clean() pass of WarningTextHandler. WarnGen wraps the parts a forecaster may not
     * edit in <L>...</L>; the Text Workstation turns those into uneditable text.
     */

    var LOCK_START = "<L>";
    var LOCK_END = "</L>";

    var WARNING_TYPE = "(FLOOD ADVISORY)|(FLOOD WARNING)|(FLOOD STATEMENT)"
        + "|(SEVERE WEATHER STATEMENT)|(EXTREME WIND WARNING)|(FIRE WARNING)"
        + "|(FLASH FLOOD WARNING)|(FLASH FLOOD STATEMENT)|(SEVERE THUNDERSTORM WARNING)"
        + "|(TORNADO WARNING)|(MARINE WEATHER STATEMENT)|(SHORT TERM FORECAST)"
        + "|(SPECIAL WEATHER STATEMENT)|(SPECIAL MARINE WARNING)"
        + "|(DUST STORM WARNING)|(DUST ADVISORY)|(SNOW SQUALL WARNING)";

    var UGC = "(^(\\w{2}[CZ]\\d{3}\\S*-\\d{6}-)$|((\\d{3}-)*\\d{6}-)$|((\\d{3}-)+))";
    var LIST_OF_AREA_NAME = "^((" + LOCK_END + "){0,1}((([\\?\\(\\)\\w\\.,/'-]+\\s{1,})+\\w{2}-)*"
        + "(([\\?\\(\\)\\w\\.,/'-]+\\s{1,})+\\w{2}-)))";

    var P = {
        ugc:          UGC + "\\n",
        listOfAreas:  LIST_OF_AREA_NAME + "\\n",
        firstBullet:  "^(\\* (.*) (WARNING|ADVISORY)( FOR(.*)|\\.\\.\\.)\\n)",
        date:         "^((" + LOCK_END + "){0,1}\\d{3,4} (AM|PM) (\\w{3,4}) \\w{3} (\\w{3})\\s+(\\d{1,2}) (\\d{4})\\n)",
        header:       "^((THE NATIONAL WEATHER SERVICE IN .{1,} HAS (ISSUED A|EXTENDED THE))\\n)$",
        secondBullet: "\\* UNTIL (\\d{3,4} (AM|PM)|NOON|MIDNIGHT) \\w{3,4}( \\w{6,9}){0,1}"
            + "(\\/(\\d{3,4} (AM|PM)|NOON|MIDNIGHT) \\w{3,4}( \\w{6,9}){0,1}\\/){0,1}\\.{0,1}\\n",
        htec:         "^((" + LOCK_END + "){0,1}/[A-Za-z0-9]{5}.[0-3NU].\\w{2}.\\d{6}T\\d{4}Z.\\d{6}T\\d{4}Z.\\d{6}T\\d{4}Z.\\w{2}/\\n)",
        vtec:         "^((" + LOCK_END + "){0,1}/[OTEX]\\.([A-Z]{3})\\.[A-Za-z0-9]{4}\\.[A-Z]{2}\\.[WAYSFON]\\.\\d{4}\\.\\d{6}T\\d{4}Z-\\d{6}T\\d{4}Z/\\n)",
        tml:          "^((" + LOCK_END + "){0,1}(TIME\\.\\.\\.MOT\\.\\.\\.LOC \\d{3,4}Z \\d{3}DEG \\d{1,3}KT(( \\d{3,4} \\d{3,5}){1,})(\\s*\\d{3,5} )*)\\s*\\n)",
        test:         "(THIS IS A TEST MESSAGE\\. DO NOT TAKE ACTION BASED ON THIS MESSAGE\\.\\n)|(THIS IS A TEST MESSAGE\\.)|(\\.\\.\\.THIS MESSAGE IS FOR TEST PURPOSES ONLY\\.\\.\\.\\n)",
        cta:          "(^(PRECAUTIONARY/PREPAREDNESS ACTIONS\\.\\.\\.\\n))|(^(&&\\n))|(^(\\$\\$\\n))",
        latLon:       "^((LAT\\.\\.\\.LON( \\d{3,4} \\d{3,5})+)\\n)(((\\s{5}( \\d{3,4} \\d{3,5})+)\\n)+)?",
        startMND:     "(BULLETIN - IMMEDIATE BROADCAST REQUESTED)|(BULLETIN - EAS ACTIVATION REQUESTED)|" + WARNING_TYPE,
        headline:     "^\\.\\.\\.(AN?|THE) (.*) (WARNING|ADVISORY) .*(REMAINS|EXPIRE|CANCELLED).*(\\.\\.\\.)$",
        expire:       "(HAS BEEN ALLOWED TO EXPIRE)|(WILL BE ALLOWED TO EXPIRE)|(WILL EXPIRE)|(HAS EXPIRED)|EXPIRED",
        time:         "AT \\d{3,4} (AM|PM) \\w{3,4}(\\/\\d{3,4} (AM|PM) \\w{3,4}\\/){0,1}",
        remains:      "REMAINS IN EFFECT UNTIL \\d{3,4} (AM|PM) \\w{3,4}(\\/\\d{3,4} (AM|PM) \\w{3,4}\\/){0,1}",
        canceled:     "(IS|(HAS BEEN)) CANCELLED",
        warning:      "(AN?|THE)( [\\w\\s]*?)(" + WARNING_TYPE + ")"
    };

    function re(src, flags) {
        return new RegExp(src, flags);
    }

    function wrap(g) {
        return LOCK_START + g + LOCK_END;
    }

    // AbstractLockingBehavior.find: a match that opens with a stray </L> slides it to the end.
    function find(text, src, flags) {
        return text.replace(re(src, "g" + (flags || "")), function (g) {
            if (g.indexOf(LOCK_END) === 0) return g.slice(LOCK_END.length) + LOCK_END;
            return wrap(g);
        });
    }

    function countOf(s, needle) {
        return s.split(needle).length - 1;
    }

    function validate(s) {
        return countOf(s, LOCK_START) === countOf(s, LOCK_END);
    }

    function hasBeenLocked(line, name) {
        var index = line.indexOf(name);
        if (index === -1) return false;
        var startBefore = line.lastIndexOf(LOCK_START, index);
        var endBefore = line.lastIndexOf(LOCK_END, index);
        var startAfter = line.indexOf(LOCK_START, index);
        var endAfter = line.indexOf(LOCK_END, index);
        if (startBefore !== -1 && endAfter !== -1 && startBefore < endAfter) {
            if (startAfter !== -1 && startAfter < endAfter && startAfter > startBefore) return false;
            if (endBefore !== -1 && endBefore > startBefore && endBefore < endAfter) return false;
            return true;
        }
        return false;
    }

    function replaceAllLiteral(s, find, repl) {
        return s.split(find).join(repl);
    }

    function immediateCausePattern(immediateCauseText) {
        var parts = ["(.*)(A DAM BREAK"];
        String(immediateCauseText || "").split("\n").forEach(function (line) {
            var bits = line.split("\\");
            if (bits.length > 1 && bits[1].trim()) parts.push("| " + bits[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        });
        return re(parts.join("") + ")(.*)", "i");
    }

    function isMarineProduct(text) {
        var m = /\/[OTEX]\.[A-Z]{3}\.[A-Z0-9]{4}\.([A-Z]{2})\./.exec(text);
        return !!(m && m[1] === "MA");
    }

    // Upstream reads the PIL after the "000000" placeholder; ours sits on the line after the WMO heading.
    function isDesiredPil(text) {
        var lines = text.split("\n");
        return /^(SPS|NOW)/.test((lines[1] || "").trim());
    }

    function lock(text, opts) {
        opts = opts || {};
        var areas = (opts.areas || []).concat(opts.canceledAreas || []).filter(Boolean)
            .slice().sort(function (a, b) { return String(b.name || "").length - String(a.name || "").length; });
        var followup = !!opts.followup;
        var marine = isMarineProduct(text);

        text = find(text, P.ugc, "m");
        text = find(text, P.htec, "m");
        text = find(text, P.vtec, "m");
        if (isDesiredPil(text) && !re(P.listOfAreas, "m").test(text)) {
            text = lockListOfNames(text);
        } else {
            text = find(text, P.listOfAreas, "mi");
        }
        text = mnd(text);
        text = find(text, P.date, "m");
        if (followup) text = headlines(text, areas, marine);
        text = find(text, P.header, "mi");
        text = firstBullet(text, areas, marine, opts.immediateCause);
        text = find(text, P.secondBullet, "mi");
        text = find(text, P.cta, "m");
        text = find(text, P.latLon, "m");
        text = find(text, P.tml, "m");
        text = find(text, P.test, "");
        text = text.replace(new RegExp(LOCK_END + "(\\s*)" + LOCK_START, "g"), "$1");
        return text;
    }

    function mnd(text) {
        var s = re(P.startMND, "i").exec(text);
        var d = re(P.date, "m").exec(text);
        if (!s || !d || s.index >= d.index) return text;
        var sub = text.slice(s.index, d.index);
        return text.replace(sub, wrap(sub));
    }

    function bulletIndices(text) {
        var out = [];
        var i = text.indexOf("\n* ");
        while (i >= 0) {
            out.push(i + 1);
            i = text.indexOf("\n* ", i + 3);
        }
        return out;
    }

    function firstBullet(text, areas, marine, immediateCauseText) {
        var idx = bulletIndices(text);
        if (idx.length < 2) return text;
        var start = idx[0], end = idx[1];
        var chunk = text.slice(start, end);
        var causeRe = immediateCauseText != null ? immediateCausePattern(immediateCauseText) : null;

        if (!marine) {
            chunk = chunk.split("\n").map(function (line) {
                if (causeRe && causeRe.test(line)) return wrap(line);
                var cut = line.toUpperCase().indexOf(" IN ");
                var search = cut === -1 ? line : line.slice(0, cut);
                for (var i = 0; i < areas.length; i++) {
                    var a = areas[i];
                    var name = a.name;
                    if (!name || !String(name).trim() || search.indexOf(name) === -1) continue;
                    var t = line;
                    if (!hasBeenLocked(line, name)) t = replaceAllLiteral(t, name, wrap(name));
                    if (a.areaNotation && String(a.areaNotation).trim() && !hasBeenLocked(line, a.areaNotation)) {
                        t = replaceAllLiteral(t, a.areaNotation, wrap(a.areaNotation));
                    }
                    if (a.parentRegion && String(a.parentRegion).trim() && !hasBeenLocked(line, a.parentRegion)) {
                        t = replaceAllLiteral(t, a.parentRegion, wrap(a.parentRegion));
                    }
                    if (validate(t)) line = t;
                    break;
                }
                return line;
            }).join("\n");
        }
        chunk = chunk.replace(re(P.firstBullet, "gi"), function (g) { return wrap(g); });
        return text.slice(0, start) + chunk + text.slice(end);
    }

    function headlines(text, areas, marine) {
        return text.replace(re(P.headline, "gmi"), function (original) {
            var h = original;
            if (marine) {
                h = wrap(h);
            } else {
                var notations = {}, names = {};
                areas.forEach(function (a) {
                    if (a.areaNotation && String(a.areaNotation).trim()) notations[String(a.areaNotation).toUpperCase()] = 1;
                    if (a.areasNotation && String(a.areasNotation).trim()) notations[String(a.areasNotation).toUpperCase()] = 1;
                    if (a.name && String(a.name).trim()) names[String(a.name).toUpperCase()] = 1;
                });
                h = h.replace(/^\.\.\./, wrap("..."));
                if (/\.\.\.$/.test(h)) h = h.slice(0, -3) + wrap("...");
                h = h.replace(re(P.warning, "gmi"), LOCK_START + "$1" + LOCK_END + "$2" + LOCK_START + "$3" + LOCK_END);
                Object.keys(notations).forEach(function (n) {
                    if (!hasBeenLocked(h, n)) h = replaceAllLiteral(h, n, wrap(n));
                });
                Object.keys(names).forEach(function (n) {
                    if (!hasBeenLocked(h, n)) h = replaceAllLiteral(h, n, wrap(n));
                });
            }
            h = h.replace(re(P.remains, "mi"), function (g) { return wrap(g); });
            h = h.replace(re(P.expire, "gmi"), function (g) { return wrap(g); });
            h = h.replace(re(P.time, "gmi"), function (g) { return wrap(g); });
            h = h.replace(re(P.canceled, "gmi"), function (g) { return wrap(g); });
            return h;
        });
    }

    // Area names on an SPS/NOW that carry no state suffix ("Douglas-Sarpy-").
    function lockListOfNames(text) {
        var m = re(P.ugc, "m").exec(text);
        if (!m) return text;
        var index = m.index + m[0].length;
        var rest = text.slice(index, text.length - 1);
        var head = "";
        var marks = [" AM ", " PM ", "NOON", "MIDNIGHT"];
        for (var i = 0; i < marks.length; i++) {
            var at = rest.indexOf(marks[i]);
            if (at !== -1) { head = rest.slice(0, at); break; }
        }
        if (!head) return text;
        var i1 = head.indexOf(LOCK_END), i2 = head.lastIndexOf("-");
        if (i1 === -1 || i2 === -1 || i2 + 1 < i1 + 4) return text;
        var names = head.slice(i1 + 4, i2 + 1);
        var at2 = text.indexOf(names);
        return text.slice(0, at2) + wrap(names) + text.slice(at2 + names.length);
    }

    // CorModifyTextBehavior: "...CORRECTED" after the product type (upper-case text only upstream).
    function markCorrected(text) {
        var index = text.indexOf("NATIONAL WEATHER SERVICE");
        if (index <= 0 || text.indexOf("...CORRECTED") !== -1) return text;
        var types = ["WARNING", "WATCH", "STATEMENT", "ADVISORY"];
        for (var i = 0; i < types.length; i++) {
            var at = text.lastIndexOf(types[i], index);
            if (at > 0) {
                var cut = at + types[i].length;
                return text.slice(0, cut) + "...CORRECTED" + text.slice(cut);
            }
        }
        return text;
    }

    // WarningTextHandler.clean: collapse blank runs (lock tags alone count as blank), then
    // unwrap locks that hold only whitespace.
    function clean(text) {
        var out = [];
        var blank = false;
        text.replace(/\r/g, "").trim().split("\n").forEach(function (line) {
            if (strip(line).trim().length > 0) {
                out.push(line);
                blank = false;
            } else if (!blank) {
                out.push(line);
                blank = true;
            }
        });
        return out.join("\n").trim().replace(/<L>(\s*)<\/L>/g, "$1");
    }

    function strip(text) {
        return String(text).replace(/<\/?L>/g, "");
    }

    return {
        LOCK_START:    LOCK_START,
        LOCK_END:      LOCK_END,
        lock:          lock,
        markCorrected: markCorrected,
        clean:         clean,
        strip:         strip
    };
}));
