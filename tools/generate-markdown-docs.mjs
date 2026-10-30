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

function markdownAnchor(text) {
    return text
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+\(updated as of [^)]+\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[character]));
}

function encodePath(pathname) {
    return pathname.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function demoAudioList() {
    const directory = path.join(root, 'assets/demo_files');
    const files = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.wav$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, 'en'));
    const items = files.map((file) => {
        const label = file.replace(/\s+Demo\.wav$/i, '');
        const href = encodePath(`assets/demo_files/${file}`);
        return `<li><a href="${href}">${escapeHtml(label)}</a></li>`;
    });
    return `<ul id="voice-list">${items.join('')}</ul>`;
}

function ttsExamples(html, documentHtml = html) {
    const examples = new Map();
    const sourcePattern = /\b(vtml|bal|dt)CodePre\.setValue\(`([\s\S]*?)`\);/g;
    for (const match of documentHtml.matchAll(sourcePattern)) {
        examples.set(match[1], match[2].replace(/\$\{currentTime\}/g, 'current local time'));
    }
    return html.replace(
        /<div\b(?=[^>]*\bid\s*=\s*["'](vtml|bal|dt)-example["'])[^>]*>[\s\S]*?<\/div>/gi,
        (_whole, name) => {
            const example = examples.get(name.toLowerCase());
            const language = name.toLowerCase() === 'dt' ? 'text' : 'xml';
            return example === undefined ? '' : `<pre><code class="language-${language}">${escapeHtml(example)}</code></pre>`;
        },
    );
}

function rewritePlaceholderAnchors(html) {
    return html.replace(
        /<a\b([^>]*?\bhref\s*=\s*)(["'])#\2([^>]*)>([\s\S]*?)<\/a>/gi,
        (whole, prefix, quote, suffix, label) => {
            const anchor = markdownAnchor(label);
            return anchor ? `<a${prefix}${quote}#${anchor}${quote}${suffix}>${label}</a>` : whole;
        },
    );
}

function rewriteLinks(html, source, output) {
    return rewritePlaceholderAnchors(html).replace(/\b(href|src)=(['"])([^'"]+)\2/gi, (whole, attribute, quote, target) => {
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

function replaceInlineSpanById(html, id, replacement) {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
        `([ \\t]*)<span\\b(?=[^>]*\\bid\\s*=\\s*["']${escapedId}["'])[^>]*>[\\s\\S]*?<\\/span>([ \\t]*)`,
        'gi',
    );
    return html.replace(pattern, (_whole, leading, trailing) => (
        `${leading ? ' ' : ''}${replacement}${trailing ? ' ' : ''}`
    ));
}

function prepareContent(html, source, documentHtml = html) {
    let prepared = html;
    if (source === 'demos.html') prepared = prepared.replace(/<ul\b(?=[^>]*\bid\s*=\s*["']voice-list["'])[^>]*>[\s\S]*?<\/ul>/i, demoAudioList());
    if (source === 'tts-docs.html') prepared = ttsExamples(prepared, documentHtml);
    // These values are populated by browser-side JavaScript. Use stable prose
    // in the Markdown mirror while leaving the deployed HTML dynamic.
    prepared = replaceInlineSpanById(prepared, 'voice-count', '');
    prepared = replaceInlineSpanById(prepared, 'tts-requests-per-user-limit', 'the configured number of');
    // Copy controls are useful in the browser but are not documentation prose.
    prepared = prepared.replace(
        /<span\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bcopy-text\b[^"']*["'])[^>]*>[\s\S]*?<\/span>/gi,
        '',
    );
    // Navigation controls are useful in the browser but are not documentation prose.
    prepared = prepared.replace(
        /<button\b[^>]*>\s*Back to EAS Tools\s*<\/button>/gi,
        '',
    );
    return prepared
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[\s\S]*?<\/style>/gi, '');
}

function normalizeMarkdown(markdown) {
    const lines = markdown.split('\n');
    const normalized = [];
    let inFence = false;
    let previousBlank = false;
    for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            previousBlank = false;
            normalized.push(line);
            continue;
        }
        const blank = !inFence && line.trim() === '';
        if (blank && previousBlank) continue;
        normalized.push(line);
        previousBlank = blank;
    }
    return normalized.join('\n');
}

function render(entry) {
    const sourcePath = path.join(root, entry.source);
    const html = fs.readFileSync(sourcePath, 'utf8');
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() ?? entry.source;
    const content = rewriteLinks(
        prepareContent(extract(html, entry.scope), entry.source, html),
        entry.source,
        entry.output,
    );
    const markdown = normalizeMarkdown(converter.translate(content))
        .replace(/[ \t]+$/gm, '')
        .trim();
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
