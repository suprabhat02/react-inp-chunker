import type * as RealDiagnostics from './diagnostics.js';
import type { Diagnostics } from './diagnostics.js';

/**
 * The production twin of `diagnostics.ts`, swapped in at build time for the
 * files behind this package's `production` export condition (see
 * tsdown.config.ts). Development guidance is worth about a kilobyte of
 * message strings, which is a quarter of this package — worth paying while
 * building, not worth shipping to users.
 *
 * Relying on a bundler to prove `process.env.NODE_ENV !== 'production'`
 * false and drop the branch does not work: the guard that keeps the check
 * safe outside Node (`typeof process !== 'undefined'`) is not a constant,
 * so esbuild — and therefore Vite — leaves the whole thing in. Swapping the
 * module removes the question.
 */
export const isDevelopment = false;

const NOTHING: Diagnostics = {
  check: () => undefined,
  sliceEnded: () => undefined,
  resumed: () => undefined,
};

export function createDiagnostics(): Diagnostics {
  return NOTHING;
}

/**
 * Fails the build if this stops being a drop-in replacement for the real
 * module — a missing export, or a signature that drifted.
 */
const _sameShape: typeof RealDiagnostics = { isDevelopment, createDiagnostics };
export type { _sameShape };
