import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tracked plus untracked-but-not-ignored files, as repository-relative POSIX paths.
 * Honoring .gitignore keeps local-only trees (build targets, scratch tooling, nested
 * node_modules) out of the repository audits.
 */
export function listRepoFiles(root) {
    const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    return output.split('\0').filter((file) => file && existsSync(join(root, file)));
}
