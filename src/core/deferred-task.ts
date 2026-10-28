import {
  type ChunkEvent,
  type ChunkMachineState,
  type ChunkStatus,
  initialChunkState,
  isTerminal,
  transition,
} from './chunk-machine.js';
import { createDiagnostics, isDevelopment } from './diagnostics.js';
import {
  type YieldStrategy,
  normalizeBatchSize,
  normalizeTimeSliceMs,
  now,
  resolveInputPending,
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
  /**
   * Segments (the code between two `yield`s) to run between clock checks.
   * Default 1, which bounds a slice at one segment.
   *
   * Reading the clock costs around 300ns in a browser, so a generator that
   * yields after a few nanoseconds of work spends most of its time asking
   * the time. Raising this amortizes that — at the cost of checking the
   * clock, pause and cancel only at batch boundaries, so a slice can run up
   * to `batchSize` segments past its budget.
   */
  readonly batchSize?: number;
  readonly signal?: AbortSignal;
  /** Testing-only: forces a specific yield strategy instead of auto-detecting one. */
  readonly yieldStrategy?: YieldStrategy;
}

export interface DeferredTaskResult<T> {
  readonly status: 'done' | 'cancelled' | 'error';
  readonly value?: T;
  readonly error?: unknown;
}

export interface DeferredTaskSnapshot<T = unknown> {
  readonly status: ChunkStatus;
  readonly error?: unknown;
  /**
   * Present only once the task has settled with `done`, and always in the
   * same snapshot that first reports it — so a reader can never observe
   * `status: 'done'` without the value that goes with it.
   */
  readonly value?: T;
}

export interface DeferredTask<T> {
  start(): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  getSnapshot(): DeferredTaskSnapshot<T>;
  /** The returned value once the task has settled with `done` — `undefined` otherwise. */
  getValue(): T | undefined;
  subscribe(listener: () => void): () => void;
  readonly settled: Promise<DeferredTaskResult<T>>;
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
  const batchSize = normalizeBatchSize(options.batchSize);
  // Resolved once per task rather than per segment; see chunk-scheduler.ts.
  const inputPending = resolveInputPending();
  const diagnostics = createDiagnostics('segment', batchSize);

  let machineState: ChunkMachineState = initialChunkState;
  let loopStarted = false;
  let settledFlag = false;
  let settledValue: T | undefined;

  // Built on demand, and only when something has actually changed.
  // useSyncExternalStore requires repeated calls between notifications to
  // return the *same* reference; a fresh object literal on every call (as
  // this used to be) reads as "changed every render" and sends React into
  // an infinite re-render loop. Mirrors chunk-scheduler.ts exactly.
  let snapshot: DeferredTaskSnapshot<T> = { status: machineState.status };
  let snapshotStale = false;

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

  function getSnapshot(): DeferredTaskSnapshot<T> {
    if (snapshotStale) {
      snapshotStale = false;
      snapshot = {
        status: machineState.status,
        ...(machineState.error !== undefined ? { error: machineState.error } : {}),
        ...(settledValue !== undefined ? { value: settledValue } : {}),
      };
    }
    return snapshot;
  }

  function dispatch(event: ChunkEvent): { changed: boolean } {
    const next = transition(machineState, event);
    const changed = next !== machineState;
    if (changed) {
      machineState = next;
      snapshotStale = true;
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

  /**
   * Publishes the returned value before the terminal status is announced,
   * so the notification that reports `done` already carries it.
   */
  function publishValue(resolvedValue: T | undefined): void {
    settledValue = resolvedValue;
    snapshotStale = true;
  }

  function settleWith(
    status: 'done' | 'cancelled' | 'error',
    resolvedValue?: T,
    error?: unknown,
  ): void {
    if (status === 'done') {
      settle({
        status,
        ...(resolvedValue !== undefined ? { value: resolvedValue } : {}),
      });
      return;
    }
    settle(status === 'error' ? { status, error } : { status });
  }

  /**
   * Settling as cancelled, for both places that can do it. The CANCEL
   * transition was announced earlier, so this notifies again now that the
   * task has actually settled.
   */
  function finishCancelled(): void {
    settleWith('cancelled');
    notify();
  }

  function settleIfNeverStarted(): void {
    const { status } = machineState;
    if (loopStarted || !isTerminal(status)) return;
    loopStarted = true;
    // 'cancelled' is the only status reachable here: 'done' and 'error'
    // both require the loop to have run, and that sets `loopStarted`,
    // which short-circuits this function above.
    finishCancelled();
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
    let segment = 0;
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
          if (isDevelopment) diagnostics.resumed(sliceStartedAt, segment);
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
        // One batch of segments between clock checks. At the default
        // batchSize of 1 this runs exactly one segment, then checks.
        let done = false;
        for (let inBatch = 0; inBatch < batchSize; inBatch++) {
          step = generator.next();
          segment += 1;
          if (step.done) {
            done = true;
            break;
          }
        }
        if (done) break;

        // One clock read per batch, shared by the budget check and the
        // development diagnostics, which compile away in production.
        const checkedAt = now();
        if (isDevelopment) diagnostics.check(checkedAt, segment);

        if (checkedAt - sliceStartedAt >= timeSliceMs || inputPending()) {
          if (isDevelopment) diagnostics.sliceEnded(checkedAt, segment);
          await yieldToMain(
            yieldStrategy !== undefined ? { strategy: yieldStrategy } : undefined,
          );
          notify();
          sliceStartedAt = now();
          if (isDevelopment) diagnostics.resumed(sliceStartedAt, segment);
        }
      }
    } catch (error) {
      dispatch({ type: 'ERROR', error });
      settleWith('error', undefined, error);
      return;
    }

    if (machineState.status === 'cancelled') {
      finishCancelled();
      return;
    }

    // step.done is always true by the time we get here: the only ways out
    // of the loop above are the top-of-loop 'cancelled' break (handled by
    // the early return just above, before this line) and the batch loop's
    // own `done` break — so the ": undefined" side of this ternary can't
    // actually run. It stays only because it's what makes TypeScript
    // narrow step.value's type correctly; the real type is kept rather
    // than cast away.
    /* v8 ignore next */
    const returned = step.done ? step.value : undefined;
    publishValue(returned);
    dispatch({ type: 'COMPLETE' });
    settleWith('done', returned);
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
    getSnapshot,
    getValue: () => settledValue,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    settled: settledPromise,
  };
}
