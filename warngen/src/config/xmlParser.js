

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenXmlParser = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {

    function textOf(parent, tagName) {
        var el = parent.getElementsByTagName(tagName)[0];
        return el ? (el.textContent || "").trim() : "";
    }

    function textsOf(parent, tagName) {
        var els = parent.getElementsByTagName(tagName);
        var out = [];
        for (var i = 0; i < els.length; i++) {
            out.push((els[i].textContent || "").trim());
        }
        return out;
    }

    function parseBulletConfig(xmlText) {

        var parser;
        if (typeof DOMParser !== "undefined") {
            parser = new DOMParser();
        } else {
            throw new Error("[xmlParser] DOMParser not available in this environment");
        }
        var doc = parser.parseFromString(xmlText, "text/xml");

        var errors = doc.getElementsByTagName("parsererror");
        if (errors.length > 0) {
            throw new Error("[xmlParser] malformed XML: " + errors[0].textContent);
        }

        var root = doc.documentElement;
        var result = {
            productId:       textOf(root, "productId"),
            phensigs:        textsOf(root, "phensig"),
            defaultDuration: parseInt(textOf(root, "defaultDuration") || "0", 10),
            durations:       textsOf(root, "duration").map(function (d) { return parseInt(d, 10); }),
            actions:         {}
        };

        var bags = root.getElementsByTagName("bulletActionGroup");
        for (var i = 0; i < bags.length; i++) {
            var bag = bags[i];
            var action = bag.getAttribute("action") || "NEW";
            var bulletEls = bag.getElementsByTagName("bullet");
            var bullets = [];
            for (var j = 0; j < bulletEls.length; j++) {
                var b = bulletEls[j];
                bullets.push({
                    name:        b.getAttribute("bulletName"),
                    text:        b.getAttribute("bulletText") || "",
                    group:       b.getAttribute("bulletGroup"),
                    type:        b.getAttribute("bulletType"),
                    default:     b.getAttribute("bulletDefault") === "true",
                    parseString: b.getAttribute("parseString"),
                    showString:  b.getAttribute("showString")
                });
            }
            result.actions[action] = bullets;
        }
        return result;
    }

    return {
        parseBulletConfig: parseBulletConfig
    };
}));
