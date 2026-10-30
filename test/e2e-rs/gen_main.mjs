#!/usr/bin/env node
// Regenerates suites/main.rs from the suite modules in suites/. With --check, fails instead of
// writing when main.rs is stale: a suite file missing from main.rs is never compiled or run.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const suites = path.join(import.meta.dirname, 'suites');
const skip = new Set(['main', 'common']);
const check = process.argv.includes('--check');

const modules = fs.readdirSync(suites)
    .filter((name) => name.endsWith('.rs'))
    .map((name) => name.slice(0, -3))
    .filter((name) => !skip.has(name))
    .sort();

const lines = [
    'mod common;',
    ...modules.map((name) => `mod ${name};`),
    '',
    'fn main() -> std::process::ExitCode {',
    '    eas_tools_e2e::run(vec![',
    ...modules.map((name) => `        ("${name}", ${name}::cases()),`),
    '    ])',
    '}',
    '',
];
const generated = lines.join('\n');
const target = path.join(suites, 'main.rs');

if (check) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== generated) {
        console.error('test/e2e-rs/suites/main.rs is stale; run `node test/e2e-rs/gen_main.mjs`.');
        process.exitCode = 1;
    } else {
        console.log(`E2E suite registry is current: ${modules.length} suites.`);
    }
} else {
    fs.writeFileSync(target, generated, 'utf8');
    console.log(`${modules.length} suites registered`);
}
