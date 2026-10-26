import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * REACT_VERSION=18 runs the whole suite on React 18 from compat/react18
 * (installed with `npm ci --prefix compat/react18` from its own lockfile).
 * Every import of react and react-dom resolves there — including Testing
 * Library's own, which is inlined below so it goes through the same alias.
 * tests/react-version.test.ts fails unless the suite really runs on the
 * version asked for, so a broken alias can't pass silently.
 */
const react18 =
  process.env['REACT_VERSION'] === '18'
    ? fileURLToPath(new URL('./compat/react18/node_modules', import.meta.url))
    : null;

export default defineConfig({
  resolve: {
    alias:
      react18 === null
        ? []
        : [
            { find: /^react(\/.*)?$/, replacement: `${react18}/react$1` },
            { find: /^react-dom(\/.*)?$/, replacement: `${react18}/react-dom$1` },
            {
              // Its ES module build, so its own react-dom imports are
              // resolved (and aliased) here too.
              find: /^@testing-library\/react$/,
              replacement: fileURLToPath(
                new URL(
                  './node_modules/@testing-library/react/dist/@testing-library/react.esm.js',
                  import.meta.url,
                ),
              ),
            },
          ],
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    server: { deps: { inline: react18 === null ? [] : ['@testing-library/react'] } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
