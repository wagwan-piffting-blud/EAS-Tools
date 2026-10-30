#!/usr/bin/env node
import fs from 'node:fs';

const registry = [
    {
        name: 'Audacity macro manifest',
        outputs: ['assets/audacity_macros/manifest.json'],
        inputs: ['assets/audacity_macros/'],
        generator: 'tools/generate-macro-manifest.mjs',
        classification: 'generated output',
    },
    {
        name: 'Audacity plugin manifest',
        outputs: ['assets/audacity_plugins/manifest.json'],
        inputs: ['assets/audacity_plugins/'],
        generator: 'tools/generate-plugin-manifest.mjs',
        classification: 'generated output',
    },
    {
        name: 'Marine SAME prefix mapping',
        outputs: ['assets/E2T/include/marine-same.json'],
        inputs: ['assets/E2T/include/same-us.json'],
        generator: 'tools/build-marine-same.mjs',
        classification: 'derived checked-in data',
    },
    {
        name: 'Forecast-zone to county crosswalk',
        outputs: ['assets/E2T/include/zone-county.json'],
        inputs: ['warngen/data/forecast_zones.geojson', 'warngen/data/us_counties.geojson', 'warngen/src/geo/intersect.js'],
        generator: 'tools/build-zone-county-crosswalk.mjs',
        classification: 'derived checked-in data',
    },
    {
        name: 'EAS eSpeak data package',
        outputs: [
            'assets/wasm_tts_voices/espeak/espeak-ng.eas.data',
            'assets/wasm_tts_voices/espeak/espeak-ng.eas.js',
            'assets/wasm_tts_voices/espeak/espeak-eas-manifest.json',
        ],
        inputs: ['external eSpeak NG 1.52.0 data plus pinned tables in the generator'],
        generator: 'tools/build-espeak-data.mjs',
        classification: 'patched upstream artifact',
    },
    {
        name: 'Agent-readable HTML documentation mirrors',
        outputs: ['docs/generated/'],
        inputs: [
            'docs/html-sources.json',
            'credits.html',
            'demos.html',
            'donations.html',
            'faq.html',
            'privacy.html',
            'terms.html',
            'tts-docs.html',
            'tts-list.html',
            'assets/tts_backend_codes/',
        ],
        generator: 'tools/generate-markdown-docs.mjs',
        classification: 'generated documentation',
    },
];

const requested = process.argv.slice(2);
const paths = requested;

function touches(entry, candidate) {
    return entry.outputs.some((p) => candidate === p || (p.endsWith('/') && candidate.startsWith(p)))
        || entry.inputs.some((p) => !p.startsWith('external ') && (candidate === p || (p.endsWith('/') && candidate.startsWith(p))))
        || candidate === entry.generator;
}

const matches = registry.filter((entry) => paths.some((candidate) => touches(entry, candidate)));
if (!paths.length) {
    for (const entry of registry) console.log(`${entry.name}\t${entry.classification}\t${entry.generator}`);
    process.exit(0);
}

if (!matches.length) {
    console.log('No registered artifact lineage matched. This does not prove the files are hand-authored; inspect their headers, callers, and repository tools.');
    process.exit(0);
}

for (const entry of matches) {
    console.log(`\n${entry.name}`);
    console.log(`  classification: ${entry.classification}`);
    console.log(`  generator:      ${entry.generator}${fs.existsSync(entry.generator) ? '' : ' (missing)'}`);
    console.log('  inputs:');
    for (const input of entry.inputs) console.log(`    - ${input}`);
    console.log('  outputs:');
    for (const output of entry.outputs) console.log(`    - ${output}${fs.existsSync(output) ? '' : ' (missing)'}`);
}
