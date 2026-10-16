(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./utils"), require("./ugc"));
    } else {
        root.WarngenContext = factory(root.WarngenUtils, root.WarngenUGC);
    }
}(typeof self !== "undefined" ? self : this, function (Utils, UGC) {

    var WMO_PRODUCT_PREFIX = {
        TOR: "WFUS",
        SVR: "WUUS",
        SVS: "WWUS",
        EWW: "WUUS",
        FFW: "WGUS",
        FFS: "WGUS",
        FLW: "WGUS",
        FLS: "WGUS",
        SMW: "WHUS",
        MWS: "WHUS",
        SPS: "WWUS",
        NOW: "FPUS",
        SQW: "WWUS",
        DSW: "WWUS",
        FRW: "WWUS",
        AWW: "WWUS"
    };

    /** VTEC phenomenon each PIL defaults to when the bullet config does not name one. */
    var PRODUCT_PHENOMENA = {
        TOR: "TO", SVR: "SV", SVS: "SV", EWW: "EW",
        FFW: "FF", FFS: "FF", FLW: "FA", FLS: "FA",
        SMW: "MA", MWS: "MA", SQW: "SQ", DSW: "DS",
        SPS: "SP", NOW: "SP", FRW: "FW", AWW: "AW"
    };

    var WMO_REGION_FALLBACK = {
        OAX: 3, DMX: 3, FSD: 3, ABR: 3, BIS: 3, FGF: 3, MPX: 3, ARX: 3,
        DLH: 3, GRB: 3, MKX: 3, LOT: 3, ILX: 3, IND: 3, LSX: 3, SGF: 3,
        EAX: 3, TOP: 3, ICT: 3, DDC: 3, GID: 3, LBF: 3,
        BOX: 1, OKX: 1, PHI: 1, ALY: 1, BGM: 1, BTV: 1, BUF: 1, CAR: 1,
        CLE: 1, CTP: 1, GYX: 1, PBZ: 1, RLX: 1, LWX: 1, AKQ: 1,
        MLB: 2, TBW: 2, JAX: 2, MFL: 2, KEY: 2, TAE: 2, MHX: 2, ILM: 2,
        CHS: 2, CAE: 2, GSP: 2, RAH: 2, RNK: 2, BMX: 2, HUN: 2, MOB: 2,
        JAN: 2, LIX: 2, LCH: 2, SHV: 2, LZK: 2, MEG: 2, MRX: 2, OHX: 2,
        JKL: 2, LMK: 2, PAH: 2, SJU: 2,
        FWD: 4, HGX: 4, EWX: 4, SJT: 4, MAF: 4, AMA: 4, LUB: 4, CRP: 4,
        BRO: 4, EPZ: 4, ABQ: 4, OUN: 4, TSA: 4,
        BOU: 5, PUB: 5, GJT: 5, RIW: 5, BYZ: 5, GGW: 5, MSO: 5, TFX: 5,
        UNR: 5, CYS: 5,
        SEW: 6, OTX: 6, PQR: 6, PDT: 6, MFR: 6, BOI: 6, PIH: 6, LKN: 6,
        REV: 6, VEF: 6, SGX: 6, LOX: 6, MTR: 6, STO: 6, EKA: 6, HNX: 6,
        FGZ: 6, TWC: 6, PSR: 6,
        AJK: 7,
        AFC: 8, AFG: 8,
        HFO: 0, GUM: 0, PPG: 0
    };

    function computeWmoIdFallback(productId, siteId) {
        var prefix = WMO_PRODUCT_PREFIX[productId] || "WUUS";
        var region = WMO_REGION_FALLBACK[siteId];
        if (region == null) region = 3;
        return prefix + "5" + region;
    }

    var VTEC_OFFICE_PREFIX = {
        HFO: "P", GUM: "P", PPG: "N",
        AFC: "P", AFG: "P", AJK: "P",
        SJU: "T"
    };
    function computeVtecOfficeFallback(siteId) {
        var prefix = VTEC_OFFICE_PREFIX[siteId] || "K";

        if (siteId === "PPG") return "NSTU";
        if (siteId === "SJU") return "TJSJ";
        return prefix + siteId;
    }

    function buildMockContext(opts) {
        opts = opts || {};

        var now      = opts.now     || new Date(Date.UTC(2026, 5, 15, 23, 17, 0));
        var start    = opts.start   || now;
        var duration = opts.duration != null ? opts.duration : 30;

        // TemplateRunner: Wx ends at roundDateTo15(start + duration), and ${duration} is
        // that rounded span in minutes.
        var expire   = opts.expire;
        if (!expire) {
            expire = Utils.roundDateTo15(new Date(start.getTime() + duration * 60000));
            duration = Math.floor((expire.getTime() - start.getTime()) / 60000);
        }
        var TMLtime  = opts.TMLtime || now;
        var event    = opts.event   || now;

        var siteId       = opts.siteId       || "OAX";

        var vtecOffice   = opts.vtecOffice   || computeVtecOfficeFallback(siteId);
        var productId    = opts.productId    || "SVR";

        var WMOId        = opts.WMOId        || computeWmoIdFallback(productId, siteId);
        var BBBId        = opts.BBBId        || "";
        var productClass = opts.productClass || "O";
        var action       = opts.action       || "NEW";
        var etn          = opts.etn          || "0042";

        var officeShort  = opts.officeShort  || "{OFFICE_SHORT_NAME}";
        var officeLoc    = opts.officeLoc    || "{OFFICE_LOCATION}";

        var crossesTimezone = (opts.crossesTimezone === true);
        var localtimezone   = opts.localtimezone  || "CST";
        var secondtimezone  = crossesTimezone
                                ? (opts.secondtimezone || "MST")
                                : localtimezone;

        var dstLessMap = {};
        if (opts.localtimezoneDstLess === true)  dstLessMap[localtimezone]  = true;
        if (crossesTimezone && opts.secondtimezoneDstLess === true) {
            dstLessMap[secondtimezone] = true;
        }
        var renderDateUtil = Utils.makeDateUtil(dstLessMap);

        var defaultAreas = [
            {
                name: "Douglas", fips: "31055", state: "NE", stateabbr: "NE",
                state_zone: "055", parentRegion: "Nebraska",
                partOfArea: [], partOfParentRegion: ["Central"],
                areaNotation: "County", areasNotation: "Counties", points: []
            },
            {
                name: "Sarpy", fips: "31153", state: "NE", stateabbr: "NE",
                state_zone: "153", parentRegion: "Nebraska",
                partOfArea: [], partOfParentRegion: ["Central"],
                areaNotation: "County", areasNotation: "Counties", points: []
            },
            {
                name: "Washington", fips: "31177", state: "NE", stateabbr: "NE",
                state_zone: "177", parentRegion: "Nebraska",
                partOfArea: [], partOfParentRegion: ["Central"],
                areaNotation: "County", areasNotation: "Counties", points: []
            }
        ];
        var areas = opts.areas || defaultAreas;

        var defaultPoly = [
            { x: -96.20, y: 41.50 },
            { x: -96.30, y: 41.30 },
            { x: -96.05, y: 41.20 },
            { x: -95.85, y: 41.40 },
            { x: -95.95, y: 41.55 },
            { x: -96.20, y: 41.50 }
        ];
        var areaPoly = opts.areaPoly || defaultPoly;

        var eventLocation = opts.eventLocation || [{ x: -96.10, y: 41.35 }];

        var movementSpeed          = opts.movementSpeed          != null ? opts.movementSpeed          : 35;
        var movementInKnots        = opts.movementInKnots        != null ? opts.movementInKnots        : Math.round(movementSpeed * 0.868976);
        var movementDirection      = opts.movementDirection      != null ? opts.movementDirection      : 225;
        var movementDirectionRounded = opts.movementDirectionRounded != null ? opts.movementDirectionRounded : roundTo45(movementDirection);
        var stationary             = opts.stationary             === true;

        var closestPoints = opts.closestPoints || [
            {
                name:                    "{NEAREST_CITY_TO_STORM}",
                roundedDistance:         1,
                oppositeRoundedAzimuth:  225
            }
        ];
        var otherClosestPoints = opts.otherClosestPoints || [
            {
                name:                    "{NEAREST_MAJOR_CITY_TO_STORM}",
                roundedDistance:         1,
                oppositeRoundedAzimuth:  225
            }
        ];

        var cityList = opts.cityList || [
            { name: "{POLYGON_INTERIOR_CITIES}", partOfArea: [] }
        ];
        var otherPoints = opts.otherPoints || [];

        var pathCast = opts.pathCast || [];

        var bullets = opts.bullets || [
            "doppler",
            "70mphWind",
            "quarterHail",
            "listofcities",
            "genericCTA",
            "lawEnforcementCTA"
        ];

        var includedWatches = (opts.includedWatches || []).slice();
        var watches = (opts.watches || []).map(toWatch);

        var awwSiteId = opts.awwSiteId || "";
        var awwSiteName = opts.awwSiteName || "";
        var ugcFormat = opts.ugcFormat || "C";
        var ugcline = UGC.build(areas, opts.ugcPurge || expire, ugcFormat);

        // Followup state. cancelareas are the areas that were in the original warning but have
        // dropped out of the current polygon; they get their own UGC line and VTEC segment.
        // null rather than [] when nothing was dropped: the templates gate their CAN segment on
        // #if(${cancelareas}), and an empty list would still emit a segment with an empty UGC.
        var cancelareas = (opts.cancelareas && opts.cancelareas.length) ? opts.cancelareas : null;
        var ugclinecan  = cancelareas ? UGC.build(cancelareas, opts.ugcCanPurge || expire, ugcFormat) : "";
        var phenomena   = opts.phenomena || PRODUCT_PHENOMENA[productId] || "SV";
        var significance = opts.significance || "W";

        return {

            WMOId:        WMOId,
            vtecOffice:   vtecOffice,
            BBBId:        BBBId,
            productId:    productId,
            siteId:       siteId,
            productClass: productClass,
            action:       action,
            etn:          etn,
            officeShort:  officeShort,
            officeLoc:    officeLoc,
            backupSite:   "",
            easActivation: "EAS ACTIVATION REQUESTED",

            now:           now,
            start:         start,
            expire:        expire,
            TMLtime:       TMLtime,
            event:         event,
            duration:      duration,
            localtimezone:  localtimezone,
            secondtimezone: secondtimezone,

            ugcline:       ugcline,
            ugclinecan:    ugclinecan,
            cancelareas:   cancelareas,
            cancelaffectedCounties: opts.cancelaffectedCounties || cancelareas || [],
            affectedCounties:       opts.affectedCounties || areas,
            phenomena:     phenomena,
            significance:  significance,
            oldvtec:       opts.oldvtec || etn,
            ic:            opts.ic || "ER",
            floodic:       opts.floodic || opts.ic || "ER",
            areas:         areas,
            areaPoly:      areaPoly,
            eventLocation: eventLocation,
            closestPoints: closestPoints,
            otherClosestPoints: otherClosestPoints,
            cityList:      cityList,
            locationList:  opts.locationList || [],
            otherPoints:   otherPoints,
            pathCast:      pathCast,

            stormType:              opts.stormType === "line" ? "line" : "single",
            movementSpeed:          movementSpeed,
            movementInKnots:        movementInKnots,
            movementDirection:      movementDirection,
            movementDirectionRounded: movementDirectionRounded,
            stationary:             stationary,

            bullets:        bullets,
            awwSiteId:      awwSiteId,
            awwSiteName:    awwSiteName,
            includedWatches: includedWatches,
            watches:        watches,

            user:        "wags",
            dateUtil:    renderDateUtil,
            timeFormat:  Utils.timeFormat,
            list:        Utils.list,
            mathUtil:    Utils.mathUtil,
            hazSimp:     makeHazSimp(renderDateUtil)
        };
    }

    // Hazard Services' hydro WHERE and headline wording, for the templates' hazard
    // simplification (WHAT/WHERE/WHEN) layout.
    var HS_SPECIAL_REGIONS = {
        BB: "Big Bend", CP: "central Panhandle", DS: "Deep South", EP: "eastern Panhandle",
        ER: "east central Upper", EU: "eastern Upper", MI: "Middle", NP: "northern Panhandle",
        NR: "north central Upper", PA: "the Panhandle of", PD: "the Piedmont of", SP: "southern Panhandle",
        SR: "south central Upper", UP: "Upstate", WP: "western Panhandle", WU: "western Upper",
        NN: "north", NE: "northeast", EE: "east", SE: "southeast", SS: "south", SW: "southwest", WW: "west",
        NW: "northwest", EA: "east", NO: "north", SO: "south", WE: "west", WS: "southwest", ES: "southeast",
        WN: "northwest", EN: "northeast", NC: "north central", EC: "east central", WC: "west central",
        SC: "south central", CC: "central"
    };
    var HS_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    function hsDirections(set, ern) {
        set = (set || []).map(function (d) { return String(d).toUpperCase(); });
        if (set.length === 1 && HS_SPECIAL_REGIONS[set[0]]) return HS_SPECIAL_REGIONS[set[0]];
        var w = (set.indexOf("NORTH") !== -1 ? "north" : (set.indexOf("SOUTH") !== -1 ? "south" : ""))
            + (set.indexOf("EAST") !== -1 ? "east" : (set.indexOf("WEST") !== -1 ? "west" : ""));
        if (set.indexOf("CENTRAL") !== -1) return w ? w + " central" : "central";
        return w && ern ? w + "ern" : w;
    }

    function hsList(items) {
        if (items.length < 2) return items.join("");
        return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
    }

    function makeHazSimp(dateUtil) {
        return {
            /** "715 PM CDT this evening", the expire time as the headline gives it. */
            until: function (expire, now, tz) {
                function f(d, fmt, round) { return round ? dateUtil.format(d, fmt, 15, tz) : dateUtil.format(d, fmt, tz); }
                function day(d, round) {
                    var s = f(d, "yyyyMMdd", round);
                    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 86400000;
                }
                var h = f(expire, "h", true), mm = f(expire, "mm", true), ap = f(expire, "a", true);
                var hm = +f(expire, "H", true) * 60 + +mm;
                var time = mm !== "00" ? h + mm + " " + ap : (h !== "12" ? h + " " + ap : (ap === "PM" ? "noon" : "midnight"));
                var diff = day(expire, true) - day(now, false);
                var dow = HS_DAYS.indexOf(f(expire, "EEEE", true));
                var words;
                if (diff <= 0) {
                    words = hm <= 360 ? "early this morning" : (hm < 720 ? "this morning"
                        : (hm === 720 ? "today" : (hm < 1080 ? "this afternoon" : "this evening")));
                } else if (hm === 0) {
                    words = diff === 1 ? "tonight" : HS_DAYS[(dow + 6) % 7] + " night";
                } else {
                    words = HS_DAYS[dow];
                }
                return time + " " + f(expire, "z", true) + " " + words;
            },
            /**
             * "A portion of northeast Missouri, including the following county, Ralls." The
             * noun is "county" in a new product and "area" in a cancellation or expiration,
             * where the phrase runs on from "is cancelled for" in lower case.
             */
            where: function (areas, noun, lower) {
                var s = whereText(areas, noun);
                return lower ? s.charAt(0).toLowerCase() + s.slice(1) : s;
            }
        };

        function whereText(areas, noun) {
            var groups = [];
            var byKey = {};
            var parishes = 0;
            (areas || []).forEach(function (a) {
                var region = hsDirections(a.partOfParentRegion, false);
                var label = (region ? region + " " : "") + (a.parentRegion || "");
                if (!byKey[label]) {
                    byKey[label] = { label: label, state: a.parentRegion, region: region, names: [] };
                    groups.push(byKey[label]);
                }
                var part = hsDirections(a.partOfArea, true);
                byKey[label].names.push((part ? part + " " : "") + a.name);
                if (a.stateabbr === "LA") parishes++;
            });
            var count = (areas || []).length;
            var kind = noun === "area" ? ["area", "areas"]
                : (parishes === count ? ["parish", "parishes"] : (parishes ? ["county", "counties and parishes"] : ["county", "counties"]));
            var lead = "including the following " + (count === 1 ? kind[0] : kind[1]) + ", ";
            if (groups.length === 1) return "A portion of " + groups[0].label + ", " + lead + hsList(groups[0].names) + ".";
            var states = [];
            var regions = {};
            groups.forEach(function (g) {
                if (!regions[g.state]) { regions[g.state] = []; states.push(g.state); }
                if (g.region) regions[g.state].push(g.region);
            });
            var summary = hsList(states.map(function (s) {
                return (regions[s].length ? hsList(regions[s]) + " " : "") + s;
            }));
            return "Portions of " + summary + ", " + lead + groups.map(function (g, i) {
                return (i === 0 ? "in " : "In ") + g.label + ", " + hsList(g.names) + ".";
            }).join(" ");
        }
    }

    var STATE_NAMES = {
        AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California",
        CO:"Colorado", CT:"Connecticut", DE:"Delaware", DC:"District of Columbia",
        FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho", IL:"Illinois",
        IN:"Indiana", IA:"Iowa", KS:"Kansas", KY:"Kentucky", LA:"Louisiana",
        ME:"Maine", MD:"Maryland", MA:"Massachusetts", MI:"Michigan",
        MN:"Minnesota", MS:"Mississippi", MO:"Missouri", MT:"Montana",
        NE:"Nebraska", NV:"Nevada", NH:"New Hampshire", NJ:"New Jersey",
        NM:"New Mexico", NY:"New York", NC:"North Carolina", ND:"North Dakota",
        OH:"Ohio", OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania",
        RI:"Rhode Island", SC:"South Carolina", SD:"South Dakota",
        TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont", VA:"Virginia",
        WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming",
        AS:"American Samoa", GU:"Guam", MP:"Northern Mariana Islands",
        PR:"Puerto Rico", VI:"U.S. Virgin Islands"
    };

    // countyTypes.txt, the areaNotationTranslationFile the geospatial configs name.
    var COUNTY_NOTATION_OVERRIDES = {
        LA: { area: "Parish",       areas: "Parishes" },
        DC: { area: "",             areas: "" },
        AK: { area: "",             areas: "" },
        PR: { area: "Municipality", areas: "Municipalities" },
        GU: { area: "",             areas: "" }
    };

    /**
     * Census gives independent cities a county code of 500 or higher: the 38 Virginia
     * cities, Baltimore, St. Louis and Carson City. Texas is excluded because its county
     * codes run past 500 without any of them being a city, which is the same carve-out the
     * AWIPS headline macros make.
     */
    function isIndependentCity(countyFips, state) {
        if (state === "TX") return false;
        var n = parseInt(countyFips, 10);
        return !isNaN(n) && n >= 500;
    }

    // The templates gate the "The City of..." wording on the name containing "City of",
    // so Carson City -- already a city name -- has to stay as it is.
    function independentCityName(name) {
        if (!name) return name;
        return /\bcity\b/i.test(name) ? name : "City of " + name;
    }

    function toWatch(w) {
        var end = (w.endTime instanceof Date) ? w.endTime : new Date(w.endTime);
        return {
            phenSig:     w.phenSig,
            etn:         String(w.etn == null ? "" : w.etn),
            state:       w.state || null,
            partOfState: (w.partOfState || []).slice(),
            marineArea:  w.marineArea || null,
            endTime:     end,
            startTime:   w.startTime ? new Date(w.startTime) : null,
            getPhenSig:  function () { return this.phenSig; },
            getEndTime:  function () { return this.endTime; }
        };
    }

    function featureToArea(feature) {
        var p = feature.properties || {};

        var rawFips = String(p.fips != null ? p.fips : "");
        var countyFips = rawFips.length >= 3 ? rawFips.slice(-3) : rawFips;

        var state = p.state || p.stateabbr;

        // County features carry the full SSCCC code. The headline macros slice off the state
        // digits themselves to spot independent cities, so hand them the whole thing rather
        // than the three-digit tail; UGC.build takes the tail on its own.
        var isCounty = !p.marine && !p.zone;
        var fips = (isCounty && rawFips.length === 5) ? rawFips : countyFips;
        var indepCity = isCounty && isIndependentCity(countyFips, state);

        var notation = (p.marine || indepCity)
            ? { area: "", areas: "" }
            : (COUNTY_NOTATION_OVERRIDES[state] || { area: "County", areas: "Counties" });

        return {
            name:               indepCity ? independentCityName(p.name) : p.name,
            fips:               fips,
            state:              state,
            stateabbr:          p.stateabbr || p.state,
            state_zone:         countyFips,
            parentRegion:       p.parentRegion || STATE_NAMES[state] || state,
            partOfArea:         [],

            partOfParentRegion: Array.isArray(p.partOfParentRegion) ? p.partOfParentRegion.slice() : [],
            areaNotation:       p.areaNotation  || notation.area,
            areasNotation:      p.areasNotation || notation.areas,
            points:             []
        };
    }

    function roundTo45(deg) {
        var r = Math.round(deg / 45) * 45;
        if (r === 0) r = 360;
        return r;
    }

    var CWA_STATE_REGION_OVERRIDES = {
        MEG: { TN: { FFW: "Tennessee" } }
    };

    function applyCwaRegionOverride(area, siteId, productId) {
        if (!area || !siteId || !productId) return area;
        var byOffice = CWA_STATE_REGION_OVERRIDES[siteId];
        if (!byOffice) return area;
        var byState = byOffice[area.stateabbr];
        if (!byState) return area;
        var phrase = byState[productId];
        if (!phrase) return area;
        area.partOfParentRegion = [];
        area.parentRegion = phrase;
        return area;
    }

    function stateName(abbr) {
        return STATE_NAMES[abbr] || abbr;
    }

    return {
        buildMockContext:        buildMockContext,
        featureToArea:           featureToArea,
        applyCwaRegionOverride:  applyCwaRegionOverride,
        stateName:               stateName
    };
}));
