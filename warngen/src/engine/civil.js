(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./utils.js"));
    } else {
        root.WarngenCivil = factory(root.WarngenUtils);
    }
}(typeof self !== "undefined" ? self : this, function (utils) {

    /**
     * Port of the GFE CivilEmerg formatters (CivilEmerg.py and the 19
     * CivilEmerg_<EVT>_MultiPil_Local.py variants), which reach TextRules through
     * GenericReport. AWIPS makes these in GFE, not WarnGen: there is no VTEC, no polygon
     * and a single non-segmented UGC block.
     */
    var EVENTS = [
        { code: "ADR", name: "Administrative Message" },
        { code: "AVA", name: "Avalanche Watch" },
        { code: "AVW", name: "Avalanche Warning" },
        { code: "BLU", name: "Blue Alert" },
        { code: "CAE", name: "Child Abduction Emergency" },
        { code: "CDW", name: "Civil Danger Warning" },
        { code: "CEM", name: "Civil Emergency Message" },
        { code: "EQR", name: "Earthquake Report" },
        { code: "EQW", name: "Earthquake Warning" },
        { code: "EVI", name: "Evacuation Immediate" },
        { code: "FRW", name: "Fire Warning" },
        { code: "HMW", name: "Hazardous Material Warning" },
        { code: "LAE", name: "Local Area Emergency" },
        { code: "LEW", name: "Law Enforcement Warning" },
        { code: "NUW", name: "Nuclear Power Plant Warning" },
        { code: "RHW", name: "Radiological Hazard Warning" },
        { code: "SPW", name: "Shelter in Place Warning" },
        { code: "TOE", name: "911 Telephone Outage Emergency" },
        { code: "VOW", name: "Volcano Warning" }
    ];
    var EVENT_BY_CODE = {};
    EVENTS.forEach(function (e) { EVENT_BY_CODE[e.code] = e; });

    var EAS_LEVELS = [
        "NONE",
        "URGENT - IMMEDIATE BROADCAST REQUESTED",
        "BULLETIN - IMMEDIATE BROADCAST REQUESTED",
        "BULLETIN - EAS ACTIVATION REQUESTED"
    ];

    var NIDS_HEADLINE = "|*...HEADLINE REQUIRED FOR NIDS DISSEMINATION... *|\n\n";
    var LINE_LENGTH = 66;
    var PURGE_HOURS = 3;

    var EQR = {
        issuanceTypes: ["Preliminary", "Update"],
        eqInfo: ["Golden", "WC/ATWC", "PTWC"],
        felt: ["weakly", "moderately", "strongly", "very strongly"],
        extent: ["a single person", "a few people", "many people", "numerous persons"],
        damage: ["No", "Slight", "Moderate", "Considerable", "Extensive"],
        damageType: ["objects falling from shelves", "dishes rattled or broken",
            "cracked chimneys", "communications towers fallen",
            "collapsed bridges", "collapsed overpasses", "train rails bent",
            "fissures have opened in the ground", "gas mains broken",
            "complete destruction of structures", "some casualties"]
    };

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }

    function ddhhmm(date) {
        return pad2(date.getUTCDate()) + pad2(date.getUTCHours()) + pad2(date.getUTCMinutes());
    }

    /** Zones for the Pacific and Alaska regions (and always for EQR), counties elsewhere. */
    function usesZones(region, eventCode) {
        return eventCode === "EQR" || region === "PR" || region === "AR";
    }

    function defaultSource(site) {
        return site.state + " EMERGENCY MANAGEMENT AGENCY " + site.wfoCity + " " + site.state;
    }

    // Header.makeUGCString over a list already sorted by makeUGCList.
    function makeUGCString(ugcList) {
        var list = ugcList.filter(function (u) { return u !== ""; });
        if (!list.length) return "";
        var inSeq = 0;
        var ugcStr = list[0];
        var curState = ugcStr.slice(0, 3);
        var lastNum = parseInt(list[0].slice(3), 10);

        function checkLastArrow() {
            if (inSeq !== 1) return;
            var i = ugcStr.lastIndexOf(">");
            if (i >= 0) ugcStr = ugcStr.slice(0, i) + "-" + ugcStr.slice(i + 1);
        }

        for (var k = 1; k < list.length; k++) {
            var ugc = list[k];
            var ugcState = ugc.slice(0, 3);
            var numStr = ugc.slice(3);
            var num = parseInt(numStr, 10);
            if (ugcState === curState) {
                if (num === lastNum + 1) {
                    if (inSeq > 0) {
                        ugcStr = ugcStr.slice(0, ugcStr.length - 3) + numStr;
                        inSeq += 1;
                    } else {
                        ugcStr += ">" + numStr;
                        inSeq = 1;
                    }
                } else {
                    checkLastArrow();
                    inSeq = 0;
                    ugcStr += "-" + numStr;
                }
            } else {
                checkLastArrow();
                ugcStr += "-" + ugc;
                curState = ugcState;
                inSeq = 0;
            }
            lastNum = num;
        }
        checkLastArrow();
        return ugcStr;
    }

    function sortUgcs(ugcs) {
        var seen = {};
        return ugcs.filter(function (u) {
            if (seen[u]) return false;
            seen[u] = true;
            return true;
        }).sort();
    }

    // Header.getExpireTime with no VTEC: at least an hour out, then up to the next quarter
    // hour unless within a minute past one.
    function expireTime(issued, purgeHours) {
        var issueSec = Math.floor(issued.getTime() / 1000);
        var expire = issueSec + (purgeHours == null ? PURGE_HOURS : purgeHours) * 3600;
        if (expire - issueSec < 3600) expire = issueSec + 3600;
        var step = 15 * 60;
        var delta = expire % step;
        var base = Math.floor(expire / step) * step;
        expire = (delta / 60 >= 1) ? base + step : base;
        return new Date(expire * 1000);
    }

    function isDigit(c) { return c >= "0" && c <= "9"; }

    // StringUtils.findRightMost
    function findRightMost(text, breakStr, nonNumeric) {
        if (nonNumeric === undefined) nonNumeric = true;
        var maxIndex = -1;
        var maxChars = "";
        breakStr.forEach(function (chars) {
            var index = text.lastIndexOf(chars);
            while (index > 0 && nonNumeric && chars === " " && isDigit(text.charAt(index - 1))) {
                index = index >= 2 ? text.lastIndexOf(chars, index - 2) : -1;
            }
            if (index > maxIndex) {
                maxIndex = index;
                maxChars = chars;
            }
        });
        if (maxIndex === -1) return [maxIndex, maxChars];
        return [maxChars === " " ? maxIndex : maxIndex + maxChars.length, maxChars];
    }

    // StringUtils.linebreak
    function linebreak(phrase, linelength, breakStr, forceBreakStr) {
        forceBreakStr = forceBreakStr || [" ", "/"];
        var text = "";
        var start = 0;
        var sub = phrase.slice(start, start + linelength);
        while (sub.length === linelength) {
            var found = findRightMost(sub, breakStr);
            var maxIndex = found[0];
            var chars = found[1];
            if (maxIndex === -1) {
                var forced = findRightMost(sub, forceBreakStr);
                chars = forced[1];
                if (forced[0] > 0) {
                    text += sub.slice(0, forced[0]) + "\n";
                    start += forced[0];
                } else if (forced[0] < 0) {
                    text += sub + "\n";
                    start += linelength;
                }
            } else if (maxIndex > 0) {
                text += sub.slice(0, maxIndex) + "\n";
                start += maxIndex;
            }
            if (chars === " ") start += 1;
            sub = phrase.slice(start, start + linelength);
        }
        return sub ? text + sub + "\n" : text;
    }

    // StringUtils.endline
    function endline(phrase, linelength, breakStr) {
        linelength = linelength || LINE_LENGTH;
        breakStr = breakStr || [" ", "..."];
        return phrase.split("\n").map(function (sub) {
            return sub === "" ? "\n" : linebreak(sub, linelength, breakStr);
        }).join("");
    }

    // StringUtils.punctuateList
    function punctuateList(items) {
        var s = items.join(", ");
        function replaceLast(str, find, repl) {
            var i = str.lastIndexOf(find);
            return i < 0 ? str : str.slice(0, i) + repl + str.slice(i + find.length);
        }
        if (items.length > 2) return replaceLast(s, ", ", ", and ");
        if (items.length === 2) return replaceLast(s, ", ", " and ");
        return s;
    }

    function timeLabel(date, tz, dstLess) {
        return utils._formatDate(date, "hmm a z EEE MMM d yyyy", tz || "UTC", !!dstLess);
    }

    function eqrBody(o) {
        var q = o.eqr || {};
        var felt = q.felt || EQR.felt[0];
        var extent = q.extent || EQR.extent[0];
        var damage = q.damage || EQR.damage[0];
        var area = q.area ? q.area : "|*enter area*|";
        var s = NIDS_HEADLINE + "An earthquake has been felt " + felt + " by " + extent + " "
            + "in the " + area + " area. " + damage + " damage has been reported. ";
        if (damage !== "No") {
            s += " Damage reports so far: " + punctuateList(q.damageType || []) + ".";
        }
        s += "\n\n";

        var office;
        if ((q.eqInfo || "Golden") === "Golden") {
            office = "National Earthquake Information Center in Golden Colorado";
        } else if (q.eqInfo === "WC/ATWC") {
            office = "West Coast/Alaska Tsunami Warning Center";
        } else {
            office = "Pacific Tsunami Warning Center";
        }

        if ((q.issuanceType || "Preliminary") === "Preliminary") {
            s += "Information released in this statement is preliminary. Updates, including Richter "
                + "scale magnitude, will be provided as more information becomes available from the "
                + office + ".";
        } else {
            var u = q.update || {};
            function v(key) { return u[key] ? String(u[key]) : "*" + key + "*"; }
            s += "The " + office + " has indicated that an earthquake magnitude " + v("mag")
                + " on the Richter scale was centered at " + v("lat") + "/" + v("lon") + " or about "
                + v("miles") + " " + v("direction") + " of " + v("city") + ", " + v("state")
                + ".\n\nAny further information will be made available when it is received from the "
                + office + ".";
        }
        return s;
    }

    /**
     * o: { event, site {wfoCityState, wfoCity, state}, pil, wmo, cccc, ugcs, issued (Date),
     *      purgeHours, tz, dstLess, eas, source, testMode, issuedByCityState, headline,
     *      message, eqr }
     * Returns the product before CivilEmerg._postProcessProduct, plus the pieces the UI shows.
     */
    function build(o) {
        var evt = EVENT_BY_CODE[o.event] || EVENT_BY_CODE.CEM;
        var isEqr = evt.code === "EQR";
        var issued = o.issued;
        var expire = expireTime(issued, o.purgeHours);

        var ugcList = sortUgcs(o.ugcs || []);
        var codeString = makeUGCString(ugcList);
        var ugcLine = endline(codeString + "-" + ddhhmm(expire) + "-", LINE_LENGTH, ["-"]);

        var fcst = o.wmo + " " + o.cccc + " " + ddhhmm(issued) + "\n" + o.pil + "\n";
        fcst += ugcLine + "\n";

        // Upstream compares the radio value against "None" while the choice is spelled
        // "NONE", so the unset level prints as its own line (CivilEmerg.py:159).
        var eas = "";
        if (!isEqr) eas = (o.eas == null ? EAS_LEVELS[0] : o.eas) + "\n";

        var source = "";
        if (!isEqr) source = o.source + "\n";

        var issuedBy = "";
        if (o.issuedByCityState) {
            issuedBy = "Issued by National Weather Service " + o.issuedByCityState + "\n";
            if (issuedBy.length > LINE_LENGTH) issuedBy = issuedBy.replace("National Weather Service", "NWS");
        }

        var productName = isEqr
            ? evt.name + "..." + ((o.eqr && o.eqr.issuanceType) || "Preliminary")
            : evt.name;
        if (o.testMode) productName = "TEST..." + productName + "...TEST";

        fcst += eas + productName + "\n" + source
            + "Relayed by National Weather Service " + o.site.wfoCityState + "\n"
            + issuedBy + timeLabel(issued, o.tz, o.dstLess) + "\n\n";

        var headline = o.headline ? "..." + o.headline.replace(/^\.+|\.+$/g, "") + "...\n\n" : null;
        if (isEqr) {
            var body = eqrBody(o);
            if (headline) body = body.replace(NIDS_HEADLINE, headline);
            fcst += body;
        } else {
            fcst += (headline || NIDS_HEADLINE) + "The following message is transmitted"
                + " at the request of the " + o.source + ".";
        }
        if (o.message && o.message.trim()) {
            fcst += "\n\n" + o.message.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
        }
        fcst += "\n\n$$\n";

        if (!isEqr) fcst = fcst.replace(/(\n\n)\n*/g, "$1");
        return { text: fcst, expire: expire, ugcList: ugcList, productName: productName };
    }

    /** CivilEmerg._postProcessProduct's endline over the whole product. */
    function format(text, wrap) {
        return wrap === false ? text : endline(text, LINE_LENGTH, [" ", "...", "-"]);
    }

    return {
        EVENTS: EVENTS,
        EVENT_BY_CODE: EVENT_BY_CODE,
        EAS_LEVELS: EAS_LEVELS,
        EQR: EQR,
        NIDS_HEADLINE: NIDS_HEADLINE,
        LINE_LENGTH: LINE_LENGTH,
        PURGE_HOURS: PURGE_HOURS,
        usesZones: usesZones,
        defaultSource: defaultSource,
        makeUGCString: makeUGCString,
        expireTime: expireTime,
        endline: endline,
        linebreak: linebreak,
        findRightMost: findRightMost,
        punctuateList: punctuateList,
        build: build,
        format: format
    };
}));
