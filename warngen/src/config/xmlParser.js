

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

    // <include file="geospatialConfig_MARINE.xml"/> is what tells AWIPS whether a template
    // hatches counties, forecast zones or marine zones.
    function areaSourceOf(xmlText) {
        var m = /geospatialConfig_([A-Z_]+)\.xml/.exec(xmlText || "");
        var kind = m ? m[1] : "COUNTY";
        if (kind === "ALASKA_MARINE") kind = "MARINE";
        return (kind === "MARINE" || kind === "ZONE") ? kind : "COUNTY";
    }

    function readBullet(el) {
        return {
            name:        el.getAttribute("bulletName"),
            text:        el.getAttribute("bulletText") || "",
            group:       el.getAttribute("bulletGroup"),
            type:        el.getAttribute("bulletType"),
            default:     el.getAttribute("bulletDefault") === "true",
            parseString: el.getAttribute("parseString"),
            showString:  el.getAttribute("showString")
        };
    }

    // coords="LAT...LON 2982 9279 2984 9303" -- hundredths of a degree, latitude first,
    // longitude positive-west, same encoding the LAT...LON product line uses.
    function parseDamCoords(raw) {
        if (!raw) return null;
        var nums = String(raw).replace(/LAT\.\.\.LON/i, "").match(/-?\d+/g);
        if (!nums || nums.length < 6 || nums.length % 2 !== 0) return null;
        var ring = [];
        for (var i = 0; i < nums.length; i += 2) {
            ring.push([-(parseInt(nums[i + 1], 10) / 100), parseInt(nums[i], 10) / 100]);
        }
        return ring;
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
            includedWatches: textsOf(root, "includedWatch"),
            areaSource:      areaSourceOf(xmlText),
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
                bullets.push(readBullet(bulletEls[j]));
            }

            // damInfoBullets carry the airport / dam / burn scar choices. They differ from
            // plain bullets only by an optional coords attribute naming a fixed polygon,
            // so they ride in the same list and drive $bullets.contains() the same way.
            var damEls = bag.getElementsByTagName("damInfoBullet");
            var damBullets = [];
            for (var d = 0; d < damEls.length; d++) {
                var db = readBullet(damEls[d]);
                db.coords = parseDamCoords(damEls[d].getAttribute("coords"));
                damBullets.push(db);
            }

            // Followup configs carry one group per action *and* phenomenon: a severe weather
            // statement has separate SV and TO groups for every one of CAN/CON/EXP.
            result.groups.push({
                action:     action,
                phen:       bag.getAttribute("phen") || "",
                sig:        bag.getAttribute("sig") || "W",
                bullets:    bullets,
                damBullets: damBullets
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
        var g = groupFor(cfg, action, phen);
        if (g) return (g.damBullets || []).concat(g.bullets);
        return (cfg.actions || {})[action] || [];
    }

    function groupFor(cfg, action, phen) {
        var groups = cfg.groups || [];
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].action === action && (!phen || groups[i].phen === phen)) {
                return groups[i];
            }
        }
        return null;
    }

    /** The fixed polygon attached to a selected damInfoBullet, if any. */
    function coordsForBullets(cfg, action, phen, names) {
        var g = groupFor(cfg, action, phen);
        if (!g) return null;
        for (var i = 0; i < (g.damBullets || []).length; i++) {
            var db = g.damBullets[i];
            if (db.coords && db.name && names.indexOf(db.name) !== -1) return db.coords;
        }
        return null;
    }

    return {
        parseBulletConfig: parseBulletConfig,
        phensForAction:    phensForAction,
        bulletsFor:        bulletsFor,
        groupFor:          groupFor,
        coordsForBullets:  coordsForBullets,
        parseCoords:       parseDamCoords
    };
}));
