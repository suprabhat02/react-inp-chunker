import * as React from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useEffectEvent,
  useEffectEventFallback,
} from '../../src/react/use-effect-event.js';

const nativeUseEffectEvent = (React as unknown as { readonly useEffectEvent?: unknown })
  .useEffectEvent;

describe('useEffectEvent (compat)', () => {
  afterEach(() => {
    vi.doUnmock('react');
    vi.resetModules();
  });

  it.runIf(nativeUseEffectEvent !== undefined)(
    "uses React's own useEffectEvent when the running React has it (19.2+)",
    () => {
      expect(useEffectEvent).toBe(nativeUseEffectEvent);
    },
  );

  it.runIf(nativeUseEffectEvent === undefined)(
    'uses the fallback when the running React has no useEffectEvent (18, 19.0–19.1)',
    () => {
      expect(useEffectEvent).toBe(useEffectEventFallback);
    },
  );

  it('selects the fallback when react has no useEffectEvent export at all, instead of failing to load', async () => {
    vi.resetModules();
    // An explicit `undefined` rather than a deleted key: Vitest's module
    // mock throws on reading an export the factory didn't define, while a
    // real React 18 namespace just yields `undefined` — which is exactly
    // what this reproduces.
    vi.doMock('react', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      useEffectEvent: undefined,
    }));

    const compat = await import('../../src/react/use-effect-event.js');
    expect(compat.useEffectEvent).toBe(compat.useEffectEventFallback);
  });
});

describe('useEffectEventFallback()', () => {
  it('returns the same function identity on every render', () => {
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => useEffectEventFallback(() => n),
      { initialProps: { n: 1 } },
    );
    const first = result.current;

    rerender({ n: 2 });
    rerender({ n: 3 });

    expect(result.current).toBe(first);
  });

  it('always calls the latest callback, not the one from the first render', () => {
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => useEffectEventFallback((x: number) => x * n),
      { initialProps: { n: 2 } },
    );
    expect(result.current(10)).toBe(20);

    rerender({ n: 5 });
    expect(result.current(10)).toBe(50);
  });

  it('forwards every argument and returns the callback’s return value', () => {
    const callback = vi.fn((a: number, b: string) => `${b}:${String(a)}`);
    const { result } = renderHook(() => useEffectEventFallback(callback));

    expect(result.current(7, 'item')).toBe('item:7');
    expect(callback).toHaveBeenCalledWith(7, 'item');
  });

  it('has the latest callback in place by the time effects of the same commit run', () => {
    const seenInEffect: number[] = [];

    const { rerender } = renderHook(
      ({ n }: { n: number }) => {
        const read = useEffectEventFallback(() => n);
        React.useEffect(() => {
          seenInEffect.push(read());
        });
        return read;
      },
      { initialProps: { n: 1 } },
    );
    rerender({ n: 2 });

    expect(seenInEffect).toEqual([1, 2]);
  });
});
