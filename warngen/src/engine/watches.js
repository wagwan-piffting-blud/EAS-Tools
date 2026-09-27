(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./utils.js"), require("./civil.js"));
    } else {
        root.WarngenWatches = factory(root.WarngenUtils, root.WarngenCivil);
    }
}(typeof self !== "undefined" ? self : this, function (utils, civil) {

    /**
     * Watch products AWIPS WarnGen never makes. The SPC's SEL/WOU/WWP come from SPC software,
     * the WCN from GHG, and the zone watches from GFE hazard formatters. Wording and layout
     * follow the IEM corpus and the GFE sources noted per function (see WATCH-TEMPLATES.md).
     */
    var PRODUCTS = [
        { id: "SPC-TO", family: "spc", phen: "TO", name: "Tornado Watch" },
        { id: "SPC-SV", family: "spc", phen: "SV", name: "Severe Thunderstorm Watch" },
        { id: "WCN", family: "wcn", name: "Watch County Notification" },
        { id: "WS", family: "zone", phen: "WS", pil: "WSW", name: "Winter Storm Watch" },
        { id: "EC", family: "zone", phen: "EC", pil: "NPW", name: "Extreme Cold Watch" },
        { id: "HW", family: "zone", phen: "HW", pil: "NPW", name: "High Wind Watch" },
        { id: "FA", family: "zone", phen: "FA", pil: "FFA", name: "Flood Watch" },
        { id: "FW", family: "zone", phen: "FW", pil: "RFW", name: "Fire Weather Watch" },
        { id: "CF", family: "zone", phen: "CF", pil: "CFW", name: "Coastal Flood Watch" },
        { id: "TCV", family: "tropical", pil: "TCV", name: "Tropical Cyclone Watch/Warning" },
        { id: "HLS", family: "tropical", pil: "HLS", name: "Tropical Cyclone Local Statement" }
    ];
    var PRODUCT_BY_ID = {};
    PRODUCTS.forEach(function (p) { PRODUCT_BY_ID[p.id] = p; });

    // SAME event codes for the EAS side; EC and FW have none in the 47 CFR 11.31 table.
    var SAME = { TO: "TOA", SV: "SVA", WS: "WSA", HW: "HWA", FA: "FFA", CF: "CFA", HU: "HUA", TR: "TRA", SS: "SSA" };

    var WATCH_NAME = { TO: "Tornado Watch", SV: "Severe Thunderstorm Watch" };

    // GHG (WCN) and the WOU wrap at 66, modern GFE hazard products at 69, and the SPC's text at 68
    // with no rule against breaking after a number.
    var LINE = 66;
    var LINE_GFE = 69;
    var LINE_SPC = 68;
    var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }
    function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }

    function ddhhmm(d) {
        return pad2(d.getUTCDate()) + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes());
    }

    function vtecTime(d) {
        return pad2(d.getUTCFullYear() % 100) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate())
            + "T" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + "Z";
    }

    var ZERO_TIME = "000000T0000Z";

    /** An event already in effect carries a zero begin time on every action but NEW/EXA/EXB. */
    function vtec(o) {
        var start = o.start && o.start.getTime() > o.issued.getTime() ? vtecTime(o.start) : ZERO_TIME;
        if (["NEW", "EXA", "EXB"].indexOf(o.action) !== -1 && o.start) {
            start = vtecTime(o.start.getTime() < o.issued.getTime() ? o.issued : o.start);
        }
        var end = o.end ? vtecTime(o.end) : ZERO_TIME;
        return "/" + (o.productClass || "O") + "." + o.action + "." + o.office + "." + o.phen + "."
            + o.sig + "." + pad(o.etn, 4) + "." + start + "-" + end + "/";
    }

    function wrap(text, width, breaks) {
        return civil.endline(text, width || LINE, breaks || [" ", "..."]).replace(/\n$/, "");
    }

    /** Greedy word wrap at spaces, for the SPC's text. */
    function wrapPlain(text, width) {
        return String(text).split("\n").map(function (para) {
            var words = para.split(" ");
            var lines = [];
            var cur = "";
            words.forEach(function (w) {
                if (cur && (cur + " " + w).length > width) {
                    lines.push(cur);
                    cur = w;
                } else {
                    cur = cur ? cur + " " + w : w;
                }
            });
            lines.push(cur);
            return lines.join("\n");
        }).join("\n");
    }

    /** First line flush, continuations indented; the way GFE's indentText lays out bullets. */
    function hanging(text, width, first, rest, plain) {
        var flat = text.replace(/\s+/g, " ").trim();
        function w(s, n) { return plain ? wrapPlain(s, n) : wrap(s, n, [" ", "..."]); }
        var firstText = w(flat, width - first.length).split("\n")[0];
        var remainder = flat.slice(firstText.length).trim();
        var lines = [firstText].concat(remainder ? w(remainder, width - rest.length).split("\n") : []);
        return lines.map(function (l, i) { return (i === 0 ? first : rest) + l; }).join("\n");
    }

    function ugcLine(codes, purge, ranges) {
        var list = codes.slice().sort();
        var body = ranges === false ? list.map(function (c, i) {
            return (i === 0 || c.slice(0, 3) !== list[i - 1].slice(0, 3)) ? c : c.slice(3);
        }).join("-") : civil.makeUGCString(list);
        return wrap(body + "-" + ddhhmm(purge) + "-", LINE, ["-"]);
    }

    // Header.getExpireTime with VTEC: the purge is the event end when it comes first,
    // otherwise issue time plus purgeTime, then up to the quarter hour.
    function gfePurge(issued, end, hours) {
        var cap = civil.expireTime(issued, hours);
        return end && end.getTime() < cap.getTime() && end.getTime() > issued.getTime() ? end : cap;
    }

    // ---- local time helpers ----

    function local(date, tz, dstLess) {
        var off = utils._zoneOffsetMinutes(tz, date, dstLess);
        var d = new Date(date.getTime() + off * 60000);
        return {
            h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay(),
            day: Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000),
            abbr: utils._formatDate(date, "z", tz, !!dstLess)
        };
    }

    function stamp(date, tz, dstLess, fmt) {
        return utils._formatDate(date, fmt || "hmm a z EEE MMM d yyyy", tz || "UTC", !!dstLess);
    }

    function hourStr(lt) {
        var h = lt.h % 12 === 0 ? 12 : lt.h % 12;
        return h + " " + (lt.h < 12 ? "AM" : "PM");
    }

    // ---- DiscretePhrases.getTimingPhrase, single time zone ----

    var HR = 3600;

    function tableLookup(table, hourmin, type) {
        for (var i = 0; i < table.length; i++) {
            var t = table[i];
            if (type === "start" && hourmin >= t[0] && hourmin < t[1]) return t[2];
            if (type === "end" && hourmin <= t[1]) return t[2];
        }
        return "<day>";
    }

    function dayWords(desc, lt) {
        return desc.replace("<dayOfWeek>", DAYS[lt.dow]).replace("<dayOfWeek-1>", DAYS[(lt.dow + 6) % 7]);
    }

    function wordsExplicit(issued, event, tz, dstLess, type) {
        var li = local(issued, tz, dstLess);
        var le = local(event, tz, dstLess);
        var diff = le.day - li.day;
        var hm = le.h * HR + le.mi * 60;
        var desc;
        if (diff === 0) {
            desc = tableLookup([[0, 6 * HR, "early this morning"], [6 * HR, 12 * HR - 1, "this morning"],
                [12 * HR, 12 * HR + 1, "today"], [12 * HR + 1, 18 * HR - 1, "this afternoon"],
                [18 * HR, 24 * HR, "this evening"]], hm, type);
        } else {
            desc = dayWords(tableLookup(diff === 1
                ? [[0, 1, "tonight"], [0, 24 * HR, "<dayOfWeek>"]]
                : [[0, 1, "<dayOfWeek-1> night"], [0, 24 * HR, "<dayOfWeek>"]], hm, type), le);
        }
        var hs = hourStr(le);
        if (hs === "12 PM" && desc === "today") hs = "noon";
        if (hs === "12 AM") hs = "midnight";
        return [hs, le.abbr, desc];
    }

    function wordsFuzzy4(issued, event, tz, dstLess, type) {
        var li = local(issued, tz, dstLess);
        var le = local(event, tz, dstLess);
        var diff = le.day - li.day;
        var hm = le.h * HR + le.mi * 60;
        var desc;
        if (diff === 0) {
            desc = tableLookup([[0, 6 * HR, "early this morning"], [6 * HR, 12 * HR, "this morning"],
                [12 * HR, 18 * HR, "this afternoon"], [18 * HR, 24 * HR, "this evening"]], hm, type);
        } else if (diff === 1) {
            desc = dayWords(tableLookup([[0, 0, "this evening"], [0, 6 * HR, "late tonight"],
                [6 * HR, 12 * HR, "<dayOfWeek> morning"], [12 * HR, 18 * HR, "<dayOfWeek> afternoon"],
                [18 * HR, 24 * HR, "<dayOfWeek> evening"]], hm, type), le);
        } else {
            desc = dayWords(tableLookup([[0, 0, "<dayOfWeek-1> evening"], [0, 6 * HR, "late <dayOfWeek-1> night"],
                [6 * HR, 12 * HR, "<dayOfWeek> morning"], [12 * HR, 18 * HR, "<dayOfWeek> afternoon"],
                [18 * HR, 24 * HR, "<dayOfWeek> evening"]], hm, type), le);
        }
        return [null, null, desc];
    }

    function timingType(h, issued) {
        var dS = (h.start.getTime() - issued.getTime()) / 1000;
        var dE = (h.end.getTime() - issued.getTime()) / 1000;
        if (dE <= 0) return ["NONE", "NONE"];
        if (h.action === "UPG" || h.action === "CAN") return ["NONE", "NONE"];
        if (h.action === "EXP") return ["NONE", "EXPLICIT"];
        var ps = h.phen + "." + h.sig;
        if (ps === "TO.A" || ps === "SV.A") return [dS < 3 * HR ? "NONE" : "EXPLICIT", "EXPLICIT"];
        if (["HU.A", "HU.W", "TR.A", "TR.W", "SS.A", "SS.W"].indexOf(ps) !== -1) return ["NONE", "NONE"];
        if (h.sig === "W" || h.sig === "Y") return [dS < 3 * HR ? "NONE" : "EXPLICIT", "EXPLICIT"];
        var start = dS < 3 * HR ? "NONE" : (dS < 12 * HR ? "EXPLICIT" : "FUZZY4");
        return [start, dE < 12 * HR ? "EXPLICIT" : "FUZZY4"];
    }

    var CONNECTOR = {
        "NONE/NONE": [null, null], "NONE/EXPLICIT": [null, "until"], "NONE/FUZZY4": [null, "through"],
        "EXPLICIT/EXPLICIT": ["from", "to"], "EXPLICIT/FUZZY4": ["from", "through"],
        "FUZZY4/FUZZY4": ["from", "through"], "FUZZY4/EXPLICIT": ["from", "to"]
    };

    /** "from Saturday evening through Sunday evening", "until 6 PM CST this evening", ... */
    function timingPhrase(h, issued, tz, dstLess) {
        var types = timingType(h, issued);
        var st = types[0], et = types[1];
        if (st === "NONE" && et === "NONE") return "";
        var s = st === "EXPLICIT" ? wordsExplicit(issued, h.start, tz, dstLess, "start")
            : (st === "FUZZY4" ? wordsFuzzy4(issued, h.start, tz, dstLess, "start") : null);
        var e = et === "EXPLICIT" ? wordsExplicit(issued, h.end, tz, dstLess, "end")
            : (et === "FUZZY4" ? wordsFuzzy4(issued, h.end, tz, dstLess, "end") : null);
        var con = h.action === "EXP" ? [null, "at"] : (CONNECTOR[st + "/" + et] || ["from", "through"]);
        var sp = con[0], ep = con[1];
        function noon(x) { return x === "12 PM" ? "noon" : x; }
        if (st === "NONE" && et === "EXPLICIT") return ep + " " + noon(e[0]) + " " + e[1] + " " + e[2];
        if (st === "NONE") return ep + " " + e[2];
        if (st === "EXPLICIT" && et === "EXPLICIT") {
            var sd = s[2], ed = e[2];
            if (sd === "early this morning" && ed === "this morning") sd = "this morning";
            if (s[1] === e[1] && sd === ed) return sp + " " + noon(s[0]) + " " + ep + " " + noon(e[0]) + " " + e[1] + " " + ed;
            return sp + " " + noon(s[0]) + " " + sd + " " + ep + " " + noon(e[0]) + " " + e[1] + " " + ed;
        }
        if (st === "EXPLICIT") return sp + " " + noon(s[0]) + " " + s[1] + " " + s[2] + " " + ep + " " + e[2];
        if (et === "EXPLICIT") return sp + " " + s[2] + " " + ep + " " + noon(e[0]) + " " + e[1] + " " + e[2];
        if (s[2] === e[2]) return s[2];
        return sp + " " + s[2] + " " + ep + " " + e[2];
    }

    // DiscretePhrases.actionControlWord
    function actionWords(action, issued, end) {
        if (["NEW", "EXA", "EXB"].indexOf(action) !== -1) return "in effect";
        if (action === "CON") return "remains in effect";
        if (action === "CAN") return "is cancelled";
        if (action === "EXT") return "now in effect";
        if (action === "EXP") return issued.getTime() >= end.getTime() ? "has expired" : "will expire";
        if (action === "UPG") return "no longer in effect";
        return "in effect";
    }

    function headline(h, issued, tz, dstLess) {
        var t = timingPhrase(h, issued, tz, dstLess);
        return (h.name + " " + actionWords(h.action, issued, h.end) + (t ? " " + t : "")).toUpperCase();
    }

    function sentence(s) {
        s = String(s || "").trim();
        if (!s) return s;
        s = s.charAt(0).toUpperCase() + s.slice(1);
        return /[.!?]$/.test(s) ? s : s + ".";
    }

    // ---- SPC: threat wording from WWP probabilities ----

    function inches(x) {
        var n = parseFloat(x);
        var s = String(Math.round(n * 100) / 100);
        return s + (n <= 1 ? " inch" : " inches");
    }

    function coverage(p) {
        if (p < 20) return null;
        if (p < 40) return "Isolated";
        if (p < 80) return "Scattered";
        return "Widespread";
    }

    function windLine(p, s, mph) {
        var cov = coverage(p);
        if (!cov) return null;
        var likely = p >= 60;
        var x = mph + " mph";
        if (s < 30) return cov + " damaging wind gusts to " + x + (likely ? " likely" : " possible");
        if (p < 40) return "Isolated significant damaging wind gusts to " + x + " possible";
        if (s < 60) {
            return likely ? cov + " damaging winds likely with isolated significant gusts to " + x + " possible"
                : cov + " damaging winds and isolated significant gusts to " + x + " possible";
        }
        return cov + " damaging winds and " + (p >= 80 && s >= 80 ? "scattered" : "isolated")
            + " significant gusts to " + x + " likely";
    }

    function hailLine(p, s, size) {
        var cov = coverage(p);
        if (!cov) return null;
        var likely = p >= 60;
        var x = inches(size) + " in diameter";
        if (s < 30) return cov + " large hail events to " + x + (likely ? " likely" : " possible");
        if (p < 40) return "Isolated very large hail events to " + x + " possible";
        if (s < 60) {
            return likely ? cov + " large hail likely with isolated very large hail events to " + x + " possible"
                : cov + " large hail and isolated very large hail events to " + x + " possible";
        }
        return cov + " large hail and " + (s >= 80 ? "scattered" : "isolated") + " very large hail events to " + x + " likely";
    }

    function tornadoLine(p, s) {
        if (p < 20) return null;
        if (p >= 95) {
            return s >= 90 ? "Numerous tornadoes and several intense tornadoes expected"
                : "Numerous tornadoes expected with a few intense tornadoes likely";
        }
        if (p < 30) return "A tornado or two possible";
        if (p < 50) return s >= 30 ? "A couple intense tornadoes possible" : "A couple tornadoes possible";
        if (p < 60) return s >= 30 ? "A few tornadoes and a couple intense tornadoes possible" : "A few tornadoes possible";
        if (p < 80) {
            if (s >= 60) return "A few tornadoes and a couple intense tornadoes likely";
            return s >= 30 ? "A few tornadoes likely with a couple intense tornadoes possible" : "A few tornadoes likely";
        }
        if (s >= 60) return "Several tornadoes and " + (s >= 80 ? "a few" : "a couple") + " intense tornadoes likely";
        return s >= 30 ? "Several tornadoes likely with a couple intense tornadoes possible" : "Several tornadoes likely";
    }

    /** Lines in SEL order: a tornado watch leads with tornadoes, a severe thunderstorm watch ends with them. */
    function threatLines(o) {
        var p = o.probs || {};
        var wind = windLine(p.wind10 || 0, p.wind65 || 0, o.maxGustMph || 60);
        var hail = hailLine(p.hail10 || 0, p.hail2 || 0, o.maxHail || 1);
        var tor = tornadoLine(p.tor2 || 0, p.torSig || 0);
        var wh = (p.hail10 || 0) > (p.wind10 || 0) ? [hail, wind] : [wind, hail];
        var lines = o.phen === "TO" ? [tor].concat(wh) : wh.concat([tor]);
        return lines.filter(Boolean);
    }

    // ---- SPC: SEL ----

    function spcPeriod(start, end, tz, dstLess) {
        var ls = local(start, tz, dstLess);
        var le = local(end, tz, dstLess);
        function part(h) {
            if (h >= 5 && h < 12) return "morning";
            if (h >= 12 && h < 17) return "afternoon";
            if (h >= 17 && h < 21) return "evening";
            return "night";
        }
        var sp = part(ls.h);
        var nextDay = le.day > ls.day;
        if (!nextDay || le.h <= 3) {
            var ep = nextDay ? "evening" : part(le.h === 0 && le.mi === 0 ? 23 : le.h);
            if (ep === "night" && sp !== "night") ep = "evening";
            var words = sp === ep ? sp : sp + " and " + ep;
            return "this " + DAYS[ls.dow] + " " + words;
        }
        var s2 = (sp === "evening" || sp === "night") ? "night" : sp;
        return "this " + DAYS[ls.dow] + " " + s2 + " and " + DAYS[le.dow] + " " + part(le.h);
    }

    function clock(date, tz, dstLess) {
        return stamp(date, tz, dstLess, "hmm a");
    }

    var REMEMBER = {
        TO: "REMEMBER...A Tornado Watch means conditions are favorable for tornadoes and severe thunderstorms in "
            + "and close to the watch area. Persons in these areas should be on the lookout for threatening "
            + "weather conditions and listen for later statements and possible warnings.",
        SV: "REMEMBER...A Severe Thunderstorm Watch means conditions are favorable for severe thunderstorms in "
            + "and close to the watch area. Persons in these areas should be on the lookout for threatening "
            + "weather conditions and listen for later statements and possible warnings. Severe thunderstorms "
            + "can and occasionally do produce tornadoes."
    };

    function spcHeader(o, wmo, pil) {
        return wmo + " KWNS " + ddhhmm(o.issued) + "\n" + pil + String(o.number % 10) + "\n";
    }

    function stateCodes(counties) {
        var seen = {};
        counties.forEach(function (c) { seen[c.state] = true; });
        return Object.keys(seen).sort();
    }

    /**
     * o: { phen, number, action (NEW/CAN), issued, start, end, originalIssued, tz, dstLess, counties
     *      [{state, stateName, fips, name, cwa}], regionLines [], probs, maxGustMph, maxHail, gustKt,
     *      tops, motion, pds, summary, forecaster, axis, otherWatches [], replaces }
     */
    function buildSel(o) {
        var phen = o.phen;
        var name = WATCH_NAME[phen];
        var states = stateCodes(o.counties);
        var ugc = wrap(states.map(function (s) { return s + "Z000"; }).join("-") + "-" + ddhhmm(o.end) + "-", LINE, ["-"]);
        var t = spcHeader(o, "WWUS20", "SEL") + "SPC WW " + ddhhmm(o.issued) + "\n" + ugc + "\n\n"
            + "URGENT - IMMEDIATE BROADCAST REQUESTED\n";

        if (o.action === "CAN" || o.action === "EXP") {
            var orig = o.originalIssued || o.start;
            t += name.toUpperCase() + " - NUMBER " + o.number + "\n"
                + "NWS STORM PREDICTION CENTER NORMAN OK\n"
                + stamp(o.issued, o.tz, o.dstLess).toUpperCase() + "\n\n"
                + "THE NWS STORM PREDICTION CENTER HAS CANCELLED\n"
                + name.toUpperCase() + " NUMBER " + o.number + " ISSUED AT "
                + clock(orig, o.tz, o.dstLess) + " " + local(orig, o.tz, o.dstLess).abbr + " FOR PORTIONS OF\n\n"
                + states.map(function (s) {
                    return "         " + String(o.stateNames[s] || s).toUpperCase();
                }).join("\n") + "\n";
            return { text: t, locked: true };
        }

        t += name + " Number " + o.number + "\n"
            + "NWS Storm Prediction Center Norman OK\n"
            + stamp(o.issued, o.tz, o.dstLess) + "\n\n"
            + "The NWS Storm Prediction Center has issued a\n\n"
            + "* " + name + " for portions of\n"
            + (o.regionLines || []).map(function (r) { return "  " + r; }).join("\n") + "\n\n";

        var eff = "* Effective " + spcPeriod(o.start, o.end, o.tz, o.dstLess) + " from "
            + clock(o.start, o.tz, o.dstLess) + " until " + clock(o.end, o.tz, o.dstLess) + " "
            + local(o.end, o.tz, o.dstLess).abbr + ".";
        t += hanging(eff, LINE_SPC, "", "  ", true) + "\n\n";

        if (o.pds) t += "...THIS IS A PARTICULARLY DANGEROUS SITUATION...\n\n";

        t += "* Primary threats include...\n" + threatLines(o).map(function (l) {
            return hanging(l, LINE, "  ", "    ", true);
        }).join("\n") + "\n\n";

        t += wrapPlain("SUMMARY..." + (o.summary && o.summary.trim()
            ? o.summary.replace(/\s+/g, " ").trim()
            : "!** Summary of the meteorological setup **!"), LINE_SPC) + "\n\n";

        var a = o.axis;
        var geo = "The " + name.toLowerCase() + " area is approximately along and " + (a ? a.width : "!** width **!")
            + " statute miles " + (a ? a.orient : "north and south") + " of a line from "
            + (a ? a.from.miles + " miles " + a.from.dir + " of " + a.from.city : "!** point **!") + " to "
            + (a ? a.to.miles + " miles " + a.to.dir + " of " + a.to.city : "!** point **!")
            + ". For a complete depiction of the watch see the associated watch outline update (WOUS64 KWNS WOU"
            + (o.number % 10) + ").";
        t += wrapPlain(geo, LINE_SPC) + "\n\n";

        t += "PRECAUTIONARY/PREPAREDNESS ACTIONS...\n\n" + wrapPlain(REMEMBER[phen], LINE_SPC) + "\n\n&&\n\n";

        var other = "";
        if (o.replaces && o.replaces.number) {
            var rk = (WATCH_NAME[o.replaces.phen] || "tornado watch").toLowerCase();
            other += "This " + name.toLowerCase() + " replaces " + rk + " number " + o.replaces.number
                + ". Watch number " + o.replaces.number + " will not be in effect after "
                + (o.replaces.until || "!** time **!") + ". ";
        }
        if (o.otherWatches && o.otherWatches.length) {
            other += "CONTINUE..." + o.otherWatches.map(function (n) { return "WW " + n + "..."; }).join("");
        }
        if (other) t += wrapPlain("OTHER WATCH INFORMATION..." + other.trim(), LINE_SPC) + "\n\n";

        var av = "AVIATION..." + (phen === "TO" ? "Tornadoes and a few" : "A few")
            + " severe thunderstorms with hail surface and aloft to " + inches(o.maxHail || 1)
            + ". Extreme turbulence and surface wind gusts to " + (o.gustKt || 50)
            + " knots. A few cumulonimbi with maximum tops to " + (o.tops || 450)
            + ". Mean storm motion vector " + (o.motion || "24030") + ".";
        t += wrapPlain(av, LINE_SPC) + "\n\n..." + (o.forecaster || "!** Forecaster **!") + "\n";
        return { text: t, locked: false };
    }

    // ---- SPC: WOU ----

    function columns(names, widths) {
        var out = [];
        for (var i = 0; i < names.length; i += widths.length) {
            var row = "";
            for (var k = 0; k < widths.length && i + k < names.length; k++) {
                var n = names[i + k];
                while (n.length < widths[k]) n += " ";
                row += n;
            }
            out.push(row);
        }
        return out.join("\n");
    }

    function byState(counties) {
        var groups = {};
        counties.forEach(function (c) { (groups[c.state] = groups[c.state] || []).push(c); });
        return Object.keys(groups).sort().map(function (s) {
            return { state: s, counties: groups[s].sort(function (a, b) { return a.fips < b.fips ? -1 : a.fips > b.fips ? 1 : 0; }) };
        });
    }

    function areaNoun(state, n) {
        if (state === "LA") return n === 1 ? "PARISH" : "PARISHES";
        return n === 1 ? "COUNTY" : "COUNTIES";
    }

    function wfoList(counties) {
        var seen = [];
        counties.forEach(function (c) { if (c.cwa && seen.indexOf(c.cwa) === -1) seen.push(c.cwa); });
        return "ATTN...WFO..." + seen.map(function (w) { return w + "..."; }).join("");
    }

    function buildWou(o) {
        var phen = o.phen;
        var up = WATCH_NAME[phen].toUpperCase();
        var t = spcHeader(o, "WOUS64", "WOU") + "\n";
        if (o.action === "NEW") t += "BULLETIN - IMMEDIATE BROADCAST REQUESTED\n";
        t += up + " OUTLINE UPDATE FOR " + (phen === "TO" ? "WT" : "WS") + " " + o.number + "\n"
            + "NWS STORM PREDICTION CENTER NORMAN OK\n"
            + stamp(o.issued, o.tz, o.dstLess, "hmm a z EEE MMM dd yyyy").toUpperCase() + "\n\n";

        var endWords = clock(o.end, o.tz, o.dstLess) + " " + local(o.end, o.tz, o.dstLess).abbr;
        if (o.action === "CAN" || o.action === "EXP") {
            t += up + " " + o.number + " IS NO LONGER IN EFFECT.\n\n"
                + wrap(stateCodes(o.counties).map(function (s) { return s + "Z000"; }).join("-") + "-"
                    + ddhhmm(o.end) + "-", LINE, ["-"]) + "\n"
                + vtec({ productClass: o.productClass, action: o.action, office: "KWNS", phen: phen, sig: "A",
                    etn: o.number, issued: o.issued, start: o.start, end: o.end }) + "\n\n"
                + "NO COUNTIES OR PARISHES REMAIN IN THE WATCH.\n\n$$\n\n" + wfoList(o.counties) + "\n";
            return { text: t };
        }

        t += up + " " + o.number + (o.action === "NEW" ? " IS IN EFFECT UNTIL " : " REMAINS IN EFFECT UNTIL ")
            + endWords + "\nFOR THE FOLLOWING LOCATIONS\n\n";
        t += byState(o.counties).map(function (g) {
            var codes = g.counties.map(function (c) { return g.state + "C" + c.fips; });
            var noun = areaNoun(g.state, 2);
            return ugcLine(codes, o.end, false) + "\n"
                + vtec({ productClass: o.productClass, action: o.action, office: "KWNS", phen: phen, sig: "A",
                    etn: o.number, issued: o.issued, start: o.start, end: o.end }) + "\n\n"
                + g.state + " \n.    " + String(o.stateNames[g.state] || g.state).toUpperCase() + " " + noun
                + " INCLUDED ARE\n\n"
                + columns(g.counties.map(function (c) { return c.name.toUpperCase(); }), [21, 20, 20]) + "\n$$\n";
        }).join("\n\n");
        t += "\n\n" + wfoList(o.counties) + "\n";
        return { text: t };
    }

    // ---- SPC: WWP ----

    function probField(v, floor) {
        if (v == null || v < floor) return "<" + pad(floor, 2) + "%";
        var s = String(v);
        while (s.length < 3) s = " " + s;
        return s + "%";
    }

    function buildWwp(o) {
        var p = o.probs || {};
        var code = (o.phen === "TO" ? "WT" : "WS") + " " + pad(o.number, 4);
        var rows = [
            ["PROB OF 2 OR MORE TORNADOES", probField(p.tor2, 5)],
            ["PROB OF 1 OR MORE STRONG /EF2-EF5/ TORNADOES", probField(p.torSig, 2)],
            ["PROB OF 10 OR MORE SEVERE WIND EVENTS", probField(p.wind10, 5)],
            ["PROB OF 1 OR MORE WIND EVENTS >= 65 KNOTS", probField(p.wind65, 2)],
            ["PROB OF 10 OR MORE SEVERE HAIL EVENTS", probField(p.hail10, 5)],
            ["PROB OF 1 OR MORE HAIL EVENTS >= 2 INCHES", probField(p.hail2, 2)],
            ["PROB OF 6 OR MORE COMBINED SEVERE HAIL/WIND EVENTS", probField(p.combo6, 5)]
        ];
        var attrs = [
            ["MAX HAIL /INCHES/", String(o.maxHail || 1)],
            ["MAX WIND GUSTS SURFACE /KNOTS/", String(o.gustKt || 50)],
            ["MAX TOPS /X 100 FEET/", String(o.tops || 450)],
            ["MEAN STORM MOTION VECTOR /DEGREES AND KNOTS/", String(o.motion || "24030")],
            ["PARTICULARLY DANGEROUS SITUATION", o.pds ? "YES" : "NO"]
        ];
        function table(list, width) {
            return list.map(function (r) {
                var k = r[0];
                while (k.length < width) k += " ";
                return k + ": " + r[1];
            }).join("\n");
        }
        var t = "WWUS40 KWNS " + ddhhmm(o.issued) + "\nWWP" + (o.number % 10) + "\n\n"
            + WATCH_NAME[o.phen].toUpperCase() + " PROBABILITIES FOR " + code + "\n"
            + "NWS STORM PREDICTION CENTER NORMAN OK\n"
            + stamp(o.issued, o.tz, o.dstLess, "hhmm a z EEE MMM dd yyyy").toUpperCase() + "\n\n"
            + code + "\nPROBABILITY TABLE:\n" + table(rows, 51) + "\n\n&&\n"
            + "ATTRIBUTE TABLE:\n" + table(attrs, 45) + "\n\n&&\n"
            + "FOR A COMPLETE GEOGRAPHICAL DEPICTION OF THE WATCH AND\n"
            + "WATCH EXPIRATION INFORMATION SEE WOUS64 FOR WOU" + (o.number % 10) + ".\n\n$$\n";
        return { text: t };
    }

    // ---- WCN: office watch county notification ----

    var COUNTY_REGION = {
        "CENTRAL": "CENTRAL", "NORTH": "NORTHERN", "SOUTH": "SOUTHERN", "EAST": "EASTERN", "WEST": "WESTERN",
        "NORTH+EAST": "NORTHEAST", "NORTH+WEST": "NORTHWEST", "SOUTH+EAST": "SOUTHEAST", "SOUTH+WEST": "SOUTHWEST",
        "NORTH+CENTRAL": "NORTH CENTRAL", "SOUTH+CENTRAL": "SOUTH CENTRAL", "EAST+CENTRAL": "EAST CENTRAL",
        "WEST+CENTRAL": "WEST CENTRAL", "PA": "THE PANHANDLE OF", "UP": "UPSTATE", "PD": "THE PIEDMONT OF",
        "BB": "THE BIG BEND OF"
    };

    function countyRegion(c, stateName) {
        var key = (c.partOfParentRegion || []).join("+");
        var word = COUNTY_REGION[key];
        if (!word) return stateName;
        return word + " " + stateName;
    }

    function wcnHeadline(seg, o) {
        var name = WATCH_NAME[o.phen].toUpperCase();
        var until = timingPhrase({ phen: o.phen, sig: "A", action: seg.action, start: o.start, end: o.end },
            o.issued, o.tz, o.dstLess).toUpperCase();
        if (seg.action === "NEW") {
            return "THE NATIONAL WEATHER SERVICE HAS ISSUED " + name + " " + o.number + " IN EFFECT " + until
                + " FOR THE FOLLOWING AREAS";
        }
        if (seg.action === "CON") return name + " " + o.number + " REMAINS VALID " + until + " FOR THE FOLLOWING AREAS";
        if (seg.action === "CAN") return "THE NATIONAL WEATHER SERVICE HAS CANCELLED " + name + " " + o.number + " FOR THE FOLLOWING AREAS";
        if (seg.action === "EXA" || seg.action === "EXB") {
            return "THE NATIONAL WEATHER SERVICE HAS EXTENDED " + name + " " + o.number
                + " TO INCLUDE THE FOLLOWING AREAS " + until;
        }
        if (seg.action === "EXT") {
            var prev = timingPhrase({ phen: o.phen, sig: "A", action: "CON", start: o.start, end: o.previousEnd || o.end },
                o.issued, o.tz, o.dstLess).toUpperCase().replace(/^UNTIL /, "");
            return name + " " + o.number + ", PREVIOUSLY IN EFFECT UNTIL " + prev + ", IS NOW IN EFFECT " + until
                + " FOR THE FOLLOWING AREAS";
        }
        if (seg.action === "EXP") {
            return o.issued.getTime() >= o.end.getTime()
                ? "THE NATIONAL WEATHER SERVICE HAS ALLOWED " + name + " " + o.number + " TO EXPIRE FOR THE FOLLOWING AREAS"
                : "THE NATIONAL WEATHER SERVICE WILL ALLOW " + name + " " + o.number + " TO EXPIRE "
                    + until.replace(/^AT /, "AT ") + " FOR THE FOLLOWING AREAS";
        }
        return name + " " + o.number;
    }

    /**
     * o: { phen, number, wfo, wmo, office (city ST), issued, start, end, previousEnd, tz, dstLess,
     *      productClass, segments [{action, counties [{state, fips, name, partOfParentRegion, cities[]}]}] }
     */
    function buildWcn(o) {
        var t = o.wmo + " K" + o.wfo + " " + ddhhmm(o.issued) + "\nWCN" + o.wfo + "\n\n"
            + "WATCH COUNTY NOTIFICATION FOR WATCH " + o.number + "\n"
            + "NATIONAL WEATHER SERVICE " + String(o.office).toUpperCase() + "\n"
            + stamp(o.issued, o.tz, o.dstLess).toUpperCase() + "\n\n";
        t += o.segments.filter(function (s) { return s.counties.length; }).map(function (seg) {
            var codes = seg.counties.map(function (c) { return c.state + "C" + c.fips; });
            var purge = (seg.action === "CAN" || seg.action === "EXP")
                ? new Date(Math.min(o.end.getTime(), o.issued.getTime() + 3600000 + 15 * 60000)) : o.end;
            var s = ugcLine(codes, purge, true) + "\n"
                + vtec({ productClass: o.productClass, action: seg.action, office: "K" + o.wfo, phen: o.phen,
                    sig: "A", etn: o.number, issued: o.issued, start: o.start, end: o.end }) + "\n\n"
                + wrap(wcnHeadline(seg, o), LINE) + "\n\n";
            var verb = seg.action === "CAN" ? "THIS CANCELS" : "THIS WATCH INCLUDES";
            byState(seg.counties).forEach(function (g) {
                var stName = String(o.stateNames[g.state] || g.state).toUpperCase();
                s += "IN " + stName + " " + verb + " " + g.counties.length + " " + areaNoun(g.state, g.counties.length) + "\n\n";
                var regions = [];
                var byRegion = {};
                g.counties.forEach(function (c) {
                    var r = countyRegion(c, stName);
                    if (!byRegion[r]) { byRegion[r] = []; regions.push(r); }
                    byRegion[r].push(c);
                });
                regions.sort().forEach(function (r) {
                    s += "IN " + r + "\n\n" + columns(byRegion[r].map(function (c) {
                        return c.name.toUpperCase();
                    }).sort(), [22, 22, 22]) + "\n\n";
                });
            });
            var cities = [];
            seg.counties.forEach(function (c) { (c.cities || []).forEach(function (n) {
                n = n.toUpperCase();
                if (cities.indexOf(n) === -1) cities.push(n);
            }); });
            if (cities.length) {
                cities.sort();
                s += wrap(("THIS INCLUDES THE " + (cities.length === 1 ? "CITY" : "CITIES") + " OF "
                    + civil.punctuateList(cities) + ".").toUpperCase(), LINE) + "\n\n";
            }
            return s + "$$";
        }).join("\n\n") + "\n";
        return { text: t };
    }

    // ---- Office zone watches (GFE hazard formatters) ----

    var ZONE_HAZARDS = {
        WS: {
            hdln: "Winter Storm Watch", header: ["URGENT - WINTER WEATHER MESSAGE"],
            bullets: ["WHAT", "WHERE", "WHEN", "IMPACTS"],
            cta: "A Winter Storm Watch means there is a potential for significant snow, sleet, or ice "
                + "accumulations that may impact travel. Continue to monitor the latest forecasts.",
            impacts: "Travel could be very difficult."
        },
        EC: {
            hdln: "Extreme Cold Watch", header: ["URGENT - WEATHER MESSAGE"],
            bullets: ["WHAT", "WHERE", "WHEN", "IMPACTS"],
            cta: "Dress in layers including a hat, face mask, and gloves if you must go outside.",
            impacts: "The dangerously cold wind chills could cause frostbite on exposed skin in as little as 10 minutes."
        },
        HW: {
            hdln: "High Wind Watch", header: ["URGENT - WEATHER MESSAGE"],
            bullets: ["WHAT", "WHERE", "WHEN", "IMPACTS"],
            cta: "A High Wind Watch means there is the potential for a hazardous high wind event. Sustained "
                + "winds of at least 40 mph, or gusts of 58 mph or stronger may occur. Continue to monitor "
                + "the latest forecasts.",
            impacts: "Damaging winds could blow down trees and power lines. Widespread power outages are "
                + "possible. Travel could be difficult, especially for high profile vehicles."
        },
        FA: {
            hdln: "Flood Watch", header: ["URGENT - IMMEDIATE BROADCAST REQUESTED", "Flood Watch"],
            bullets: ["WHAT", "WHERE", "WHEN", "IMPACTS"],
            cta: "You should monitor later forecasts and be alert for possible Flood Warnings. Those living "
                + "in areas prone to flooding should be prepared to take action should flooding develop.",
            impacts: "Excessive runoff may result in flooding of rivers, creeks, streams, and other low-lying "
                + "and flood-prone locations."
        },
        FW: {
            hdln: "Fire Weather Watch", header: ["URGENT - FIRE WEATHER MESSAGE"], attribution: true,
            bullets: ["AFFECTED AREA", "WINDS", "RELATIVE HUMIDITY", "IMPACTS"],
            cta: "A Fire Weather Watch means that critical fire weather conditions are forecast to occur. "
                + "Listen for later forecasts and possible Red Flag Warnings.",
            impacts: "Any fires that develop will likely spread rapidly. Outdoor burning is not recommended."
        },
        CF: {
            hdln: "Coastal Flood Watch", header: ["Coastal Hazard Message"],
            bullets: ["WHAT", "WHERE", "WHEN", "IMPACTS"],
            cta: "A Coastal Flood Watch means that conditions favorable for flooding are expected to develop. "
                + "Coastal residents should be alert for later statements or warnings, and take action to "
                + "protect property.",
            impacts: "Flooding of lots, parks, and roads with only isolated road closures expected."
        }
    };

    function num(v, fallback) {
        var s = v == null ? "" : String(v).trim();
        return s ? s : "!** " + fallback + " **!";
    }

    /** Hazard Services' default WHAT sentence for a watch, built from the panel's numbers. */
    function whatText(phen, f) {
        f = f || {};
        if (phen === "WS") {
            var gust = f.gust ? " Winds could gust as high as " + f.gust + " mph." : "";
            if (f.ice) {
                return "Heavy mixed precipitation possible. Total snow accumulations between " + num(f.snowLo, "low")
                    + " and " + num(f.snowHi, "high") + " inches and ice accumulations of " + f.ice + " possible." + gust;
            }
            return "Heavy snow possible. Total snow accumulations between " + num(f.snowLo, "low") + " and "
                + num(f.snowHi, "high") + " inches possible." + gust;
        }
        if (phen === "EC") return "Dangerously cold wind chills as low as " + num(f.windChill, "value") + " below possible.";
        if (phen === "HW") {
            return (f.dir ? f.dir.charAt(0).toUpperCase() + f.dir.slice(1).toLowerCase() + " winds " : "Winds ")
                + num(f.windLo, "low") + " to " + num(f.windHi, "high") + " mph with gusts up to "
                + num(f.gust, "gust") + " mph possible.";
        }
        if (phen === "FA") return (f.flash ? "Flash flooding" : "Flooding") + " caused by excessive rainfall is possible.";
        if (phen === "CF") {
            return num(f.surgeLo, "low") + " to " + num(f.surgeHi, "high") + " feet of inundation above ground level "
                + "possible in low-lying areas near shorelines and tidal waterways.";
        }
        return "";
    }

    var REGION_WORDS = {
        NN: "north", SS: "south", EE: "east", WW: "west", NE: "northeast", NW: "northwest", SE: "southeast",
        SW: "southwest", NC: "north central", SC: "south central", EC: "east central", WC: "west central", CC: "central"
    };

    /** Hazard Services' WHERE: "Portions of north central and northwest Minnesota and ...". */
    function whereText(zones, stateNames) {
        var groups = {};
        var order = [];
        zones.forEach(function (z) {
            if (!groups[z.state]) { groups[z.state] = []; order.push(z.state); }
            (z.partOfParentRegion || []).forEach(function (code) {
                var w = REGION_WORDS[code];
                if (w && groups[z.state].indexOf(w) === -1) groups[z.state].push(w);
            });
        });
        var parts = order.sort().map(function (s) {
            var words = groups[s].sort();
            return (words.length ? civil.punctuateList(words) + " " : "") + (stateNames[s] || s);
        });
        return "Portions of " + civil.punctuateList(parts) + ".";
    }

    /**
     * o: { phen, wfo, wmo, pil, city (wfoCity), office (wfoCityState), issued, start, end, previousEnd,
     *      tz, dstLess, productClass, etn, action, zones [{state, fips, name, partOfParentRegion, cities}],
     *      stateNames, fields {...}, text {what, where, when, impacts, details, cta, wrapup}, overview,
     *      synopsis, includeCities }
     */
    function buildZoneWatch(o) {
        var hz = ZONE_HAZARDS[o.phen];
        var tx = o.text || {};
        var t = o.wmo + " K" + o.wfo + " " + ddhhmm(o.issued) + "\n" + o.pil + o.wfo + "\n\n"
            + hz.header.join("\n") + "\nNational Weather Service " + o.office + "\n"
            + stamp(o.issued, o.tz, o.dstLess) + "\n\n";
        if (o.overview && o.overview.trim()) {
            t += wrap("..." + o.overview.replace(/^\.+|\.+$/g, "").trim().toUpperCase() + "...", LINE_GFE) + "\n\n";
        }
        if (o.synopsis && o.synopsis.trim()) t += wrap("." + o.synopsis.replace(/^\./, "").trim(), LINE_GFE) + "\n\n";

        var codes = o.zones.map(function (z) { return z.state + "Z" + z.fips; });
        var purge = (o.action === "CAN" || o.action === "EXP")
            ? civil.expireTime(o.issued, 1) : gfePurge(o.issued, o.end, 12);
        t += ugcLine(codes, purge, true) + "\n"
            + vtec({ productClass: o.productClass, action: o.action, office: "K" + o.wfo, phen: o.phen, sig: "A",
                etn: o.etn, issued: o.issued, start: o.start, end: o.end }) + "\n"
            + wrap(o.zones.map(function (z) { return z.name; }).join("-") + "-", LINE, ["-"]) + "\n";
        if (o.includeCities !== false) {
            var cities = [];
            o.zones.forEach(function (z) { (z.cities || []).forEach(function (c) { if (cities.indexOf(c) === -1) cities.push(c); }); });
            if (cities.length) t += wrap("Including the cities of " + civil.punctuateList(cities), LINE_GFE) + "\n";
        }
        t += stamp(o.issued, o.tz, o.dstLess) + "\n\n";

        var h = { name: hz.hdln, phen: o.phen, sig: "A", action: o.action, start: o.start, end: o.end };
        t += wrap("..." + headline(h, o.issued, o.tz, o.dstLess) + "...", LINE_GFE) + "\n\n";

        if (o.action === "CAN" || o.action === "EXP") {
            var body = o.action === "CAN"
                ? "The National Weather Service in " + o.city + " has cancelled the " + hz.hdln + "."
                : "The " + hz.hdln + " " + actionWords("EXP", o.issued, o.end) + " "
                    + timingPhrase(h, o.issued, o.tz, o.dstLess) + ".";
            t += wrap(body, LINE_GFE) + "\n\n";
            if (tx.wrapup && tx.wrapup.trim()) t += wrap(tx.wrapup.trim(), LINE_GFE) + "\n\n";
            return { text: t + "$$\n" };
        }

        if (hz.attribution) {
            var when = timingPhrase(h, o.issued, o.tz, o.dstLess);
            var attr = o.action === "CON"
                ? "The " + hz.hdln + " remains in effect" + (when ? " " + when : "") + "."
                : (o.action === "EXT" ? "The " + hz.hdln + " is now in effect" + (when ? " " + when : "") + "."
                    : "The National Weather Service in " + o.city + " has issued a " + hz.hdln
                        + ", which is in effect" + (when ? " " + when : "") + ".");
            t += wrap(attr, LINE_GFE) + "\n\n";
        }

        var auto = {
            WHAT: whatText(o.phen, o.fields),
            WHERE: whereText(o.zones, o.stateNames),
            WHEN: sentence(timingPhrase(h, o.issued, o.tz, o.dstLess)),
            IMPACTS: hz.impacts,
            "AFFECTED AREA": whereText(o.zones, o.stateNames),
            WINDS: o.fields && o.fields.windLo
                ? (o.fields.dir ? o.fields.dir.charAt(0).toUpperCase() + o.fields.dir.slice(1).toLowerCase() + " " : "")
                    + o.fields.windLo + " to " + num(o.fields.windHi, "high") + " mph with gusts up to "
                    + num(o.fields.gust, "gust") + " mph."
                : "!** Winds **!",
            "RELATIVE HUMIDITY": o.fields && o.fields.rh ? "As low as " + o.fields.rh + " percent." : "!** Minimum humidity **!"
        };
        var override = { WHAT: tx.what, WHERE: tx.where, WHEN: tx.when, IMPACTS: tx.impacts, "AFFECTED AREA": tx.where,
            WINDS: tx.what, "RELATIVE HUMIDITY": null };
        hz.bullets.forEach(function (b) {
            var v = override[b] && override[b].trim() ? override[b].trim() : auto[b];
            t += hanging("* " + b + "..." + v, LINE_GFE, "", "  ") + "\n\n";
        });
        if (tx.details && tx.details.trim()) t += hanging("* ADDITIONAL DETAILS..." + tx.details.trim(), LINE_GFE, "", "  ") + "\n\n";

        var cta = tx.cta && tx.cta.trim() ? tx.cta.trim() : hz.cta;
        t += "PRECAUTIONARY/PREPAREDNESS ACTIONS...\n\n" + cta.split(/\n\s*\n/).map(function (p) {
            return wrap(p.replace(/\s+/g, " ").trim(), LINE_GFE);
        }).join("\n\n") + "\n\n&&\n\n$$\n";
        return { text: t };
    }

    return {
        PRODUCTS: PRODUCTS,
        PRODUCT_BY_ID: PRODUCT_BY_ID,
        SAME: SAME,
        ZONE_HAZARDS: ZONE_HAZARDS,
        WATCH_NAME: WATCH_NAME,
        LINE: LINE,
        vtec: vtec,
        ugcLine: ugcLine,
        wrap: wrap,
        wrapPlain: wrapPlain,
        hanging: hanging,
        columns: columns,
        stamp: stamp,
        local: local,
        timingPhrase: timingPhrase,
        headline: headline,
        actionWords: actionWords,
        sentence: sentence,
        threatLines: threatLines,
        spcPeriod: spcPeriod,
        buildSel: buildSel,
        buildWou: buildWou,
        buildWwp: buildWwp,
        buildWcn: buildWcn,
        whatText: whatText,
        whereText: whereText,
        buildZoneWatch: buildZoneWatch
    };
}));
