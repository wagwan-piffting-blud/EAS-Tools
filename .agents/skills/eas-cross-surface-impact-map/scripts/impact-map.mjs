#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const json = args.includes('--json');
const requested = args.filter((arg) => arg !== '--json');
const changed = [...new Set(requested)];

const rules = [
    ['shell/shared UI', /^(index\.html|assets\/css\/|assets\/js\/(common-functions|announcements|handoff|searchable-select)\.js$)/],
    ['decoder/SAME receive path', /^(assets\/js\/(decoder-bundle|seatty-|processor\.js)|tools\/(same-ab|recorder-boundary-check)\.mjs)/],
    ['encoder/E2T path', /^(assets\/js\/encoder-bundle\.js|assets\/E2T\/)/],
    ['crawl path', /^assets\/js\/(crawl-bundle|crawl-|canvas-capture)/],
    ['splicer/audio processing', /^assets\/js\/(splicer-bundle|splicer\/|audacity-macro-engine|native-plugins|vstemu)/],
    ['phoneme/TTS path', /^(assets\/js\/(phoneme|text2wav|nanotts|espeak|spfy|acu|wasm-voice-cache)|assets\/(piper-tts|wasm_tts_voices)\/)/],
    ['WarnGen iframe application', /^warngen\//],
    ['muxer iframe application', /^(muxer\.html|assets\/muxer\/)/],
    ['worker/WASM boundary', /(worker\.js$|\.wasm$|\.data$)/],
    ['generated or derived artifact', /(^tools\/(build|generate)-|^warngen\/tools\/|manifest\.json$|^warngen\/data\/)/],
    ['documentation/static page', /^(docs\/|README|CHANGES|faq|tts-docs|tts-list|credits|terms|privacy|demos|donations|changelog).*\.(md|html|json)$/],
    ['test and quality infrastructure', /^(test\/|vitest\.config\.mjs$|package\.json$|pnpm-lock\.yaml$|Makefile$|tools\/check-docs\.mjs$)/],
    ['agent workflow', /^(AGENTS\.md$|\.agents\/skills\/)/],
];

function referencesFor(file) {
    const base = path.basename(file);
    if (base.length < 5) return [];
    const roots = ['index.html', 'muxer.html', 'assets/js', 'assets/E2T', 'warngen/index.html', 'warngen/src', 'tools', 'test', 'docs', 'README.md', 'Makefile', 'package.json'];
    const candidates = [];
    const allowed = new Set(['.js', '.mjs', '.html', '.css', '.json', '.vm', '.xml', '.md']);
    function visit(candidate) {
        if (!fs.existsSync(candidate)) return;
        const stat = fs.statSync(candidate);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(candidate)) visit(path.join(candidate, name));
            return;
        }
        if (!allowed.has(path.extname(candidate)) || stat.size > 2_000_000 || candidate === file) return;
        candidates.push(candidate);
    }
    for (const candidate of roots) visit(candidate);
    const found = [];
    for (const candidate of candidates) {
        const lines = fs.readFileSync(candidate, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].includes(base)) continue;
            found.push(`${candidate}:${i + 1}:${lines[i].trim().slice(0, 180)}`);
            if (found.length === 12) return found;
        }
    }
    return found;
}

const records = changed.sort().map((file) => ({
    file,
    exists: fs.existsSync(file),
    surfaces: rules.filter(([, re]) => re.test(file)).map(([label]) => label),
    references: referencesFor(file),
}));

const surfaces = [...new Set(records.flatMap((record) => record.surfaces))].sort();
const result = { changedFiles: records, surfaces };

if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
}

if (!records.length) {
    console.error('Usage: node impact-map.mjs [--json] <repository-relative paths...>');
    process.exit(2);
}

console.log('# EAS Tools impact map');
console.log(`\nSurfaces: ${surfaces.length ? surfaces.join('; ') : 'unclassified'}\n`);
for (const record of records) {
    console.log(`## ${record.file}${record.exists ? '' : ' (not present)'}`);
    console.log(`- Surface: ${record.surfaces.length ? record.surfaces.join('; ') : 'unclassified'}`);
    if (record.references.length) {
        console.log('- Filename references:');
        for (const reference of record.references) console.log(`  - ${reference}`);
    } else {
        console.log('- Filename references: none found');
    }
    console.log();
}

console.log('Inspect dynamic imports, worker messages, bridge events, DOM selectors, and generated-source boundaries before treating this map as complete.');
