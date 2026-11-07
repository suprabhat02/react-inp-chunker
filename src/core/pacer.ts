/**
 * Paint-aware pacing: how a chunked loop yields between slices.
 *
 * `scheduler.yield()` is the best plain yield there is — its continuation
 * resumes ahead of other queued work, and input is handled promptly — but
 * in Chromium "ahead of other queued work" includes rendering. A loop that
 * yields only through it keeps the page from painting until the browser's
 * own starvation guard steps in, about every 100 ms. A click still gets its
 * frame quickly, because Chromium prioritizes rendering after input; it is
 * everything else on screen — a progress bar, a counter, a JavaScript-driven
 * animation — that drops to around 10 frames a second for as long as the
 * work runs.
 *
 * So a pacer uses that fast yield only while the page has painted recently,
 * within `paintIntervalMs`. Otherwise it yields through an ordinary task (a
 * `MessageChannel` message, or `setTimeout` where that is what was asked
 * for), which queues behind a frame that is due rather than in front of it:
 * the frame renders, then the work resumes.
 *
 * It never waits for a frame. Nothing can leave it waiting for one that
 * won't come — a hidden tab, a throttled iframe, a test with faked timers:
 * without frames it simply keeps yielding through ordinary tasks, which is
 * what `yieldToMain()` does in Safari anyway.
 *
 * Frames are counted by keeping one `requestAnimationFrame` callback — the
 * sentinel — pending; it records when the browser rendered. Off the main
 * thread (Node, a worker: no `document`) and with `paintIntervalMs:
 * Infinity`, no callback is ever registered and every yield is the fast one.
 */

import { type YieldStrategy, now, yieldToMain } from './scheduler.js';

/** Default `paintIntervalMs`: about 30 frames a second. */
export const DEFAULT_PAINT_INTERVAL_MS = 33;

export interface Pacer {
  /** Yields to the main thread — behind rendering when a frame is overdue. */
  yield(): Promise<void>;
  /** Cancels the pending frame sentinel. Call once the loop is finished; idempotent. */
  dispose(): void;
}

interface FrameApi {
  readonly request: (callback: () => void) => number;
  readonly cancel: (handle: number) => void;
}

interface FrameGlobals {
  readonly requestAnimationFrame?: unknown;
  readonly cancelAnimationFrame?: unknown;
  readonly document?: unknown;
}

/**
 * The animation-frame API of a main-thread document, or `undefined`. A
 * worker can have `requestAnimationFrame` (for OffscreenCanvas) but has no
 * `document`, and a worker's work never keeps the page from painting, so
 * requiring the document is what keeps workers on the fast path.
 */
function resolveFrameApi(): FrameApi | undefined {
  const { requestAnimationFrame, cancelAnimationFrame, document } =
    globalThis as FrameGlobals;
  if (
    typeof requestAnimationFrame !== 'function' ||
    typeof cancelAnimationFrame !== 'function' ||
    document === undefined
  ) {
    return undefined;
  }
  return {
    // Called through the global each time rather than bound once, so a
    // test (or a polyfill) that replaces the global later is respected.
    request: (callback) =>
      (
        globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number }
      ).requestAnimationFrame(callback),
    cancel: (handle) => {
      (
        globalThis as unknown as { cancelAnimationFrame: (handle: number) => void }
      ).cancelAnimationFrame(handle);
    },
  };
}

/**
 * NaN, a negative number or a non-number fall back to the default.
 * `Infinity` turns pacing off; `0` makes every yield an ordinary task.
 */
export function normalizePaintIntervalMs(value: number | undefined): number {
  // `NaN >= 0` is false, so this one comparison rejects NaN too.
  return typeof value === 'number' && value >= 0 ? value : DEFAULT_PAINT_INTERVAL_MS;
}

function noop(): void {
  // Nothing to release on the fast-only path.
}

export function createPacer(
  paintIntervalMs: number,
  strategy: YieldStrategy | undefined,
): Pacer {
  const fastOptions = strategy === undefined ? undefined : { strategy };
  const fastYield = (): Promise<void> => yieldToMain(fastOptions);

  const frames = paintIntervalMs === Infinity ? undefined : resolveFrameApi();
  if (frames === undefined) return { yield: fastYield, dispose: noop };

  // Whatever was asked for, minus scheduler.yield(): a task that waits its
  // turn, so a frame that is due renders first.
  const ordinaryOptions = {
    strategy: strategy === 'set-timeout' ? 'set-timeout' : 'message-channel',
  } as const;

  // No frame seen yet, so the first yield is an ordinary one. For a task
  // started from a click this changes little — Chromium renders first after
  // input anyway — but a task started any other way no longer jumps ahead
  // of the frame that would show it starting.
  let lastFrameAt = -Infinity;
  let framesSeen = 0;
  let sentinel: number | undefined;
  let disposed = false;

  /**
   * Keeps one animation-frame callback pending, so every frame the browser
   * renders is counted. Re-armed lazily, at the next yield, so a paused or
   * finished task leaves nothing ticking.
   */
  function watchForFrames(api: FrameApi): void {
    if (sentinel !== undefined || disposed) return;
    const seenBefore = framesSeen;
    const handle = api.request(() => {
      sentinel = undefined;
      lastFrameAt = now();
      framesSeen += 1;
    });
    // A requestAnimationFrame that calls back synchronously — a common stub
    // in application test suites — has already run the callback by now, and
    // its handle must not be kept as if it were still pending.
    if (framesSeen === seenBefore) sentinel = handle;
  }

  return {
    yield() {
      watchForFrames(frames);
      return now() - lastFrameAt < paintIntervalMs
        ? fastYield()
        : yieldToMain(ordinaryOptions);
    },
    dispose() {
      disposed = true;
      if (sentinel !== undefined) {
        frames.cancel(sentinel);
        sentinel = undefined;
      }
    },
  };
}
