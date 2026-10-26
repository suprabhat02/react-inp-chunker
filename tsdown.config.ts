import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'core/index': 'src/core/index.ts',
  },
  format: ['esm', 'cjs'],
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  clean: true,
  // react/react-dom are peer deps; never bundle them into the package.
  deps: { neverBundle: ['react', 'react-dom'] },
  outDir: 'dist',
});
