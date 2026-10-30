#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { listRepoFiles } from './repo-files.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sources = JSON.parse(fs.readFileSync(path.join(root, 'docs/html-sources.json'), 'utf8'));
const codeMap = JSON.parse(fs.readFileSync(path.join(root, 'docs/code-map.json'), 'utf8'));
const errors = [];

const registeredHtml = new Set([
    ...sources.entries.map(({ source }) => source),
    ...sources.exceptions.map(({ source }) => source),
]);

function walk(dir, predicate) {
    return listRepoFiles(dir).map((file) => path.join(dir, file)).filter(predicate);
}

for (const absolute of walk(root, (file) => file.endsWith('.html'))) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (relative.startsWith('node_modules/') || relative.startsWith('coverage/')) continue;
    const html = fs.readFileSync(absolute, 'utf8');
    const looksLikeDoc = /<article\b|<title>[^<]*(?:FAQ|Documentation|Credits|Privacy|Terms|Donations|Demos|Phonemic|Phonetic)/i.test(html);
    if (looksLikeDoc && !registeredHtml.has(relative)) errors.push(`Unregistered HTML documentation source: ${relative}`);
}

for (const { source, output } of sources.entries) {
    if (!fs.existsSync(path.join(root, source))) errors.push(`Missing HTML source: ${source}`);
    if (!fs.existsSync(path.join(root, output))) errors.push(`Missing generated Markdown: ${output}`);
}

for (const area of codeMap.areas) {
    if (!fs.existsSync(path.join(root, area.path))) errors.push(`Missing documented code area: ${area.path}`);
    for (const doc of area.docs) {
        if (!fs.existsSync(path.join(root, doc))) errors.push(`Missing documentation for ${area.path}: ${doc}`);
    }
}

for (const absolute of walk(root, (file) => file.endsWith('.md'))) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (relative.startsWith('node_modules/') || relative.startsWith('coverage/')) continue;
    const markdown = fs.readFileSync(absolute, 'utf8');
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\((<)?([^)>\s]+)(?:\s+['"][^'"]*['"])?(?:>)?\)/g)) {
        const target = match[2];
        if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) continue;
        const pathname = decodeURIComponent(target.split(/[?#]/, 1)[0]);
        if (!pathname) continue;
        const resolved = path.resolve(path.dirname(absolute), pathname);
        if (!fs.existsSync(resolved)) errors.push(`Broken local link in ${relative}: ${target}`);
    }
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
for (const required of ['## Repository map', './docs/index.md', './docs/usage.md']) {
    if (!readme.includes(required)) errors.push(`README.md is missing required documentation marker: ${required}`);
}

if (errors.length) {
    for (const error of [...new Set(errors)]) console.error(error);
    process.exitCode = 1;
} else {
    console.log(`Documentation checks passed: ${sources.entries.length} generated mirrors and ${codeMap.areas.length} mapped code areas.`);
}
