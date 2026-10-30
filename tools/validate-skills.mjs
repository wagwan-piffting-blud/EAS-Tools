#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const skillsRoot = path.join(root, '.agents/skills');
const allowedKeys = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata']);
const errors = [];
let count = 0;

for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    count += 1;
    const relative = `.agents/skills/${entry.name}/SKILL.md`;
    const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
        errors.push(`${relative}: missing file`);
        continue;
    }
    const content = fs.readFileSync(skillPath, 'utf8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    if (!frontmatter) {
        errors.push(`${relative}: invalid or missing YAML frontmatter`);
        continue;
    }
    const fields = new Map();
    for (const line of frontmatter[1].split('\n')) {
        if (/^\s|^#|^$/.test(line)) continue;
        const match = line.match(/^([a-z-]+):\s*(.*)$/);
        if (match) fields.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''));
    }
    for (const key of fields.keys()) {
        if (!allowedKeys.has(key)) errors.push(`${relative}: unsupported frontmatter field ${key}`);
    }
    const name = fields.get('name') ?? '';
    const description = fields.get('description') ?? '';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
        errors.push(`${relative}: name must be 1-64 characters of lowercase hyphen-case`);
    }
    if (!description || description.length > 1024 || /[<>]/.test(description)) {
        errors.push(`${relative}: description must be present, at most 1024 characters, and contain no angle brackets`);
    }
    if (/^\s*\[TODO:[^\n]*\]\s*$/m.test(content.slice(frontmatter[0].length))) {
        errors.push(`${relative}: unfinished TODO placeholder`);
    }
}

if (count === 0) errors.push('No repository skills found.');
if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
} else {
    console.log(`Skill validation passed: ${count} repository skills.`);
}
