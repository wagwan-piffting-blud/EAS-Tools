(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./watches.js"), require("./civil.js"));
    } else {
        root.WarngenTropical = factory(root.WarngenWatches, root.WarngenCivil);
    }
}(typeof self !== "undefined" ? self : this, function (W, civil) {

    /**
     * Office tropical products: the zone-segmented TCV (Hazard_TCV.py, text from TCVDictionary.py via
     * data/tcv_dictionary.json) and the HLS narrative, laid out after the IEM corpus.
     */
    var LINE_TCV = 69;
    var LINE_HLS = 69;
    var SECTIONS = ["Wind", "Storm Surge", "Flooding Rain", "Tornado"];
    var LEVELS = ["None", "Elevated", "Mod", "High", "Extreme"];
    var PHASES = ["default", "check plans", "complete preparations", "hunker down", "recovery"];
    var HAZ_NAME = {
        "HU.A": "Hurricane Watch", "HU.W": "Hurricane Warning", "TR.A": "Tropical Storm Watch",
        "TR.W": "Tropical Storm Warning", "SS.A": "Storm Surge Watch", "SS.W": "Storm Surge Warning"
    };
    var PHEN_ORDER = { HU: 0, TR: 1, SS: 2 };

    // Hazard_TCV._hazardDefinition
    function definition(key) {
        var name = HAZ_NAME[key];
        var d = {
            "HU.W": "hurricane-force winds are expected",
            "HU.A": "hurricane-force winds are possible",
            "TR.W": "tropical storm-force winds are expected",
            "TR.A": "tropical storm-force winds are possible",
            "SS.W": "there is a danger of life-threatening inundation, from rising water moving inland from the coastline,",
            "SS.A": "life-threatening inundation, from rising water moving inland from the coastline, is possible"
        }[key];
        return "A " + name + " means " + d + " somewhere within this area within the next "
            + (key.slice(-1) === "W" ? "36" : "48") + " hours";
    }

    // Defaults for LATEST LOCAL FORECAST, most common phrasing per threat level in the corpus.
    var LATEST = {
        Wind: { None: "Below tropical storm force wind", Elevated: "Equivalent Tropical Storm force wind",
            Mod: "Equivalent Strong Tropical Storm force wind", High: "Equivalent Cat 1 Hurricane force wind",
            Extreme: "Equivalent Cat 3 Hurricane force wind" },
        "Storm Surge": { None: "", Elevated: "Localized storm surge possible", Mod: "Life-threatening storm surge possible",
            High: "Life-threatening storm surge possible", Extreme: "Life-threatening and historic storm surge possible" },
        "Flooding Rain": { None: "", Elevated: "", Mod: "Flood Watch is in effect", High: "Flood Watch is in effect",
            Extreme: "Flood Watch is in effect" },
        Tornado: { None: "", Elevated: "", Mod: "", High: "", Extreme: "" }
    };
    var TORNADO_SITUATION = { None: "unfavorable", Elevated: "somewhat favorable", Mod: "favorable",
        High: "very favorable", Extreme: "very favorable" };
    var THREAT_LABEL = "THREAT TO LIFE AND PROPERTY THAT INCLUDES TYPICAL FORECAST UNCERTAINTY IN TRACK, "
        + "SIZE AND INTENSITY:";
    var TREND = { increased: "increased", decreased: "decreased", steady: "remained nearly steady" };
    var NOUN = { Wind: "wind", "Storm Surge": "storm surge", "Flooding Rain": "flooding rain", Tornado: "tornado" };

    function plain(text, width) { return W.wrapPlain(text, width); }

    function sortHazards(list) {
        return list.slice().sort(function (a, b) {
            var sa = a.sig === "W" ? 0 : 1, sb = b.sig === "W" ? 0 : 1;
            var ua = a.action === "UPG" ? 1 : 0, ub = b.action === "UPG" ? 1 : 0;
            return ua - ub || sa - sb || PHEN_ORDER[a.phen] - PHEN_ORDER[b.phen];
        });
    }

    function hazardHeadline(h) {
        var words = { NEW: "IN EFFECT", EXA: "IN EFFECT", CON: "REMAINS IN EFFECT", CAN: "IS CANCELLED" }[h.action];
        return words ? "..." + HAZ_NAME[h.phen + "." + h.sig].toUpperCase() + " " + words + "..." : null;
    }

    function bullet(text, indent, width) {
        return W.hanging(text, width || LINE_TCV, indent + "- ", indent + "  ", true);
    }

    function impactStatements(dict, section, level, phase) {
        if ((phase === "hunker down") && (section === "Wind" || section === "Storm Surge") && level !== "None") {
            return { label: "POTENTIAL IMPACTS: Unfolding",
                list: ["Potential impacts from the main " + (section === "Wind" ? "wind" : "surge") + " event are unfolding."] };
        }
        var list = (dict.potentialImpactStatements[section] || {})[level] || [];
        list = list.slice();
        if (phase === "default" && list.length && (section === "Wind" || section === "Storm Surge")
            && list[0].indexOf("If realized, ") !== 0) {
            list[0] = "If realized, " + list[0].charAt(0).toLowerCase() + list[0].slice(1);
        }
        return { label: "POTENTIAL IMPACTS: " + dict.impactLevel[level], list: list };
    }

    function section(dict, name, o) {
        var level = (o.threats || {})[name] || "None";
        var phase = o.phase || "default";
        var f = o.forecast || {};
        var latest = f[name] && f[name].summary != null && f[name].summary !== "" ? f[name].summary : LATEST[name][level];
        var s = "* " + name.toUpperCase() + "\n" + (latest ? W.hanging("- LATEST LOCAL FORECAST: " + latest, LINE_TCV, "    ", "      ", true) : "    - LATEST LOCAL FORECAST: ") + "\n";
        if (name === "Wind") s += bullet("Peak Wind Forecast: " + ((f.Wind && f.Wind.detail) || "!** 25-35 mph with gusts to 45 mph **!"), "        ") + "\n";
        if (name === "Storm Surge") {
            s += bullet("Peak Storm Surge Inundation: The potential for " + ((f["Storm Surge"] && f["Storm Surge"].detail)
                || "!** 1-3 feet **!") + " above ground somewhere within surge prone areas", "        ") + "\n";
            if (f["Storm Surge"] && f["Storm Surge"].window) s += bullet("Window of concern: " + f["Storm Surge"].window, "        ") + "\n";
        }
        if (name === "Flooding Rain") s += bullet("Peak Rainfall Amounts: " + ((f["Flooding Rain"] && f["Flooding Rain"].detail)
            || "!** Additional 2-4 inches, with locally higher amounts **!"), "        ") + "\n";
        if (name === "Tornado") s += bullet("Situation is " + TORNADO_SITUATION[level] + " for tornadoes", "        ") + "\n";
        s += "\n" + W.hanging("- " + THREAT_LABEL + " " + dict.threatPhrase[name][level], LINE_TCV, "    ", "      ", true) + "\n";
        if (o.trend && TREND[o.trend]) {
            s += bullet("The " + NOUN[name] + " threat has " + TREND[o.trend] + " from the previous assessment.", "        ") + "\n";
        }
        var st = ((dict.threatStatements[name] || {})[level] || {})[phase] || {};
        ["planning", "preparation", "action"].forEach(function (k) {
            if (st[k]) s += bullet(st[k], "        ") + "\n";
        });
        var imp = impactStatements(dict, name, level, phase);
        s += "\n" + bullet(imp.label, "    ") + "\n" + imp.list.map(function (t) { return bullet(t, "        "); }).join("\n") + "\n";
        return s;
    }

    function stormTitle(o) {
        return o.storm.name + " Local Watch/Warning Statement/Advisory Number " + o.storm.advisory;
    }

    /**
     * o: { wfo, wmo, office, issued, tz, dstLess, productClass, etn, storm {type, name, advisory, atcf},
     *      hazards [{phen, sig, action}], zones [{state, fips, name, cities, coastal}], threats {Wind,...},
     *      phase, trend, forecast {Wind {summary, detail}, ...}, moreInfo, dict }
     */
    function buildTcv(o) {
        var dict = o.dict;
        var stamp = W.stamp(o.issued, o.tz, o.dstLess);
        var t = o.wmo + " K" + o.wfo + " " + W.stamp(o.issued, "UTC", false, "ddHHmm") + "\nTCV" + o.wfo + "\n\n"
            + "URGENT - IMMEDIATE BROADCAST REQUESTED\n" + stormTitle(o) + "\n"
            + "National Weather Service " + o.office + "  " + o.storm.atcf + "\n" + stamp + "\n\n";
        var hz = sortHazards(o.hazards || []);
        var purge = new Date(Math.ceil((o.issued.getTime() + 8 * 3600000) / 900000) * 900000);
        t += o.zones.map(function (z) {
            var s = W.ugcLine([z.state + "Z" + z.fips], purge, true) + "\n";
            hz.forEach(function (h) {
                s += W.vtec({ productClass: o.productClass, action: h.action, office: "K" + o.wfo, phen: h.phen, sig: h.sig,
                    etn: o.etn, issued: o.issued, start: h.action === "NEW" ? o.issued : null, end: null }) + "\n";
            });
            s += z.name + "-\n" + stamp + "\n\n";
            var heads = hz.map(hazardHeadline).filter(Boolean);
            if (heads.length) s += heads.join("\n") + "\n\n";
            hz.filter(function (h) { return h.action === "NEW" || h.action === "EXA"; }).forEach(function (h) {
                s += plain(definition(h.phen + "." + h.sig), LINE_TCV) + "\n\n";
            });
            s += "* LOCATIONS AFFECTED\n" + (z.cities && z.cities.length ? z.cities : ["!** Location **!"]).slice(0, 3)
                .map(function (c) { return "    - " + c; }).join("\n") + "\n\n";
            SECTIONS.forEach(function (name) {
                if (name === "Storm Surge" && !z.coastal) return;
                s += section(dict, name, o) + "\n";
            });
            s += "* FOR MORE INFORMATION:\n    - " + (o.moreInfo || "https://www.weather.gov/" + o.wfo.toLowerCase()) + "\n\n$$";
            return s;
        }).join("\n\n") + "\n";
        return { text: t };
    }

    // ---- HLS ----

    function hlsSentence(dict, name, level, phase, area) {
        if (level === "None") return "Little to no impacts are anticipated at this time across " + area + ".";
        var verb = (phase === "complete preparations" || phase === "hunker down") ? "Protect against" : "Prepare for";
        var adj = { Extreme: "life-threatening", High: "life-threatening", Mod: name === "Storm Surge" ? "life-threatening" : "dangerous",
            Elevated: name === "Wind" ? "hazardous" : "locally hazardous" }[level];
        var impact = { Extreme: name === "Storm Surge" ? "catastrophic" : "devastating", High: "extensive",
            Mod: "significant", Elevated: "limited" }[level];
        var noun = { Wind: adj + " wind", "Storm Surge": adj + " surge", "Flooding Rain": adj + " rainfall flooding",
            Tornado: level === "High" || level === "Extreme" ? "a particularly dangerous tornado event"
                : (level === "Mod" ? "a dangerous tornado event" : "a tornado event") }[name];
        return verb + " " + noun + " having possible " + impact + " impacts across " + area + ". Potential impacts include:";
    }

    function hazardsSentence(hazards) {
        var names = sortHazards(hazards).filter(function (h) { return h.action !== "CAN" && h.action !== "UPG"; })
            .map(function (h) { return HAZ_NAME[h.phen + "." + h.sig]; });
        if (!names.length) return null;
        return "A " + civil.punctuateList(names) + (names.length > 1 ? " are" : " is") + " in effect for ";
    }

    function changesLines(hazards, zoneList) {
        var out = [];
        sortHazards(hazards).forEach(function (h) {
            var name = HAZ_NAME[h.phen + "." + h.sig];
            if (h.action === "NEW") out.push("A " + name + " has been issued for " + zoneList);
            else if (h.action === "CAN") out.push("The " + name + " has been cancelled for " + zoneList);
            else if (h.action === "UPG") out.push("The " + name + " has been upgraded for " + zoneList);
        });
        return out;
    }

    function heading(title) {
        return title + "\n" + title.replace(/./g, "-") + "\n\n";
    }

    /**
     * o: TCV fields plus { headline, covers, stormInfo {location, latlon, intensity, movement}, overview,
     *      nextUpdate, evacuations }
     */
    function buildHls(o) {
        var dict = o.dict;
        var stamp = W.stamp(o.issued, o.tz, o.dstLess);
        var zoneNames = o.zones.map(function (z) { return z.name; }).sort();
        var zoneList = civil.punctuateList(zoneNames);
        var codes = o.zones.map(function (z) { return z.state + "Z" + z.fips; });
        var purge = new Date(Math.ceil((o.issued.getTime() + 8 * 3600000) / 900000) * 900000);
        var t = o.wmo + " K" + o.wfo + " " + W.stamp(o.issued, "UTC", false, "ddHHmm") + "\nHLS" + o.wfo + "\n"
            + W.ugcLine(codes, purge, false) + "\n\n"
            + o.storm.type + " " + o.storm.name + " Local Statement Advisory Number " + o.storm.advisory + "\n"
            + "National Weather Service " + o.office + "  " + o.storm.atcf + "\n" + stamp + "\n\n"
            + plain("This product covers " + (o.covers || "!** area **!"), LINE_HLS) + "\n\n"
            + plain("**" + (o.headline || "!** Headline **!").replace(/^\*+|\*+$/g, "").toUpperCase() + "**", LINE_HLS) + "\n\n"
            + heading("NEW INFORMATION");
        var changes = changesLines(o.hazards || [], zoneList);
        t += "* CHANGES TO WATCHES AND WARNINGS:\n" + (changes.length ? changes : ["None"]).map(function (c) {
            return W.hanging("- " + c, LINE_HLS, "    ", "      ", true);
        }).join("\n") + "\n\n";
        var cur = hazardsSentence(o.hazards || []);
        t += "* CURRENT WATCHES AND WARNINGS:\n" + W.hanging("- " + (cur ? cur + zoneList : "All watches and warnings have been canceled"),
            LINE_HLS, "    ", "      ", true) + "\n\n";
        var si = o.stormInfo || {};
        t += "* STORM INFORMATION:\n" + [si.location || "!** About X miles direction of place **!",
            si.latlon || "!** 00.0N 00.0W **!", "Storm Intensity " + (si.intensity || "!** 00 mph **!"),
            "Movement " + (si.movement || "!** direction or 000 degrees at 00 mph **!")]
            .map(function (l) { return "    - " + l; }).join("\n") + "\n\n";
        t += heading("SITUATION OVERVIEW") + (o.overview && o.overview.trim()
            ? o.overview.trim().split(/\n\s*\n/).map(function (p) { return plain(p.replace(/\s+/g, " "), LINE_HLS); }).join("\n\n")
            : "!** Situation overview **!") + "\n\n";
        t += heading("POTENTIAL IMPACTS");
        var area = o.covers || "the area";
        [["Storm Surge", "SURGE"], ["Wind", "WIND"], ["Flooding Rain", "FLOODING RAIN"], ["Tornado", "TORNADOES"]].forEach(function (p) {
            var name = p[0];
            if (name === "Storm Surge" && !o.zones.some(function (z) { return z.coastal; })) return;
            var level = (o.threats || {})[name] || "None";
            t += "* " + p[1] + ":\n" + plain(hlsSentence(dict, name, level, o.phase, area), LINE_HLS) + "\n";
            if (level !== "None") {
                t += ((dict.potentialImpactStatements[name] || {})[level] || []).map(function (s) {
                    return W.hanging("- " + s, LINE_HLS, "    ", "      ", true);
                }).join("\n") + "\n";
            }
            t += "\n";
        });
        t += heading("PRECAUTIONARY/PREPAREDNESS ACTIONS") + "* EVACUATIONS:\n"
            + plain(o.evacuations || "Follow the advice of local officials.", LINE_HLS) + "\n\n"
            + "* OTHER PREPAREDNESS INFORMATION:\n"
            + plain("When making safety and preparedness decisions, do not focus on the exact forecast track since "
                + "hazards such as flooding rain, damaging wind gusts, storm surge, and tornadoes extend well away from "
                + "the center of the storm.", LINE_HLS) + "\n\n"
            + plain("Closely monitor weather.gov, NOAA Weather Radio and local news outlets for official storm "
                + "information. Listen for possible changes to the forecast.", LINE_HLS) + "\n\n"
            + "* ADDITIONAL SOURCES OF INFORMATION:\n" + dict.additionalSources.join("\n") + "\n\n"
            + heading("NEXT UPDATE")
            + plain("The next local statement will be issued by the National Weather Service in " + o.office
                + " around " + (o.nextUpdate || "!** time **!") + ", or sooner if conditions warrant.", LINE_HLS) + "\n\n$$\n";
        return { text: t };
    }

    return {
        SECTIONS: SECTIONS,
        LEVELS: LEVELS,
        PHASES: PHASES,
        HAZ_NAME: HAZ_NAME,
        LATEST: LATEST,
        definition: definition,
        buildTcv: buildTcv,
        buildHls: buildHls,
        hlsSentence: hlsSentence
    };
}));
