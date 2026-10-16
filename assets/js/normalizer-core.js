

(function () {
    "use strict";

    const TZ_MAP = {
        CDT: "Central Daylight Time",
        CST: "Central Standard Time",
        EDT: "Eastern Daylight Time",
        EST: "Eastern Standard Time",
        MDT: "Mountain Daylight Time",
        MST: "Mountain Standard Time",
        PDT: "Pacific Daylight Time",
        PST: "Pacific Standard Time",
        AKDT: "Alaska Daylight Time",
        AKST: "Alaska Standard Time",
        HST: "Hawaii Standard Time",
        UTC: "Coordinated Universal Time",
        Z: "Coordinated Universal Time",
    };

    const LOWER_WORDS = new Set([
        "a", "an", "and", "as", "at", "between", "but", "by", "for", "from",
        "if", "in", "into", "near", "nor", "of", "off", "on", "onto", "or",
        "out", "over", "per", "the", "to", "up", "via", "with", "without",
        "north", "south", "east", "west",
        "northeast", "northwest", "southeast", "southwest",
        "northern", "southern", "eastern", "western",
        "northeastern", "northwestern", "southeastern", "southwestern",
        "central",
    ]);

    const US_STATES = [
        "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
        "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
        "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
        "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
        "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
        "New Hampshire", "New Jersey", "New Mexico", "New York",
        "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
        "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
        "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
        "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
        "Puerto Rico", "Guam", "American Samoa", "Virgin Islands",
        "Northern Mariana Islands",
    ];

    const DAY_NAMES = [
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    ];

    const PROPER_ALWAYS = new Set([
        "National Weather Service", "Interstate", "Doppler", ...US_STATES, ...DAY_NAMES,
    ]);

    // words after which a "..."-separated run is a list of places
    const LIST_TRIGGER = /\b(?:INCLUDES?|INCLUDING|CITIES OF|TOWNS OF|COMMUNITIES OF|LOCATIONS OF|COUNTIES OF|AFFECT|AFFECTING|IMPACT|IMPACTING|NEAR|FOR)\s*$/;

    const PLACE_ENDERS = new Set([
        "REFUGE", "PARK", "AIRPORT", "LAKE", "RESERVOIR", "CREEK", "RIVER",
        "BAY", "HARBOR", "BEACH", "MOUNTAIN", "MOUNTAINS", "HILLS", "FOREST",
        "MONUMENT", "ISLAND", "CANYON", "DAM",
    ]);

    function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function collapseSpaces(text) {
        return text.replace(/\s+/g, " ").trim();
    }

    function isProductLine(text) {
        const t = text.trim().toUpperCase();
        return (
            /^(?:TEST\.\.\.)?[A-Z][A-Z /()\-]+(?:WARNING|WATCH|ADVISORY|STATEMENT|EMERGENCY|OUTLOOK|FORECAST|MESSAGE|ALERT)(?:\.\.\.(?:UPDATED|CORRECTED|TEST))?$/.test(t) ||
            /^WATCH COUNTY NOTIFICATION\b/.test(t)
        );
    }

    function isBroadcastLine(text) {
        return /^(?:BULLETIN|URGENT)\s*-/i.test(text.trim());
    }

    // a block of county names in fixed-width columns (WCN)
    function isColumnLine(text) {
        const cells = text.trim().split(/\s{2,}/);
        return cells.every((c) => /^[A-Z][A-Z'\-]*(?: [A-Z][A-Z'\-]*){0,2}$/.test(c));
    }

    function isHeaderTime(text) {
        // optionally followed by the same time in a second zone: "... 2012 /1056 AM MST THU JUL 12 2012/"
        return /^(?:\d{3,4}|\d{1,2}:\d{2})\s+[AP]M\s+[A-Z]{2,4}\s+\w{3}\s+\w{3}\s+\d{1,2}\s+\d{4}(?:\s*\/[^/]+\/)?$/i.test(
            text.trim()
        );
    }

    function isWmoHeaderLine(text) {
        return /^[A-Z]{4}\d{2}\s+[A-Z]{4}\s+\d{6}(?:\s+[A-Z]{3})?$/.test(text.trim());
    }

    function isAwipsIdLine(text) {
        return /^[A-Z]{3}[A-Z0-9]{3}$/.test(text.trim());
    }

    function isUgcLine(text) {
        const stripped = text.trim();
        return /^[A-Z0-9>-]+-$/.test(stripped) && /\d{3}/.test(stripped);
    }

    function isVtecLine(text) {
        const stripped = text.trim();
        return (
            /^\/[A-Z0-9]\.[A-Z]{3}\.[A-Z]{4}\.[A-Z]{2}\.[A-Z]\.\d{4}\.\d{6}T\d{4}Z-\d{6}T\d{4}Z\/$/.test(stripped) ||
            /^\/[A-Z0-9]{5}\.[0-9NU]\.[A-Z]{2}\.(?:\d{6}T\d{4}Z\.){3}[A-Z]{2}\/$/.test(stripped)
        );
    }

    function isAreaNameListLine(text) {
        const stripped = text.trim();
        if (!stripped.endsWith("-") || stripped.includes("...")) return false;
        const parts = stripped.slice(0, -1).split("-");
        if (!parts.length) return false;
        return parts.every((p) => /^[A-Za-z][A-Za-z0-9.'\u2019/ ]*$/.test(p.trim()));
    }

    function titleish(phrase) {
        phrase = collapseSpaces(phrase);
        const words = phrase.toLowerCase().split(" ");

        function transformToken(token) {
            if (LOWER_WORDS.has(token.toLowerCase())) return token.toLowerCase();
            return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
        }

        const out = [];
        for (const word of words) {
            if (word.includes("/")) {
                out.push(word.split("/").map(transformToken).join("/"));
            } else if (word.includes("-")) {
                out.push(word.split("-").map(transformToken).join("-"));
            } else {
                out.push(transformToken(word));
            }
        }
        return out.join(" ");
    }

    const TIME_CONT = new Set(["area", "to", "and", "or", "until", "through", "on", "at", "for", "in", "with", "est",
        "cst", "mst", "pst", "edt", "cdt", "mdt", "pdt", "akst", "akdt", "hst", "eastern", "central", "mountain",
        "pacific", "local", "today", "tonight", "tomorrow", "this", "observations", "temperatures", "readings"]);

    function sentenceCaseBasic(text) {
        text = collapseSpaces(text).toLowerCase();
        const chars = text.split("");
        let capitalize = true;
        for (let i = 0; i < chars.length; i++) {
            if (capitalize && /[a-z]/i.test(chars[i])) {
                chars[i] = chars[i].toUpperCase();
                capitalize = false;
            }
            // a sentence end only before a space or the end: "1.5 TO 2.5 INCHES" is not three sentences
            if (".!?".includes(chars[i]) && (i + 1 >= chars.length || /\s/.test(chars[i + 1]))) {
                // "THE 9 A.M. AREA WEATHER OBSERVATIONS": after a.m. / p.m. a continuing word keeps the sentence
                const tail = text.slice(i + 1).match(/^\s+([a-z]+)/);
                capitalize = !(/\b[ap]\.m$/.test(text.slice(0, i)) && tail && TIME_CONT.has(tail[1]));
            }
        }
        return chars.join("");
    }

    function restorePhrases(text, phrases) {
        const sorted = [...new Set([...phrases].filter(Boolean))].sort(
            (a, b) => b.length - a.length
        );
        for (const phrase of sorted) {
            const pat = new RegExp(
                "(?<![A-Za-z])" + escapeRegExp(phrase) + "(?![A-Za-z])",
                "gi"
            );
            text = text.replace(pat, phrase);
        }
        return text;
    }

    function oxfordJoin(items) {
        items = items.filter(Boolean);
        if (items.length === 0) return "";
        if (items.length === 1) return items[0];
        if (items.length === 2) return items[0] + " and " + items[1];
        return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
    }

    function expandTimeString(text) {
        text = collapseSpaces(text).toUpperCase().replace(/\.+$/, "");
        const m = text.match(/^(\d{1,4})\s*([AP]M)\s*([A-Z]{1,4}\b)?\s*(.*)$/);
        if (!m) return titleish(text);

        const hhmm = m[1];
        const ampm = m[2];
        let hour, minute;

        if (hhmm.length <= 2) {
            hour = parseInt(hhmm, 10);
            minute = 0;
        } else if (hhmm.length === 3) {
            hour = parseInt(hhmm[0], 10);
            minute = parseInt(hhmm.slice(1), 10);
        } else {
            hour = parseInt(hhmm.slice(0, -2), 10);
            minute = parseInt(hhmm.slice(-2), 10);
        }

        let rendered = minute
            ? `${hour}:${String(minute).padStart(2, "0")} ${ampm}`
            : `${hour} ${ampm}`;
        let rest = m[4] || "";
        if (m[3] && TZ_MAP[m[3]]) {
            rendered += " " + TZ_MAP[m[3]];
        } else if (m[3]) {
            rest = (m[3] + " " + rest).trim();
        }
        // "345 PM CST FRIDAY", "3 PM CST THIS AFTERNOON"
        if (rest) rendered += " " + restorePhrases(rest.toLowerCase(), DAY_NAMES);
        return rendered;
    }

    function expandInlineTimes(text) {
        const tzAbbrevs = Object.keys(TZ_MAP).map(escapeRegExp).join("|");
        const pat = new RegExp(
            "\\b(\\d{1,4}\\s*[AaPp][Mm]\\s*(?:" + tzAbbrevs + "))\\b",
            "gi"
        );
        return text.replace(pat, (match) => expandTimeString(match));
    }

    function extractMixedCaseEntities(text) {
        if (text.toUpperCase() === text) return new Set();
        const clean = text.replace(/\.\.\./g, " ");
        const entities = new Set();

        const multiRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
        let m;
        while ((m = multiRe.exec(clean)) !== null) {
            const candidate = m[1];
            let words = candidate.split(/\s+/);
            if (!LOWER_WORDS.has(words[0].toLowerCase())) {
                entities.add(candidate);
            }

            while (words.length && LOWER_WORDS.has(words[0].toLowerCase())) {
                words = words.slice(1);
            }
            if (words.length >= 2) {
                entities.add(words.join(" "));
            }
        }

        const singleRe =
            /(?:,\s*|\band\s+|\bor\s+|\binclude\s+|\bof\s+|\bover\s+|\bnear\s+)([A-Z][a-z]{2,})\b/g;
        while ((m = singleRe.exec(clean)) !== null) {
            const word = m[1];
            if (!LOWER_WORDS.has(word.toLowerCase())) {
                entities.add(word);
            }
        }
        return entities;
    }

    function splitAreaItems(text, lines) {
        // one area per line, no "..." separators
        if (lines && lines.length > 1 && !/\.\.\./.test(text)) {
            return lines.map((l) => titleish(l.replace(/^[ .]+|[ .]+$/g, ""))).filter(Boolean);
        }
        const raw = collapseSpaces(text.replace(/\n/g, " "));
        const parts = raw
            .split(/\.\.\.+/)
            .map((p) => p.replace(/^[ .]+|[ .]+$/g, ""))
            .filter(Boolean);
        // "A DAM FAILURE IN...WESTERN HENRY COUNTY": an item ending in a preposition runs into the next
        const merged = [];
        for (const p of parts) {
            if (merged.length && /\s(?:IN|NEAR|OF|ON|AT|ALONG)$/i.test(merged[merged.length - 1])) {
                merged[merged.length - 1] += " " + p;
            } else {
                merged.push(p);
            }
        }
        return merged.map(titleish);
    }

    function splitPlaceItems(text) {
        const raw = collapseSpaces(text.replace(/\n/g, " ").replace(/^[ .]+|[ .]+$/g, ""));
        if (!raw) return [];

        const chunks = raw
            .split(/\.\.\.+/)
            .map((c) => c.replace(/^[ .]+|[ .]+$/g, ""))
            .filter(Boolean);

        const out = [];
        const enders = [...PLACE_ENDERS].sort().join("|");
        const splitRe = new RegExp(
            "^(.*\\b(?:" + enders + "))\\s+AND\\s+([A-Z0-9].+)$",
            "i"
        );

        for (const chunk of chunks) {
            const cm = chunk.match(splitRe);
            const am = chunk.match(/^((?:\S+\s+){0,2}\S+)\s+AND\s+((?:\S+\s+){0,2}\S+)$/i);
            if (cm && cm[2].split(/\s+/).length >= 2) {
                out.push(cm[1]);
                out.push(cm[2]);
            } else if (am) {
                // "PAISLEY AND CASSIA": two places
                out.push(am[1]);
                out.push(am[2]);
            } else {
                out.push(chunk);
            }
        }
        return out.map(titleish);
    }

    // words that make a "..." list a list of hazards or a clause, not of places
    const NOT_PLACE = new Set((
        "HAIL WIND WINDS RAIN RAINFALL LIGHTNING FLOODING FLOOD TORNADO TORNADOES SNOW ICE SLEET WEATHER STORM STORMS " +
        "THUNDERSTORM THUNDERSTORMS DAMAGE DAMAGING DEBRIS VISIBILITY CONDITIONS TRAVEL ROADS GUSTS HEAVY LARGE " +
        "STRONG SEVERE DESTRUCTIVE EXTREMELY DEADLY FREQUENT TEMPERATURES WATER IS ARE WAS WERE WILL BE ITS " +
        "WITH YOUR YOU THIS THAT THESE IF MAY CAN SHOULD MOVE PROTECTION SAFETY PORTIONS PARTS"
    ).split(" "));

    function isPlaceLike(phrase) {
        return phrase.trim().split(/\s+/).every((w) => !NOT_PLACE.has(w));
    }

    // places in "...INCLUDE...A...B...C AND D" style lists, so restorePhrases capitalises them after sentence casing
    function addListEntities(text, entities) {
        if (text.toUpperCase() !== text) return;
        const chunks = text.split(/\.\.\.+/).map((c) => c.trim());
        for (let i = 0; i < chunks.length - 1; i++) {
            // a "IMPACT...OVERTURNED AND CAPSIZED BOATS." label opening its own sentence is not a place list
            if (/(?:^|[.:]\s*)IMPACTS?\s*$/.test(chunks[i])) continue;
            const tm = chunks[i].match(LIST_TRIGGER);
            const head = chunks[i].match(
                /\b(?:INCLUDES?|INCLUDING|NEAR|FOR|AFFECT|AFFECTING|IMPACT|IMPACTING)\s+((?:[A-Z][A-Z.'\-]*\s?){1,3})$/
            );
            // "...INCLUDING THE FOLLOWING AREAS...A...B": a trigger, not the first place
            const following = head && /^THE FOLLOWING\b/.test(head[1].trim());
            if (!tm && !following && !(head && isPlaceLike(head[1]))) continue;
            const items = [];
            if (!tm && !following && head) items.push(head[1].trim());
            for (let j = i + 1; j < chunks.length; j++) {
                let c = chunks[j].replace(/\.\s*$/, "").replace(/^AND\s+/, "").trim();
                // the next list's trigger, not a place: that list is collected from its own chunk
                if (/^(?:INCLUDING|THE FOLLOWING)\b/.test(c)) break;
                const last = /\.(?:\s|$)/.test(chunks[j]) || j === chunks.length - 1;
                const parts = c.split(/\s+AND\s+/).map((p) =>
                    p.replace(/\s+(?:COUNTIES|COUNTY|PARISHES|PARISH|AREAS)$/, "").trim()
                );
                if (!parts.every((p) => /^[A-Z][A-Z .'\-]*$/.test(p) && p.split(/\s+/).length <= 4)) break;
                // a hazard or clause in the run: it was never a list of places
                if (!parts.every(isPlaceLike)) {
                    items.length = 0;
                    break;
                }
                items.push(...parts);
                if (last) break;
            }
            if (items.length >= 2) {
                for (const it of items) entities.add(titleish(it));
            }
        }
    }

    // zone names carry a state code in multi-state products ("ALLEGHANY VA"): CRS read "Alleghany, Virginia".
    // Codes that are also English words (IN OR ME OK HI DE LA MA AL CO PA ID OH) are left alone.
    const ZONE_STATES = {
        AK: "ALASKA", AZ: "ARIZONA", AR: "ARKANSAS", CA: "CALIFORNIA", CT: "CONNECTICUT",
        FL: "FLORIDA", GA: "GEORGIA", IA: "IOWA", KS: "KANSAS", KY: "KENTUCKY", MI: "MICHIGAN", MN: "MINNESOTA",
        MO: "MISSOURI", MS: "MISSISSIPPI", MT: "MONTANA", NC: "NORTH CAROLINA", ND: "NORTH DAKOTA", NE: "NEBRASKA",
        NH: "NEW HAMPSHIRE", NJ: "NEW JERSEY", NM: "NEW MEXICO", NV: "NEVADA", NY: "NEW YORK", RI: "RHODE ISLAND",
        SC: "SOUTH CAROLINA", SD: "SOUTH DAKOTA", TN: "TENNESSEE", TX: "TEXAS", UT: "UTAH", VA: "VIRGINIA",
        VT: "VERMONT", WA: "WASHINGTON", WI: "WISCONSIN", WV: "WEST VIRGINIA", WY: "WYOMING", PR: "PUERTO RICO",
    };
    const ZONE_STATE_RE = new RegExp(
        "\\b([A-Z][A-Z'\\-]+) (" + Object.keys(ZONE_STATES).join("|") + ")(?=\\s+AND\\b|\\s*\\.\\.\\.|[.,]|\\s*$)",
        "g"
    );

    // marine zones: "LAKE MICHIGAN MICHIGAN CITY IN TO ST. JOSEPH MI 5 NM OFFSHORE TO MID-LINE OF LAKE": CRS read
    // "Lake Michigan, Michigan City, Indiana to St. Joseph, Michigan, 5 nautical miles offshore to mid-line of lake"
    // (WXJ57 SMW 2015). Every code is a state here, IN / OH / ... included, when a "TO" or a number follows.
    const MARINE_STATES = Object.assign({}, ZONE_STATES, {
        IL: "ILLINOIS", IN: "INDIANA", OH: "OHIO", OR: "OREGON", ME: "MAINE", OK: "OKLAHOMA", HI: "HAWAII",
        DE: "DELAWARE", LA: "LOUISIANA", MA: "MASSACHUSETTS", AL: "ALABAMA", MD: "MARYLAND", PA: "PENNSYLVANIA",
    });
    const MARINE_STATE_RE = new RegExp(
        "\\b([A-Z][A-Z.'\\-]+) (" + Object.keys(MARINE_STATES).join("|") + ")(?=\\s+(?:TO|OUT)\\b|\\s+\\d|\\s*\\.\\.\\.|[.,]|\\s*$)",
        "g"
    );

    function marineZoneItem(item) {
        return item
            .replace(/(^|\.\.\.)(\s*LAKE (?:MICHIGAN|SUPERIOR|HURON|ERIE|ONTARIO)) (?=[A-Z])/g, "$1$2, ")
            .replace(MARINE_STATE_RE, (m, name, st) => `${name}, ${MARINE_STATES[st]}`)
            .replace(/\b(\d+) NM\b/g, "$1 NAUTICAL MILES");
    }

    const MARINE_LOWER_RE = /\b(?:Nautical Miles|Offshore|[Oo]ff Shore|Nearshore|Mid-Line|Beyond|of Lake(?=$|,))/g;
    // titleish lowercases compass words: "Edisto Beach, south Carolina"
    const MARINE_STATE_CASE_RE = /\b(north|south|west|new|rhode) (Carolina|Dakota|Virginia|Hampshire|Jersey|Mexico|York|Island)\b/g;

    // "BIG SIOUX RIVER", "WEST 12TH STREET", "COVELL LAKE": up to three words before a feature word are a name. AT&T
    // phrases a lowercase "covell lake and" with a break after "lake" (2.1.5 ran on); leading function words are
    // not part of it ("ADJACENT TO THE RIVER" stays lowercase)
    // a feature word used as a modifier ("ROAD CREWS", "ROAD CONDITIONS") is not a name
    // COUNTY / PARISH too: "AT THE REQUEST OF THE PASCO COUNTY EMERGENCY MANAGEMENT AGENCY" was "pasco county"
    const FEATURE_RE = /\b([A-Z0-9][A-Z0-9'\-]*(?:\s+[A-Z0-9][A-Z0-9'\-]*){0,2})\s+(AVENUE|STREET|RIVER|LAKE|PARK|ROAD|BOULEVARD|CREEK|PARKWAY|RESERVOIR|COUNTY|PARISH)\b(?!\s+(?:YOUR|THEIR|THE|A|AN|COUNTY|COUNTIES|PARISH|CREWS?|CONDITIONS|SIGNS|WATERS|CLOSURES?|CLOSED|SURFACES?|WORK|ELECTRIC|PATROL|LEVELS?|STAGES?|FLOODING|OR\s+STREAM|ROADS?|LINES?)\b)/g;
    const FEATURE_STOP = new Set(["THE", "A", "AN", "OF", "AND", "OR", "TO", "FROM", "INTO", "ALONG", "BY", "IN", "ON",
        "AT", "NEAR", "OVER", "ACROSS", "THROUGH", "AROUND", "INCLUDING", "THIS", "THAT", "THESE", "THOSE", "ITS",
        "THEIR", "YOUR", "OUR", "AREA", "AREAS", "AFFECTED", "SMALL", "LOCAL", "NEARBY", "ANY", "ALL", "IS", "ARE",
        "WAS", "WILL", "BE", "OUT", "AWAY", "ADJACENT", "BOUNDARY", "STAY", "INTERSTATE", "SUCH", "AS", "UNTIL",
        "PERSIST", "ALLOW", "NOT", "DO", "NEVER", "CHECK", "OBEY", "USE", "MEANS", "CANNOT", "CAN", "YOU", "IF",
        "SO", "MAY", "SHOULD", "MUST", "WOULD", "COULD", "WITH", "FOR", "WHEN", "WHERE", "WHICH", "FLOODED",
        "FLOOD", "UP", "DOWN", "EVERY", "MANY", "SOME", "MOST", "MORE", "OTHER", "NO", "AVOID", "CROSS", "ENTER",
        "LEAVE", "CLOSED", "MAJOR", "MINOR", "EACH", "BOTH", "INCLUDE", "INCLUDES", "WARNING", "WATCH", "ADVISORY",
        "THUNDERSTORM", "THUNDERSTORMS", "STORM", "STORMS", "TORNADIC", "TORNADO", "SEVERE", "REMAIN", "OFF", "SOME",
        "BRIEF", "OFFICIAL", "ALSO", "LOCATIONS", "IMPACTED", "AGENCY", "MANAGEMENT", "EMERGENCY", "HEAVY", "RAIN",
        "WATER", "WATERS", "THEN", "NOW", "HAS", "HAVE", "HAD", "BEEN", "IT", "THEY", "WE", "THERE", "ROADS",
        "FLOODING", "HIGH", "LOW", "RISING", "EITHER", "FAR", "EXTREME", "NORTHEASTERN", "NORTHWESTERN",
        "SOUTHEASTERN", "SOUTHWESTERN"]);

    // county / parish names: at most two words, letters only, and directions are not part of them ("North Central
    // Pinal County", "Cancels 1 County", "Please Contact Clay County" were wrong)
    const COUNTY_STOP = new Set(["NORTH", "SOUTH", "EAST", "WEST", "CENTRAL", "NORTHEAST", "NORTHWEST", "SOUTHEAST",
        "SOUTHWEST", "NORTHERN", "SOUTHERN", "EASTERN", "WESTERN", "UPPER", "LOWER", "ESPECIALLY", "CONTACT", "PLEASE",
        "CANCELS", "EXPIRE", "INDICATED", "PORTIONS", "PARTS", "PART", "PORTION", "RURAL", "ENTIRE", "WHOLE", "SAME",
        "ADJACENT", "NEIGHBORING", "SURROUNDING", "COASTAL", "INLAND", "EXTREME", "FAR", "FOLLOWING", "DOWNEAST"]);

    function addFeatureEntities(text, entities) {
        for (const m of text.matchAll(FEATURE_RE)) {
            let words = m[1].split(/\s+/);
            const county = /^(?:COUNTY|PARISH)$/.test(m[2]);
            if (county) words = words.slice(-2);
            let k = words.length;
            while (k > 0 && !FEATURE_STOP.has(words[k - 1]) &&
                   !(county && (COUNTY_STOP.has(words[k - 1]) || !/^[A-Z'\-]+$/.test(words[k - 1])))) k--;
            const name = words.slice(k);
            // directions belong to the name here ("West 12th Street", "Western Avenue"), unlike titleish's area lists
            if (name.length) {
                const cased = name.map((w) => w.charAt(0) + w.slice(1).toLowerCase());
                entities.add([...cased, m[2].charAt(0) + m[2].slice(1).toLowerCase()].join(" "));
                // "ALONG THE ANCLOTE RIVER NEAR ELFERS...AND ALONG ELFERS PARKWAY": the bare name after NEAR / OF /
                // IN / AT elsewhere in the text is the same place (was "near elfers")
                const bare = name.join(" ");
                if (!county && new RegExp(`\\b(?:NEAR|OF|IN|AT) ${escapeRegExp(bare)}\\b(?! ${m[2]}\\b)`).test(text)) {
                    entities.add(cased.join(" "));
                }
            }
        }
    }

    function normalizeNarrative(text, entities) {
        text = collapseSpaces(text);
        if (text.toUpperCase() === text) text = text.replace(ZONE_STATE_RE, (m, name, st) => `${name}, ${ZONE_STATES[st]}`);
        if (text.toUpperCase() === text) addFeatureEntities(text, entities);
        addListEntities(text, entities);
        text = text.replace(/^\.(?=[A-Z])/, "");
        text = text.replace(/\.\.\.\s*$/, "");
        text = text.replace(/\b(near|include|includes|including|of)\s*\.\.\./gi, "$1 ");
        text = text.replace(/\.\.\./g, ", ");
        text = text.replace(/\s*,\s*/g, ", ");
        text = text.replace(/\s+\.\s*/g, ". ");
        text = text.replace(/\b(\d+)\s*MPH\b/gi, "$1 miles per hour");
        // "8 NM NORTHEAST OF MICHIGAN CITY": nautical miles (New Mexico never follows a number)
        text = text.replace(/\b(\d+)\s*NM\b/g, "$1 nautical miles");
        text = text.replace(/\bNWS\b/gi, "National Weather Service");
        text = sentenceCaseBasic(text);
        text = expandInlineTimes(text);
        // times without a zone: "345 pm" -> "3:45 PM", "3 pm" -> "3 PM"
        text = text.replace(/(?<![:\d])\b(\d{1,4})\s*([ap])m\b/gi, (m0, d, ap) => expandTimeString(`${d} ${ap}M`));
        text = text.replace(/\b(\d{1,2}):(\d{2})\s*([ap])\.?m\b/gi, (m0, h, mm, ap) => `${+h}:${mm} ${ap.toUpperCase()}M`);
        // CRS read "I-74" as "Interstate 74"
        text = text.replace(/\bi-(\d+)/gi, "Interstate $1");
        // coordinates: "latitude 30.3N, longitude 82.4W"
        text = text.replace(/(\d\.\d+)([nsew])\b/g, (m0, d, c) => d + c.toUpperCase());
        text = text.replace(/\bu\.s\.(?=\s)/gi, "U.S.");
        text = restorePhrases(text, [...PROPER_ALWAYS, ...entities]);
        text = text.replace(/\s+,/g, ",");
        text = text.replace(/\.\.+/g, ".");
        return text;
    }

    function stripMetadata(raw) {
        const text = raw
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .replace(/^\uFEFF/, "");
        const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));

        let start = 0;
        for (let i = 0; i < lines.length; i++) {
            const stripped = lines[i].trim();
            if (
                /^(BULLETIN\s*-|URGENT\s*-|WATCH COUNTY NOTIFICATION)/i.test(stripped) ||
                isProductLine(stripped) ||
                stripped.startsWith("THE NATIONAL WEATHER SERVICE")
            ) {
                start = i;
                break;
            }
        }

        const trimmed = lines.slice(start);
        const out = [];
        let inUgcBlock = false;
        let inZoneCities = false;
        let sawIssuedTime = false;
        let prevWasWmo = false;
        // after "&&" only a watch statement is read ("A TORNADO WATCH REMAINS IN EFFECT UNTIL ..."): 20 of 24 SVR /
        // TOR / SVS takes whose product carried one
        let afterAmp = false;
        let para = [];
        const flushWatch = () => {
            if (para.length && /\bWATCH (?:REMAINS|IS) IN EFFECT\b/.test(para.join(" "))) out.push("", ...para);
            para = [];
        };
        for (const line of trimmed) {
            const stripped = line.trim();
            if (afterAmp) {
                if (stripped === "$$" || /^(LAT\.\.\.LON|TIME\.\.\.MOT\.\.\.LOC)/.test(stripped)) break;
                if (!stripped || stripped === "&&") flushWatch();
                else para.push(line);
                continue;
            }
            if (stripped === "&&") {
                afterAmp = true;
                continue;
            }
            // segment header of a zone product: "INCLUDING THE CITIES OF...A...B" up to the issue time line
            if (inUgcBlock && /^INCLUDING THE CITIES OF\b/.test(stripped)) {
                inZoneCities = true;
                continue;
            }
            if (inZoneCities) {
                if (stripped && !isHeaderTime(stripped)) continue;
                inZoneCities = false;
                if (stripped) {
                    inUgcBlock = false;
                    continue;
                }
            }
            if (stripped === "&&" || stripped === "$$") break;
            if (/^(LAT\.\.\.LON|TIME\.\.\.MOT\.\.\.LOC|TIME\.\.\.)/.test(stripped)) break;
            if (/^[A-Z]{2,}(?:\/[A-Z]{2,})+$/.test(stripped)) break;

            if (stripped) {
                if (isWmoHeaderLine(stripped)) {
                    prevWasWmo = true;
                    continue;
                }
                if (prevWasWmo && isAwipsIdLine(stripped)) {
                    prevWasWmo = false;
                    continue;
                }
                prevWasWmo = false;

                if (isUgcLine(stripped) || isVtecLine(stripped)) {
                    inUgcBlock = true;
                    continue;
                }
                if (inUgcBlock && isAreaNameListLine(stripped)) continue;
                if (isHeaderTime(stripped)) {
                    if (sawIssuedTime) continue;
                    sawIssuedTime = true;
                }
                inUgcBlock = false;
            }

            out.push(line);
        }
        flushWatch();
        return out;
    }

    function parseSegments(lines) {
        let i = 0;
        const header = {};

        if (i < lines.length && isBroadcastLine(lines[i])) {
            header.broadcast = lines[i].trim();
            i++;
        }
        if (i < lines.length && isProductLine(lines[i].trim())) {
            header.product = lines[i].trim();
            i++;
        }
        // issuing office lines ("NATIONAL WEATHER SERVICE ...", "... EMERGENCY MANAGEMENT AGENCY ...",
        // "RELAYED BY ...") up to and including the issue time
        const timeAt = lines.slice(i, i + 5).findIndex((l) => isHeaderTime(l));
        if (timeAt >= 0 && lines.slice(i, i + timeAt).every((l) => l.trim() && l.trim() === l.trim().toUpperCase())) {
            header.office = lines.slice(i, i + timeAt).map((l) => l.trim()).join(" ");
            header.issued_at = lines[i + timeAt].trim();
            i += timeAt + 1;
        } else if (
            i < lines.length &&
            lines[i].trim().toUpperCase().startsWith("NATIONAL WEATHER SERVICE")
        ) {
            header.office = lines[i].trim();
            i++;
            if (i < lines.length && isHeaderTime(lines[i])) {
                header.issued_at = lines[i].trim();
                i++;
            }
        }

        while (i < lines.length && !lines[i].trim()) i++;

        const segments = [];
        let current = null;

        while (i < lines.length) {
            const stripped = lines[i].trim();
            i++;

            if (!stripped) {
                if (current) {
                    segments.push(current);
                    current = null;
                }
                continue;
            }

            if (stripped.startsWith("* ")) {
                if (current) segments.push(current);
                current = { kind: "bullet", lines: [stripped.slice(2)] };
                continue;
            }

            if (current && current.kind === "bullet") {
                current.lines.push(stripped);
                continue;
            }

            // a section header starts a block; mid-paragraph it is the tail of a wrapped headline. A short label only
            // ("PRECAUTIONARY/PREPAREDNESS ACTIONS..."): "OTHER LOCATIONS IMPACTED BY THIS SEVERE THUNDERSTORM INCLUDE
            // LODA..." and "INCLUDING THE FOLLOWING INTERSTATE..." are content (CRS read them: 24 of 26 takes)
            if (current === null && /^[A-Z/ ]+\.\.\.$/.test(stripped) && stripped.split(/\s+/).length <= 4 &&
                !/\bINCLUD(?:E|ES|ING)\b/.test(stripped)) {
                current = { kind: "section", lines: [stripped] };
                continue;
            }

            if (current === null) {
                current = { kind: "para", lines: [stripped] };
            } else {
                current.lines.push(stripped);
            }
        }

        if (current) segments.push(current);
        return [header, segments];
    }

    // labels: "expanded" reads the impact-based tags the way broadcast systems did:
    // HAZARD...X -> "Expected hazards include x."   SOURCE...RADAR INDICATED [Y] -> "This is a radar indicated threat [y]."
    // IMPACT...X -> "The following impacts are expected. X."   Returns false to leave a label to the default handling.
    function expandLabel(label, value, entities, output) {
        const v = value.trim();
        // "60 Miles per hour wind gusts": the first letter, not the first character
        const lowerFirst = (s) =>
            [...entities].some((p) => p.length > 1 && s.toLowerCase().startsWith(p.toLowerCase()))
                ? s
                : s.replace(/^([^A-Za-z]*)([A-Z])/, (m0, a, b) => a + b.toLowerCase());
        const body = () => normalizeNarrative(v, entities).replace(/[.\s]+$/, "");
        switch (label.trim().toUpperCase()) {
            case "HAZARD":
                output.push(`Expected hazards include ${lowerFirst(body())}.`);
                return true;
            case "SOURCE": {
                const sm = v.match(/^RADAR INDICATED\b\s*(.*?)[.\s]*$/i);
                if (!sm) return false;
                output.push(`This is a radar indicated threat${sm[1] ? " " + sm[1].toLowerCase() : ""}.`);
                return true;
            }
            case "IMPACT":
            case "IMPACTS":
                output.push(`The following impacts are expected. ${body()}.`);
                return true;
        }
        return false;
    }

    const STATE_NAMES = Object.values(ZONE_STATES)
        .concat(["INDIANA", "OREGON", "MAINE", "OKLAHOMA", "HAWAII", "DELAWARE", "LOUISIANA", "MASSACHUSETTS",
            "ALABAMA", "COLORADO", "PENNSYLVANIA", "IDAHO", "OHIO", "MARYLAND"])
        .map(titleish)
        .sort((a, b) => b.length - a.length);

    // CRS's own repeat wording (443 of 597 transcribed 'Repeating' lines): county names only, alphabetical, grouped by
    // state: "for the following counties, in Texas, Gray and Wheeler" / "for the following county, Perry, Illinois"
    function crsRepeatAreas(items, unitWord) {
        const groups = new Map();
        let parish = false;
        for (const it of items.filter((x) => x && !/^this\b/i.test(x))) {
            const state = STATE_NAMES.find((s) => new RegExp(`\\b${s}$`, "i").test(it)) || "";
            const nm = it
                .replace(/\s+in\s+.*$/i, "")
                .replace(/^(?:(?:far|extreme|northern|southern|eastern|western|central|north|south|east|west|northeast|northwest|southeast|southwest|northeastern|northwestern|southeastern|southwestern|east central|west central|north central|south central)\s+)+/i, "")
                .replace(/\s+(County|Parish)$/i, (m0, w) => {
                    if (/parish/i.test(w)) parish = true;
                    return "";
                })
                .trim();
            if (!groups.has(state)) groups.set(state, []);
            if (!groups.get(state).includes(nm)) groups.get(state).push(nm);
        }
        const n = [...groups.values()].reduce((a, g) => a + g.length, 0);
        // unitWord: the CRS said "areas" for sub-county zones ("Central Campbell, Northern Campbell": WXL23 drill)
        const unit = unitWord || (parish ? (n > 1 ? "parishes" : "parish") : n > 1 ? "counties" : "county");
        if (n === 1) {
            const [[state, [nm]]] = [...groups.entries()];
            return `the following ${unit}, ${nm}${state ? ", " + state : ""}`;
        }
        const parts = [...groups.entries()].map(([state, names]) => {
            names.sort((a, b) => a.localeCompare(b));
            const list = names.length > 2
                ? `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
                : names.join(" and ");
            return state ? `in ${state}, ${list}` : list;
        });
        return `the following ${unit}, ${parts.join(", ")}`;
    }

    // per-office CRS reading habits, keyed by the issuing WFO; an explicit option of the same name wins.
    //   soundOutA: the office's CRS sounded out the article ("has issued A tornado warning"), MLB does, most do not.
    //              Emitted as a capital "A", which the AT&T Tom voice plays as MLB's long rising "a"; limited to the
    //              contexts the voice has an approved reading for.
    //   rate:      the office's CRS speaking speed in percent of the fleet's (MLB: 95, measured on its NWS_Warning bulletin against 2.1.5);
    //              emitted as a leading "\!rateNN", which the AT&T Tom voice's front-end proxy strips and applies.
    //   citiesRunOn: the cities line follows the warned area as a comma clause ("... Florida, this includes the cities
    //              of ...") instead of a new sentence (MLB: 160 ms there against its ~400 ms sentence breaks).
    //   nearRunOn: "will be near <place>" runs on (MLB); most stations pause after "near" (2.1.5 90%, 48 stations), which
    //              the AT&T Tom voice does by rule: "\!nr" before "be" turns that rule off at this spot.
    //   milesAnHour: "MPH" read as "miles an hour" (MLB 2.1.5 Wayback); the fleet's CRS said "miles per hour"
    //              (off-air takes: per 342, an 116; "an" mostly where the product spelled it out)
    //   nearAndBreak: "will be near A, and B by ..." with a phrase break before the "and" (MLB 2.1.5: 155 ms, A ends
    //              in a final fall); the fleet runs it on (2.1.5 paused 7% of 28, 17 stations). "\!nr," keeps the
    //              AT&T Tom voice's rule that drops a comma before "and" off this one.
    const OFFICE_PROFILES = {
        MLB: { soundOutA: true, rate: 95, citiesRunOn: true, nearRunOn: true, milesAnHour: true, nearAndBreak: true },
    };

    // offices whose CRS read the time zone after a time (crs_iem.db: >= 5 matched takes, >= 70% said it; MLB 4 of 7,
    // kept for its 2.1.5 Wayback bulletins); every other office drops it (C:\tmp\t51\ear_fixer\tz_office.py)
    const TZ_SAY_OFFICES = new Set(["BMX", "BOU", "BOX", "BRO", "CHS", "CYS", "FFC", "HGX", "IND", "IWX", "JAN", "LMK",
        "MLB", "OHX", "OTX", "OUN", "PSR", "SHV", "SJT", "TSA"]);

    function issuingOffice(raw) {
        const m = raw.match(/^[A-Z]{4}\d{2}\s+[KPT]([A-Z]{3})\s+\d{6}/m) || raw.match(/^[A-Z]{3}([A-Z]{3})\s*$/m);
        return m ? m[1].toUpperCase() : null;
    }

    function normalizeNwsBulletin(raw, options) {
        options = options || {};
        const office = (options.office || issuingOffice(raw) || "").toUpperCase();
        options = Object.assign({}, TZ_SAY_OFFICES.has(office) ? { timeZone: true } : {}, OFFICE_PROFILES[office] || {},
            options);
        const lines = stripMetadata(raw);
        const [header, segments] = parseSegments(lines);

        const entities = new Set(PROPER_ALWAYS);
        // the issuing office's city ("NATIONAL WEATHER SERVICE LINCOLN IL", "... TAMPA BAY AREA - RUSKIN FL")
        const om = (header.office || "").match(/NATIONAL WEATHER SERVICE\s+(.+?)(?:\s+[A-Z]{2})?$/i);
        if (om) {
            for (const part of om[1].split(/\s+-\s+|\//)) {
                if (part.trim()) entities.add(titleish(part.trim()));
            }
        }
        // test products (VTEC "/T.", "TEST...TORNADO WARNING...TEST"): CRS read "has issued a test tornado warning
        // for ..." and dropped "THIS IS A TEST MESSAGE." inside the bullets (WXL23 TOR drill 2014)
        const isTest = /^\/T\.[A-Z]{3}\./m.test(raw) || /^TEST\.\.\./.test(header.product || "");
        let testLead = null;
        let product = header.product
            ? titleish(header.product.replace(/^TEST\.\.\.|\.\.\.TEST$/g, ""))
            : null;
        if (product && isTest) product = `test ${product}`;
        let introCity = null;
        let introAction = null;
        let warningFor = null;
        let areaItems = [];
        let until = null;
        let citiesLine = null;
        let leadBullet = null;
        const output = [];
        let inPrecautions = false;

        for (const segment of segments) {
            if (isTest && segment.kind === "bullet") {
                segment.lines[0] = segment.lines[0].replace(/^THIS IS A TEST MESSAGE\.\s*/i, "");
            }
            // bulletLabels: "drop": "* TIMING: SNOW..." / "* MAIN IMPACT: A COMBINATION ..." read without the label
            // (WXM49 WSW 2015)
            if (options.bulletLabels === "drop" && segment.kind === "bullet" && /^[A-Z][A-Z /\-]{1,30}:\s*/.test(segment.lines[0])) {
                segment.lines[0] = segment.lines[0].replace(/^[A-Z][A-Z /\-]{1,30}:\s*/, "");
                segment.unlabelled = true;
            }
            const text = collapseSpaces(segment.lines.join(" "));
            // precautions: false: the transmitter skipped the PRECAUTIONARY/PREPAREDNESS ACTIONS block (WXJ76 2 of 2
            // takes, WXM49 3 of 3); a post-&& watch statement is still read
            if (segment.kind === "section") inPrecautions = /PRECAUTIONARY|PREPAREDNESS/.test(text);
            else if (/\bWATCH (?:REMAINS|IS) IN EFFECT\b/.test(text)) inPrecautions = false;
            if (inPrecautions && options.precautions === false) continue;
            for (const e of extractMixedCaseEntities(text)) entities.add(e);

            if (
                segment.kind === "para" &&
                /^THE NATIONAL WEATHER SERVICE IN /i.test(text)
            ) {
                const im = text.match(
                    /^THE NATIONAL WEATHER SERVICE IN (.+?) HAS (ISSUED A|EXTENDED THE|CONTINUED THE|CANCELLED THE|ALLOWED THE|REISSUED THE)\s*$/i
                );
                if (im) {
                    introCity = titleish(im[1]);
                    introAction = im[2].toLowerCase();
                    entities.add(introCity);
                } else {
                    let sentence = normalizeNarrative(text, entities);
                    if (!/[.!?]$/.test(sentence)) sentence += ".";
                    output.push(sentence);
                }
                continue;
            }

            if (segment.kind === "bullet") {
                const full = text;
                let bm;

                bm = full.match(/^([A-Za-z /()\-]+?)\s+FOR\.\.\.(.*)$/i);
                if (bm) {
                    if (!product) product = titleish(bm[1]);
                    const marine = /\bMARINE\b/i.test(bm[1]);
                    let body = bm[2];
                    // "...THIS INCLUDES THE CITIES OF...A...B": its own sentence after the opening one. Multi-county
                    // bullets repeat it per county; CRS read them in order, each "This includes ..." a new sentence
                    // and the next county run on after the previous city list (KEC94 SVRPSR 2014-08-11)
                    const cityRe = /\bTHIS INCLUDES THE (CITY|CITIES) OF\b/i;
                    const cm = body.match(new RegExp(`^(.*?)${cityRe.source}(.*)$`, "i"));
                    const extraAreas = [];
                    if (cm) {
                        body = cm[1];
                        const parts = cm[3].split(/\bTHIS INCLUDES THE (CITY|CITIES) OF\b/i);
                        const kinds = [cm[2]];
                        for (let i = 1; i < parts.length; i += 2) kinds.push(parts[i]);
                        const chunks = parts.filter((_, i) => i % 2 === 0);
                        const sents = [];
                        chunks.forEach((chunk, i) => {
                            const cities = splitPlaceItems(chunk);
                            for (const it of cities) entities.add(it);
                            for (const it of cities) {
                                if (/\b(?:COUNTY|COUNTIES|PARISH|PARISHES)\b/i.test(it)) extraAreas.push(it);
                            }
                            // CRS read the cities with commas only, no "and" (14 of 14 off-air takes)
                            if (cities.length) {
                                sents.push(`This includes the ${kinds[i].toLowerCase()} of ` +
                                    `${options.listAnd ? oxfordJoin(cities) : cities.join(", ")}.`);
                            }
                        });
                        if (sents.length) citiesLine = sents.join(" ");
                    }
                    let items = marine
                        ? splitAreaItems(marineZoneItem(body), cm ? null : segment.lines.slice(1).map(marineZoneItem))
                            .map((it) => it.replace(MARINE_LOWER_RE, (w) => w.toLowerCase())
                                .replace(MARINE_STATE_CASE_RE, (m0, a, b) => `${a.charAt(0).toUpperCase()}${a.slice(1)} ${b}`))
                        : splitAreaItems(body, cm ? null : segment.lines.slice(1));
                    for (const it of items) entities.add(it);
                    areaItems = items.concat(extraAreas);
                    // region: false: "Ford County in east central Illinois" read "Ford County" (the transmitter's
                    // habit: WXJ75 4 of 4 takes, WXJ76 2 of 2)
                    if (options.region === false) {
                        items = items.map((it) => it.replace(/\b(County|Parish|Counties|Parishes) in (?:\w+ ){0,3}\w+$/i, "$1"));
                    }
                    // CRS read the area list with commas only (685 of 738 transcribed first sentences)
                    warningFor = options.listAnd ? oxfordJoin(items) : items.filter(Boolean).join(", ");
                    continue;
                }

                bm = full.match(/^UNTIL\s+(.+)$/i);
                if (bm) {
                    until = expandTimeString(bm[1].replace(/\.\.\./g, " "));
                    continue;
                }

                // watches: "* FLASH FLOOD WATCH FOR PORTIONS OF ..." is the object of "...HAS ISSUED A" (CRS reads
                // the two as one sentence); left alone it became "has issued a." plus a stray sentence
                bm = full.match(/^(?!THIS\b)((?:[A-Z\-]+ ){0,3}(?:WATCH|WARNING|ADVISORY))\s+FOR\s+(?!\.\.\.)(.+)$/i);
                if (bm && introCity && introAction && !warningFor && !leadBullet) {
                    if (!product) product = titleish(bm[1]);
                    const s = normalizeNarrative(full, entities).replace(/[.\s]+$/, "");
                    leadBullet = s.charAt(0).toLowerCase() + s.slice(1);
                    continue;
                }

                bm = full.match(/^AT\s+(.+?)\.\.\.(.*)$/i);
                if (!bm) {

                    bm = full.match(
                        /^AT\s+(\d{1,4}\s*[AP]M\s*[A-Z]{2,4})\b[,.\s]\s*(.*)$/i
                    );
                }
                if (bm) {
                    const atTime = expandTimeString(bm[1]);
                    const narrative = bm[2].trim();
                    if (narrative.toUpperCase() === narrative) {
                        // "7 MILES NORTHWEST OF X", "NEAR X", "OVER X": not any "OF" ("CAPABLE OF PRODUCING ...")
                        const placeRe =
                            /\b(?:(?:NORTH|SOUTH|EAST|WEST|NORTHEAST|NORTHWEST|SOUTHEAST|SOUTHWEST|[NSEW]{1,3})\s+OF|NEAR|OVER)\s+([A-Z][A-Z0-9 /'\-]{1,40}?)(?=(?:\.\.\.|\.|,| AND | OR | MOVING | AT | TO |$))/g;
                        let pm;
                        while ((pm = placeRe.exec(narrative)) !== null) {
                            // "OVER THE NEXT HOUR", "OVER THE WARNED AREA" are not places (was "over the Next Hour")
                            if (/\b(?:HOURS?|MINUTES?|DAYS?|NIGHT|AREAS?|WARNED|PERIOD|WEEKEND)\b/.test(pm[1])) continue;
                            entities.add(titleish(pm[1]));
                        }
                    }
                    let sentence = normalizeNarrative(narrative, entities);
                    if (
                        sentence &&
                        ![...entities].some(
                            (p) =>
                                p.length > 1 &&
                                sentence.toLowerCase().startsWith(p.toLowerCase())
                        )
                    ) {
                        sentence = sentence.charAt(0).toLowerCase() + sentence.slice(1);
                    }
                    if (!/[.!?]$/.test(sentence)) sentence += ".";
                    output.push(`At ${atTime}, ${sentence}`);
                    continue;
                }

                bm = full.match(/^LOCATIONS IMPACTED INCLUDE\.\.\.(.*)$/i);
                if (bm) {
                    const items = splitPlaceItems(bm[1]);
                    for (const it of items) entities.add(it);
                    output.push(`Locations impacted include: ${oxfordJoin(items)}.`);
                    continue;
                }

                // "SOME LOCATIONS THAT WILL EXPERIENCE FLOODING INCLUDE...A...B AND C."
                bm = full.match(/^([A-Z][A-Z ,'\-]*\bINCLUDES?)\s*\.\.\.(?:\s*(BUT ARE NOT LIMITED TO)\s*\.\.\.)?(.*)$/);
                if (bm && bm[1].split(/\s+/).length > 1) {
                    const items = splitPlaceItems(bm[3]);
                    for (const it of items) entities.add(it);
                    const lead = sentenceCaseBasic(bm[1]) + (bm[2] ? " but are not limited to" : "");
                    output.push(`${lead} ${oxfordJoin(items)}.`);
                    continue;
                }

                bm = segment.unlabelled ? null : full.match(/^([A-Z][A-Z /\-]{1,40})\.\.\.(.*)$/);
                if (bm && options.labels === "expanded" && expandLabel(bm[1], bm[2], entities, output)) continue;
                if (bm) {
                    const rawLabel = bm[1];
                    const label =
                        rawLabel.split(/\s+/).length > 4 || /\b(?:WILL|IS|ARE|CAN|MAY|SHOULD)\b/.test(rawLabel)
                            ? sentenceCaseBasic(rawLabel)
                            : titleish(rawLabel).replace(/^./, (c) => c.toUpperCase());
                    const value = bm[2].trim();
                    // "WILL BE NEAR...CISSNA PARK AND BUCKLEY AROUND 950 PM CDT. CLAYTONVILLE AROUND ...": the places
                    // ahead of each time are names (was "Cissna Park and buckley")
                    if (/\bNEAR$/i.test(rawLabel)) {
                        for (const chunk of value.split(/\.(?:\s+|$)/)) {
                            const place = chunk.split(/\s+(?:AROUND|BY|AT|UNTIL)\s+\d/i)[0];
                            for (const p of place.split(/\s+AND\s+|\.\.\.|,\s*/i)) {
                                if (/^[A-Z][A-Z .'\-]{1,30}$/.test(p.trim())) entities.add(titleish(p.trim()));
                            }
                        }
                    }
                    // "Temperatures: falling ...": a capital after the colon is mid-sentence, and AT&T reads a
                    // mid-sentence capitalised word as a name ("Falling" = f ae l ih ng)
                    let body = normalizeNarrative(value, entities);
                    const keep = [...PROPER_ALWAYS, ...entities].some((p) => p.length > 1 && body.startsWith(p));
                    if (!keep) {
                        body = body.replace(/^([^A-Za-z]*)([A-Z])(?=[a-z])/, (m0, a, b) => a + b.toLowerCase());
                    }
                    // "THE TORNADO WILL BE NEAR...LADY LAKE ...": one sentence, the label is not a heading
                    const runOn = /\b(?:NEAR|AT|IN|OF|TO|BY|ON|INTO|OVER|AROUND|TOWARD|THROUGH|FROM)$/i.test(rawLabel);
                    output.push(runOn ? `${label} ${body}.` : `${label}: ${body}.`);
                    continue;
                }

                let sentence = normalizeNarrative(full, entities);
                if (!/[.!?]$/.test(sentence)) sentence += ".";
                output.push(sentence);
                continue;
            }

            if (segment.kind === "section") continue;

            if (segment.kind === "para") {
                // test products: CRS opened with the test headline (WXL23 TOR drill 2014)
                if (isTest && /^\.\.\.(THIS MESSAGE IS FOR TEST PURPOSES ONLY)\.\.\.$/i.test(text.trim())) {
                    testLead = "This message is for test purposes only.";
                    continue;
                }
                // one or more "...HEADLINE..." lines, alone or ahead of the paragraph's first sentence
                if (/^\.\.\..+\.\.\.$/.test(text.trim())) continue;
                // "OTHER LOCATIONS IMPACTED BY THIS SEVERE THUNDERSTORM INCLUDE LODA...WELLINGTON...THAWVILLE AND
                // CRESCENT CITY."
                let om2 = text.match(/^(OTHER LOCATIONS IMPACTED BY [A-Z ]+? INCLUDES?)\s+(.+?)\.?$/);
                if (om2) {
                    // the product's own "A...B...C AND D": "..." is a comma, the closing AND stays (no Oxford comma,
                    // which the voices read as a pause)
                    const items = splitPlaceItems(om2[2]).flatMap((it) => it.split(/\s+and\s+/i));
                    for (const it of items) entities.add(it);
                    const list = items.length > 1
                        ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
                        : items.join("");
                    output.push(`${sentenceCaseBasic(om2[1])} ${list}.`);
                    continue;
                }
                // "INCLUDING THE FOLLOWING INTERSTATE...I-57 BETWEEN MILE MARKERS 258 AND 286.": CRS ran it on after
                // the locations sentence ("... and Crescent City, including the following interstate, Interstate 57
                // between mile markers 258 and 286.")
                om2 = text.match(/^(INCLUDING THE FOLLOWING (?:INTERSTATES?|HIGHWAYS?|ROADS?))\.\.\.\s*(.+)$/);
                if (om2) {
                    const body = normalizeNarrative(om2[2], entities).replace(/[.\s]+$/, "");
                    const tail = `${om2[1].toLowerCase()}, ${body}.`;
                    if (output.length) output[output.length - 1] = output[output.length - 1].replace(/[.\s]*$/, `, ${tail}`);
                    else output.push(tail.charAt(0).toUpperCase() + tail.slice(1));
                    continue;
                }
                // ".SEVERAL DISTURBANCES WILL ...": the synopsis ahead of the segments; CRS skipped it in
                // 11/11 FFA, 15/15 NPW, 38/40 WSW and 5/5 CFW matched takes
                if (options.synopsis === "drop" && /^\.(?!\.)/.test(segment.lines[0])) continue;
                const lm = text.match(/^(HAZARD|SOURCE|IMPACTS?)\.\.\.(.*)$/);
                if (lm && options.labels === "expanded" && expandLabel(lm[1], lm[2], entities, output)) continue;
                let lead = text.trim();
                while (/^\.\.\./.test(lead)) {
                    const hm = lead.match(/^\.\.\..+?\.\.\.\s+(?=[A-Z])/);
                    if (!hm) break;
                    lead = lead.slice(hm[0].length);
                }
                if (lead !== text.trim()) {
                    let sentence = normalizeNarrative(lead, entities);
                    if (!/[.!?]$/.test(sentence)) sentence += ".";
                    output.push(sentence);
                    continue;
                }
                // WCN county columns: "FREMONT     MILLS     MONTGOMERY"
                if (segment.lines.every(isColumnLine) && segment.lines.some((l) => l.trim().split(/\s{2,}/).length >= 3)) {
                    const items = segment.lines
                        .flatMap((l) => l.trim().split(/\s{2,}/))
                        .filter(Boolean)
                        .map(titleish);
                    for (const it of items) entities.add(it);
                    output.push(`${oxfordJoin(items)}.`);
                    continue;
                }
                let sentence = normalizeNarrative(text, entities);
                if (!/[.!?]$/.test(sentence)) sentence += ".";
                output.push(sentence);
            }
        }

        // with a cities line CRS read the bullets in order: area, cities, then "Until ..." as its own sentence
        // (MLB 2.1.5: 400 ms before "until", a sentence break; 14 of 19 off-air takes put "until" after the cities)
        const firstUntil = citiesLine ? null : until;
        if (citiesLine && until) citiesLine += ` Until ${until}.`;
        if (introCity && introAction && product && warningFor) {
            let first = `The National Weather Service in ${introCity} has ${introAction} ${product} for ${warningFor}`;
            if (firstUntil) first += ` until ${firstUntil}`;
            output.unshift(first + ".");
        } else if (introCity && introAction && leadBullet) {
            output.unshift(`The National Weather Service in ${introCity} has ${introAction} ${leadBullet}` +
                (firstUntil ? ` until ${firstUntil}.` : "."));
        } else if (introCity && introAction) {
            let first = `The National Weather Service in ${introCity} has ${introAction}`;
            if (firstUntil) first += ` until ${firstUntil}`;
            output.unshift(first + ".");
        } else if (product && warningFor) {
            let first = `${product} for ${warningFor}`;
            if (firstUntil) first += ` until ${firstUntil}`;
            output.unshift(first + ".");
        } else if (firstUntil) {
            output.unshift(`Until ${firstUntil}.`);
        }
        if (citiesLine) {
            const opened = (introCity && introAction) || (product && warningFor);
            output.splice(opened ? 1 : 0, 0, citiesLine);
        }
        if (testLead) output.unshift(testLead);

        if (product && areaItems.length && until && options.repeat && options.repeatStyle === "list") {
            const short = areaItems.map((item) =>
                item.replace(/\s+in\s+(?:\w+\s+)*\w+$/i, "")
            );
            output.push(
                `Repeating, a ${product} has been issued until ${until} for ${oxfordJoin(short)}.`
            );
        } else if (product && areaItems.length && until && options.repeat && /\bmarine\b/i.test(product)) {
            // "for the following marine location, New York Harbor." (KWO35 SMW 2012, the one marine repeat on file)
            const unit = areaItems.length > 1 ? "locations" : "location";
            output.push(`Repeating, a ${product} has been issued until ${until} for the following marine ${unit}, ` +
                `${oxfordJoin(areaItems)}.`);
        } else if (product && areaItems.length && until && options.repeat) {
            output.push(`Repeating, a ${product} has been issued until ${until} for ${crsRepeatAreas(areaItems, options.repeatUnit)}.`);
        }

        // a bare time-range bullet ("* FROM MONDAY MORNING THROUGH TUESDAY MORNING") leads into the next sentence:
        // CRS read "From Monday morning through Tuesday morning, slow moving showers ..."
        for (let i = output.length - 2; i >= 0; i--) {
            if (/^From [^.!?]{3,80}\.$/.test(output[i])) {
                const nxt = output[i + 1];
                const keep = [...PROPER_ALWAYS, ...entities].some((p) => p.length > 1 && nxt.startsWith(p));
                output.splice(i, 2, output[i].slice(0, -1) + ", " + (keep ? nxt : nxt.charAt(0).toLowerCase() + nxt.slice(1)));
            }
        }
        let text = output.join(" ").replace(/\s+/g, " ").replace(/\.(?:\s*\.)+/g, ".").trim();
        // "DRIZZLE....FREEZING DRIZZLE": a four-dot ellipsis left "drizzle,. Freezing"
        text = text.replace(/,\.\s+([A-Z])(?=[a-z])/g, (m0, c) => `, ${c.toLowerCase()}`);
        // "MILWAUKEE/SULLIVAN": 2.1.5 read the two names, no "slash" (KXI41 CDW 2011)
        text = text.replace(/\b([A-Z][a-z]+)\/([A-Z][a-z]+)\b/g, "$1 $2");
        if (options.soundOutA) text = text.replace(/\b(issued) a (?=tornado\b)/gi, "$1 A ");
        if (options.nearRunOn) text = text.replace(/\bwill be near\b/gi, (m) => m.replace(/ be /i, " \\!nr be "));
        if (options.citiesRunOn) text = text.replace(/\. This includes the (cities|city) of\b/g, ", this includes the $1 of");
        if (options.milesAnHour) text = text.replace(/\bmiles per hour\b/g, "miles an hour");
        // the zone after a time is dropped unless timeZone: true ("until 1 AM", "At 7:13 PM,"): CRS dropped it in 411
        // of 675 matched takes, 143 of 248 transmitters
        if (options.timeZone !== true) {
            const zones = [...new Set(Object.values(TZ_MAP))].map(escapeRegExp).join("|");
            text = text.replace(new RegExp(`\\b([AP]M) (?:${zones})\\b`, "g"), "$1");
        }
        if (options.nearAndBreak) {
            text = text.replace(/(\bbe near [^,.;:]+?) and (?=[^,.;:]+? (?:by|around|at) )/gi, "$1 \\!nr, and ");
        }
        if (options.rate && Math.round(options.rate) !== 100) text = `\\!rate${Math.round(options.rate)} ${text}`;
        return text;
    }

    function run() {
        const input = document.getElementById("productToNormalize");
        const output = document.getElementById("normalizedProduct");
        if (!input || !output) return;

        const raw = input.value || input.textContent || "";
        const repeatEl = document.getElementById("shouldRepeat");
        const result = normalizeNwsBulletin(raw, {
            repeat: repeatEl ? repeatEl.checked : false,
            labels: (document.getElementById("expandLabels") || {}).checked ? "expanded" : undefined,
            ...((document.getElementById("keepTimeZones") || {}).checked ? { timeZone: true } : {}),
        });
        if ("value" in output) {
            output.value = result;
        } else {
            output.textContent = result;
        }
    }

    window.normalizeNwsBulletin = normalizeNwsBulletin;
    window.runNwsNormalizer = run;
})();
