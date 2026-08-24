

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
            actions:         {},
            groups:          [],
            actionList:      []
        };

        var bags = root.getElementsByTagName("bulletActionGroup");
        for (var i = 0; i < bags.length; i++) {
            var bag = bags[i];

            // Followup configs open with an action-less group holding a "select a followup"
            // title. It is a placeholder, not a NEW action, and must not reach the action list.
            var action = bag.getAttribute("action");
            if (!action) continue;
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

            // Followup configs carry one group per action *and* phenomenon: a severe weather
            // statement has separate SV and TO groups for every one of CAN/CON/EXP.
            result.groups.push({
                action:  action,
                phen:    bag.getAttribute("phen") || "",
                sig:     bag.getAttribute("sig") || "W",
                bullets: bullets
            });
            if (result.actionList.indexOf(action) === -1) result.actionList.push(action);
            if (!result.actions[action]) result.actions[action] = bullets;
        }
        return result;
    }

    /** Phenomenon codes offered for an action, in document order. */
    function phensForAction(cfg, action) {
        var out = [];
        (cfg.groups || []).forEach(function (g) {
            if (g.action !== action || !g.phen) return;
            if (out.indexOf(g.phen) === -1) out.push(g.phen);
        });
        return out;
    }

    /** Bullets for an action/phenomenon pair, falling back to the action's first group. */
    function bulletsFor(cfg, action, phen) {
        var groups = cfg.groups || [];
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].action === action && (!phen || groups[i].phen === phen)) {
                return groups[i].bullets;
            }
        }
        return (cfg.actions || {})[action] || [];
    }

    return {
        parseBulletConfig: parseBulletConfig,
        phensForAction:    phensForAction,
        bulletsFor:        bulletsFor
    };
}));
