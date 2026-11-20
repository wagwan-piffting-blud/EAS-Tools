#!/usr/bin/env node
/**
 * Sync the DASDEC header translator (eas-translate) into EAS Tools.
 *
 *   node tools/build-dasdec-translate.mjs --from /home/wags/Documents/dasdec-investigation/eas-translate
 *   node tools/build-dasdec-translate.mjs --from <dir> --check   fail if the copies are out of date
 *
 * eas-translate reproduces the Monroe/DAS DASDEC eas_decoder translator (English and Spanish); its tables
 * are extracted from the firmware binaries. Copied here:
 *   src/eas-translate.js        -> assets/js/dasdec-translate.js (comments dropped, profile imports repointed)
 *   src/profiles/*.js           -> assets/js/dasdec-translate/*.js (generated data, header comment dropped)
 * assets/js files carry no comments, so this tool removes them instead of hand-editing the copies. The 473 captured
 * DASDEC translations (test/fixtures.json) stay in eas-translate: they are that unit's alert history, so run its
 * own tests (node test/run-fixtures.mjs) there before syncing.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENGINE_TARGET = path.join(ROOT, 'assets', 'js', 'dasdec-translate.js');
const PROFILE_DIR = path.join(ROOT, 'assets', 'js', 'dasdec-translate');

function stripLineComments(source) {
    const lines = source.split('\n').filter((line) => !/^\s*\/\//.test(line));
    for (const line of lines) {
        if (/\/\/|\/\*/.test(line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, ''))) {
            throw new Error(`Unexpected inline comment left in the engine: ${line.trim()}`);
        }
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
}

export function buildFiles(fromDir) {
    const files = new Map();
    const engine = fs.readFileSync(path.join(fromDir, 'src', 'eas-translate.js'), 'utf8');
    const profileNames = fs.readdirSync(path.join(fromDir, 'src', 'profiles')).filter((n) => n.endsWith('.js')).sort();
    let out = stripLineComments(engine);
    for (const name of profileNames) {
        const from = `'./profiles/${name}'`;
        if (!out.includes(from)) throw new Error(`The engine does not import ${from}`);
        out = out.replace(from, `'./dasdec-translate/${name}'`);
    }
    if (out.includes('./profiles/')) throw new Error('The engine imports a profile that is not in src/profiles');
    files.set(ENGINE_TARGET, out);
    for (const name of profileNames) {
        const data = fs.readFileSync(path.join(fromDir, 'src', 'profiles', name), 'utf8');
        files.set(path.join(PROFILE_DIR, name), stripLineComments(data));
    }
    return files;
}

function main() {
    const args = process.argv.slice(2);
    const fromIndex = args.indexOf('--from');
    if (fromIndex < 0 || !args[fromIndex + 1]) {
        console.error('Usage: node tools/build-dasdec-translate.mjs --from <eas-translate dir> [--check]');
        return 2;
    }
    const files = buildFiles(path.resolve(args[fromIndex + 1]));
    if (args.includes('--check')) {
        const stale = [...files].filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text);
        const expected = new Set([...files.keys()].filter((f) => f.startsWith(PROFILE_DIR + path.sep)));
        const extra = fs.existsSync(PROFILE_DIR)
            ? fs.readdirSync(PROFILE_DIR).map((n) => path.join(PROFILE_DIR, n)).filter((f) => !expected.has(f))
            : [];
        for (const [file] of stale) console.error(`${path.relative(ROOT, file)} is out of date`);
        for (const file of extra) console.error(`${path.relative(ROOT, file)} is no longer in eas-translate`);
        if (stale.length || extra.length) return 1;
        console.log(`DASDEC translator copies are current (${files.size} files).`);
        return 0;
    }
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    for (const [file, text] of files) {
        fs.writeFileSync(file, text);
        console.log(`Wrote ${path.relative(ROOT, file)}`);
    }
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
    process.exitCode = main();
}
