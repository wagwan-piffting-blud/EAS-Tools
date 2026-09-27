(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("velocityjs"));
    } else {
        root.WarngenRender = factory(root.Velocity);
    }
}(typeof self !== "undefined" ? self : this, function (Velocity) {

    function resolveParses(templateText, templates, seen) {
        if (!seen) seen = new Set();
        var parseRe = /^([ \t]*)#parse\s*\(\s*["']([^"']+)["']\s*\)\s*$/gm;
        return templateText.replace(parseRe, function (match, indent, filename) {
            if (seen.has(filename)) {
                return indent + "## [warngen] parse cycle skipped: " + filename;
            }
            var content = templates[filename];
            if (content === undefined) {
                return indent + "## [warngen] missing template: " + filename;
            }
            var nextSeen = new Set(seen);
            nextSeen.add(filename);
            return resolveParses(content, templates, nextSeen);
        });
    }

    function stripBlockComments(s) {
        return s.replace(/#\*[\s\S]*?\*#/g, "");
    }

    function normalizeMacroDefs(s) {
        return s.replace(/(#macro\s*\()([^)]*)\)/g, function (_, head, params) {
            return head + params.replace(/,/g, " ") + ")";
        });
    }

    function normalizeJavaIdioms(s) {
        var out = s;

        out = out.replace(/(\$\{?[A-Za-z_][\w.]*)\.length\(\)/g, "$1.length");

        out = out.replace(/\$\{?[A-Za-z_][\w.]*\.parseInt\((\$\{?[\w.]+\}?)\)\}?/g, "$1");

        out = out.replace(/\.\.\."\$\{/g, '..." ${');

        out = out.replace(/\$\{(\w+)\.equalsIgnoreCase\("([^"]+)"\)\}/g, function (_m, v, s) {
            return "$" + v + ".toUpperCase() == \"" + s.toUpperCase() + "\"";
        });

        // Java Velocity compares operands of different classes by their string
        // representations, so #if($isFIPS == "true") is true for the boolean true.
        // velocityjs uses JS ==, where true == "true" is false. Quoting the reference
        // forces the same string comparison Java does, and leaves a variable that already
        // holds "true"/"false" -- which is how most of the config flags are written --
        // behaving exactly as before.
        out = out.replace(
            /(^|[^"\w])(\$\{[A-Za-z_][\w.]*\}|\$[A-Za-z_][\w.]*)(\s*[!=]=\s*)("(?:true|false)")/g,
            function (_m, pre, ref, op, lit) { return pre + '"' + ref + '"' + op + lit; });

        return out;
    }

    function cleanWhitespace(s) {
        var lines = s.split("\n");
        for (var i = 0; i < lines.length; i++) {
            lines[i] = lines[i].replace(/[ \t]+$/, "");
        }

        while (lines.length > 0 && lines[0] === "") lines.shift();

        if (lines.length > 0) {
            lines[0] = lines[0].replace(/^[ \t]+/, "");
        }

        var out = [];
        var lastBlank = false;
        for (var i = 0; i < lines.length; i++) {
            var blank = (lines[i] === "");
            if (blank && lastBlank) continue;
            out.push(lines[i]);
            lastBlank = blank;
        }

        while (out.length > 0 && out[out.length - 1] === "") out.pop();
        return out.join("\n") + "\n";
    }

    function formatCase(text, mixedCase) {
        if (mixedCase === false) return text.toUpperCase();
        return text;
    }

    function stripUntilPeriod(text) {
        return text.replace(/^(\* UNTIL [^\n]+?)\.$/gim, "$1");
    }

    function ellipsizeAtBullet(text) {
        return text.replace(/^(\* AT [^,\n]+?),\s+/gim, "$1...");
    }

    function indentBulletContent(text) {
        var lines = text.split("\n");
        var inContent = false;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (/^\* /.test(line) && /\.\.\.$/.test(line)) {
                inContent = true;
                continue;
            }
            if (line === "") { inContent = false; continue; }
            if (/^\* /.test(line)) { inContent = false; continue; }
            if (inContent) {

                if ((line.match(/, /g) || []).length >= 2) {
                    line = line.replace(/, /g, "...");
                }
                lines[i] = "  " + line;
            }
        }
        return lines.join("\n");
    }

    // Lock tags take no room on the page (WrapUtil.indexIgnoringLockMarkers).
    function visible(s) {
        return s.replace(/<\/?L>/g, "");
    }

    var LOCK_START = "<L>";
    var LOCK_END = "</L>";
    var INDENT = "  ";
    var BULLET_START = "* ";
    var DELIM_GROUP = "\0";
    var NORMAL_DELIMS = [" ", "...", DELIM_GROUP, "-"];
    var AREA_DELIMS = ["-", "...", DELIM_GROUP, " "];
    var UGC_LINE_RE = /(^(\w{2}[CZ]\d{3}\S*-\d{6}-)$|((\d{3}-)*\d{6}-)$|((\d{3}-)+))/;
    var AREA_LIST_RE = new RegExp("^((" + LOCK_END + "){0,1}((([\\?\\(\\)\\w\\.,/'-]+\\s{1,})+\\w{2}-)*"
        + "(([\\?\\(\\)\\w\\.,/'-]+\\s{1,})+\\w{2}-)))");

    function isJavaWhitespace(c) {
        return /[ \t\n\x0B\f\r\x1C-\x1F]/.test(c);
    }

    function indexIgnoringLockMarkers(text, start, count) {
        var i = start;
        for (;;) {
            if (text.startsWith(LOCK_START, i)) {
                i += LOCK_START.length;
            } else if (text.startsWith(LOCK_END, i)) {
                i += LOCK_END.length;
            } else if (count > 0) {
                if (i >= text.length) break;
                ++i;
                --count;
            } else {
                break;
            }
        }
        return i;
    }

    // Trailing whitespace goes, stepping over any lock marks mixed into it.
    function appendRTrim(text, start, end, sb) {
        var sbStart = sb.length;
        sb += text.slice(start, end);
        var i = sb.length;
        while (i > sbStart) {
            if (isJavaWhitespace(sb.charAt(i - 1))) {
                sb = sb.slice(0, i - 1) + sb.slice(i);
                --i;
            } else if (i - sbStart >= LOCK_START.length && sb.slice(i - LOCK_START.length, i) === LOCK_START) {
                i -= LOCK_START.length;
            } else if (i - sbStart >= LOCK_END.length && sb.slice(i - LOCK_END.length, i) === LOCK_END) {
                i -= LOCK_END.length;
            } else {
                break;
            }
        }
        return sb;
    }

    function splitEndOfLine(text, start, inBullet, sb) {
        var goodBreak = start;
        var i = start;
        while (i < text.length) {
            if (isJavaWhitespace(text.charAt(i))) {
                ++i;
            } else if (text.startsWith(LOCK_START, i)) {
                goodBreak = i;
                i += LOCK_START.length;
                break;
            } else if (text.startsWith(LOCK_END, i)) {
                i += LOCK_END.length;
                goodBreak = i;
                break;
            } else {
                break;
            }
        }
        if (i >= text.length) goodBreak = i;
        if (goodBreak >= start) sb = appendRTrim(text, start, goodBreak, sb);
        if (i < text.length) {
            sb += "\n";
            if (inBullet) sb += INDENT;
            sb = appendRTrim(text, goodBreak, i, sb);
        }
        return { i: i, sb: sb };
    }

    function javaLastIndexOf(text, str, from) {
        return from < 0 ? -1 : text.lastIndexOf(str, from);
    }

    // WrapUtil.wrapLongLine: within a delimiter group the break closest to the margin wins;
    // a later group is only tried when an earlier one finds nothing.
    function wrapLongLine(line, inBullet, delims, maxLength) {
        var sb = "";
        var start = 0;
        var allowLength = maxLength;
        var failed = false;

        if (inBullet) {
            var lead = "";
            var i = indexIgnoringLockMarkers(line, start, 0);
            while (i < line.length && lead.length < 2) {
                lead += line.charAt(i);
                i = indexIgnoringLockMarkers(line, i, 1);
            }
            if (lead.length === 2) {
                allowLength -= INDENT.length;
                if (lead === INDENT || lead === BULLET_START) {
                    start = i;
                    sb += line.slice(0, i);
                } else {
                    sb += INDENT;
                }
            }
        }

        while (start < line.length) {
            var limit = indexIgnoringLockMarkers(line, start, allowLength);
            if (limit >= line.length) {
                sb = appendRTrim(line, start, line.length, sb);
                break;
            }
            var bestDelim = null;
            var bestP = -1;
            for (var d = 0; d < delims.length; d++) {
                var delim = delims[d];
                if (delim === DELIM_GROUP) {
                    if (bestDelim !== null) break;
                    continue;
                }
                var backup = delim === " " ? 0 : delim.length;
                var p = !failed ? javaLastIndexOf(line, delim, limit - backup)
                    : line.indexOf(delim, Math.max(0, limit - backup));
                if (p >= start && ((bestDelim === null || !failed) ? p > bestP : p < bestP)) {
                    bestDelim = delim;
                    bestP = p;
                }
            }

            if (bestDelim !== null) {
                failed = false;
                var next = bestP + bestDelim.length;
                var segmentEnd = bestDelim === " " ? bestP : next;
                sb = appendRTrim(line, start, segmentEnd, sb);
                var split = splitEndOfLine(line, next, inBullet, sb);
                start = split.i;
                sb = split.sb;
                if (inBullet) allowLength = maxLength - INDENT.length;
            } else if (!failed) {
                failed = true;
            } else {
                sb = appendRTrim(line, start, line.length, sb);
                break;
            }
        }
        return sb;
    }

    function wrapDelimiters(line) {
        if (UGC_LINE_RE.test(line)) return AREA_DELIMS;
        if (AREA_LIST_RE.test(line) && line.indexOf(BULLET_START) !== 0) return AREA_DELIMS;
        return NORMAL_DELIMS;
    }

    /**
     * WrapUtil.wrap at 69 columns. Lock tags take no width; from a "* " line to the next
     * blank line, lines get the two-space bullet indent.
     */
    function wrapBulletin(text, width) {
        var maxWidth = width || 69;
        var lines = text.split("\n");
        var out = [];
        var inBullet = false;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var unlocked = visible(line);
            if (unlocked.trim().length === 0) {
                inBullet = false;
                out.push(line);
                continue;
            }
            var wasInBullet = inBullet;
            if (unlocked.indexOf(BULLET_START) === 0) inBullet = true;
            var add = (wasInBullet && unlocked.indexOf(INDENT) !== 0) ? INDENT.length : 0;
            if (unlocked.length <= maxWidth - add) {
                out.push((add > 0 ? INDENT : "") + line);
            } else {
                out.push(wrapLongLine(line, inBullet, wrapDelimiters(line), maxWidth));
            }
        }
        return out.join("\n");
    }

    function wrapUgcLines(text, width) {
        return text.split("\n").map(function (line) {
            if (!/^[A-Z]{2}[CZ]\d{3}.*-\d{6}-$/.test(line) || line.length <= width) return line;
            var out = [];
            while (line.length > width) {
                var at = line.lastIndexOf("-", width - 1);
                if (at <= 0) at = width - 1;
                out.push(line.slice(0, at + 1));
                line = line.slice(at + 1);
            }
            if (line) out.push(line);
            return out.join("\n");
        }).join("\n");
    }

    // Word wrap for the CRS layout, which predates WarnGen's WrapUtil.
    function wrapWords(text, width) {
        if (!width) width = 68;
        var lines = text.split("\n");
        var out = [];
        var inBullet = false;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var plain = visible(line);
            if (plain.trim() === "") {
                inBullet = false;
            } else if (/^\* /.test(plain)) {
                inBullet = true;
            } else if (inBullet && !/^  /.test(plain)) {
                line = "  " + line;
                plain = "  " + plain;
            }
            if (plain.length <= width) { out.push(line); continue; }
            if (/^(LAT\.\.\.LON|TIME\.\.\.MOT\.\.\.LOC|\$\$|&&|\s+\d{4}\s+\d{4}|WUUS|\/[OTE]\.|[A-Z]{3,4}\d{3})/.test(plain)) {
                out.push(line);
                continue;
            }
            var contIndent = /^\* /.test(plain)
                ? "  "
                : (plain.match(/^(\s*)/) || ["",""])[1];
            out.push(wrapOneLine(line, width, contIndent));
        }
        return out.join("\n");
    }

    function wrapOneLine(line, width, contIndent) {
        var leadMatch = line.match(/^(\s*)(.*)$/);
        var leadIndent = leadMatch[1];
        var content = leadMatch[2];
        var words = content.split(/\s+/).filter(function (w) { return w.length > 0; });
        if (words.length === 0) return line;

        var pieces = [];
        var current = leadIndent + words[0];
        for (var i = 1; i < words.length; i++) {
            var w = words[i];
            if (visible(current + " " + w).length <= width) {
                current = current + " " + w;
            } else {
                pieces.push(current);
                current = contIndent + w;
            }
        }
        pieces.push(current);
        return pieces.join("\n");
    }

    function formatCRS(text) {
        var t = text;
        t = stripUntilPeriod(t);
        t = ellipsizeAtBullet(t);
        t = indentBulletContent(t);
        t = wrapUgcLines(wrapWords(t, 68), 64);
        return t;
    }

    function render(templateName, templates, context) {
        var library = templates["VM_global_library.vm"] || "";
        var body = templates[templateName];
        if (body === undefined) {
            throw new Error("[warngen] template not found: " + templateName);
        }
        var assembled = stripBlockComments(library) + "\n" + stripBlockComments(body);
        var resolved = resolveParses(assembled, templates);
        var normalized = normalizeMacroDefs(resolved);
        normalized = normalizeJavaIdioms(normalized);
        var raw = Velocity.render(normalized, context);
        return cleanWhitespace(raw);
    }

    return {
        render:              render,
        formatCase:          formatCase,
        formatCRS:           formatCRS,
        stripUntilPeriod:    stripUntilPeriod,
        ellipsizeAtBullet:   ellipsizeAtBullet,
        indentBulletContent: indentBulletContent,
        wrapBulletin:        wrapBulletin,
        resolveParses:       resolveParses,
        stripBlockComments:  stripBlockComments,
        normalizeMacroDefs:  normalizeMacroDefs,
        normalizeJavaIdioms: normalizeJavaIdioms,
        cleanWhitespace:     cleanWhitespace
    };
}));
