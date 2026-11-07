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
 * So a pacer keeps the plain yield for ordinary slice boundaries and, once
 * `paintIntervalMs` has passed since the last frame it knows of, makes the
 * next yield wait for a frame instead: a `requestAnimationFrame` callback,
 * then the plain yield from inside it, so the work resumes after that
 * frame's rendering rather than in front of it. Frames the browser renders
 * on its own count as well — a pending animation-frame callback, the
 * sentinel, records each one — so where rendering already interleaves with
 * the yields (a `MessageChannel` yield, Safari), the pacer never forces a
 * wait and costs nothing.
 *
 * It degrades to a plain `yieldToMain()`:
 *  - off the main thread — Node, a worker — where there is no `document`
 *    and nothing to paint;
 *  - with `paintIntervalMs: Infinity`, where no animation-frame callback is
 *    ever registered at all;
 *  - in a hidden document, where no frame would come; a wait already in
 *    progress is abandoned the moment the document becomes hidden;
 *  - after a wait that sees no frame within `FRAME_TIMEOUT_MS` — rendering
 *    throttled, as in an offscreen cross-origin iframe — until the
 *    sentinel sees a frame again.
 */

import { type YieldStrategy, now, yieldToMain } from './scheduler.js';

/** Default `paintIntervalMs`: about 30 frames a second. */
export const DEFAULT_PAINT_INTERVAL_MS = 33;

/**
 * How long a forced wait for a frame may take before the pacer concludes
 * that rendering is throttled here and stops forcing waits. Chromium's own
 * guard against rendering starvation fires at about this interval, so a
 * visible, unthrottled page always produces a frame well within it.
 */
export const FRAME_TIMEOUT_MS = 100;

export interface Pacer {
  /** Yields to the main thread — waiting for a frame first when one is overdue. */
  yield(): Promise<void>;
  /** Cancels the pending frame sentinel. Call once the loop is finished; idempotent. */
  dispose(): void;
}

interface FrameApi {
  readonly request: (callback: () => void) => number;
  readonly cancel: (handle: number) => void;
  readonly document: VisibilityTarget;
}

interface VisibilityTarget {
  readonly hidden?: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

interface FrameGlobals {
  readonly requestAnimationFrame?: unknown;
  readonly cancelAnimationFrame?: unknown;
  readonly document?: {
    readonly addEventListener?: unknown;
    readonly removeEventListener?: unknown;
  };
}

/**
 * The animation-frame API of a main-thread document, or `undefined`. A
 * worker can have `requestAnimationFrame` (for OffscreenCanvas) but has no
 * `document`, and a worker's work never keeps the page from painting, so
 * requiring the document is what keeps workers on the plain path.
 */
function resolveFrameApi(): FrameApi | undefined {
  const globals = globalThis as FrameGlobals;
  const { requestAnimationFrame, cancelAnimationFrame, document } = globals;
  if (
    typeof requestAnimationFrame !== 'function' ||
    typeof cancelAnimationFrame !== 'function' ||
    typeof document?.addEventListener !== 'function' ||
    typeof document.removeEventListener !== 'function'
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
    document: document as VisibilityTarget,
  };
}

/**
 * Zero, negative, NaN or a non-number fall back to the default, as
 * `timeSliceMs` does. `Infinity` is allowed: it turns paint pacing off.
 */
export function normalizePaintIntervalMs(value: number | undefined): number {
  // `NaN > 0` is false, so this one comparison rejects NaN too.
  return typeof value === 'number' && value > 0 ? value : DEFAULT_PAINT_INTERVAL_MS;
}

function noop(): void {
  // Nothing to release on the plain path.
}

export function createPacer(
  paintIntervalMs: number,
  strategy: YieldStrategy | undefined,
): Pacer {
  const yieldOptions = strategy === undefined ? undefined : { strategy };
  const plainYield = (): Promise<void> => yieldToMain(yieldOptions);

  const frames = paintIntervalMs === Infinity ? undefined : resolveFrameApi();
  if (frames === undefined) return { yield: plainYield, dispose: noop };

  // Counted from creation: a task usually starts right after a frame (React
  // runs effects after the commit that scheduled them), and a click gets
  // its frame promptly anyway. Starting at -Infinity would make the very
  // first yield wait for a frame that, in the common case, just happened.
  let lastFrameAt = now();
  let framesSeen = 0;
  let sentinel: number | undefined;
  let stalled = false;
  let disposed = false;

  function sawFrame(): void {
    lastFrameAt = now();
    framesSeen += 1;
    stalled = false;
  }

  /**
   * Keeps one animation-frame callback pending, so frames the browser
   * renders on its own are counted. Re-armed lazily, at the next yield, so
   * a paused or finished task leaves nothing ticking.
   */
  function watchForFrames(api: FrameApi): void {
    if (sentinel !== undefined || disposed) return;
    const seenBefore = framesSeen;
    const handle = api.request(() => {
      sentinel = undefined;
      sawFrame();
    });
    // A requestAnimationFrame that calls back synchronously — a common stub
    // in application test suites — has already run the callback by now, and
    // its handle must not be kept as if it were still pending.
    if (framesSeen === seenBefore) sentinel = handle;
  }

  function waitForFrame(api: FrameApi): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        finish('timeout');
      }, FRAME_TIMEOUT_MS);
      const onVisibilityChange = (): void => {
        if (api.document.hidden === true) finish('hidden');
      };
      // Runs once: whichever of the three — the frame, the timer, the
      // document going hidden — gets here first tears down the other two.
      const finish = (outcome: 'frame' | 'hidden' | 'timeout'): void => {
        clearTimeout(timer);
        api.document.removeEventListener('visibilitychange', onVisibilityChange);
        if (outcome === 'frame') {
          sawFrame();
        } else {
          // Only ever reached asynchronously, from the timer or the
          // visibility listener — by then `frame` below is assigned. The
          // 'frame' outcome, which a synchronous requestAnimationFrame can
          // deliver before that assignment, never touches it.
          api.cancel(frame);
          if (outcome === 'timeout') stalled = true;
        }
        // From inside the frame callback, a plain yield resumes the loop
        // after this frame's rendering, not before it.
        void plainYield().then(resolve);
      };
      api.document.addEventListener('visibilitychange', onVisibilityChange);
      // Requested last, so a synchronous requestAnimationFrame finds the
      // timer and the listener already in place for finish() to remove.
      const frame = api.request(() => {
        finish('frame');
      });
    });
  }

  return {
    yield() {
      watchForFrames(frames);
      if (
        stalled ||
        frames.document.hidden === true ||
        now() - lastFrameAt < paintIntervalMs
      ) {
        return plainYield();
      }
      return waitForFrame(frames);
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
