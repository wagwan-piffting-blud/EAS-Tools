// Builds data/civil_sites.json: per-office PIL/WMO rows for the GFE CivilEmerg formatters plus
// the SiteCFG fields they substitute (<region>, <wfoCityState>, <wfoCity>, <state>).
//
// Mirrors Generator.__createPilDictionary: an afos2awips row belongs to a site when its WMO
// CCCC is the site's fullStationID.
//
// Usage: node warngen/tools/build_civil_sites.mjs [path-to-awips2-clone]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLONE = process.argv[2] || "C:/tmp/awips2";
const AFOS = path.join(CLONE, "rpms/awips2.edex/Installer.edex/ndm/afos2awips.txt");
const SITECFG = path.join(CLONE,
    "rpms/awips2.core/Installer.localization/utility/common_static/configured/OAX/gfe/python/SiteCFG.py");
const OUT = path.join(HERE, "..", "data", "civil_sites.json");

const EVENTS = ["ADR", "AVA", "AVW", "BLU", "CAE", "CDW", "CEM", "EQR", "EQW", "EVI",
    "FRW", "HMW", "LAE", "LEW", "NUW", "RHW", "SPW", "TOE", "VOW",
    // Office watch products (watches.js): county notification, winter, non-precip, flood,
    // fire weather, coastal flood, tropical VTEC and local statement.
    "WCN", "WSW", "NPW", "FFA", "RFW", "CFW", "TCV", "HLS"];

// SiteCFG gives Pago Pago PPPG, but its civil rows are filed under NSTU.
const STATION_ALIASES = { NSTU: "PPG" };

function parseSiteCfg(text) {
    const sites = {};
    const re = /'([A-Z]{3})':\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(text))) {
        const fields = {};
        const fre = /'(\w+)':\s*'([^']*)'/g;
        let f;
        while ((f = fre.exec(m[2]))) fields[f[1]] = f[2].trim();
        sites[m[1]] = fields;
    }
    return sites;
}

const siteCfg = parseSiteCfg(fs.readFileSync(SITECFG, "utf8"));
const bySiteStation = {};
for (const [site, info] of Object.entries(siteCfg)) {
    const cccc = String(info.fullStationID || "").split(",")[0].trim();
    if (!cccc) continue;
    // AER and ALU share PAFC with AFC; the office picker only knows AFC.
    if (!bySiteStation[cccc] || site === "AFC") bySiteStation[cccc] = site;
}
for (const [cccc, site] of Object.entries(STATION_ALIASES)) bySiteStation[cccc] = site;

const out = {};
for (const [site, info] of Object.entries(siteCfg)) {
    if (site === "AER" || site === "ALU") continue;
    out[site] = {
        region: info.region,
        fullStationID: info.fullStationID,
        wfoCityState: info.wfoCityState,
        wfoCity: info.wfoCity,
        state: info.state,
        products: {}
    };
}

let rows = 0;
for (const line of fs.readFileSync(AFOS, "utf8").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [afos, wmo, cccc] = parts;
    const nnn = afos.slice(3, 6);
    if (EVENTS.indexOf(nnn) === -1) continue;
    const site = bySiteStation[cccc];
    if (!site || !out[site]) continue;
    const list = out[site].products[nnn] || (out[site].products[nnn] = []);
    const pil = afos.slice(3);
    if (list.some((e) => e.pil === pil && e.wmo === wmo)) continue;
    list.push(cccc === out[site].fullStationID ? { pil, wmo } : { pil, wmo, cccc });
    rows++;
}

for (const s of Object.values(out)) {
    for (const list of Object.values(s.products)) {
        list.sort((a, b) => (a.pil === b.pil ? 0 : a.pil < b.pil ? -1 : 1)
            || (b.wmo.startsWith("WO") - a.wmo.startsWith("WO")));
    }
}

fs.writeFileSync(OUT, JSON.stringify({
    _source: "Unidata/awips2 afos2awips.txt + configured SiteCFG.py",
    sites: out
}));
console.log("sites:", Object.keys(out).length, "rows:", rows, "->", OUT);
