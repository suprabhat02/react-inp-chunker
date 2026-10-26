import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import type { ChunkStatus } from '../core/chunk-machine.js';
import { createChunkScheduler } from '../core/chunk-scheduler.js';
import type { ChunkScheduler, ChunkSnapshot } from '../core/chunk-scheduler.js';
import { createTaskController } from './task-controller.js';

export interface UseChunkedTaskOptions<T, R> {
  /** Max ms of uninterrupted work before yielding. Default 5. */
  readonly timeSliceMs?: number;
  /** Start processing automatically when the task is (re)created. Default `true`. */
  readonly autoStart?: boolean;
  /**
   * Called synchronously after each item is processed. This is the cheap
   * way to consume results incrementally while the task is still running —
   * write into a ref-backed buffer, a canvas, a chart, whatever you need —
   * without paying for an array copy on every yield checkpoint.
   */
  readonly onItem?: (result: R, item: T, index: number) => void;
}

export interface UseChunkedTaskState<R> {
  readonly status: ChunkStatus;
  readonly processed: number;
  readonly total: number;
  readonly error: unknown;
  /** The full results array once the task has settled — `undefined` until then. */
  readonly results: readonly R[] | undefined;
  readonly isIdle: boolean;
  readonly isProcessing: boolean;
  readonly isPaused: boolean;
  readonly isDone: boolean;
  readonly isCancelled: boolean;
  readonly isError: boolean;
  readonly start: () => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly cancel: () => void;
}

const IDLE_STATUS: ChunkStatus = 'idle';

/**
 * Chunks a heavy, synchronous per-item computation over `items` so it never
 * blocks the main thread for longer than a time slice — the thing that
 * costs you Interaction to Next Paint. Starts automatically by default;
 * pass `{ autoStart: false }` to wait for an explicit `start()` call (e.g.
 * behind a button).
 *
 * `processItem` and `onItem` can be fresh closures every render — the hook
 * always calls the latest version (via `useEffectEvent`) without that
 * causing the task to restart. What *does* restart the task is `items`
 * changing identity (a new array reference), or `timeSliceMs`/`autoStart`
 * changing. That's deliberate: a new `items` array means new work, and
 * memoizing it when you don't want that is the caller's call to make, the
 * same as any other React dependency.
 */
export function useChunkedTask<T, R>(
  items: readonly T[],
  processItem: (item: T, index: number) => R,
  options?: UseChunkedTaskOptions<T, R>,
): UseChunkedTaskState<R> {
  const { timeSliceMs, autoStart = true, onItem } = options ?? {};

  // Stable identity, always runs the latest processItem/onItem passed this
  // render — the React-Compiler-safe replacement for a ref mutated during
  // render. Effect Events are meant to be called from inside an effect
  // (here: from the scheduler's async loop, which the effect below owns),
  // never during render itself.
  const stableProcessItem = useEffectEvent((item: T, index: number) =>
    processItem(item, index),
  );
  const stableOnItem = useEffectEvent((result: R, item: T, index: number) => {
    onItem?.(result, item, index);
  });

  // Created once, lazily, via useState rather than a ref mutated during
  // render — the controller itself is inert (no subscriptions, no timers)
  // until an effect calls replace() on it, so a discarded render (double
  // render in dev, or one React throws away) never leaks anything.
  const [controller] = useState(() => createTaskController<ChunkScheduler<R>>());

  // What getSnapshot() reports before the effect below has ever run —
  // including during SSR, where effects never run at all.
  const idleSnapshot = useMemo<ChunkSnapshot>(
    () => ({ status: IDLE_STATUS, processed: 0, total: items.length }),
    [items.length],
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot() ?? idleSnapshot,
    () => idleSnapshot,
  );

  useEffect(() => {
    const scheduler = createChunkScheduler<T, R>({
      items,
      processItem: stableProcessItem,
      onItem: stableOnItem,
      ...(timeSliceMs !== undefined ? { timeSliceMs } : {}),
    });
    controller.replace(scheduler);
    if (autoStart) scheduler.start();

    return () => {
      // Safe even if the task already finished on its own — cancel() on a
      // terminal scheduler is a documented no-op, not an error.
      scheduler.cancel();
      controller.replace(null);
    };
    // stableProcessItem/stableOnItem are Effect Events: stable by
    // construction, intentionally excluded from the reactive dependency set
    // (that's the whole point of useEffectEvent) rather than omitted by
    // oversight.
  }, [items, timeSliceMs, autoStart, controller]);

  const start = useCallback(() => controller.getCurrent()?.start(), [controller]);
  const pause = useCallback(() => controller.getCurrent()?.pause(), [controller]);
  const resume = useCallback(() => controller.getCurrent()?.resume(), [controller]);
  const cancel = useCallback(() => controller.getCurrent()?.cancel(), [controller]);

  // Safe to read outside useSyncExternalStore's own getSnapshot: a
  // scheduler only ever finishes synchronously (dispatch-then-finish, no
  // await between them — see chunk-scheduler.ts), so by the time React
  // re-renders in response to the status-change notification, getResults()
  // already agrees with that status. They can never be observed out of sync.
  const results = controller.getCurrent()?.getResults();

  return {
    status: snapshot.status,
    processed: snapshot.processed,
    total: snapshot.total,
    error: snapshot.error,
    results,
    isIdle: snapshot.status === 'idle',
    isProcessing: snapshot.status === 'processing',
    isPaused: snapshot.status === 'paused',
    isDone: snapshot.status === 'done',
    isCancelled: snapshot.status === 'cancelled',
    isError: snapshot.status === 'error',
    start,
    pause,
    resume,
    cancel,
  };
}
