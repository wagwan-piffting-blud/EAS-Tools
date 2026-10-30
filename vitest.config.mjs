import { configDefaults, defineConfig } from 'vitest/config';
import { measuredFiles } from './tools/coverage-scope.mjs';

export default defineConfig({
    test: {
        include: ['test/**/*.test.js'],
        exclude: [...configDefaults.exclude, 'test/e2e-rs/**'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'html'],
            reportsDirectory: 'coverage',
            include: measuredFiles,
            thresholds: {
                statements: 90,
                branches: 90,
                functions: 90,
                lines: 90,
            },
        },
    },
});
