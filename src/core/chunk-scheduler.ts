import {
  type ChunkEvent,
  type ChunkMachineState,
  type ChunkStatus,
  initialChunkState,
  isTerminal,
  transition,
} from './chunk-machine.js';
import { createDiagnostics, isDevelopment, warnDev } from './diagnostics.js';
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
  /**
   * Called when `processItem` throws. Return `'skip'` to drop that one item
   * and keep going — its index and error are recorded in `skipped`, on both
   * the live snapshot and the settled result — or return `'abort'` to end
   * the task the way it always has, as an `'error'` result carrying
   * whatever was collected before the throw. Omitting `onItem` defaults to
   * `'abort'`, so existing callers see no behavior change.
   *
   * Only ever called for `processItem` throwing. An `onItem` that throws
   * still aborts unconditionally: that's the caller's own progress handler
   * misbehaving, not a per-item failure there's anything to recover from.
   */
  readonly onError?: (error: unknown, item: T, index: number) => 'skip' | 'abort';
  /** External cancellation source — aborting it is equivalent to calling cancel(). */
  readonly signal?: AbortSignal;
  /** Testing-only: forces a specific yield strategy instead of auto-detecting one. */
  readonly yieldStrategy?: YieldStrategy;
  /**
   * Called every time a slice ends and the task is about to yield, with how
   * long that slice ran and how many items are done so far. Unlike the
   * development-only diagnostics above, this ships in the production
   * build — wire it to your own telemetry so you can verify, on real
   * traffic, that this task is actually staying under `timeSliceMs`,
   * instead of trusting this package's own benchmark numbers.
   */
  readonly onSlice?: (durationMs: number, processed: number) => void;
  /** Called right after each yield resolves and work is about to resume. Pairs with `onSlice`. */
  readonly onYield?: () => void;
}

/** One item `onError` chose to skip, in the order it happened. */
export interface SkippedChunkItem {
  readonly index: number;
  readonly error: unknown;
}

/**
 * Fields every status shares. Split out so the union below only has to spell
 * out what actually differs per status: whether `results` is guaranteed yet,
 * and whether `error` is.
 */
interface ChunkResultShared {
  /** Items `onError` skipped. Omitted when nothing was skipped. */
  readonly skipped?: readonly SkippedChunkItem[];
  /**
   * The `AbortSignal`'s `reason`, present only when this cancellation came
   * from that signal aborting rather than a direct `cancel()` call.
   */
  readonly reason?: unknown;
}

/**
 * Discriminated on `status`: narrowing to `'error'` narrows `error` to
 * `unknown` (defined), and narrowing to `'done' | 'cancelled'` rules it out
 * entirely — `results` is a plain array either way, never `undefined`, since
 * a settled task has always published it by the time anyone can observe
 * this type.
 */
export type ChunkSchedulerResult<R> = ChunkResultShared &
  (
    | {
        readonly status: 'done' | 'cancelled';
        readonly results: readonly R[];
        readonly error?: undefined;
      }
    | {
        readonly status: 'error';
        readonly results: readonly R[];
        readonly error: unknown;
      }
  );

/**
 * Discriminated on `status`: narrowing to `'done' | 'cancelled' | 'error'`
 * narrows `results` to a defined array — exactly the statuses `isTerminal()`
 * recognizes, and exactly when the engine has actually published it. Narrow
 * to `'error'` specifically to also narrow `error` itself to defined.
 */
export type ChunkSnapshot<R = unknown> = ChunkResultShared &
  (
    | {
        readonly status: 'idle' | 'processing' | 'paused';
        readonly processed: number;
        readonly total: number;
        readonly results?: undefined;
        readonly error?: undefined;
      }
    | {
        readonly status: 'done' | 'cancelled';
        readonly processed: number;
        readonly total: number;
        readonly results: readonly R[];
        readonly error?: undefined;
      }
    | {
        readonly status: 'error';
        readonly processed: number;
        readonly total: number;
        readonly results: readonly R[];
        readonly error: unknown;
      }
  );

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
 * Loose, `typeof`-only thenable check — the same test `await` itself uses,
 * not an `instanceof Promise` (which would miss any other Promise-like:
 * a different realm's Promise, a userland polyfill). Good enough for a
 * one-shot development warning; never throws on anything a caller could
 * plausibly have returned.
 */
function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { then?: unknown }).then === 'function'
  );
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
  const { items, processItem, onItem, onError, signal, yieldStrategy, onSlice, onYield } =
    options;
  const timeSliceMs = normalizeTimeSliceMs(options.timeSliceMs);
  const batchSize = normalizeBatchSize(options.batchSize);
  const collectResults = options.collectResults ?? true;
  const total = items.length;

  if (isDevelopment && !collectResults && onItem === undefined) {
    warnDev(
      'collectResults is false and no onItem was passed — every result will be computed and then discarded, with nothing to retrieve once the task settles. Pass onItem to consume results as they finish, or drop collectResults: false if you need the final array.',
    );
  }

  // Resolved once per scheduler, not per item: the feature detection behind
  // it walks `navigator.scheduling.isInputPending` through optional calls,
  // which is wasted work on every item of a million-item task.
  const inputPending = resolveInputPending();
  const diagnostics = createDiagnostics('item', batchSize);
  let warnedAboutAsyncResult = false;

  let machineState: ChunkMachineState = initialChunkState;
  let processed = 0;
  let loopStarted = false;
  let settledFlag = false;
  const results: R[] = [];
  let finalResults: readonly R[] | undefined;
  const skipped: SkippedChunkItem[] = [];
  let cancelReason: unknown;

  // Built on demand rather than after every item. useSyncExternalStore
  // requires repeated calls between notifications to return the *same*
  // reference, which `snapshot` holds until something actually changes;
  // `snapshotStale` is what marks it as needing a rebuild. Allocating a
  // fresh snapshot per item (as this once did) is pure garbage for a task
  // that only publishes progress at slice boundaries.
  // `status` here is the wide `ChunkStatus`, not yet one of the three
  // terminal literals, so this literal can't be checked against the
  // discriminated union structurally — same invariant-the-type-system-
  // can't-see situation as `at()` above. True at construction: a fresh
  // machine starts idle, with no results to have published yet.
  let snapshot = { status: machineState.status, processed, total } as ChunkSnapshot<R>;
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
      // Same invariant as the constructor above: `results`/`error` are
      // only ever populated together with a terminal `status` (see
      // `publishResults()` and `dispatch()`'s callers), which is what the
      // discriminated union actually requires — but it's enforced by this
      // function's own call order, not by anything the type checker can
      // read off these independent conditionals.
      snapshot = {
        status: machineState.status,
        processed,
        total,
        ...(machineState.error !== undefined ? { error: machineState.error } : {}),
        ...(finalResults !== undefined ? { results: finalResults } : {}),
        ...(skipped.length > 0 ? { skipped: skipped.slice() } : {}),
        ...(cancelReason !== undefined ? { reason: cancelReason } : {}),
      } as ChunkSnapshot<R>;
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
    // `error` is only ever passed for `status === 'error'` (see this
    // function's two call sites), which is the exact pairing the
    // discriminated union requires — invisible to the checker because it's
    // enforced by the caller, not by anything in this object literal.
    settle({
      status,
      results: published,
      ...(error !== undefined ? { error } : {}),
      ...(skipped.length > 0 ? { skipped: skipped.slice() } : {}),
      ...(status === 'cancelled' && cancelReason !== undefined
        ? { reason: cancelReason }
        : {}),
    } as ChunkSchedulerResult<R>);
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
    cancelReason = signal?.reason;
    cancel();
  }

  function detachSignal(): void {
    signal?.removeEventListener('abort', handleAbort);
  }

  if (signal?.aborted) {
    cancelReason = signal.reason;
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
          let result: R;
          try {
            result = processItem(item, index);
          } catch (caught) {
            // Default ('abort', same as omitting onError) rethrows into the
            // outer try below, so a caller with no onError sees exactly the
            // same error-and-stop behavior this always had.
            if ((onError?.(caught, item, index) ?? 'abort') !== 'skip') throw caught;
            skipped.push({ index, error: caught });
            processed = index + 1;
            snapshotStale = true;
            index += 1;
            continue;
          }
          if (isDevelopment && !warnedAboutAsyncResult && isThenable(result)) {
            warnedAboutAsyncResult = true;
            warnDev(
              'processItem returned a Promise. createChunkScheduler calls it synchronously and never awaits the result, so results will contain unresolved Promise objects instead of the values they resolve to. Resolve the value before returning it, or chunk the async work a different way.',
            );
          }
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
          onSlice?.(checkedAt - sliceStartedAt, index);
          await yieldToMain(
            yieldStrategy !== undefined ? { strategy: yieldStrategy } : undefined,
          );
          notify(); // surface the progress made during this slice
          sliceStartedAt = now();
          onYield?.();
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
