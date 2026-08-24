#!/usr/bin/env node
/**
 * Headless render of every warngen template, using the same engine the browser loads.
 *
 * The src/ modules and the velocityjs bundle are evaluated inside one vm context so the
 * java-idiom prototype shims installed by utils.js land on the realm velocityjs actually
 * resolves properties against.
 *
 * Usage:
 *   node tools/render_check.mjs [--era modern] [--only <template.vm>] [--save <dir>] [--quiet]
 *
 * Exit status is non-zero if any template fails to render.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const argOf = (flag, dflt) => { const i = args.indexOf(flag); return i === -1 ? dflt : args[i + 1]; };
const era     = argOf('--era', 'modern');
const only    = argOf('--only', null);
const saveDir = argOf('--save', null);
const quiet   = args.includes('--quiet');
const allActions = args.includes('--all-actions');
// modern/config.vm pins productClass to O; pass this when rendering a tree that does not.
const productClass = argOf('--product-class', null);

const TEMPLATE_DIR = path.join(ROOT, 'templates', era);

function makeSandbox() {
    const sb = { console };
    sb.self = sb; sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    const load = p => vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: p });
    load(path.join(ROOT, 'vendor', 'velocityjs.bundle.js'));
    for (const rel of ['engine/utils.js', 'engine/ugc.js', 'engine/render.js', 'engine/context.js']) {
        load(path.join(ROOT, 'src', rel));
    }
    // The browser runs in one realm, so the java shims utils.js installs cover every array a
    // template sees. Objects built out here would carry the host realm's prototypes instead,
    // so the context is assembled inside the sandbox from a JSON string.
    sb.__buildContext = vm.runInContext(
        '(function (json) { return WarngenContext.buildMockContext(JSON.parse(json)); })', sb);
    return sb;
}

/**
 * Minimal stand-in for xmlParser.js, which needs a DOM. Only the bullet metadata that
 * drives template selection is required here, and that lives entirely in attributes.
 */
function parseGroups(xmlText) {
    const groupRe = /<bulletActionGroup\b([^>]*)>([\s\S]*?)<\/bulletActionGroup>/g;
    const groups = [];
    let g;
    while ((g = groupRe.exec(xmlText)) !== null) {
        const attrs = g[1];
        const body = g[2].replace(/<!--[\s\S]*?-->/g, '');
        const bullets = [];
        const bulletRe = /<bullet\b([^>]*)\/?>/g;
        let b;
        while ((b = bulletRe.exec(body)) !== null) {
            const ba = b[1];
            const name = (ba.match(/bulletName="([^"]*)"/) || [])[1];
            if (!name) continue;
            bullets.push({
                name,
                group: (ba.match(/bulletGroup="([^"]*)"/) || [])[1] || null,
                isDefault: /bulletDefault="true"/.test(ba)
            });
        }
        // An action-less group is the followup configs' "select a followup" placeholder.
        const action = (attrs.match(/action="([^"]*)"/) || [])[1];
        if (!action) continue;
        groups.push({ action, phen: (attrs.match(/phen="([^"]*)"/) || [, ''])[1], bullets });
    }
    return groups;
}

/** Defaults exactly as BulletPanel.build() would resolve them: last default per group wins. */
function defaultBulletNames(bullets) {
    const selected = {};
    const byGroup = {};
    for (const b of bullets) {
        if (!b.isDefault) continue;
        if (b.group) {
            if (byGroup[b.group]) delete selected[byGroup[b.group]];
            byGroup[b.group] = b.name;
        }
        selected[b.name] = true;
    }
    return Object.keys(selected);
}

const sb = makeSandbox();
const { WarngenRender, WarngenContext } = sb;

const templates = {};
for (const f of fs.readdirSync(TEMPLATE_DIR)) {
    if (f.endsWith('.vm')) templates[f] = fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8');
}

const xmlFor = name => {
    const p = path.join(TEMPLATE_DIR, name.replace(/\.vm$/, '.xml'));
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

// Templates that exist only to be #parse()d into another one.
const FRAGMENTS = new Set([
    'VM_global_library.vm', 'config.vm', 'forecasterName.vm', 'impactStatements.vm',
    'damInfo.vm', 'burnScarInfo.vm', 'dssEvents.vm', 'dupCounties.vm', 'mileMarkers.vm',
    'pointMarkers.vm', 'stormReports.vm', 'marineCombo.vm'
]);

const names = (only ? [only] : Object.keys(templates).filter(n => !FRAGMENTS.has(n))).sort();
if (saveDir) fs.mkdirSync(saveDir, { recursive: true });

/** One county of the mock context's three, standing in for a partial cancellation. */
const CANCEL_AREA = {
    name: 'Washington', fips: '177', state: 'NE', stateabbr: 'NE', state_zone: '177',
    parentRegion: 'Nebraska', partOfArea: [], partOfParentRegion: ['Central'],
    areaNotation: 'County', areasNotation: 'Counties', points: []
};

/** Every action/phenomenon pair a bullet config offers, plus the synthesized CANCON. */
function casesFor(groups) {
    if (!groups.length) return [{ action: 'NEW', phen: '', bullets: [] }];
    const cases = groups.map(g => ({ action: g.action, phen: g.phen, bullets: g.bullets }));
    const can = groups.filter(g => g.action === 'CAN');
    const hasCon = groups.some(g => g.action === 'CON');
    if (can.length && hasCon) {
        can.forEach(g => cases.push({ action: 'CANCON', phen: g.phen, bullets: g.bullets }));
    }
    return cases;
}

const results = [];
for (const name of names) {
    const xml = xmlFor(name);
    const groups = xml ? parseGroups(xml) : [];
    const productId = xml ? ((xml.match(/<productId>([^<]*)<\/productId>/) || [])[1] || 'SVR').trim() : 'SVR';

    for (const c of (allActions ? casesFor(groups) : [casesFor(groups)[0]])) {
        const bullets = defaultBulletNames(c.bullets || []);
        const label = allActions ? `${name} [${c.action}${c.phen ? '/' + c.phen : ''}]` : name;

        let text = null, error = null;
        try {
            const ctx = sb.__buildContext(JSON.stringify({
                bullets: bullets.length ? bullets : ['doppler'],
                productId,
                action: c.action,
                productClass: productClass || undefined,
                phenomena: c.phen || undefined,
                cancelareas: (c.action === 'CANCON' || c.action === 'COR') ? [CANCEL_AREA] : []
            }));
            text = WarngenRender.render(name, templates, ctx);
        } catch (e) {
            error = e.message;
        }
        collect(label, name, productId, bullets, text, error);
    }
}

function collect(label, name, productId, bullets, text, error) {

    // An unresolved $ref means velocity could not evaluate it and echoed the source.
    const unresolved = text
        ? [...new Set((text.match(/\$\{?[A-Za-z_][\w.]*(?:\([^)]*\))?\}?/g) || []))]
        : [];
    const directives = text ? [...new Set((text.match(/^#\w+/gm) || []))] : [];

    // The VTEC line is the part a followup is most likely to get wrong.
    const vtec = text ? (text.match(/^\/[OTEX]\.[A-Z]{3}\.[A-Z]{4}\.[A-Z]{2}\.[A-Z]\.\d{4}\./m) || [])[0] || null : null;
    const badVtec = text && /^\/[OTEX]\.\$|^\/\$/m.test(text);

    results.push({
        label, name, productId, bullets: bullets.length, error,
        chars: text ? text.length : 0, unresolved, directives, vtec, badVtec
    });
    if (saveDir && text) {
        fs.writeFileSync(path.join(saveDir, label.replace(/[\\/\[\]]/g, '_').replace(/\.vm/, '') + '.txt'), text);
    }
}

const failed = results.filter(r => r.error);
const dirty  = results.filter(r => !r.error && (r.unresolved.length || r.directives.length));

// Statements and forecasts carry no VTEC at all; only flag a missing one where it is required.
const NON_VTEC_PILS = new Set(['SPS', 'NOW', 'FRW', 'AWW', 'MWS']);
const noVtec = results.filter(r => !r.error &&
    (r.badVtec || (allActions && !r.vtec && !NON_VTEC_PILS.has(r.productId))));

if (!quiet) {
    for (const r of results) {
        const w = allActions ? 58 : 46;
        if (r.error) {
            console.log(`FAIL   ${r.label}\n         ${r.error}`);
        } else if (r.unresolved.length || r.directives.length || r.badVtec) {
            const bits = [];
            if (r.unresolved.length) bits.push(`unresolved: ${r.unresolved.slice(0, 6).join(' ')}${r.unresolved.length > 6 ? ' …' : ''}`);
            if (r.directives.length) bits.push(`leaked directives: ${r.directives.join(' ')}`);
            if (r.badVtec) bits.push('malformed VTEC');
            console.log(`WARN   ${r.label.padEnd(w)} ${r.chars}c  ${bits.join(' | ')}`);
        } else {
            console.log(`ok     ${r.label.padEnd(w)} ${r.chars}c  ${r.productId}  ${r.bullets} bullets${r.vtec ? '  ' + r.vtec : ''}`);
        }
    }
}

console.log(`\n${results.length} renders | ${results.length - failed.length} ok | ${failed.length} failed | ${dirty.length} with unresolved refs | ${noVtec.length} VTEC problems`);
if (failed.length) process.exitCode = 1;
