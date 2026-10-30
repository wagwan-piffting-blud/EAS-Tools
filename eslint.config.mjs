import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: [
            '**/node_modules/**',
            '**/coverage/**',
            'assets/muxer/**',
            'assets/piper-tts/**',
            'warngen/vendor/**',
            'assets/js/*-bundle.js',
            'assets/js/codemirror.js',
            'assets/js/marked.js',
            'assets/js/sox.js',
            'assets/js/spfy_wasm.js',
            'assets/js/seatty-same-wasm.js',
            'assets/wasm_tts_voices/**',
            'test/e2e-rs/target/**',
            'test/e2e-rs/vendor/**',
        ],
    },
    {
        files: ['assets/**/*.js', 'assets/**/*.mjs', 'warngen/src/**/*.js', 'tools/**/*.mjs', 'warngen/tools/**/*.mjs', 'test/**/*.js', 'test/e2e-rs/*.mjs', 'vitest.config.mjs'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            // Legacy browser entrypoints intentionally consume globals supplied by the shell.
            // Keep structural correctness rules active without pretending those globals are imports.
            'no-undef': 'off',
            'no-unused-vars': 'off',
        },
    },
    {
        files: ['test/**/*.js', 'tools/**/*.mjs', 'warngen/tools/**/*.mjs', 'test/e2e-rs/*.mjs', 'vitest.config.mjs'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser },
        },
    },
    {
        files: ['warngen/src/**/*.js', 'assets/js/splicer/*.js'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: { ...globals.browser, ...globals.node },
        },
    },
    {
        files: ['assets/js/splicer/*.js', 'warngen/src/vendor-entry.js'],
        languageOptions: {
            sourceType: 'module',
        },
    },
    {
        files: ['assets/js/splicer/rec-worklet.js'],
        languageOptions: {
            globals: {
                AudioWorkletProcessor: 'readonly',
                registerProcessor: 'readonly',
            },
        },
    },
];
