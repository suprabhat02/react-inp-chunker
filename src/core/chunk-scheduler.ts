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

export interface ChunkSchedulerOptions<T, R> {
  readonly items: readonly T[];
  readonly processItem: (item: T, index: number) => R;
  /** Max ms of uninterrupted work before yielding. Default 5. */
  readonly timeSliceMs?: number;
  /** Called after each item is successfully processed. */
  readonly onItem?: (result: R, item: T, index: number) => void;
  /** External cancellation source — aborting it is equivalent to calling cancel(). */
  readonly signal?: AbortSignal;
  /** Testing-only: forces a specific yield strategy instead of auto-detecting one. */
  readonly yieldStrategy?: YieldStrategy;
}

export interface ChunkSchedulerResult<R> {
  readonly status: 'done' | 'cancelled' | 'error';
  readonly results: readonly R[];
  readonly error?: unknown;
}

export interface ChunkSnapshot {
  readonly status: ChunkStatus;
  readonly processed: number;
  readonly total: number;
  readonly error?: unknown;
}

export interface ChunkScheduler<R> {
  start(): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  getSnapshot(): ChunkSnapshot;
  /**
   * The accumulated results, but only once the task has reached a terminal
   * state — `undefined` while idle/processing/paused. Computed once, cheaply,
   * at the moment of that transition; never recomputed on every item, so
   * reading it (e.g. every time the snapshot changes) never costs an O(n)
   * array copy per item for a large task. For incremental consumption while
   * the task is still running, use the `onItem` option instead.
   */
  getResults(): readonly R[] | undefined;
  subscribe(listener: () => void): () => void;
  /** Resolves exactly once, when the task reaches a terminal state. Never rejects. */
  readonly settled: Promise<ChunkSchedulerResult<R>>;
}

function normalizeTimeSliceMs(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    return DEFAULT_TIME_SLICE_MS;
  }
  return value;
}

/**
 * Builds a one-shot, controllable scheduler that processes `items` through
 * `processItem`, yielding to the main thread on a time budget (and sooner,
 * if the browser reports pending input) so a large array never produces a
 * single long task.
 *
 * One-shot means exactly that: once the task reaches `done`, `cancelled` or
 * `error`, this instance is finished — start()/pause()/resume() on it are
 * no-ops from then on. To run another task, create another scheduler. For a
 * React hook, that falls out naturally: new deps → new effect → new
 * scheduler, which is the idiomatic React data-flow anyway.
 */
export function createChunkScheduler<T, R>(
  options: ChunkSchedulerOptions<T, R>,
): ChunkScheduler<R> {
  const { items, processItem, onItem, signal, yieldStrategy } = options;
  const timeSliceMs = normalizeTimeSliceMs(options.timeSliceMs);
  const total = items.length;

  let machineState: ChunkMachineState = initialChunkState;
  let processed = 0;
  let loopStarted = false;
  let settledFlag = false;
  const results: R[] = [];
  let finalResults: readonly R[] | undefined;

  let snapshot: ChunkSnapshot = { status: machineState.status, processed, total };
  const listeners = new Set<() => void>();

  let settleFn!: (result: ChunkSchedulerResult<R>) => void;
  const settledPromise = new Promise<ChunkSchedulerResult<R>>((resolve) => {
    settleFn = resolve;
  });

  // The gate a paused loop blocks on. Recreated per pause; opened by either
  // resume() or cancel() so a cancelled-while-paused task can never hang.
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
      processed,
      total,
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

  function settle(result: ChunkSchedulerResult<R>): void {
    // Structurally unreachable, not merely untested: `finish()` — the only
    // caller of `settle()` — is itself only ever reached from one of two
    // mutually exclusive places, each gated by `loopStarted`: runLoop()'s
    // own completion (which only runs after `loopStarted` was already set
    // true by start()) or settleIfNeverStarted() (which refuses to run
    // once `loopStarted` is true). Either way, by the time this instance
    // can ever reach a terminal state the second time, there is no longer
    // any code path left that would call settle() again. Kept anyway as
    // defense-in-depth against a future refactor breaking that invariant.
    /* v8 ignore next */
    if (settledFlag) return;
    settledFlag = true;
    detachSignal();
    settleFn(result);
  }

  /**
   * The single path every terminal transition goes through: snapshots the
   * results array exactly once (not per item), publishes it via
   * getResults(), and settles the public promise with the same reference —
   * no redundant second copy.
   */
  function finish(status: 'done' | 'cancelled' | 'error', error?: unknown): void {
    const resultsCopy = [...results];
    finalResults = resultsCopy;
    settle(
      status === 'error'
        ? { status, error, results: resultsCopy }
        : { status, results: resultsCopy },
    );
  }

  // If the machine reached a terminal state without the processing loop
  // ever running (e.g. cancel() called before start(), or the signal was
  // already aborted), the loop will never call finish() itself — so this
  // does it. Guarded by !loopStarted, which this also sets, so it can never
  // race with (or double-finish against) the loop's own completion path.
  function settleIfNeverStarted(): void {
    const { status, error } = machineState;
    if (loopStarted || !isTerminal(status)) return;
    loopStarted = true;
    // Both 'done' and 'error' are unreachable here without the loop
    // having run — and the loop having run means `loopStarted` was
    // already true, which would have short-circuited this function above
    // — so 'cancelled' is the only status this ever actually sees. Kept
    // as the real (narrowed) type rather than assumed away, in case that
    // invariant ever changes; the 'error' branch specifically is untestable
    // defense-in-depth for the same structural reason.
    /* v8 ignore next */
    if (status === 'error') finish('error', error);
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

    itemLoop: for (const [index, item] of items.entries()) {
      // Keep re-checking status for *this same* item until it's neither
      // paused nor cancelled, instead of trusting a single wake-from-pause
      // to mean "clear to proceed". A resume() can be undone by a
      // *reentrant* pause() triggered synchronously from a subscriber's
      // own notification (resume() dispatches, notify() runs listeners
      // synchronously, a listener calls pause() before resume() returns)
      // — so without this, the first item after such a resume() would
      // run anyway, even though the task is genuinely paused again by
      // the time it does. A plain `continue` on the outer for-of would
      // wrongly advance to the next item instead of re-checking this one,
      // which is why this is its own inner loop with a labeled break for
      // the one case (cancelled) that must stop processing entirely.
      for (;;) {
        const status: ChunkStatus = machineState.status;
        if (status === 'cancelled') break itemLoop;
        if (status !== 'paused') break;
        await waitForWake();
        sliceStartedAt = now();
      }

      try {
        const result = processItem(item, index);
        results.push(result);
        processed = index + 1;
        refreshSnapshot();
        onItem?.(result, item, index);
      } catch (error) {
        dispatch({ type: 'ERROR', error });
        finish('error', error);
        return;
      }

      if (shouldYieldNow({ sliceStartedAt, timeSliceMs })) {
        await yieldToMain(
          yieldStrategy !== undefined ? { strategy: yieldStrategy } : undefined,
        );
        notify(); // surface the progress made during this slice
        sliceStartedAt = now();
      }
    }

    if (machineState.status === 'cancelled') {
      finish('cancelled');
      return;
    }

    dispatch({ type: 'COMPLETE' });
    finish('done');
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
    getResults: () => finalResults,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    settled: settledPromise,
  };
}
