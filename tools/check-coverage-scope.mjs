import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { classifyCoverageFile, coverageLaneDescriptions, measuredFiles } from './coverage-scope.mjs';

const ignoredDirectories = new Set(['.git', '.aws', '.codex', 'coverage', 'node_modules']);

function findJavaScriptFiles(directory = '.') {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) files.push(...findJavaScriptFiles(join(directory, entry.name)));
        } else if (entry.isFile() && /\.m?js$/.test(entry.name)) {
            files.push(relative('.', join(directory, entry.name)).split(sep).join('/'));
        }
    }
    return files;
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
