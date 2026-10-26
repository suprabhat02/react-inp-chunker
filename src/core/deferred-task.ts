import {
  type ChunkEvent,
  type ChunkMachineState,
  type ChunkStatus,
  initialChunkState,
  isTerminal,
  transition,
} from './chunk-machine.js';
import {
  DEFAULT_TIME_SLICE_MS,
  type YieldStrategy,
  now,
  shouldYieldNow,
  yieldToMain,
} from './scheduler.js';

/**
 * A generator is how you tell `createDeferredTask` where it's safe to yield
 * — arbitrary heavy work (a multi-phase algorithm, a big canvas render)
 * doesn't have a natural "array of items" shape the way `createChunkScheduler`
 * expects, so instead you mark checkpoints yourself:
 *
 * ```ts
 * function* renderFrames(frameCount: number) {
 *   for (let i = 0; i < frameCount; i++) {
 *     renderOneExpensiveFrame(i);
 *     yield; // "it's safe to pause here if we're over budget"
 *   }
 *   return frameCount;
 * }
 * ```
 *
 * Everything between two `yield`s runs as one uninterruptible synchronous
 * segment — put them wherever your function can safely stop, the same way
 * you'd think about chunk boundaries by hand, just without writing the
 * scheduling code yourself.
 */
export type DeferredGenerator<T> = Generator<void, T, void>;

export interface DeferredTaskOptions<T> {
  readonly task: () => DeferredGenerator<T>;
  /** Max ms of uninterrupted work before yielding. Default 5. */
  readonly timeSliceMs?: number;
  readonly signal?: AbortSignal;
  /** Testing-only: forces a specific yield strategy instead of auto-detecting one. */
  readonly yieldStrategy?: YieldStrategy;
}

export interface DeferredTaskResult<T> {
  readonly status: 'done' | 'cancelled' | 'error';
  readonly value?: T;
  readonly error?: unknown;
}

export interface DeferredTaskSnapshot {
  readonly status: ChunkStatus;
  readonly error?: unknown;
}

export interface DeferredTask<T> {
  start(): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  getSnapshot(): DeferredTaskSnapshot;
  /** The returned value once the task has settled with `done` — `undefined` otherwise. */
  getValue(): T | undefined;
  subscribe(listener: () => void): () => void;
  readonly settled: Promise<DeferredTaskResult<T>>;
}

function normalizeTimeSliceMs(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    return DEFAULT_TIME_SLICE_MS;
  }
  return value;
}

/**
 * The generator-driven sibling of `createChunkScheduler`, for heavy work
 * that isn't shaped like "one function applied to each item of an array".
 * Same state machine, same yield primitives, same one-shot-instance
 * contract — see that file's doc comment for the reasoning, which applies
 * here unchanged.
 */
export function createDeferredTask<T>(options: DeferredTaskOptions<T>): DeferredTask<T> {
  const { task, signal, yieldStrategy } = options;
  const timeSliceMs = normalizeTimeSliceMs(options.timeSliceMs);

  let machineState: ChunkMachineState = initialChunkState;
  let loopStarted = false;
  let settledFlag = false;
  let value: T | undefined;

  // Cached, and only rebuilt on an actual transition (see refreshSnapshot())
  // — not recomputed on every getSnapshot() call. useSyncExternalStore
  // requires repeated calls between notifications to return the *same*
  // reference; a fresh object literal on every call (as this used to be)
  // reads as "changed every render" and sends React into an infinite
  // re-render loop. Mirrors chunk-scheduler.ts's `snapshot` exactly.
  let snapshot: DeferredTaskSnapshot = { status: machineState.status };

  const listeners = new Set<() => void>();

  let settleFn!: (result: DeferredTaskResult<T>) => void;
  const settledPromise = new Promise<DeferredTaskResult<T>>((resolve) => {
    settleFn = resolve;
  });

  let pauseResolve: (() => void) | undefined;
  let pausePromise: Promise<void> | undefined;

  function waitForWake(): Promise<void> {
    pausePromise ??= new Promise((resolve) => {
      pauseResolve = resolve;
    });
    return pausePromise;
  }

  function openGate(): void {
    pauseResolve?.();
    pauseResolve = undefined;
    pausePromise = undefined;
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function refreshSnapshot(): void {
    snapshot = {
      status: machineState.status,
      ...(machineState.error !== undefined ? { error: machineState.error } : {}),
    };
  }

  function dispatch(event: ChunkEvent): { changed: boolean } {
    const next = transition(machineState, event);
    const changed = next !== machineState;
    if (changed) {
      machineState = next;
      refreshSnapshot();
      notify();
    }
    return { changed };
  }

  function settle(result: DeferredTaskResult<T>): void {
    // Structurally unreachable, not merely untested — see the identical
    // guard in chunk-scheduler.ts's settle() for the full invariant: the
    // only caller, finish(), is reached from exactly one of two mutually
    // exclusive, `loopStarted`-gated paths per instance, so there is never
    // a second call left to make once this instance has settled once.
    // Kept as defense-in-depth against a future refactor breaking that.
    /* v8 ignore next */
    if (settledFlag) return;
    settledFlag = true;
    detachSignal();
    settleFn(result);
  }

  function finish(
    status: 'done' | 'cancelled' | 'error',
    resolvedValue?: T,
    error?: unknown,
  ): void {
    if (status === 'done') {
      value = resolvedValue;
      settle({
        status,
        ...(resolvedValue !== undefined ? { value: resolvedValue } : {}),
      });
      return;
    }
    settle(status === 'error' ? { status, error } : { status });
  }

  function settleIfNeverStarted(): void {
    const { status, error } = machineState;
    if (loopStarted || !isTerminal(status)) return;
    loopStarted = true;
    // See the identical comment in chunk-scheduler.ts's settleIfNeverStarted():
    // both 'done' and 'error' are unreachable here, since reaching either
    // requires the loop to have run, which requires `loopStarted` already
    // true — which would have short-circuited this function above. Only
    // 'cancelled' is ever actually observed; 'error' is kept as the real,
    // narrowed type rather than assumed away, as untestable defense-in-depth.
    /* v8 ignore next */
    if (status === 'error') finish('error', undefined, error);
    else finish(status);
  }

  function handleAbort(): void {
    cancel();
  }

  function detachSignal(): void {
    signal?.removeEventListener('abort', handleAbort);
  }

  if (signal?.aborted) {
    dispatch({ type: 'CANCEL' });
  } else {
    signal?.addEventListener('abort', handleAbort);
  }

  async function runLoop(): Promise<void> {
    let sliceStartedAt = now();
    const generator = task();

    // `step` always holds the result of the *last* generator.next() call —
    // including, on an early break below, a stale not-done step from before
    // that break, which the post-loop checks account for explicitly.
    let step: IteratorResult<void, T> = { done: false, value: undefined };
    try {
      for (;;) {
        // Captured once per iteration and compared via this local, not via
        // repeated `machineState.status` property reads — narrowing a
        // direct property access to a literal here would otherwise survive
        // (in TS's eyes) across the `await` below, even though the whole
        // point of that await is that `machineState` can change out from
        // under us while it's pending.
        const status: ChunkStatus = machineState.status;
        if (status === 'cancelled') {
          generator.return(undefined as unknown as T);
          break;
        }

        if (status === 'paused') {
          await waitForWake();
          sliceStartedAt = now();
          // Don't fall through to generator.next() just because the gate
          // opened — re-enter the loop and read machineState.status fresh.
          // A resume() can be undone by a *reentrant* pause() triggered
          // synchronously from a subscriber's own notification (resume()
          // dispatches, notify() runs listeners synchronously, a listener
          // calls pause() before resume() returns) — so waking from one
          // gate is not proof we're actually clear to proceed. Looping
          // back here is what lets the top-of-loop checks see that and
          // either re-block on a fresh gate (status is paused again) or
          // notice cancellation, instead of blindly running one more
          // generator step first.
          continue;
        }

        // The cancellation check above MUST run before this call, not
        // after: calling the generator is where its actual (synchronous)
        // work for this segment happens. An earlier draft called
        // generator.next() at the *bottom* of the loop, right after the
        // yieldToMain() await below — so a cancel() landing during that
        // await would still let one more segment's worth of work run
        // before the next loop iteration finally noticed. Checking first,
        // every time, closes that race: nothing the generator does can run
        // once cancellation has been observed.
        step = generator.next();
        if (step.done) break;

        if (shouldYieldNow({ sliceStartedAt, timeSliceMs })) {
          await yieldToMain(
            yieldStrategy !== undefined ? { strategy: yieldStrategy } : undefined,
          );
          notify();
          sliceStartedAt = now();
        }
      }
    } catch (error) {
      dispatch({ type: 'ERROR', error });
      finish('error', undefined, error);
      return;
    }

    if (machineState.status === 'cancelled') {
      finish('cancelled');
      return;
    }

    dispatch({ type: 'COMPLETE' });
    // step.done is always true by the time we get here: the only ways out
    // of the loop above are the top-of-loop 'cancelled' break (handled by
    // the early return just above, before this line) and `if (step.done)
    // break;` — so the ": undefined" side of this ternary can't actually
    // run. It stays only because it's what makes TypeScript narrow
    // step.value's type correctly (see the top of this function's history
    // for the exact inference issue); the real type is kept rather than
    // cast away.
    /* v8 ignore next */
    finish('done', step.done ? step.value : undefined);
  }

  function start(): void {
    dispatch({ type: 'START' });
    if (machineState.status === 'processing' && !loopStarted) {
      loopStarted = true;
      void runLoop();
    }
    settleIfNeverStarted();
  }

  function pause(): void {
    dispatch({ type: 'PAUSE' });
  }

  function resume(): void {
    const { changed } = dispatch({ type: 'RESUME' });
    if (changed) openGate();
  }

  function cancel(): void {
    dispatch({ type: 'CANCEL' });
    openGate();
    settleIfNeverStarted();
  }

  return {
    start,
    pause,
    resume,
    cancel,
    getSnapshot: () => snapshot,
    getValue: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    settled: settledPromise,
  };
}
