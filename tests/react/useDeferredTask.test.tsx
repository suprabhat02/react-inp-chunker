import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DeferredGenerator } from '../../src/core/deferred-task.js';
import { useDeferredTask } from '../../src/react/useDeferredTask.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function* countingTask(n: number, progress: number[]): DeferredGenerator<number> {
  for (let i = 0; i < n; i++) {
    progress.push(i);
    yield;
  }
  return n;
}

describe('useDeferredTask() — autoStart (default)', () => {
  // As with useChunkedTask, `deps` must be a stable array reference across
  // re-renders in these tests: the hook treats `deps` exactly like
  // useEffect's own deps array, so an inline `[]` literal created fresh
  // every render would still be a *new* array each time by identity —
  // which is actually fine for `[]` (zero-length, nothing to compare
  // positionally changes "equal" under React's own Object.is-per-slot
  // check)... but any non-empty deps array of changing values needs care,
  // so every test below hoists its deps for clarity and consistency.
  it('drives the generator to completion and exposes the returned value', async () => {
    const progress: number[] = [];
    const { result } = renderHook(() =>
      useDeferredTask(() => countingTask(5, progress), []),
    );

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.value).toBe(5);
    expect(progress).toEqual([0, 1, 2, 3, 4]);
    expect(result.current.isError).toBe(false);
  });

  it('starts in isProcessing (or already isDone, for trivial work) without the caller calling start()', () => {
    const { result } = renderHook(() => useDeferredTask(() => countingTask(3, []), []));
    expect(result.current.isIdle).toBe(false);
    expect(result.current.isProcessing || result.current.isDone).toBe(true);
  });

  it('surfaces a thrown generator error as isError with the error exposed', async () => {
    function* throwing(): DeferredGenerator<number> {
      yield;
      throw new Error('boom');
    }
    const { result } = renderHook(() => useDeferredTask(throwing, []));

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect((result.current.error as Error).message).toBe('boom');
    expect(result.current.value).toBeUndefined();
  });
});

describe('useDeferredTask() — autoStart: false', () => {
  it('stays idle until start() is called explicitly', async () => {
    const task = vi.fn(() => countingTask(3, []));
    const { result } = renderHook(() => useDeferredTask(task, [], { autoStart: false }));

    expect(result.current.isIdle).toBe(true);
    expect(task).not.toHaveBeenCalled();

    act(() => {
      result.current.start();
    });

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.value).toBe(3);
  });
});

describe('useDeferredTask() — pause / resume / cancel via the hook', () => {
  it('pause() stops progress and resume() continues it', async () => {
    const progress: number[] = [];
    const { result } = renderHook(() =>
      useDeferredTask(() => countingTask(50, progress), [], { timeSliceMs: 0.0001 }),
    );

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
      expect(progress.length).toBeGreaterThan(0);
    });

    act(() => {
      result.current.pause();
    });
    await waitFor(() => {
      expect(result.current.isPaused).toBe(true);
    });
    const countAtPause = progress.length;
    await act(async () => {
      await sleep(20);
    });
    expect(progress.length).toBe(countAtPause);

    act(() => {
      result.current.resume();
    });
    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.value).toBe(50);
  });

  it('cancel() mid-processing settles as isCancelled with no value', async () => {
    const progress: number[] = [];
    const { result } = renderHook(() =>
      useDeferredTask(() => countingTask(100, progress), [], { timeSliceMs: 0.0001 }),
    );

    await waitFor(() => {
      expect(progress.length).toBeGreaterThan(0);
    });

    act(() => {
      result.current.cancel();
    });

    await waitFor(() => {
      expect(result.current.isCancelled).toBe(true);
    });
    expect(result.current.value).toBeUndefined();
  });
});

describe('useDeferredTask() — reactivity contract', () => {
  it('a changed dep restarts the task, re-invoking the task factory with the latest closure', async () => {
    const { result, rerender } = renderHook(
      ({ multiplier }: { multiplier: number }) =>
        useDeferredTask(
          // eslint-disable-next-line require-yield -- intentionally trivial: this test is about dep-driven restarts, not chunking.
          function* (): DeferredGenerator<number> {
            return 7 * multiplier;
          },
          [multiplier],
        ),
      { initialProps: { multiplier: 1 } },
    );

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.value).toBe(7);

    rerender({ multiplier: 10 });

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.value).toBe(70);
  });

  it('does NOT restart the task when the task closure identity changes but deps does not', async () => {
    const deps: readonly unknown[] = [];
    const { result, rerender } = renderHook(
      ({ multiplier }: { multiplier: number }) =>
        useDeferredTask(
          // eslint-disable-next-line require-yield -- intentionally trivial: this test is about dep-driven restarts, not chunking.
          function* (): DeferredGenerator<number> {
            return 7 * multiplier;
          },
          deps,
        ),
      { initialProps: { multiplier: 1 } },
    );

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });
    expect(result.current.value).toBe(7);

    // deps is unchanged (still []), but the closure itself captures a new
    // multiplier — must NOT cause a restart, since deps says "same work".
    rerender({ multiplier: 999 });

    await act(async () => {
      await sleep(10);
    });

    expect(result.current.value).toBe(7);
    expect(result.current.isDone).toBe(true);
  });
});

describe('useDeferredTask() — unmount', () => {
  it('cancels the in-flight task on unmount and stops making further progress', async () => {
    const progress: number[] = [];
    const { result, unmount } = renderHook(() =>
      useDeferredTask(() => countingTask(200, progress), [], { timeSliceMs: 0.0001 }),
    );

    await waitFor(() => {
      expect(progress.length).toBeGreaterThan(0);
    });
    expect(result.current.isDone).toBe(false);

    unmount();
    const countAtUnmount = progress.length;

    await sleep(30);
    expect(progress.length).toBe(countAtUnmount);
  });
});
