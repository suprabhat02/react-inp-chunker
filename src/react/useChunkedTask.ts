import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { ChunkStatus } from '../core/chunk-machine.js';
import { createChunkScheduler } from '../core/chunk-scheduler.js';
import type {
  ChunkScheduler,
  ChunkSnapshot,
  SkippedChunkItem,
} from '../core/chunk-scheduler.js';
import { createTaskController } from './task-controller.js';
import { useEffectEvent } from './use-effect-event.js';

/** Stable empty array so a never-skipped task doesn't hand out a fresh `[]` every render. */
const NO_SKIPPED: readonly SkippedChunkItem[] = [];

export interface UseChunkedTaskOptions<T, R> {
  /** Max ms of uninterrupted work before yielding. Default 5. */
  readonly timeSliceMs?: number;
  /**
   * The longest the task may keep the page from painting, in ms. Default
   * 33, about 30 frames a second: once that long has passed since the last
   * frame, the next yield waits for one to render. `Infinity` turns it off
   * for the most throughput — in Chromium the page then paints only about
   * every 100 ms while the task runs, though input is still answered
   * promptly. Changing it sets up a new run, like `timeSliceMs`.
   */
  readonly paintIntervalMs?: number;
  /**
   * Items to process between clock checks. Default 1. Raise it only for
   * items measured in nanoseconds, where reading the clock costs more than
   * the work; a slice can then run up to `batchSize` items past its budget.
   * See the `batchSize` note on `createChunkScheduler`.
   */
  readonly batchSize?: number;
  /**
   * Keep every result in `results`. Default true. Set false when results
   * are consumed through `onItem`, to avoid retaining one result per item;
   * `results` is then an empty array once the task settles.
   */
  readonly collectResults?: boolean;
  /** Start processing automatically when the task is (re)created. Default `true`. */
  readonly autoStart?: boolean;
  /**
   * Called synchronously after each item is processed. This is the cheap
   * way to consume results incrementally while the task is still running —
   * write into a ref-backed buffer, a canvas, a chart, whatever you need —
   * without paying for an array copy on every yield checkpoint.
   */
  readonly onItem?: (result: R, item: T, index: number) => void;
  /**
   * Called when `processItem` throws. Return `'skip'` to drop that item and
   * keep going — it shows up in `skipped` — or `'abort'` to end the task as
   * an error, carrying whatever was collected before the throw. Omitting
   * this defaults to `'abort'`, so existing callers see no behavior change.
   */
  readonly onError?: (error: unknown, item: T, index: number) => 'skip' | 'abort';
  /**
   * Called every time a slice ends and the task is about to yield, with how
   * long that slice ran and how many items are done so far. Ships in the
   * production build, unlike this package's own dev-only diagnostics — wire
   * it to your own telemetry to verify, on real traffic, that this task is
   * actually staying under `timeSliceMs`.
   */
  readonly onSlice?: (durationMs: number, processed: number) => void;
  /** Called right after each yield resolves and work is about to resume. Pairs with `onSlice`. */
  readonly onYield?: () => void;
  /**
   * External cancellation source — aborting it is equivalent to calling
   * `cancel()`, and its `reason` comes through on `reason` below, so a
   * cancellation caused by the signal is distinguishable from a direct
   * `cancel()` call. A new reference restarts the task the same way a new
   * `items` array does, so memoize it (e.g. from a ref or a parent-owned
   * `AbortController`) unless you mean to restart on every render.
   */
  readonly signal?: AbortSignal;
}

/** Fields every status shares, independent of the `status`/`results`/`error` narrowing below. */
interface UseChunkedTaskShared {
  readonly processed: number;
  readonly total: number;
  /** Items `onError` has skipped so far, growing live as skips happen. Empty when unused. */
  readonly skipped: readonly SkippedChunkItem[];
  /**
   * The `signal` option's `reason`, present only when cancellation came
   * from that signal aborting rather than a direct `cancel()` call.
   */
  readonly reason: unknown;
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

/**
 * Discriminated on `status`. Narrowing to `'done'` or `'cancelled'` narrows
 * `results` to a defined array, no `=== undefined` check needed alongside
 * `isDone`; narrowing to `'error'` narrows `error` to defined instead. The
 * `is*` booleans above remain the simple way to branch when you only care
 * about one status and don't need the narrowing.
 */
export type UseChunkedTaskState<R> = UseChunkedTaskShared &
  (
    | {
        readonly status: Exclude<ChunkStatus, 'done' | 'cancelled' | 'error'>;
        readonly results: undefined;
        readonly error: undefined;
      }
    | {
        readonly status: 'done' | 'cancelled';
        readonly results: readonly R[];
        readonly error: undefined;
      }
    | {
        readonly status: 'error';
        readonly results: readonly R[];
        readonly error: unknown;
      }
  );

// Narrowed to the literal, not widened to `ChunkStatus`, so the object
// literal below satisfies the discriminated `ChunkSnapshot` union on its
// own merits — no assertion needed for a status this function knows for sure.
const IDLE_STATUS = 'idle';

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
 * changing identity (a new array reference), or any of the other scheduling
 * options — `timeSliceMs`, `paintIntervalMs`, `batchSize`, `collectResults`,
 * `autoStart`, `signal` — changing. That's deliberate: a new `items` array means new work, and
 * memoizing it when you don't want that is the caller's call to make, the
 * same as any other React dependency.
 */
export function useChunkedTask<T, R>(
  items: readonly T[],
  processItem: (item: T, index: number) => R,
  options?: UseChunkedTaskOptions<T, R>,
): UseChunkedTaskState<R> {
  const {
    timeSliceMs,
    paintIntervalMs,
    batchSize,
    collectResults,
    autoStart = true,
    onItem,
    onError,
    onSlice,
    onYield,
    signal,
  } = options ?? {};

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
  const stableOnError = useEffectEvent(
    (error: unknown, item: T, index: number): 'skip' | 'abort' =>
      onError?.(error, item, index) ?? 'abort',
  );
  const stableOnSlice = useEffectEvent((durationMs: number, processed: number) => {
    onSlice?.(durationMs, processed);
  });
  const stableOnYield = useEffectEvent(() => {
    onYield?.();
  });

  // Created once, lazily, via useState rather than a ref mutated during
  // render — the controller itself is inert (no subscriptions, no timers)
  // until an effect calls replace() on it, so a discarded render (double
  // render in dev, or one React throws away) never leaks anything.
  const [controller] = useState(() => createTaskController<ChunkScheduler<R>>());

  // What getSnapshot() reports before the effect below has ever run —
  // including during SSR, where effects never run at all.
  const idleSnapshot = useMemo<ChunkSnapshot<R>>(
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
      onError: stableOnError,
      onSlice: stableOnSlice,
      onYield: stableOnYield,
      ...(timeSliceMs !== undefined ? { timeSliceMs } : {}),
      ...(paintIntervalMs !== undefined ? { paintIntervalMs } : {}),
      ...(batchSize !== undefined ? { batchSize } : {}),
      ...(collectResults !== undefined ? { collectResults } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });
    controller.replace(scheduler);
    if (autoStart) scheduler.start();

    return () => {
      // Safe even if the task already finished on its own — cancel() on a
      // terminal scheduler is a documented no-op, not an error.
      scheduler.cancel();
      controller.replace(null);
    };
    // stableProcessItem/stableOnItem/stableOnError/stableOnSlice/stableOnYield
    // are Effect Events: stable by construction, intentionally excluded
    // from the reactive dependency set
    // (that's the whole point of useEffectEvent) rather than omitted by
    // oversight.
  }, [
    items,
    timeSliceMs,
    paintIntervalMs,
    batchSize,
    collectResults,
    autoStart,
    signal,
    controller,
  ]);

  const start = useCallback(() => controller.getCurrent()?.start(), [controller]);
  const pause = useCallback(() => controller.getCurrent()?.pause(), [controller]);
  const resume = useCallback(() => controller.getCurrent()?.resume(), [controller]);
  const cancel = useCallback(() => controller.getCurrent()?.cancel(), [controller]);

  // Built from `snapshot`'s own wide-`status` fields, so — same as the core
  // engine this wraps — it can't be checked structurally against the
  // discriminated union above; `snapshot` already carries that invariant.
  return {
    status: snapshot.status,
    processed: snapshot.processed,
    total: snapshot.total,
    error: snapshot.error,
    // From the snapshot, not a direct read of the scheduler: the engine
    // publishes results before it announces a terminal status, so the two
    // always arrive together and a concurrent render can never tear them
    // apart.
    results: snapshot.results,
    skipped: snapshot.skipped ?? NO_SKIPPED,
    reason: snapshot.reason,
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
  } as UseChunkedTaskState<R>;
}
