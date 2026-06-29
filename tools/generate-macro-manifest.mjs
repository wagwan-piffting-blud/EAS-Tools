import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const macroDir = join(here, '..', 'assets', 'audacity_macros');
const manifestPath = join(macroDir, 'manifest.json');

const files = readdirSync(macroDir).filter((f) => /\.txt$/i.test(f));

let existing = [];
if (existsSync(manifestPath)) {
    try {
        const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (Array.isArray(parsed)) existing = parsed;
    } catch {
        existing = [];
    }
}

const present = new Set(files);
const ordered = existing.filter((f) => present.has(f));
const seen = new Set(ordered);
const added = files.filter((f) => !seen.has(f)).sort((a, b) => a.localeCompare(b));
const manifest = ordered.concat(added);

writeFileSync(manifestPath, JSON.stringify(manifest));

const removed = existing.length - ordered.length;
console.log(`Wrote ${manifest.length} macros to ${manifestPath}`);
console.log(`  ${added.length} added, ${removed} removed, ${ordered.length} kept in order`);
