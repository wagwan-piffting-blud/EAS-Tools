

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

    const PROPER_ALWAYS = new Set([
        "National Weather Service", "Interstate", "Doppler", ...US_STATES,
    ]);

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
        return /^[A-Z][A-Z /()\-]+(?:WARNING|WATCH|ADVISORY|STATEMENT|EMERGENCY|OUTLOOK|FORECAST)$/.test(
            text.trim().toUpperCase()
        );
    }

    function isHeaderTime(text) {
        return /^\d{3,4}\s+[AP]M\s+[A-Z]{2,4}\s+\w{3}\s+\w{3}\s+\d{1,2}\s+\d{4}$/i.test(
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

    function sentenceCaseBasic(text) {
        text = collapseSpaces(text).toLowerCase();
        const chars = text.split("");
        let capitalize = true;
        for (let i = 0; i < chars.length; i++) {
            if (capitalize && /[a-z]/i.test(chars[i])) {
                chars[i] = chars[i].toUpperCase();
                capitalize = false;
            }
            if (".!?".includes(chars[i])) {
                capitalize = true;
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
        const m = text.match(/^(\d{1,4})\s*([AP]M)\s*([A-Z]{1,4})?$/);
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

    function splitAreaItems(text) {
        const raw = collapseSpaces(text.replace(/\n/g, " "));
        const parts = raw
            .split(/\.\.\.+/)
            .map((p) => p.replace(/^[ .]+|[ .]+$/g, ""))
            .filter(Boolean);
        return parts.map(titleish);
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
            if (cm && cm[2].split(/\s+/).length >= 2) {
                out.push(cm[1]);
                out.push(cm[2]);
            } else {
                out.push(chunk);
            }
        }
        return out.map(titleish);
    }

    function normalizeNarrative(text, entities) {
        text = collapseSpaces(text);
        text = text.replace(/\.\.\.\s*$/, "");
        text = text.replace(/\b(near|include)\s*\.\.\./gi, "$1 ");
        text = text.replace(/\.\.\./g, ", ");
        text = text.replace(/\s*,\s*/g, ", ");
        text = text.replace(/\s+\.\s*/g, ". ");
        text = text.replace(/\b(\d+)\s*MPH\b/gi, "$1 miles per hour");
        text = text.replace(/\bNWS\b/gi, "National Weather Service");
        text = sentenceCaseBasic(text);
        text = expandInlineTimes(text);
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
        let sawIssuedTime = false;
        let prevWasWmo = false;
        for (const line of trimmed) {
            const stripped = line.trim();
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
        return out;
    }

    function parseSegments(lines) {
        let i = 0;
        const header = {};

        if (i < lines.length && /^BULLETIN\s*-/i.test(lines[i].trim())) {
            header.broadcast = lines[i].trim();
            i++;
        }
        if (i < lines.length && isProductLine(lines[i].trim())) {
            header.product = lines[i].trim();
            i++;
        }
        if (
            i < lines.length &&
            lines[i].trim().toUpperCase().startsWith("NATIONAL WEATHER SERVICE")
        ) {
            header.office = lines[i].trim();
            i++;
        }
        if (i < lines.length && isHeaderTime(lines[i])) {
            header.issued_at = lines[i].trim();
            i++;
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

            if (/^[A-Z/ ]+\.\.\.$/.test(stripped)) {
                if (current) segments.push(current);
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

    function normalizeNwsBulletin(raw, options) {
        options = options || {};
        const lines = stripMetadata(raw);
        const [header, segments] = parseSegments(lines);

        const entities = new Set(PROPER_ALWAYS);
        let product = header.product ? titleish(header.product) : null;
        let introCity = null;
        let introAction = null;
        let warningFor = null;
        let areaItems = [];
        let until = null;
        const output = [];

        for (const segment of segments) {
            const text = collapseSpaces(segment.lines.join(" "));
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
                    const items = splitAreaItems(
                        segment.lines.slice(1).join(" ") || bm[2]
                    );
                    for (const it of items) entities.add(it);
                    areaItems = items;
                    warningFor = oxfordJoin(items);
                    continue;
                }

                bm = full.match(/^UNTIL\s+(.+)$/i);
                if (bm) {
                    until = expandTimeString(bm[1].replace(/\.\.\./g, " "));
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
                        const placeRe =
                            /\b(?:OF|NEAR)\s+([A-Z][A-Z0-9 /\-]{1,60}?)(?=(?:\.\.\.|,| AND | OR | MOVING |$))/g;
                        let pm;
                        while ((pm = placeRe.exec(narrative)) !== null) {
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
                    const items = splitPlaceItems(
                        segment.lines.slice(1).join(" ") || bm[1]
                    );
                    for (const it of items) entities.add(it);
                    output.push(`Locations impacted include: ${oxfordJoin(items)}.`);
                    continue;
                }

                bm = full.match(/^([A-Z][A-Z /\-]{1,40})\.\.\.(.*)$/);
                if (bm) {
                    const rawLabel = bm[1];
                    const label =
                        rawLabel.split(/\s+/).length > 4
                            ? sentenceCaseBasic(rawLabel)
                            : titleish(rawLabel);
                    const value = (segment.lines.slice(1).join(" ") || bm[2]).trim();
                    output.push(`${label}: ${normalizeNarrative(value, entities)}.`);
                    continue;
                }

                let sentence = normalizeNarrative(full, entities);
                if (!/[.!?]$/.test(sentence)) sentence += ".";
                output.push(sentence);
                continue;
            }

            if (segment.kind === "section") continue;

            if (segment.kind === "para") {
                if (/^\.\.\..+\.\.\.$/.test(text.trim())) continue;
                let sentence = normalizeNarrative(text, entities);
                if (!/[.!?]$/.test(sentence)) sentence += ".";
                output.push(sentence);
            }
        }

        if (introCity && introAction && product && warningFor) {
            let first = `The National Weather Service in ${introCity} has ${introAction} ${product} for ${warningFor}`;
            if (until) first += ` until ${until}`;
            output.unshift(first + ".");
        } else if (introCity && introAction) {
            let first = `The National Weather Service in ${introCity} has ${introAction}`;
            if (until) first += ` until ${until}`;
            output.unshift(first + ".");
        } else if (product && warningFor) {
            let first = `${product} for ${warningFor}`;
            if (until) first += ` until ${until}`;
            output.unshift(first + ".");
        } else if (until) {
            output.unshift(`Until ${until}.`);
        }

        if (product && areaItems.length && until && options.repeat) {
            const short = areaItems.map((item) =>
                item.replace(/\s+in\s+(?:\w+\s+)*\w+$/i, "")
            );
            output.push(
                `Repeating, a ${product} has been issued for ${oxfordJoin(short)} until ${until}.`
            );
        }

        return output.join(" ").replace(/\s+/g, " ").trim();
    }

    function run() {
        const input = document.getElementById("productToNormalize");
        const output = document.getElementById("normalizedProduct");
        if (!input || !output) return;

        const raw = input.value || input.textContent || "";
        const repeatEl = document.getElementById("shouldRepeat");
        const result = normalizeNwsBulletin(raw, {
            repeat: repeatEl ? repeatEl.checked : false,
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
