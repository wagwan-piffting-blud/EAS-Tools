#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(root, 'docs/html-sources.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const check = process.argv.includes('--check');
const outputBySource = new Map(manifest.entries.map(({ source, output }) => [source, output]));
const converter = new NodeHtmlMarkdown({ bulletMarker: '-', keepDataImages: false });

function extract(html, scope = 'article') {
    const preferred = scope === 'body' ? ['body'] : ['article', 'main', 'body'];
    for (const tag of preferred) {
        const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        if (match) return match[1];
    }
    throw new Error(`Could not find ${preferred.join(', ')} content`);
}

function rewriteLinks(html, source, output) {
    return html.replace(/\b(href|src)=(['"])([^'"]+)\2/gi, (whole, attribute, quote, target) => {
        if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) return whole;
        const [pathname, suffix = ''] = target.split(/(?=[?#])/u, 2);
        if (!pathname) return whole;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), pathname));
        const mapped = outputBySource.get(resolved) ?? resolved;
        let relative = path.posix.relative(path.posix.dirname(output), mapped);
        if (!relative.startsWith('.')) relative = `./${relative}`;
        return `${attribute}=${quote}${relative}${suffix}${quote}`;
    });
}

function render(entry) {
    const sourcePath = path.join(root, entry.source);
    const html = fs.readFileSync(sourcePath, 'utf8');
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() ?? entry.source;
    const content = rewriteLinks(extract(html, entry.scope), entry.source, entry.output)
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[\s\S]*?<\/style>/gi, '');
    const markdown = converter.translate(content).trim();
    const heading = markdown.startsWith('# ') ? '' : `# ${title}\n\n`;
    return `<!-- GENERATED FILE: edit ${entry.source}, then run make docs. -->\n\n${heading}${markdown}\n`;
}

let stale = false;
for (const entry of manifest.entries) {
    const outputPath = path.join(root, entry.output);
    const expected = render(entry);
    if (check) {
        const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
        if (actual !== expected) {
            console.error(`${entry.output} is missing or stale; run make docs`);
            stale = true;
        }
        continue;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, expected);
    console.log(`${entry.source} -> ${entry.output}`);
}

if (stale) process.exitCode = 1;
