import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useChunkedTask } from '../../src/react/useChunkedTask.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('useChunkedTask() — autoStart (default)', () => {
  // `items` MUST be a stable reference across re-renders in every test
  // below: the hook restarts the task whenever the `items` identity
  // changes (that's its documented contract — see the "reactivity
  // contract" tests), so an inline array literal created fresh on every
  // render of the test's own render-callback would restart the task every
  // render, including the renders *caused by* that restart's own
  // notifications — an infinite loop that has nothing to do with the hook
  // itself. Hoisting the array out of the callback is what makes these
  // tests actually exercise "autoStart, run once" rather than that trap.
  it('processes every item and reaches isDone with the correct results', async () => {
    const items = [1, 2, 3, 4, 5];
    const { result } = renderHook(() => useChunkedTask(items, (x: number) => x * 2));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.results).toEqual([2, 4, 6, 8, 10]);
    expect(result.current.processed).toBe(5);
    expect(result.current.total).toBe(5);
    expect(result.current.isError).toBe(false);
  });

  it('starts in isProcessing (or already isDone, for trivial work) without the caller calling start()', () => {
    const items = [1, 2, 3];
    const { result } = renderHook(() => useChunkedTask(items, (x: number) => x));
    expect(result.current.isIdle).toBe(false);
    expect(result.current.isProcessing || result.current.isDone).toBe(true);
  });

  it('calls onItem incrementally as each item completes', async () => {
    const items = [1, 2, 3];
    const onItem = vi.fn();
    const { result } = renderHook(() =>
      useChunkedTask(items, (x: number) => x + 1, { onItem }),
    );

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(onItem).toHaveBeenCalledTimes(3);
    expect(onItem).toHaveBeenNthCalledWith(1, 2, 1, 0);
    expect(onItem).toHaveBeenNthCalledWith(3, 4, 3, 2);
  });

  it('surfaces a thrown processItem error as isError with the error exposed', async () => {
    const items = [1, 2, 3];
    const { result } = renderHook(() =>
      useChunkedTask(items, (x: number) => {
        if (x === 2) throw new Error('boom');
        return x;
      }),
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect((result.current.error as Error).message).toBe('boom');
  });
});

describe('useChunkedTask() — autoStart: false', () => {
  it('stays idle until start() is called explicitly', async () => {
    const items = [1, 2, 3];
    const processItem = vi.fn((x: number) => x);
    const { result } = renderHook(() =>
      useChunkedTask(items, processItem, { autoStart: false }),
    );

    expect(result.current.isIdle).toBe(true);
    expect(processItem).not.toHaveBeenCalled();

    act(() => {
      result.current.start();
    });

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.results).toEqual([1, 2, 3]);
  });
});

describe('useChunkedTask() — pause / resume / cancel via the hook', () => {
  it('pause() stops progress and resume() continues it', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const processed: number[] = [];
    const { result } = renderHook(() =>
      useChunkedTask(items, (x: number) => x, {
        timeSliceMs: 0.0001,
        onItem: (r: number) => processed.push(r),
      }),
    );

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
      expect(processed.length).toBeGreaterThan(0);
    });

    act(() => {
      result.current.pause();
    });
    await waitFor(() => {
      expect(result.current.isPaused).toBe(true);
    });
    const countAtPause = processed.length;
    await act(async () => {
      await sleep(20);
    });
    expect(processed.length).toBe(countAtPause);

    act(() => {
      result.current.resume();
    });
    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.results).toEqual(items);
  });

  it('cancel() mid-processing settles as isCancelled', async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() =>
      useChunkedTask(items, (x: number) => x, { timeSliceMs: 0.0001 }),
    );

    await waitFor(() => {
      expect(result.current.processed).toBeGreaterThan(0);
    });

    act(() => {
      result.current.cancel();
    });

    await waitFor(() => {
      expect(result.current.isCancelled).toBe(true);
    });
  });
});

describe('useChunkedTask() — reactivity contract', () => {
  it('a new `items` array reference restarts the task with the latest processItem', async () => {
    const { result, rerender } = renderHook(
      ({ items, multiplier }: { items: number[]; multiplier: number }) =>
        useChunkedTask(items, (x: number) => x * multiplier),
      { initialProps: { items: [1, 2, 3], multiplier: 10 } },
    );

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.results).toEqual([10, 20, 30]);

    rerender({ items: [1, 2, 3], multiplier: 100 });

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.results).toEqual([100, 200, 300]);
  });

  it('does NOT restart the task when only processItem/onItem identity changes, items staying the same', async () => {
    const items = [1, 2, 3];
    const { result, rerender } = renderHook(
      ({ multiplier }: { multiplier: number }) =>
        useChunkedTask(items, (x: number) => x * multiplier),
      { initialProps: { multiplier: 10 } },
    );

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.results).toEqual([10, 20, 30]);

    // Same `items` reference, brand-new processItem closure (multiplier
    // changed) — the effect's deps are [items, timeSliceMs, autoStart,
    // controller], so this must NOT recreate/rerun the scheduler.
    rerender({ multiplier: 999 });

    await act(async () => {
      await sleep(10);
    });

    expect(result.current.results).toEqual([10, 20, 30]);
    expect(result.current.isDone).toBe(true);
  });

  it('always calls the latest onItem closure for items processed after a rerender, without restarting', async () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const seenByFirst: number[] = [];
    const seenBySecond: number[] = [];

    const { result, rerender } = renderHook(
      ({ onItem }: { onItem: (x: number) => void }) =>
        useChunkedTask(items, (x: number) => x, { timeSliceMs: 0.0001, onItem }),
      { initialProps: { onItem: (x: number) => seenByFirst.push(x) } },
    );

    await waitFor(() => {
      expect(seenByFirst.length).toBeGreaterThan(0);
    });
    expect(result.current.isProcessing).toBe(true);

    rerender({ onItem: (x: number) => seenBySecond.push(x) });

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    // The task was never restarted (one continuous run over 30 items), but
    // everything processed after the rerender should have gone to the
    // *new* onItem closure.
    expect(seenByFirst.length + seenBySecond.length).toBe(items.length);
    expect(seenBySecond.length).toBeGreaterThan(0);
  });

  it('timeSliceMs changing restarts the task even with the same items array', async () => {
    const items = [1, 2, 3];
    const { result, rerender } = renderHook(
      ({ timeSliceMs }: { timeSliceMs: number }) =>
        useChunkedTask(items, (x: number) => x, { timeSliceMs }),
      { initialProps: { timeSliceMs: 5 } },
    );
    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    rerender({ timeSliceMs: 10 });
    // A fresh scheduler instance was created; it should still converge to
    // the same correct result for the same items.
    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.results).toEqual([1, 2, 3]);
  });
});

describe('useChunkedTask() — unmount', () => {
  it('cancels the in-flight task on unmount and stops making further progress', async () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const processItem = vi.fn((x: number) => x);
    const { result, unmount } = renderHook(() =>
      useChunkedTask(items, processItem, { timeSliceMs: 0.0001 }),
    );

    await waitFor(() => {
      expect(result.current.processed).toBeGreaterThan(0);
    });
    expect(result.current.isDone).toBe(false);

    unmount();
    const callsAtUnmount = processItem.mock.calls.length;

    await sleep(30);
    expect(processItem.mock.calls.length).toBe(callsAtUnmount);
  });
});
