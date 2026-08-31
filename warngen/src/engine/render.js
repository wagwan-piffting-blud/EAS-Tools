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

    function wrapBulletin(text, width) {
        if (!width) width = 68;
        var lines = text.split("\n");
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.length <= width) { out.push(line); continue; }
            if (/^(LAT\.\.\.LON|TIME\.\.\.MOT\.\.\.LOC|\$\$|&&|\s+\d{4}\s+\d{4}|WUUS|\/[OTE]\.|[A-Z]{3,4}\d{3})/.test(line)) {
                out.push(line);
                continue;
            }
            var contIndent = /^\* /.test(line)
                ? "  "
                : (line.match(/^(\s*)/) || ["",""])[1];
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
            if ((current + " " + w).length <= width) {
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
        t = wrapBulletin(t, 68);
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
