import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from 'react';

import type { ChunkStatus } from '../core/chunk-machine.js';
import { createDeferredTask } from '../core/deferred-task.js';
import type {
  DeferredGenerator,
  DeferredTask,
  DeferredTaskSnapshot,
} from '../core/deferred-task.js';
import { createTaskController } from './task-controller.js';

export interface UseDeferredTaskOptions {
  /** Max ms of uninterrupted work before yielding. Default 5. */
  readonly timeSliceMs?: number;
  /** Start processing automatically when the task is (re)created. Default `true`. */
  readonly autoStart?: boolean;
}

export interface UseDeferredTaskState<T> {
  readonly status: ChunkStatus;
  readonly error: unknown;
  /** The returned value once the task settles with `done` — `undefined` until then. */
  readonly value: T | undefined;
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

const IDLE_SNAPSHOT: DeferredTaskSnapshot = { status: 'idle' };

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
  const { timeSliceMs, autoStart = true } = options ?? {};

  // Stable identity, always runs the latest `task` passed this render —
  // see useChunkedTask.ts for why this is useEffectEvent rather than a ref
  // mutated during render.
  const stableTask = useEffectEvent(() => task());

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
        ...(timeSliceMs !== undefined ? { timeSliceMs } : {}),
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
    [...deps, timeSliceMs, autoStart, controller],
  );

  const start = useCallback(() => controller.getCurrent()?.start(), [controller]);
  const pause = useCallback(() => controller.getCurrent()?.pause(), [controller]);
  const resume = useCallback(() => controller.getCurrent()?.resume(), [controller]);
  const cancel = useCallback(() => controller.getCurrent()?.cancel(), [controller]);

  // See useChunkedTask.ts for why reading this outside useSyncExternalStore
  // is safe: status and value are always settled in the same synchronous
  // turn, with no await between them.
  const value = controller.getCurrent()?.getValue();

  return {
    status: snapshot.status,
    error: snapshot.error,
    value,
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
