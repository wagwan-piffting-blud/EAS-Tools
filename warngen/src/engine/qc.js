(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./utils.js"));
    } else {
        root.WarngenQC = factory(root.WarngenUtils);
    }
}(typeof self !== "undefined" ? self : this, function (utils) {

    /**
     * The Text Workstation's quality control (com.raytheon.viz.texteditor.qc), run before a
     * product can be sent. QCProductChecks.properties picks the checks per PIL; the first
     * one that fails stops the run. The warning-decoder check needs the EDEX decoder and is
     * left out. Checks that read the clock use the product's issuance time instead.
     */
    var PRODUCT_CHECKS = ["wmo-header", "unsubstituted-variable", "mnd-header", "text-segment",
        "time-consistency", "cta-marker", "two-dollar"];
    var CHECKED_PILS = ["TOR", "SVR", "SMW", "FFW", "EWW", "SVS", "FFS", "FLS", "FLW", "MWS", "DSW", "SQW"];

    // QualityControlCfg.xml
    var PRODUCT_TYPE = {
        FFW: "Flash Flood Warning", EWW: "Extreme Wind Warning", NOW: "Short Term Forecast",
        MWS: "Marine Weather Statement", FLW: "Flood Warning", FFS: "Flash Flood Statement",
        SVS: "Severe Weather Statement", SPS: "Special Weather Statement", FLS: "Flood Statement",
        "FA.Y": "Flood Advisory", SMW: "Special Marine Warning", SVR: "Severe Thunderstorm Warning",
        TOR: "Tornado Warning", DSW: "Dust Storm Warning", SQW: "Snow Squall Warning",
        "DS.W": "Dust Storm Warning", "DS.Y": "Dust Advisory", "SQ.W": "Snow Squall Warning"
    };
    var FOLLOWUP_NNN = {
        "TO.W": "SVS", "SV.W": "SVS", "MA.W": "MWS", "FA.Y": "FLS", "FF.W": "FFS", "FA.W": "FLS",
        "DS.W": "DSW", "DS.Y": "DSW", "SQ.W": "SQW"
    };
    var NNN_OF_IDENT = {
        "TO.W": "TOR", "SV.W": "SVR", "MA.W": "SMW", "FA.Y": "FLS", "FF.W": "FFW", "FA.W": "FLW",
        "EW.W": "EWW", "DS.W": "DSW", "DS.Y": "DSW", "SQ.W": "SQW"
    };
    var SEGMENTED_NNN = ["WCN", "SLS", "SVS", "FFS", "FLS", "MWS", "SQW", "DSW"];
    var BULLET_TYPES = { "FA.Y": ["FLOODADVISORY", "HYDROLOGICADVISORY"], "DS.Y": ["DustAdvisory"] };
    var IMMEDIATE_CAUSES = [
        "ER \\ RAIN", "SM \\ SNOWMELT", "SM \\ MELTING SNOW", "SM \\ VOLCANIC SNOWMELT",
        "IJ \\ ICE JAM", "IC \\ ICE JAM AND RAIN", "IC \\ ICE JAM AND SNOWMELT", "GO \\ GLACIER",
        "GO \\ GLACIER-DAMMED LAKE", "DM \\ DAM", "DR \\ DAM FLOODGATE RELEASE", "DR \\ DAM FLOODGATE",
        "DM \\ LEVEE FAILURE", "DM \\ DAM FAILURE", "DM \\ DAM BREAK", "RS \\ RAIN AND SNOWMELT",
        "RS \\ RAIN AND MELTING SNOW"
    ];
    // countyTypes.txt as QualityControl.loadCountyTypes reads it: values untrimmed.
    var COUNTY_TYPES = {
        "LA": " Parish", "Louisiana": " Parish", "LA+": " Parishes", "Louisiana+": " Parishes",
        "DC": "", "District of Columbia": " ", "DC+": " ", "District of Columbia+": " ",
        "AK": "", "Alaska": " ", "AK+": " ", "Alaska+": " ",
        "PR": " Municipality", "Puerto Rico": " Municipality", "PR+": " Municipalities",
        "Puerto Rico+": " Municipalities", "GU": "", "Guam": "", "GU+": "", "Guam+": "",
        "DEFAULT+": " Counties", "DEFAULT": " County", "City": ""
    };
    var IMMEDIATE_CAUSE_EXCLUSIONS = ["ER", "MC", "UU", "IC"];
    var COUNTY_ZONE_TYPE_2_PILS = ["FFW", "FLW", "FLS", "FFS"];
    var COUNTY_ZONE_TYPE_3_PILS = ["SMW", "MWS"];
    var BULLETIN_NOT_REQUIRED_PILS = ["FFW", "SVS", "FFS", "FLW", "FLS", "MWS", "DSW", "SQW"];
    var NO_BULLETIN_LINE_PILS = ["SVS", "FFS", "FLW", "FLS", "MWS"];
    // timeZoneShortNameMap
    var SHORT_ZONES = ["AKST", "AKDT", "CST", "CDT", "EST", "EDT", "CHST", "HST", "MST", "MDT",
        "PST", "PDT", "SST", "AST"];

    var AWIPS_ID_PATTERN = /^(\w{3})(\w{3})$/;
    var WMO_HEADER_PATTERN = /^(\w{2})\w{2}\d{2}\s\w{4}\s\S{6}((\s(\w{2})(\w{1}))|)$/;
    var DATE_PATTERN = /(\d{1,2})(\d{2})\s(AM|PM)\s(\w{3,4})\s\w{3}\s(\w{3})\s{1,}(\d{1,2})\s(\d{4})/;
    // Upstream's pattern has no ">"; WarnGen's own UGC lines use it (FipsUtil.simplifyHeader).
    var UGC_PATTERN = /^(?:(?:[A-Z]{2}[CZ]\d{3}[->])?(?:\d{3}[->])*)*(?:\d{6}-)?$/;
    var VTEC_PATTERN = /\/[OTEX]\.([A-Z]{3})\.[A-Za-z0-9]{4}\.[A-Z]{2}\.[WAYSFON]\.\d{4}\.\d{6}T\d{4}Z-\d{6}T\d{4}Z\//;
    var HVTEC_PATTERN = /\/[A-Za-z0-9]{5}.[0-3NU].(\w{2}).\d{6}T\d{4}Z.\d{6}T\d{4}Z.\d{6}T\d{4}Z.\w{2}\//;
    var FIRST_BULLET_PATTERN = /^\*\s(.*)\s(WARNING|ADVISORY)(\sFOR(.*)|...)/im;
    var SECOND_BULLET_PATTERN = /^\*\sUNTIL\s(\d{1,2})(\d{2})\s(AM|PM)\s(\w{3,4})/im;
    var THIRD_BULLET_PATTERN = /^\*\sAT\s(\d{1,2})(\d{2})\s(AM|PM)\s(\w{3,4})(.*)/im;
    var AREA_NAME_LIST_PATTERN = /^([\w\s.'/]*-)/;
    var LAT_LON_PATTERN = /LAT...LON+(\s\d{3,4}\s\d{3,5}){1,}/;
    var SUB_LAT_LON_PATTERN = /\s{1,}\d{3,4}\s\d{3,5}(|(\s\d{3,4}\s\d{3,5}){1,})/;
    var LAT_LON_PAIR_PATTERN = /(\d{3,4})\s(\d{3,5})/g;
    var TIME_MOT_LOC_PATTERN = /TIME...MOT...LOC \d{3,4}Z\s\d{3}DEG\s\d{1,3}KT((\s\d{3,4}\s\d{3,5}){1,})/;
    var QC_UGC_PATTERN = /(((\w{2}[CZ](\d{3}-){1,}){1,})|(\d{3}-){1,})(\d{2})(\d{2})(\d{2})-/;

    function vtecTime(s) {
        var m = /^(\d{2})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/.exec(s);
        if (!m || s === "000000T0000Z") return null;
        return new Date(Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    }

    // VtecUtil.parseMessage: the first P-VTEC string in the text.
    function parseVtec(text) {
        var m = /\/([OTEX])\.([A-Z]{3})\.([A-Za-z0-9]{4})\.([A-Z]{2})\.([WAYSFON])\.(\d{4})\.(\d{6}T\d{4}Z)-(\d{6}T\d{4}Z)\//.exec(text);
        if (!m) return null;
        return { action: m[2], phenomena: m[4], significance: m[5], phensig: m[4] + "." + m[5],
            start: vtecTime(m[7]), end: vtecTime(m[8]) };
    }

    function match(nnn, phensig) {
        var mapped = SEGMENTED_NNN.indexOf(nnn) !== -1 ? FOLLOWUP_NNN[phensig] : NNN_OF_IDENT[phensig];
        return mapped != null && mapped === nnn;
    }

    function wmoHeader(header, body, nnn) {
        var err = "";
        if (!header) return "\nNo text found.\n";
        var lines = header.trim().split("\n");
        if (lines.length < 2) return "\nIncomlete product.\n";
        var m = WMO_HEADER_PATTERN.exec(lines[0]);
        if (m) {
            if ((nnn === "SVR" && m[1] !== "WU") || (nnn === "TOR" && m[1] !== "WF")
                || (nnn === "SMW" && m[1] !== "WH") || (nnn === "FFW" && m[1] !== "WG")) {
                err += nnn + " doesn't match " + m[1] + "\n in TTAAii.\n";
            }
            if (m[4] && ["RR", "4", "AA", "CC"].indexOf(m[4]) === -1) {
                err += "BBB: " + m[4] + m[5] + " error.\n";
            }
        } else {
            err += "First line is not WMO header or invalid format.\n";
        }
        if (!AWIPS_ID_PATTERN.test(lines[1])) err += "No NNNXXX on second line.\n";
        var vtec = parseVtec(body);
        if (!vtec && nnn !== "MWS") {
            err += "\nNo VTEC line found.\n";
        } else if (vtec && !match(nnn, vtec.phensig)) {
            if (!(nnn === "SVS" && vtec.phensig === "EW.W")) {
                err += "VTEC event type (" + vtec.phensig + ") doesn't match NNN.\n";
            }
        }
        return err;
    }

    function unsubstitutedVariable(header, body) {
        var m = /(\$\{[a-z][a-z0-9-_]*\}|\$[a-z][a-z0-9-_]*(?=\W))/.exec(body);
        return m ? "An unsubstituted variable reference was found: " + m[0]
            + "\nThis is likely a template issue.\n" : "";
    }

    function mndHeader(header, body, nnn) {
        var nnnUpper = nnn.toUpperCase();
        body = body.toUpperCase();
        if (BULLETIN_NOT_REQUIRED_PILS.indexOf(nnnUpper) === -1
            && body.indexOf("EAS ACTIVATION") === -1 && body.indexOf("IMMEDIATE BROADCAST") === -1) {
            return "BULLETIN line not found in the MND header.\n";
        }
        var state = NO_BULLETIN_LINE_PILS.indexOf(nnnUpper) !== -1 ? 1 : 0;
        var vtec = parseVtec(body);
        var phensig = vtec ? vtec.phensig : null;
        var dateTested = false;
        var err = "";
        body.split("\n").forEach(function (line) {
            if (line.indexOf("EAS ACTIVATION") !== -1 || line.indexOf("IMMEDIATE BROADCAST") !== -1) {
                state = 1;
                return;
            }
            if (state === 1) {
                var eventType = PRODUCT_TYPE[phensig] || PRODUCT_TYPE[nnnUpper] || null;
                if (eventType == null) err += "Invalid event type in MND header\n";
                else if (line.indexOf(eventType.toUpperCase()) === -1) {
                    err += "Event type in MND header does not\n match " + nnnUpper + ".\n";
                }
                state++;
            } else if (state === 2) {
                if (line.indexOf("UNLOCALIZED SITE") !== -1) err += "Unlocalized site in MND header.\n";
                state++;
            } else if (state === 3 || state === 4) {
                if (line.indexOf("ISSUED BY NATIONAL WEATHER SERVICE") === 0) {
                    if (/UNLOCALIZED SITE$/.test(line)) err += "Unlocalized site in the service backup line.\n";
                } else if (!dateTested) {
                    if (!DATE_PATTERN.test(line)) err += "No date and time line in MND header.\n";
                    dateTested = true;
                }
                state++;
            }
        });
        return err;
    }

    function zoneTypes() {
        var set = {};
        Object.keys(COUNTY_TYPES).forEach(function (key) {
            var v = COUNTY_TYPES[key];
            if (v.length > 1) set[v.trim().toUpperCase()] = true;
            else if (key.length > 1) set[key.toUpperCase()] = true;
        });
        delete set.AK;
        delete set.DC;
        set.CITY = true;
        return Object.keys(set);
    }

    function checkHeadline(headline, nnn, vtec) {
        if (SEGMENTED_NNN.indexOf(nnn) === -1 || nnn === "FLS") return "";
        if (nnn === "MWS" && !vtec) return "";
        if ((nnn === "DSW" || nnn === "SQW") && vtec && (vtec.action === "NEW" || vtec.action === "COR")) return "";
        if (!headline) return "Headline is missing or malformed.\n";
        if (!/\.\.\.$/.test(headline)) return "Headline should end with '...'.\n";
        return "";
    }

    function checkLatLon(latLon) {
        if (!latLon) return "LAT...LON line is malformed.\n";
        var pairs = 0, m;
        LAT_LON_PAIR_PATTERN.lastIndex = 0;
        var rest = latLon.slice(9);
        while ((m = LAT_LON_PAIR_PATTERN.exec(rest))) {
            pairs++;
            if (+m[1] > 9000 || +m[2] > 18000) return "Data error in the LAT...LON line.\n";
        }
        if (pairs <= 2 || pairs > 20) return "LAT...LON line must have at least 3 and no more than 20 points.\n";
        return "";
    }

    // AbstractTextSegmentCheck / TextSegmentCheck
    function textSegment(header, body, nnn) {
        body = body.toUpperCase();
        nnn = nnn.toUpperCase();
        var countyOrZoneCounter = 0, ugcLength = 0, czmType = 1, nb = 0, segmentCount = 0;
        var expecHTEC = false, expectNamesList = false, insideFirstBullet = false;
        var secondBulletFound = false, checkIC = false, countUGC = false, headlineFound = false;
        var insideLatLon = false, countyBased = false;
        var vtec = null, ic = null, ugc = "", latLon = "", tml = "", headline = "";
        var err = "";
        var segment = "Primary";
        var hm = HVTEC_PATTERN.exec(body);
        if (hm) ic = hm[1];
        if (COUNTY_ZONE_TYPE_2_PILS.indexOf(nnn) !== -1) czmType = 2;
        else if (COUNTY_ZONE_TYPE_3_PILS.indexOf(nnn) !== -1) czmType = 3;
        var cpm = zoneTypes();
        var lines = body.split("\n");

        for (var li = 0; li < lines.length; li++) {
            var line = lines[li];
            if (line === "$$") {
                if (ugc.length === 0 && vtec == null) return err + "Badly placed segment end.\n";
                segmentCount++;
                segment = "Secondary";
                ugc = "";
                err += checkHeadline(headline, nnn, vtec);
                headline = "";
                if (segmentCount > 1 && SEGMENTED_NNN.indexOf(nnn) === -1) {
                    err += "Segments exist in unsegmented product.\n";
                }
                continue;
            }
            var um = UGC_PATTERN.exec(line);
            if (um && um[0].length > 0) {
                ugc += line;
                countUGC = true;
                continue;
            }
            if (countUGC) {
                var czCnt = 0;
                if (!/^\w{2}[CZ]\d{3}[->].*$/.test(ugc)) err += "First UGC does not specify a zone or county.\n";
                if (ugc.length > 2 && ugc.charAt(2) === "C") {
                    ++czCnt;
                    countyBased = true;
                }
                if (ugc.length > 2 && ugc.charAt(2) === "Z") ++czCnt;
                if (czCnt === 0) err += "No zone or county specified in UGCs.\n";
                else if (czCnt === 2) err += "Illegal mixture of zone/county UGCs.\n";
                ugc.replace(/\d{6}-/, "").split("-").filter(function (r) { return r !== ""; }).forEach(function (range) {
                    var gt = range.indexOf(">");
                    if (gt !== -1) {
                        var start = parseInt(range.slice(gt - 3, gt), 10);
                        var end = parseInt(range.slice(gt + 1), 10);
                        for (var v = start; v <= end; ++v) ugcLength++;
                    } else {
                        ugcLength++;
                    }
                });
            }
            if (VTEC_PATTERN.test(line)) {
                vtec = parseVtec(line);
                if (["FF", "FL", "FA"].indexOf(vtec.phenomena) !== -1) expecHTEC = true;
                if (SEGMENTED_NNN.indexOf(nnn) !== -1) expectNamesList = true;
                countUGC = false;
                continue;
            } else if (countUGC) {
                if (parseVtec(body) != null) err += segment + " VTEC not right after UGC\n";
                countUGC = false;
            }
            if (expecHTEC) {
                if (!HVTEC_PATTERN.test(line)) err += "Hydro VTEC line must follow FF or FL.\n";
                expecHTEC = false;
                continue;
            }
            if (expectNamesList) {
                if (nnn !== "MWS" && !AREA_NAME_LIST_PATTERN.test(line)) err += "List of county/zone names missing.\n";
                expectNamesList = false;
                continue;
            }
            if (line.indexOf("...") === 0) {
                headline = line;
                headlineFound = true;
                continue;
            }
            if (line.trim().length === 0) {
                headlineFound = false;
                continue;
            } else if (headlineFound) {
                headline += line;
                continue;
            }
            if (line.indexOf("* ") === 0) nb++;
            if (line.indexOf("* ") === 0 && nb === 3) {
                if (line.slice(0, 5) !== "* AT ") err += "Event bullet does not start with '* AT '\n.";
                else if (!THIRD_BULLET_PATTERN.test(line)) {
                    err += "Event bullet starts with badly formatted time\n or event bullet does not start with a time.\n";
                }
            }
            if (line.indexOf("* ") === 0 && nb === 2) {
                if (SECOND_BULLET_PATTERN.test(line) || line.indexOf("* UNTIL NOON") !== -1
                    || line.indexOf("* UNTIL MIDNIGHT") !== -1) {
                    secondBulletFound = true;
                    insideFirstBullet = false;
                    continue;
                }
            }
            if (nb === 1) {
                if (FIRST_BULLET_PATTERN.test(line)) {
                    var types = vtec ? BULLET_TYPES[vtec.phensig] : null;
                    if (types) {
                        if (!types.some(function (t) { return line.indexOf(t.toUpperCase()) !== -1; })) {
                            err += "first bullet not valid for " + nnn + "\n";
                        }
                    } else if (line.indexOf((PRODUCT_TYPE[nnn] || "Unknown Warning").toUpperCase()) === -1) {
                        err += nnn + " does not match first bullet.\n";
                    }
                    insideFirstBullet = true;
                    checkIC = true;
                    continue;
                } else if (!insideFirstBullet && !secondBulletFound
                    && (line.indexOf("AREA...") !== -1 || line.indexOf("AREAS...") !== -1
                        || line.indexOf("AREA WAS...") !== -1)) {
                    insideFirstBullet = true;
                    continue;
                }
            }
            if (insideFirstBullet) {
                if (ic != null && IMMEDIATE_CAUSE_EXCLUSIONS.indexOf(ic) === -1 && checkIC) {
                    var validIC = IMMEDIATE_CAUSES.some(function (c) {
                        return c.indexOf(ic) === 0 && line.indexOf(c.split("\\")[1]) !== -1;
                    });
                    if (!validIC) {
                        return err + "Immediate cause missing in first bullet\n or is inconsistent with VTEC.\n";
                    }
                    checkIC = false;
                    continue;
                }
                if (czmType === 3) {
                    if (line.trim().indexOf("INCLUDING ") === 0) {
                        insideFirstBullet = false;
                        continue;
                    }
                } else {
                    if (line.indexOf("THIS INCLUDES") !== -1) continue;
                    var invalid = true;
                    if (ugc.length > 2 && ugc.charAt(2) === "Z") {
                        if (line.indexOf(" IN ") !== -1) invalid = false;
                    } else {
                        Object.keys(COUNTY_TYPES).forEach(function (st) {
                            if (line.indexOf(st.toUpperCase()) !== -1
                                && line.indexOf(COUNTY_TYPES[st].toUpperCase()) !== -1) invalid = false;
                        });
                        if (invalid) {
                            invalid = !Object.keys(COUNTY_TYPES).some(function (k) {
                                var t = COUNTY_TYPES[k];
                                return t.trim().length > 0 && line.indexOf(" " + t.trim().toUpperCase()) !== -1;
                            });
                        }
                    }
                    if (invalid && line.indexOf(" OF ") === -1) continue;
                }
                var hit = cpm.some(function (t) { return line.indexOf(t) !== -1; });
                if (hit) {
                    if (line.trim().length > 0) {
                        countyOrZoneCounter++;
                        continue;
                    }
                    insideFirstBullet = false;
                }
            }
            if (LAT_LON_PATTERN.test(line)) {
                latLon = line;
                insideLatLon = true;
                continue;
            }
            if (insideLatLon) {
                if (line.indexOf("TIME...") !== 0 && SUB_LAT_LON_PATTERN.test(line)) {
                    latLon += " " + line.trim();
                    continue;
                }
                insideLatLon = false;
            }
            if (TIME_MOT_LOC_PATTERN.test(line)) tml = line;
        }
        if (ugcLength === 0) {
            err += "No UGC text was found\n";
        } else if (nb > 0 && (czmType === 1 || (czmType === 2 && countyBased))
            && ugcLength !== countyOrZoneCounter) {
            err += ugcLength + " UGCs while " + countyOrZoneCounter + " counties/zones listed.\n"
                + "Area descriptions count does not\n match UGC count.\n";
        }
        if (body.indexOf("LAT...LON") !== -1) err += checkLatLon(latLon);
        if (body.indexOf("TIME...MOT...LOC") !== -1 && !tml) err += "TIME...MOT...LOC line is malformed.\n";
        return err;
    }

    function zoneOffset(abbr, date) {
        return utils._zoneOffsetMinutes(abbr, date, false);
    }

    // A local clock time on the issuance's local date, as a UTC instant.
    function localClock(now, hh, mm, ampm, abbr) {
        var hour = (parseInt(hh, 10) % 12) + (ampm === "PM" ? 12 : 0);
        var off = zoneOffset(abbr, now) * 60000;
        var local = new Date(now.getTime() + off);
        return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(),
            hour, parseInt(mm, 10)) - off);
    }

    function timeConsistent(header, body, nnn, now) {
        body = body.toUpperCase();
        var vtec = parseVtec(body);
        if (vtec) {
            var soon = new Date(now.getTime() + 5 * 60000);
            if (vtec.action !== "EXP" && vtec.end && vtec.end < soon) {
                return "Product has expired or will expire in\n less than 5 minutes. (UGC line)\n";
            }
            var um = QC_UGC_PATTERN.exec(body);
            if (um && vtec.end) {
                var purge = new Date(Date.UTC(soon.getUTCFullYear(), soon.getUTCMonth(), soon.getUTCDate(),
                    parseInt(um[7], 10), parseInt(um[8], 10)));
                if (purge.getTime() - vtec.end.getTime() > 16 * 60000) {
                    return "VTEC end time is 15 minutes older\n than UGC expiration times differ";
                }
            }
            var nb = body.replace(/UNTIL NOON/g, "UNTIL 1200 PM").replace(/UNTIL MIDNIGHT/g, "UNTIL 1200 AM");
            var m = SECOND_BULLET_PATTERN.exec(nb);
            if (m) {
                if (SHORT_ZONES.indexOf(m[4]) === -1) return "Could not determine time zone in second bullet";
                var until = localClock(now, m[1], m[2], m[3], m[4]);
                if (m[3] === "AM" && until < now) until = new Date(until.getTime() + 86400000);
                if (vtec.end && until.getUTCHours() !== vtec.end.getUTCHours()) {
                    return "VTEC and bullet expiration times differ,\n or no * UNTIL line found.\n";
                }
            } else if (["SVS", "FFS", "FLW", "FLS", "MWS"].indexOf(nnn) === -1
                && ((nnn === "DSW" || nnn === "SQW") && vtec.action === "NEW")) {
                return "VTEC and bullet expiration times differ,\n or no * UNTIL line found.\n";
            }
            if (vtec.start && vtec.end && vtec.end < vtec.start) {
                return "VTEC ending time is earlier than\n VTEC beginning time.\n";
            }
        }
        var t = THIRD_BULLET_PATTERN.exec(body);
        if (t) {
            if (SHORT_ZONES.indexOf(t[4]) === -1) return "Could not determine time zone in third bullet";
            var at = localClock(now, t[1], t[2], t[3], t[4]);
            if (at.getTime() - 60000 > now.getTime()) return "Event time is later than the MND\n issue time.\n";
            if (now.getTime() - at.getTime() > 15 * 60000) {
                return "The event time is more than 15 minutes\n earlier than the issue time.\n";
            }
        }
        return "";
    }

    function ctaMarker(header, body) {
        body = body.toUpperCase();
        var err = "";
        var lines = body.split("\n");
        var dollarRow = [];
        for (var i = 0; i < lines.length; i++) {
            if (lines[i] === "$$") {
                dollarRow.push(i);
                if (dollarRow.length > 2) return "There are too many $$ lines.\n";
            }
        }
        function scan(j1, j2, suffix, trimLines) {
            var start = [], end = [];
            for (var k = j1; k < j2; k++) {
                var line = trimLines ? lines[k].trim() : lines[k];
                if (line === "PRECAUTIONARY/PREPAREDNESS ACTIONS...") start.push(k);
                else if (line === "&&") end.push(k);
            }
            if (start.length && !end.length) err += "There is no end marker" + suffix + ".\n";
            if (start.length > 1) err += "There is more than one start marker" + suffix + ".\n";
            if (end.length > 1) err += "There is more than one end marker" + suffix + ".\n";
            if (start.length === 1 && end.length === 1) {
                if (start[0] > end[0]) {
                    err += "End marker is in front of the start marker" + suffix + ".\n";
                } else {
                    var text = false;
                    for (var j = start[0] + 1; j < end[0]; j++) {
                        if (lines[j].trim().length) { text = true; break; }
                    }
                    if (!text) {
                        err += "There is no CTA text inside CTA markers" + (suffix ? suffix.replace(" in", "") : "") + ".\n";
                        err += "Please add CTA text or remove the" + (suffix ? " markers" + suffix.replace(" in", "") : "\n markers") + ".\n";
                    }
                }
            }
        }
        if (dollarRow.length === 1) {
            scan(0, lines.length, "", true);
        } else {
            for (var s = 0; s < dollarRow.length; s++) {
                scan(s === 0 ? 0 : dollarRow[0] + 1, s === 0 ? dollarRow[0] : lines.length,
                    " in segment " + (s === 0 ? "one" : "two"), false);
            }
        }
        return err;
    }

    function twoDollar(header, body) {
        var lines = body.split("\n");
        var has = false;
        for (var i = lines.length - 1; i >= 15; i--) {
            var line = lines[i];
            if (line.indexOf("*") === 0 || line.indexOf("LAT...LON") === 0) break;
            if (line === "$$") { has = true; break; }
        }
        return lines.length > 15 && !has ? "No $$ found at the bottom.\n" : "";
    }

    var CHECKS = {
        "wmo-header": wmoHeader,
        "unsubstituted-variable": unsubstitutedVariable,
        "mnd-header": mndHeader,
        "text-segment": textSegment,
        "time-consistency": timeConsistent,
        "cta-marker": ctaMarker,
        "two-dollar": twoDollar
    };

    /**
     * QualityControl.checkWarningInfo. The Text Workstation keeps the WMO and AWIPS ID lines
     * in its header field and the rest in the body. Returns null for PILs it doesn't check.
     */
    function check(product, nnn, now) {
        if (CHECKED_PILS.indexOf(nnn) === -1) return null;
        var lines = String(product).replace(/\r/g, "").replace(/^\n+/, "").split("\n");
        var header = lines.slice(0, 2).join("\n");
        var body = lines.slice(2).join("\n").replace(/^\n+/, "");
        for (var i = 0; i < PRODUCT_CHECKS.length; i++) {
            var msg = CHECKS[PRODUCT_CHECKS[i]](header, body, nnn, now || new Date());
            if (msg) return { ok: false, check: PRODUCT_CHECKS[i], message: msg.trim() };
        }
        return { ok: true };
    }

    return {
        check: check,
        CHECKS: CHECKS,
        CHECKED_PILS: CHECKED_PILS,
        parseVtec: parseVtec
    };
}));
