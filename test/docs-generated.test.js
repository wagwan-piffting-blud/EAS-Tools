import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

function readGenerated(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('generated documentation mirrors', () => {
    it('uses stable text for dynamic placeholders and omits browser-only controls', () => {
        const demos = readGenerated('docs/generated/tts-demos.md');
        const tts = readGenerated('docs/generated/tts.md');
        const faq = readGenerated('docs/generated/faq.md');

        const demoFiles = fs.readdirSync(path.join(root, 'assets/demo_files')).filter((name) => /\.wav$/i.test(name));
        const demoLinks = demos.match(/\]\(\.\.\/\.\.\/assets\/demo%5Ffiles\/[^)]+\.wav\)/gi) || [];
        expect(demoFiles.length).toBeGreaterThan(0);
        expect(demoLinks).toHaveLength(demoFiles.length);
        expect(demos).not.toContain('Back to EAS Tools');
        expect(demos).not.toMatch(/\S {2,}\S/);
        expect(tts).toContain('limit of the configured number of successful requests');
        const ttsHtml = fs.readFileSync(path.join(root, 'tts-docs.html'), 'utf8');
        const examples = new Map([...ttsHtml.matchAll(/\b(vtml|bal|dt)CodePre\.setValue\(`([\s\S]*?)`\);/g)].map((m) => [m[1], m[2]]));
        const exampleOrder = [...ttsHtml.matchAll(/\bid\s*=\s*["'](vtml|bal|dt)-example["']/gi)].map((m) => m[1].toLowerCase()).filter((name) => examples.has(name));
        expect(exampleOrder.length).toBeGreaterThan(0);
        const fenceLines = tts.split('\n').filter((line) => line.startsWith('```'));
        expect(fenceLines.filter((_line, index) => index % 2 === 0)).toEqual(exampleOrder.map((name) => (name === 'dt' ? '```text' : '```xml')));
        for (const name of exampleOrder) {
            const firstLine = examples.get(name).split('\n').map((line) => line.trim()).find((line) => line && !line.includes('${'));
            if (firstLine) expect(tts, name).toContain(firstLine);
        }
        expect(tts).not.toContain('${currentTime}');
        expect(tts).not.toContain('Copy text');
        expect(tts).not.toContain('Back to EAS Tools');
        const toc = [...faq.matchAll(/^- \[(.+)\]\(#([^)]*)\)$/gm)];
        expect(toc.length).toBeGreaterThan(0);
        const headings = new Set([...faq.matchAll(/^#{2,6} (.+)$/gm)].map((m) => m[1].replace(/\s+\(updated as of [^)]+\)\s*$/i, '').trim()));
        for (const [, label, anchor] of toc) {
            expect(anchor, label).not.toBe('');
            expect(anchor, label).not.toMatch(/updated-as-of/);
            expect(headings.has(label.replace(/\s+\(updated as of [^)]+\)\s*$/i, '').trim()), label).toBe(true);
        }
        expect(faq).not.toContain('](#)');
    });

    it('contains no trailing horizontal whitespace', () => {
        const generatedRoot = path.join(root, 'docs/generated');
        const markdownFiles = [];

        function collect(directory) {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const absolute = path.join(directory, entry.name);
                if (entry.isDirectory()) collect(absolute);
                else if (entry.name.endsWith('.md')) markdownFiles.push(absolute);
            }
        }

        collect(generatedRoot);
        for (const file of markdownFiles) {
            const markdown = readGenerated(path.relative(root, file));
            expect(markdown).not.toMatch(/[ \t]+$/m);
            expect(markdown).not.toMatch(/\n{3,}/);
        }
    });
});
