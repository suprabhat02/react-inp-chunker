import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import type { ChunkStatus } from '../core/chunk-machine.js';
import { createDeferredTask } from '../core/deferred-task.js';
import type {
  DeferredGenerator,
  DeferredTask,
  DeferredTaskSnapshot,
} from '../core/deferred-task.js';
import { createTaskController } from './task-controller.js';
import { useEffectEvent } from './use-effect-event.js';

export interface UseDeferredTaskOptions {
  /** Max ms of uninterrupted work before yielding. Default 5. */
  readonly timeSliceMs?: number;
  /**
   * Generator segments to run between clock checks. Default 1. Raise it
   * only for segments measured in nanoseconds; a slice can then run up to
   * `batchSize` segments past its budget.
   */
  readonly batchSize?: number;
  /** Start processing automatically when the task is (re)created. Default `true`. */
  readonly autoStart?: boolean;
  /**
   * Called every time a segment-batch ends and the task is about to yield,
   * with how long that slice ran and how many segments are done so far.
   * Ships in the production build — see the identical option on
   * `useChunkedTask`/`createChunkScheduler` for why.
   */
  readonly onSlice?: (durationMs: number, segmentsDone: number) => void;
  /** Called right after each yield resolves and work is about to resume. Pairs with `onSlice`. */
  readonly onYield?: () => void;
  /**
   * External cancellation source — aborting it is equivalent to calling
   * `cancel()`, and its `reason` comes through on `reason` below, so a
   * cancellation caused by the signal is distinguishable from a direct
   * `cancel()` call. A new reference restarts the task the same way a new
   * entry in `deps` does, so memoize it unless you mean to restart on
   * every render.
   */
  readonly signal?: AbortSignal;
}

/** Fields every status shares, independent of the `status`/`value`/`error` narrowing below. */
interface UseDeferredTaskShared {
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
 * Discriminated on `status`. Narrowing to `'done'` narrows `value` to `T`
 * itself — no `=== undefined` check needed alongside `isDone`, even when
 * `T` allows `undefined` as a genuine return value. Narrowing to `'error'`
 * narrows `error` to defined instead.
 */
export type UseDeferredTaskState<T> = UseDeferredTaskShared &
  (
    | {
        readonly status: Exclude<ChunkStatus, 'done' | 'error'>;
        readonly value: undefined;
        readonly error: undefined;
      }
    | { readonly status: 'done'; readonly value: T; readonly error: undefined }
    | { readonly status: 'error'; readonly value: undefined; readonly error: unknown }
  );

// Narrowed to the literal, not widened to `ChunkStatus`, so this satisfies
// the discriminated `DeferredTaskSnapshot` union on its own merits.
const IDLE_SNAPSHOT: DeferredTaskSnapshot<never> = { status: 'idle' };

/**
 * Runs an arbitrary heavy, synchronous generator function in chunks, so it
 * never produces a long task on its own. Where `useChunkedTask` chunks "one
 * function applied to every item of an array" automatically, this hook
 * leaves the chunk boundaries to you — put `yield` wherever your function
 * can safely pause (see `DeferredGenerator`'s doc comment for an example).
 *
 * `task` is only called when the effect (re)creates the underlying task, not
 * on every render — list whatever it closes over in `deps`, the same way
 * you would for `useMemo` or `useEffect`.
 */
export function useDeferredTask<T>(
  task: () => DeferredGenerator<T>,
  deps: readonly unknown[],
  options?: UseDeferredTaskOptions,
): UseDeferredTaskState<T> {
  const {
    timeSliceMs,
    batchSize,
    autoStart = true,
    onSlice,
    onYield,
    signal,
  } = options ?? {};

  // Stable identity, always runs the latest `task` passed this render —
  // see useChunkedTask.ts for why this is useEffectEvent rather than a ref
  // mutated during render.
  const stableTask = useEffectEvent(() => task());
  const stableOnSlice = useEffectEvent((durationMs: number, segmentsDone: number) => {
    onSlice?.(durationMs, segmentsDone);
  });
  const stableOnYield = useEffectEvent(() => {
    onYield?.();
  });

  const [controller] = useState(() => createTaskController<DeferredTask<T>>());

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot() ?? IDLE_SNAPSHOT,
    () => IDLE_SNAPSHOT,
  );

  useEffect(
    () => {
      const deferredTask = createDeferredTask<T>({
        task: stableTask,
        onSlice: stableOnSlice,
        onYield: stableOnYield,
        ...(timeSliceMs !== undefined ? { timeSliceMs } : {}),
        ...(batchSize !== undefined ? { batchSize } : {}),
        ...(signal !== undefined ? { signal } : {}),
      });
      controller.replace(deferredTask);
      if (autoStart) deferredTask.start();

      return () => {
        deferredTask.cancel();
        controller.replace(null);
      };
    },
    // `deps` plays the role `items` plays for useChunkedTask: it's the
    // caller's declaration of "this is new work". `stableTask` is an Effect
    // Event — stable by construction, intentionally excluded from the
    // reactive dependency set rather than omitted by oversight. `deps` is a
    // caller-supplied array, the same pattern (and the same reason it can't
    // be statically verified) as useMemo/useEffect's own deps parameter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, timeSliceMs, batchSize, autoStart, signal, controller],
  );

  const start = useCallback(() => controller.getCurrent()?.start(), [controller]);
  const pause = useCallback(() => controller.getCurrent()?.pause(), [controller]);
  const resume = useCallback(() => controller.getCurrent()?.resume(), [controller]);
  const cancel = useCallback(() => controller.getCurrent()?.cancel(), [controller]);

  // Built from `snapshot`'s own wide-`status` fields — see the identical
  // note in useChunkedTask.ts; `snapshot` already carries the invariant.
  return {
    status: snapshot.status,
    error: snapshot.error,
    // From the snapshot: the engine publishes the value before it
    // announces `done`, so a concurrent render can never see one without
    // the other. See useChunkedTask.ts.
    value: snapshot.value,
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
  } as UseDeferredTaskState<T>;
}
