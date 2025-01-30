import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        exclude: ['node_modules'],
        coverage: {
            reporter: ['text', 'text-summary', 'html'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['node_modules'],
        },
    },

    build: {
        sourcemap: true,
    },
});
