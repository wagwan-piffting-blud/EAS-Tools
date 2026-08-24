#!/usr/bin/env node
/**
 * Three-way merge of the AWIPS2 base warngen templates into warngen/templates/modern.
 *
 *   base   = the upstream release modern/ was originally imported from (20.3.2-2-release)
 *   ours   = warngen/templates/modern (base + local eas-tools edits)
 *   theirs = the newer upstream drop staged in warngen/templates/_work_23.4.1 (unidata_23.4.3)
 *
 * Trailing whitespace is stripped from all three sides before merging: the local import
 * already did that, upstream churns it constantly, and render.js strips it at render time,
 * so leaving it in produces nothing but phantom conflicts.
 *
 * After merging, applyHousePolicy() re-asserts the eas-tools deltas on every file, including
 * the ones that arrive new from upstream and have no local history to merge against.
 *
 * Usage:
 *   node tools/merge_awips_templates.mjs [--dry-run] [--only <file>]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const BASE_DIR  = process.env.AWIPS_BASE_DIR || 'C:/tmp/awips_base_2032';
const THEIRS_DIR = path.join(ROOT, 'templates', '_work_23.4.1');
const OURS_DIR   = path.join(ROOT, 'templates', 'modern');

const args   = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyIx = args.indexOf('--only');
const only   = onlyIx !== -1 ? args[onlyIx + 1] : null;

const SKIP = new Set(['SOURCE.txt', '.filelist']);

// config.xml drives the CAVE product menu, which this build never reads; the local copy is a
// curated list of what eas-tools actually ships, so upstream's menu is not an improvement here.
const KEEP_OURS = new Set(['config.xml']);

function stripTrailing(text) {
    return text.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n');
}

/**
 * The eas-tools local deltas, expressed as idempotent rewrites so they can be re-applied
 * to merged output and to brand-new upstream files alike.
 */
function applyHousePolicy(text, filename) {
    let out = text;

    // WarnGen fills the WMO header's DDHHMM downstream; the browser build puts it in BBBId.
    out = out.replace(/^(\$\{WMOId\} \$\{vtecOffice\}) 000000 (\$\{BBBId\})$/gm, '$1 $2');

    // Fill-in prompts: there is no window to close in the browser build.
    out = out.replace(/\.\s*PLEASE CLOSE THIS WINDOW AND RE-?GENERATE (?:THIS|YOUR) (?:WARNING|PRODUCT)\s*(!\*\*!|\*\*!)/gi,
        (_m, tail) => (tail === '**!' ? '**!' : '!**!'));
    out = out.replace(/\.\s{2}PLEASE CLOSE THIS WINDOW AND REGENERATE YOUR WARNING\*\*!/gi, '.!**!');

    // Nothing to restart either -- ticking the CTA box re-renders live.
    out = out.replace(/(!\*\* YOU DID NOT SELECT A CTA)\.\s*PLEASE RESTART( \*\*!)/gi, '$1$2');

    // Fill-in labels are upper case in this build so extractFillIns() can find them.
    out = out.replace(/!\*\* Edit Location\(s\) \*\*!/g, '!** EDIT LOCATION(S) **!');

    // config.vm sets mixed-case "miles"; keep call sites consistent with it.
    out = out.replace(/(#handleClosestPoints\([^\n]*?), "MILES", /g, '$1, "miles", ');

    if (filename === 'config.vm') {
        out = out.replace(/^#set\(\$landDistanceUnits = "MILES"\)$/m, '#set($landDistanceUnits = "miles")');
        if (!/^#set\(\$productClass = /m.test(out)) {
            out = out.replace(/^(#set\(\$marineDistanceUnits = "NM"\))$/m, '$1\n#set($productClass = "O")');
        }
    }

    if (filename === 'tornadoWarning.xml') {
        // BulletPanel renders a bulletGroup as a radio; a one-member group can never be cleared.
        out = out.replace(/(<bullet bulletName="torEmergency"[^>]*?) bulletGroup="torEMER"/, '$1');
    }

    return out;
}

function mergeFile(name) {
    const basePath   = path.join(BASE_DIR, name);
    const oursPath   = path.join(OURS_DIR, name);
    const theirsPath = path.join(THEIRS_DIR, name);

    const hasBase = fs.existsSync(basePath);
    const hasOurs = fs.existsSync(oursPath);

    const theirs = stripTrailing(fs.readFileSync(theirsPath, 'utf8'));

    if (!hasOurs || !hasBase) {
        return { name, status: hasOurs ? 'new-nobase' : 'new', text: applyHousePolicy(theirs, name), conflicts: 0 };
    }

    const base = stripTrailing(fs.readFileSync(basePath, 'utf8'));
    const ours = stripTrailing(fs.readFileSync(oursPath, 'utf8'));

    if (ours === base) {
        // No local edits worth preserving -- take upstream and re-assert house policy.
        return { name, status: 'fast-forward', text: applyHousePolicy(theirs, name), conflicts: 0 };
    }

    if (KEEP_OURS.has(name)) {
        return { name, status: 'keep-ours', text: applyHousePolicy(ours, name), conflicts: 0 };
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warngen-merge-'));
    const f = (tag, text) => { const p = path.join(tmp, tag); fs.writeFileSync(p, text); return p; };
    let merged, conflicts = 0;
    try {
        // --theirs on a conflicted hunk: every local delta in this tree is a house-policy
        // rewrite, and applyHousePolicy() puts it back after the merge. assertPolicy() below
        // fails the run if that ever stops being true.
        merged = execFileSync('git', ['merge-file', '-p', '--theirs',
            '-L', 'modern', '-L', 'awips-20.3.2', '-L', 'awips-23.4.3',
            f('ours', ours), f('base', base), f('theirs', theirs)
        ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
        // git merge-file exits with the conflict count as its status.
        if (typeof e.status === 'number' && e.status > 0 && e.stdout) {
            merged = e.stdout;
            conflicts = e.status;
        } else {
            throw e;
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    return { name, status: conflicts ? 'CONFLICT' : 'merged', text: applyHousePolicy(merged, name), conflicts };
}

/** Fails loudly if a house-policy rewrite did not take, rather than shipping a silent regression. */
function assertPolicy(name, text) {
    const bad = [];
    if (/^\$\{WMOId\} \$\{vtecOffice\} 000000/m.test(text))            bad.push('WMO header still carries 000000');
    if (/PLEASE CLOSE THIS WINDOW/i.test(text))                        bad.push('"close this window" prompt survived');
    if (/!\*\* Edit Location\(s\) \*\*!/.test(text))                   bad.push('mixed-case Edit Location(s) fill-in survived');
    if (/^<{7} |^={7}$|^>{7} /m.test(text))                            bad.push('conflict markers left in output');
    return bad.map(b => `${name}: ${b}`);
}

const names = fs.readdirSync(THEIRS_DIR).filter(n => !SKIP.has(n)).sort();
const targets = only ? names.filter(n => n === only) : names;

const tally = {};
const conflicted = [];
const policyFailures = [];
for (const name of targets) {
    const r = mergeFile(name);
    tally[r.status] = (tally[r.status] || 0) + 1;
    if (r.conflicts) conflicted.push(`${r.name} (${r.conflicts})`);
    policyFailures.push(...assertPolicy(r.name, r.text));
    if (!dryRun) {
        fs.writeFileSync(path.join(OURS_DIR, name), r.text.endsWith('\n') ? r.text : r.text + '\n');
    }
    if (r.status !== 'fast-forward' || only) console.log(`${r.status.padEnd(13)} ${r.name}`);
}

console.log('\n--- summary ---');
for (const [k, v] of Object.entries(tally)) console.log(`${k.padEnd(13)} ${v}`);
if (conflicted.length) {
    console.log('\nauto-resolved toward upstream (house policy re-applied after):');
    conflicted.forEach(c => console.log('  ' + c));
}
if (policyFailures.length) {
    console.log('\nHOUSE POLICY NOT APPLIED:');
    policyFailures.forEach(p => console.log('  ' + p));
    process.exitCode = 1;
}
if (dryRun) console.log('\n(dry run -- nothing written)');
