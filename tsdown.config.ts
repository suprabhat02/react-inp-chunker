import { fileURLToPath } from 'node:url';
import type { Plugin } from 'rolldown';
import { type UserConfig, defineConfig } from 'tsdown';

const productionDiagnostics = fileURLToPath(
  new URL('src/core/diagnostics.production.ts', import.meta.url),
);

/**
 * Redirects the one import of the diagnostics module to its no-op twin.
 * A path alias cannot do this: rolldown matches alias keys against the
 * import specifier (`./diagnostics.js`), not against the file it resolves
 * to, and a bare relative specifier is not safe to alias globally.
 */
const swapInProductionDiagnostics: Plugin = {
  name: 'production-diagnostics',
  resolveId(source) {
    return source === './diagnostics.js' ? productionDiagnostics : null;
  },
};

const entry = {
  index: 'src/index.ts',
  'core/index': 'src/core/index.ts',
};

const shared = {
  entry,
  format: ['esm', 'cjs'],
  platform: 'neutral',
  sourcemap: true,
  // react/react-dom are peer deps; never bundle them into the package.
  deps: { neverBundle: ['react', 'react-dom'] },
} satisfies Partial<UserConfig>;

/**
 * Two builds of the same source.
 *
 * `dist/` is what Node, a server render and any bundler without condition
 * support resolve: it decides whether to warn by reading
 * `process.env.NODE_ENV` at runtime, so it is correct everywhere.
 *
 * `dist/production/` is what the `production` export condition resolves to
 * (webpack, Vite, Rspack, Parcel all set it for a production build). The
 * development diagnostics are replaced with a no-op module before bundling,
 * so none of their message strings reach a user's bundle — about a kilobyte
 * that would otherwise be dead weight in every production app.
 */
export default defineConfig([
  {
    ...shared,
    dts: true,
    clean: true,
    outDir: 'dist',
  },
  {
    ...shared,
    dts: false, // the types in dist/ describe both builds
    clean: false, // would delete the build above
    outDir: 'dist/production',
    plugins: [swapInProductionDiagnostics],
  },
]);
