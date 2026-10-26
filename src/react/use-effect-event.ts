import * as React from 'react';
import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * `useEffectEvent` only became a stable React export in 19.2. On React 18
 * and 19.0–19.1 it doesn't exist at all — and a named
 * `import { useEffectEvent } from 'react'` then fails outright: at module
 * link time under Node ESM ("Named export 'useEffectEvent' not found"), or
 * as "useEffectEvent is not a function" on first render in a bundler. Both
 * versions are inside this package's declared peer range, so that has to
 * work, not just type-check.
 *
 * So the native hook is read as a property of the namespace object, where a
 * missing export is plain `undefined` rather than a link error, and used
 * whenever the running React has it. Otherwise the fallback keeps the same
 * contract: a stable function identity that always calls the latest
 * callback. The latest callback is committed from an insertion effect —
 * after render, before any layout or passive effect of the same commit can
 * observe it — so effects always see the current closure, without the
 * render-time ref mutation the React Compiler rejects.
 */
type EffectEventHook = <Args extends readonly unknown[], Return>(
  callback: (...args: Args) => Return,
) => (...args: Args) => Return;

export function useEffectEventFallback<Args extends readonly unknown[], Return>(
  callback: (...args: Args) => Return,
): (...args: Args) => Return {
  const latest = useRef(callback);
  useInsertionEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}

// Through `unknown` on purpose: React 18's types have no `useEffectEvent`
// member at all, so a direct assertion wouldn't compile against them.
const nativeUseEffectEvent = (
  React as unknown as { readonly useEffectEvent?: EffectEventHook }
).useEffectEvent;

export const useEffectEvent: EffectEventHook =
  nativeUseEffectEvent ?? useEffectEventFallback;
