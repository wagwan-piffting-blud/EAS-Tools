/**
 * The numeric 90% gate applies only to these instrumented first-party modules.
 * Every other JavaScript file is still accounted for by classifyCoverageFile().
 */
export const measuredFiles = [
    'assets/js/splicer/layout.js',
    'assets/js/splicer/limiter.js',
    'assets/js/splicer/encode.js',
    'assets/js/splicer/model.js',
    'assets/js/splicer/peaks.js',
    'assets/js/splicer/render.js',
    'assets/js/splicer/wav.js',
    'assets/js/splicer/zip.js',
    'warngen/src/engine/ugc.js',
    'warngen/src/engine/utils.js',
    'warngen/src/config/xmlParser.js',
    'warngen/src/geo/intersect.js',
    'warngen/src/geo/highways.js',
    'warngen/src/radar/palette.js',
    'warngen/src/radar/synth.js',
];

const measured = new Set(measuredFiles);

const generatedFiles = new Set([
    'assets/js/phoneme-webpack.js',
    'assets/js/seatty-same-wasm.js',
    'assets/js/sox.js',
    'assets/js/spfy_wasm.js',
    'assets/wasm_tts_voices/espeak/espeak-ng.eas.js',
    'assets/wasm_tts_voices/espeak/espeak-ng.js',
]);

const vendoredFiles = new Set([
    'assets/js/codemirror.js',
    'assets/js/marked.js',
    'assets/js/matchbrackets.js',
    'assets/js/wave-resampler.js',
    'assets/js/wavefile.js',
]);

const integrationFiles = new Set([
    'assets/js/seatty-same.js',
    'tools/recorder-boundary-check.mjs',
    'tools/same-ab.mjs',
    'warngen/tools/render_check.mjs',
]);

/** Return the single quality lane responsible for a JavaScript file. */
export function classifyCoverageFile(file) {
    if (measured.has(file)) return 'measured';
    if (file.startsWith('test/') && !file.startsWith('test/e2e-rs/vendor/')) return 'test-harness';
    if (file === 'vitest.config.mjs' || file === 'eslint.config.mjs') return 'test-harness';
    if (integrationFiles.has(file)) return 'integration';

    if (
        generatedFiles.has(file)
        || /^assets\/js\/[^/]+-bundle\.js$/.test(file)
        || file.startsWith('assets/muxer/')
        || file.startsWith('assets/piper-tts/')
    ) return 'generated';

    if (
        vendoredFiles.has(file)
        || file.startsWith('assets/js/gifenc/')
        || file.startsWith('assets/js/h264-mp4-encoder/')
        || file.startsWith('assets/js/mediabunny/')
        || file.startsWith('warngen/vendor/')
        || file.startsWith('test/e2e-rs/vendor/')
    ) return 'vendored';

    if (
        file.startsWith('.agents/')
        || file.startsWith('.github/')
        || file.startsWith('tools/')
        || file.startsWith('warngen/tools/')
        || file === 'warngen/webpack.config.js'
        || file === 'warngen/src/vendor-entry.js'
        || file === 'assets/js/phoneme-webpack.entry.js'
    ) return 'maintenance-tool';

    if (file.startsWith('assets/') || file.startsWith('warngen/src/')) return 'browser-runtime';
    return null;
}

export const coverageLaneDescriptions = {
    measured: 'V8 line and branch coverage, with the repository-wide 90% gate',
    integration: 'deterministic protocol or WarnGen corpus checks',
    'browser-runtime': 'browser/runtime behavior; requires focused unit or browser tests before entering the numeric gate',
    'maintenance-tool': 'build, generation, verification, or repair command; validated through its owning workflow',
    generated: 'generated or bundled output; validate its generator, lineage, and runtime integration',
    vendored: 'third-party code; validate provenance and integration rather than local line coverage',
    'test-harness': 'test or coverage infrastructure, outside production-code coverage',
};
