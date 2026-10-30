import fs from 'node:fs';
import path from 'node:path';
import { listRepoFiles } from './repo-files.mjs';

const root = path.resolve(import.meta.dirname, '..');
const self = path.relative(root, import.meta.filename).split(path.sep).join('/');
const ignoredDirectories = new Set(['.git', 'coverage', 'node_modules']);
const sourceExtensions = new Set([
    '.bash', '.c', '.cc', '.cpp', '.css', '.fish', '.go', '.h', '.hpp', '.java', '.js',
    '.jsx', '.kts', '.mjs', '.py', '.rs', '.scss', '.sh', '.ts', '.tsx', '.xml', '.yaml', '.yml',
]);

const rules = [
    { languages: 'JavaScript/TypeScript', extensions: new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']), pattern: /eslint-(?:disable|enable|disable-next-line|disable-line)|@ts-(?:ignore|nocheck|expect-error)|(?:istanbul|c8|coverage)\s+ignore/i },
    { languages: 'Python', extensions: new Set(['.py']), pattern: /#\s*(?:noqa|type:\s*ignore|pylint:\s*disable|pragma:\s*no\s*cover)\b/i },
    { languages: 'Go', extensions: new Set(['.go']), pattern: /\/\/\s*(?:nolint|lint:\s*ignore)\b/i },
    { languages: 'Rust', extensions: new Set(['.rs']), pattern: /#\s*\[(?:allow|expect)\s*\(/i },
    { languages: 'C/C++', extensions: new Set(['.c', '.cc', '.cpp', '.h', '.hpp']), pattern: /(?:NOLINT(?:NEXTLINE)?|#\s*pragma\s+warning\s*\(\s*disable|clang-format\s+off)/i },
    { languages: 'Shell', extensions: new Set(['.bash', '.fish', '.sh']), pattern: /#\s*shellcheck\s+disable=/i },
    { languages: 'CSS', extensions: new Set(['.css', '.scss']), pattern: /stylelint-(?:disable|enable)/i },
    { languages: 'JVM', extensions: new Set(['.java', '.kts']), pattern: /(?:@SuppressWarnings|noinspection)\b/i },
];

function filesUnder(directory) {
    return listRepoFiles(directory)
        .filter((file) => !file.split('/').slice(0, -1).some((part) => ignoredDirectories.has(part)))
        .filter((file) => sourceExtensions.has(path.extname(file).toLowerCase()))
        .map((file) => path.join(directory, file));
}

const findings = [];
let scanned = 0;
for (const file of filesUnder(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative === self) continue;
    const extension = path.extname(file).toLowerCase();
    const matchingRules = rules.filter((rule) => rule.extensions.has(extension));
    if (matchingRules.length === 0) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('\0')) continue;
    scanned += 1;
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
        for (const rule of matchingRules) {
            const match = rule.pattern.exec(line);
            if (!match) continue;
            findings.push({ file: relative, line: index + 1, language: rule.languages, text: line.trim() });
            break;
        }
    });
}

if (findings.length > 0) {
    console.error(`Anti-suppression check failed: ${findings.length} suppression directive(s) found.`);
    for (const finding of findings) {
        console.error(`  ${finding.file}:${finding.line} [${finding.language}] ${finding.text}`);
    }
    process.exitCode = 1;
} else {
    console.log(`Anti-suppression check passed: scanned ${scanned} source files; no suppression directives found.`);
}
