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

        expect(demos).toContain('This page showcases the various Text-to-Speech');
        expect(demos).toContain('[AT&T Crystal](../../assets/demo%5Ffiles/AT%26T%20Crystal%20Demo.wav)');
        expect(demos).toContain('[WASM](../../assets/demo%5Ffiles/WASM%20Demo.wav)');
        expect(demos).not.toContain('Back to EAS Tools');
        expect(demos).not.toContain('  various');
        expect(tts).toContain('limit of the configured number of successful requests');
        expect(tts).toContain('This Hazardous Weather Outlook is for southwest Iowa');
        const fenceLines = tts.split('\n').filter((line) => line.startsWith('```'));
        expect(fenceLines.filter((_line, index) => index % 2 === 0)).toEqual(['```xml', '```xml', '```text']);
        expect(tts).not.toContain('Copy text');
        expect(tts).not.toContain('Back to EAS Tools');
        expect(faq).toContain('- [What is the EAS?](#what-is-the-eas)');
        expect(faq).toContain('- [Are there currently any known issues or limitations with EAS Tools? (updated as of 2026-04-26)](#are-there-currently-any-known-issues-or-limitations-with-eas-tools)');
        expect(faq).not.toContain('](#)');
        expect(faq).toContain('[You mentioned a web TTS service? What\'s that, and how does it work?](#you-mentioned-a-web-tts-service-whats-that-and-how-does-it-work)');
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
