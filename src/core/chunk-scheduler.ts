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

export interface ChunkSchedulerOptions<T, R> {
  readonly items: readonly T[];
  readonly processItem: (item: T, index: number) => R;
  /** Max ms of uninterrupted work before yielding. Default 5. */
  readonly timeSliceMs?: number;
  /**
   * Items to process between clock checks. Default 1, which bounds a slice
   * at one item: the safe choice, and the right one unless profiling says
   * otherwise.
   *
   * Reading the clock costs around 300ns in a browser (where it is also
   * coarsened to 0.1ms), so for items measured in nanoseconds that read,
   * not the work, dominates. Raising this amortizes it — at the cost of
   * checking the clock, pause and cancel only at batch boundaries, so a
   * slice can run up to `batchSize` items past its budget. Pick a value
   * whose worst-case cost you know: `batchSize * your slowest item` is the
   * overshoot you are accepting.
   */
  readonly batchSize?: number;
  /**
   * Keep every result for `getResults()`. Default true. Set false when
   * results are consumed through `onItem`: the array is then never built,
   * which matters when `items` is large enough for retaining one result
   * per item to cost real memory. `getResults()` then returns an empty
   * array once the task settles.
   */
  readonly collectResults?: boolean;
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

export interface ChunkSnapshot<R = unknown> {
  readonly status: ChunkStatus;
  readonly processed: number;
  readonly total: number;
  readonly error?: unknown;
  /**
   * Present only once the task has settled, and always in the same
   * snapshot that first reports a terminal status — so a reader can never
   * observe `status: 'done'` without the results that go with it.
   */
  readonly results?: readonly R[];
}

export interface ChunkScheduler<R> {
  start(): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  getSnapshot(): ChunkSnapshot<R>;
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

/**
 * `items[index]` for an index the caller has already bounds-checked.
 *
 * The loop below only ever indexes below `items.length`, but
 * `noUncheckedIndexedAccess` widens every index read to `T | undefined`,
 * and `T` may itself include `undefined` — so no runtime check can narrow
 * it. This states the invariant in one place instead of asserting at each
 * use, and compiles to a plain index read.
 */
function at<T>(items: readonly T[], index: number): T {
  return items[index] as T;
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
  const batchSize = normalizeBatchSize(options.batchSize);
  const collectResults = options.collectResults ?? true;
  const total = items.length;

  // Resolved once per scheduler, not per item: the feature detection behind
  // it walks `navigator.scheduling.isInputPending` through optional calls,
  // which is wasted work on every item of a million-item task.
  const inputPending = resolveInputPending();
  const diagnostics = createDiagnostics('item', batchSize);

  let machineState: ChunkMachineState = initialChunkState;
  let processed = 0;
  let loopStarted = false;
  let settledFlag = false;
  const results: R[] = [];
  let finalResults: readonly R[] | undefined;

  // Built on demand rather than after every item. useSyncExternalStore
  // requires repeated calls between notifications to return the *same*
  // reference, which `snapshot` holds until something actually changes;
  // `snapshotStale` is what marks it as needing a rebuild. Allocating a
  // fresh snapshot per item (as this once did) is pure garbage for a task
  // that only publishes progress at slice boundaries.
  let snapshot: ChunkSnapshot<R> = { status: machineState.status, processed, total };
  let snapshotStale = false;
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

  function getSnapshot(): ChunkSnapshot<R> {
    if (snapshotStale) {
      snapshotStale = false;
      snapshot = {
        status: machineState.status,
        processed,
        total,
        ...(machineState.error !== undefined ? { error: machineState.error } : {}),
        ...(finalResults !== undefined ? { results: finalResults } : {}),
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
   * Publishes the accumulated results exactly once, at the moment the task
   * settles — not per item, and never as a second copy. Always called
   * *before* the terminal status is announced, so the notification that
   * reports `done` already carries the results: a subscriber can never
   * observe one without the other.
   */
  function publishResults(): readonly R[] {
    finalResults = results;
    snapshotStale = true;
    return finalResults;
  }

  function settleWith(
    status: 'done' | 'cancelled' | 'error',
    published: readonly R[],
    error?: unknown,
  ): void {
    settle(
      status === 'error'
        ? { status, error, results: published }
        : { status, results: published },
    );
  }

  /**
   * Settling as cancelled, for both places that can do it: the loop
   * noticing, and cancel() on a task whose loop never ran. The CANCEL
   * transition was announced earlier, before there were any results to
   * carry, so this notifies again now that there are.
   */
  function finishCancelled(): void {
    settleWith('cancelled', publishResults());
    notify();
  }

  // If the machine reached a terminal state without the processing loop
  // ever running (e.g. cancel() called before start(), or the signal was
  // already aborted), the loop will never call finish() itself — so this
  // does it. Guarded by !loopStarted, which this also sets, so it can never
  // race with (or double-finish against) the loop's own completion path.
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
    let index = 0;

    try {
      while (index < total) {
        // Re-read on every pass rather than trusting a single wake from the
        // pause gate: a resume() can be undone by a *reentrant* pause()
        // triggered synchronously from a subscriber's own notification
        // (resume() dispatches, notify() runs listeners synchronously, a
        // listener calls pause() before resume() returns). Continuing the
        // loop instead of falling through is what lets this see that and
        // block again on a fresh gate, without consuming an item.
        const status: ChunkStatus = machineState.status;
        if (status === 'cancelled') break;
        if (status === 'paused') {
          await waitForWake();
          sliceStartedAt = now();
          if (isDevelopment) diagnostics.resumed(sliceStartedAt, index);
          continue;
        }

        // One batch between clock checks. At the default batchSize of 1
        // this is exactly "one item, then check", and the inner loop costs
        // nothing beyond the comparison.
        const batchEnd = index + batchSize <= total ? index + batchSize : total;
        while (index < batchEnd) {
          const item = at(items, index);
          const result = processItem(item, index);
          if (collectResults) results.push(result);
          processed = index + 1;
          onItem?.(result, item, index);
          index += 1;
        }
        snapshotStale = true;

        // One clock read per batch, shared by the budget check and the
        // development diagnostics. Both diagnostic calls compile away in a
        // production build, along with this module.
        const checkedAt = now();
        if (isDevelopment) diagnostics.check(checkedAt, index);

        if (checkedAt - sliceStartedAt >= timeSliceMs || inputPending()) {
          if (isDevelopment) diagnostics.sliceEnded(checkedAt, index);
          await yieldToMain(
            yieldStrategy !== undefined ? { strategy: yieldStrategy } : undefined,
          );
          notify(); // surface the progress made during this slice
          sliceStartedAt = now();
          if (isDevelopment) diagnostics.resumed(sliceStartedAt, index);
        }
      }
    } catch (error) {
      const published = publishResults();
      dispatch({ type: 'ERROR', error });
      settleWith('error', published, error);
      return;
    }

    if (machineState.status === 'cancelled') {
      finishCancelled();
      return;
    }

    const published = publishResults();
    dispatch({ type: 'COMPLETE' });
    settleWith('done', published);
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
