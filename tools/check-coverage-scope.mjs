import { resolve } from 'node:path';
import { classifyCoverageFile, coverageLaneDescriptions, measuredFiles } from './coverage-scope.mjs';
import { listRepoFiles } from './repo-files.mjs';

const ignoredDirectories = new Set(['.git', '.aws', '.codex', 'coverage', 'node_modules']);

function findJavaScriptFiles() {
    return listRepoFiles(resolve(import.meta.dirname, '..'))
        .filter((file) => /\.m?js$/.test(file))
        .filter((file) => !file.split('/').slice(0, -1).some((part) => ignoredDirectories.has(part)));
}

const files = findJavaScriptFiles().sort();
const lanes = new Map();
const unclassified = [];

for (const file of files) {
    const lane = classifyCoverageFile(file);
    if (!lane) {
        unclassified.push(file);
        continue;
    }
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(file);
}

const missingMeasured = measuredFiles.filter((file) => !files.includes(file));
if (unclassified.length || missingMeasured.length) {
    if (unclassified.length) {
        console.error('JavaScript files missing a coverage-scope classification:');
        unclassified.forEach((file) => console.error(`  ${file}`));
    }
    if (missingMeasured.length) {
        console.error('Measured files missing from the checkout:');
        missingMeasured.forEach((file) => console.error(`  ${file}`));
    }
    process.exitCode = 1;
} else {
    console.log(`Coverage scope accounts for all ${files.length} JavaScript files:`);
    for (const [lane, description] of Object.entries(coverageLaneDescriptions)) {
        const count = lanes.get(lane)?.length ?? 0;
        console.log(`  ${lane}: ${count} — ${description}`);
    }
}
