#!/usr/bin/env node
/*
 * build-espeak-data.mjs — repack the vendored espeak-ng WASM drop into an
 * EAS Tools data package that can speak plain text.
 *
 * The upstream drop in assets/wasm_tts_voices/espeak/ is a phoneme-only build:
 * its espeak-ng.data carries exactly one voice (itc/la) and no dictionaries, so
 * espeak_Synth on ordinary text returns silence. The wasm binary itself is the
 * complete engine — only the virtual-FS payload was trimmed. This script builds
 * a second payload from a local eSpeak NG 1.52.0 install and patches a copy of
 * the Emscripten loader to match, leaving every upstream artifact byte-identical.
 *
 * Emits (alongside the upstream files):
 *   espeak-ng.eas.data          repacked virtual FS
 *   espeak-ng.eas.js            classic-script loader (globalThis.EspeakNgModule)
 *   espeak-eas-manifest.json    contents + hashes
 *
 * espeak-ng.wasm is shared with the upstream drop, unmodified.
 *
 * Usage:
 *   node tools/build-espeak-data.mjs
 *   node tools/build-espeak-data.mjs --src "C:/Program Files/eSpeak NG/espeak-ng-data"
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'assets', 'wasm_tts_voices', 'espeak');

const DEFAULT_SRC = 'C:/Program Files/eSpeak NG/espeak-ng-data';

/* The four shared tables are byte-identical between the upstream drop and a
 * stock 1.52.0 install. Verifying them is the version gate for this whole
 * approach: phondata compiled by a different espeak-ng release would index
 * against a different phontab and the wasm would read garbage. */
const PINNED = {
    'phondata':    'a0b643b155cb6b12628d9e7865b57d9fca0d35844614f2594a5e009c80c80bb4',
    'phonindex':   '384e5fa6f714ba5356c58008249b78699c31c1ad044b243068d263fb806b7d73',
    'phontab':     '1b40690667e1e9aa1ba5e5234773c799e7e72ea751426e5150423d53c3f24fa2',
    'intonations': '031a105bf6bb2ebcd73a2c579ccfb42469b27266db0078af65ae298fd3588b21',
};

/* Voice variants (!v) are a few hundred bytes each; the whole set costs ~48 KB
 * and lets the UI list grow without another repack. Enumerated rather than
 * globbed so the package is reproducible across espeak builds. */
const VARIANTS = [
    'adam', 'Alex', 'Alicia', 'Andrea', 'Andy', 'anika', 'anikaRobot', 'Annie',
    'announcer', 'antonio', 'AnxiousAndy', 'aunty', 'belinda', 'benjamin', 'boris',
    'caleb', 'croak', 'david', 'Demonic', 'Denis', 'Diogo', 'ed', 'edward', 'edward2',
    'f1', 'f2', 'f3', 'f4', 'f5', 'fast', 'Gene', 'Gene2', 'grandma', 'grandpa',
    'gustave', 'Henrique', 'Hugo', 'iven', 'iven2', 'iven3', 'iven4', 'Jacky', 'john',
    'kaukovalta', 'klatt', 'klatt2', 'klatt3', 'klatt4', 'klatt5', 'klatt6', 'Lee',
    'linda', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'marcelo', 'Marco',
    'Mario', 'max', 'Michael', 'michel', 'miguel', 'Mike', 'Mr serious', 'Nguyen',
    'norbert', 'pablo', 'paul', 'pedro', 'quincy', 'RicishayMax', 'RicishayMax2',
    'RicishayMax3', 'rob', 'robert', 'robosoft', 'robosoft2', 'robosoft3', 'robosoft4',
    'robosoft5', 'robosoft6', 'robosoft7', 'robosoft8', 'sandro', 'shelby', 'steph',
    'steph2', 'steph3', 'Storm', 'travis', 'Tweaky', 'UniRobot', 'victor', 'whisper',
    'whisperf', 'zac',
];

/* Languages carried: English for EAS, Spanish for Spanish-language EAS
 * originators, French for Alert Ready. A dictionary serves every variant of its
 * language (en_dict covers en, en-US and every en-* voice file). */
const PACKAGE_FILES = [
    'intonations',
    'phondata',
    'phonindex',
    'phontab',
    'en_dict',
    'es_dict',
    'fr_dict',
    'lang/gmw/en',
    'lang/gmw/en-US',
    'lang/itc/la',
    'lang/roa/es',
    'lang/roa/es-419',
    'lang/roa/fr',
    ...VARIANTS.map((v) => `voices/!v/${v}`),
];

function sha256(buf) {
    return createHash('sha256').update(buf).digest('hex');
}

function parseArgs(argv) {
    const out = { src: DEFAULT_SRC };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--src') out.src = argv[++i];
    }
    return out;
}

function dirsFor(paths) {
    /* Emscripten's loader creates each directory explicitly before writing
     * files into it, parents first. */
    const seen = new Set();
    const ordered = [];
    for (const p of paths) {
        const parts = p.split('/');
        for (let i = 0; i < parts.length - 1; i++) {
            const dir = parts.slice(0, i + 1).join('/');
            if (seen.has(dir)) continue;
            seen.add(dir);
            ordered.push(dir);
        }
    }
    return ordered;
}

function jsString(s) {
    return JSON.stringify(s);
}

function main() {
    const { src } = parseArgs(process.argv.slice(2));

    for (const [name, expected] of Object.entries(PINNED)) {
        const actual = sha256(readFileSync(join(src, name)));
        if (actual !== expected) {
            console.error(`FATAL: ${name} in ${src}`);
            console.error(`  expected ${expected} (eSpeak NG 1.52.0)`);
            console.error(`  found    ${actual}`);
            console.error('The source install is not the 1.52.0 build the vendored wasm was compiled from.');
            process.exit(1);
        }
    }

    const chunks = [];
    const entries = [];
    let offset = 0;
    for (const rel of PACKAGE_FILES) {
        const buf = readFileSync(join(src, rel));
        chunks.push(buf);
        entries.push({ filename: `/espeak-ng-data/${rel}`, start: offset, end: offset + buf.length });
        offset += buf.length;
    }
    const data = Buffer.concat(chunks);
    writeFileSync(join(OUT_DIR, 'espeak-ng.eas.data'), data);

    const filesJs = entries
        .map((e) => `{filename:${jsString(e.filename)},start:${e.start},end:${e.end}}`)
        .join(',');
    const createPathJs = dirsFor(PACKAGE_FILES.map((p) => `espeak-ng-data/${p}`))
        .map((dir) => {
            const parts = dir.split('/');
            const parent = '/' + parts.slice(0, -1).join('/');
            return `Module["FS_createPath"](${jsString(parent === '/' ? '/' : parent)},${jsString(parts[parts.length - 1])},true,true);`;
        })
        .join('');

    let js = readFileSync(join(OUT_DIR, 'espeak-ng.js'), 'utf8');

    const createPathRe = /(?:Module\["FS_createPath"\]\("[^"]*","[^"]*",true,true\);)+/;
    if (!createPathRe.test(js)) throw new Error('loader patch: FS_createPath run not found');
    js = js.replace(createPathRe, createPathJs);

    const loadPackageRe = /loadPackage\(\{files:\[.*?\],remote_package_size:\d+\}\)/s;
    if (!loadPackageRe.test(js)) throw new Error('loader patch: loadPackage metadata not found');
    js = js.replace(loadPackageRe, `loadPackage({files:[${filesJs}],remote_package_size:${data.length}})`);

    const packageNameRe = /var PACKAGE_NAME="espeak-ng\.data";var REMOTE_PACKAGE_BASE="espeak-ng\.data";/;
    if (!packageNameRe.test(js)) throw new Error('loader patch: package name not found');
    js = js.replace(packageNameRe, 'var PACKAGE_NAME="espeak-ng.eas.data";var REMOTE_PACKAGE_BASE="espeak-ng.eas.data";');

    /* import.meta is a syntax error in a classic script, so the loader cannot be
     * importScripts'd as-is. All three uses are URL fallbacks the worker never
     * reaches (it always supplies locateFile); the worker sets the global before
     * importing so they stay correct anyway. */
    const metaCount = (js.match(/import\.meta\.url/g) || []).length;
    if (metaCount !== 3) throw new Error(`loader patch: expected 3 import.meta.url uses, found ${metaCount}`);
    js = js.replaceAll('import.meta.url', 'globalThis.__espeakNgScriptUrl');

    const exportRe = /export default Module;\s*$/;
    if (!exportRe.test(js)) throw new Error('loader patch: ES module export not found');
    js = js.replace(exportRe, 'globalThis.EspeakNgModule=Module;\n');

    writeFileSync(join(OUT_DIR, 'espeak-ng.eas.js'), js);

    const manifest = {
        generatedBy: 'tools/build-espeak-data.mjs',
        source: src,
        espeakNg: '1.52.0',
        note: 'Derived from the upstream drop in this directory. espeak-ng.js, espeak-ng.data, '
            + 'espeak-wasm-driver.js, la.json and manifest.json are untouched; espeak-ng.wasm is shared.',
        artifacts: {
            'espeak-ng.eas.data': { bytes: data.length, sha256: sha256(data) },
            'espeak-ng.eas.js': { bytes: Buffer.byteLength(js), sha256: sha256(Buffer.from(js, 'utf8')) },
        },
        contents: entries.map((e) => ({ path: e.filename, bytes: e.end - e.start })),
    };
    writeFileSync(join(OUT_DIR, 'espeak-eas-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    const kb = (n) => (n / 1024).toFixed(1);
    console.log(`espeak-ng.eas.data  ${entries.length} files, ${kb(data.length)} KB`);
    console.log(`espeak-ng.eas.js    ${kb(Buffer.byteLength(js))} KB`);
    console.log(`espeak-ng.wasm      ${kb(readFileSync(join(OUT_DIR, 'espeak-ng.wasm')).length)} KB (shared, unmodified)`);
}

main();
