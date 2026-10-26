/**
 * The main-thread yielding primitives this package is built around.
 *
 * Framework-agnostic on purpose: nothing here imports React, so it works
 * just as well inside a Node CLI script chewing through a big array as it
 * does inside a browser tab. The React bindings in `src/react/` are a thin
 * layer on top of this.
 *
 * Strategy, in priority order:
 *  1. `scheduler.yield()` — the purpose-built API (Baseline across Chromium
 *     and Firefox as of 2026; continuations resume ahead of same-priority
 *     work queued elsewhere on the page).
 *  2. `MessageChannel` — posts a message to a dedicated port and resolves on
 *     delivery. Not clamped to the ~4ms floor `setTimeout` gets once timers
 *     are nested, so it yields sooner than (2).
 *  3. `setTimeout(0)` — universally available, the floor of the floor.
 *
 * Every feature check below is written so it can never throw on a global
 * that doesn't exist — `typeof x` on an undeclared identifier is safe in
 * JS, and every property access goes through optional chaining. That's what
 * makes this file safe to import under SSR, in a test environment with no
 * DOM, or in a browser that only half-implements one of these APIs.
 */

export type YieldStrategy = 'scheduler-yield' | 'message-channel' | 'set-timeout';

/** Default time slice: roughly the granularity React's own scheduler uses. */
export const DEFAULT_TIME_SLICE_MS = 5;

interface SchedulerYieldGlobal {
  scheduler?: {
    yield?: () => Promise<void>;
  };
}

interface NavigatorSchedulingGlobal {
  navigator?: {
    scheduling?: {
      isInputPending?: () => boolean;
    };
  };
}

/** True when `scheduler.yield()` is present on this runtime. */
export function supportsSchedulerYield(): boolean {
  const schedulerGlobal = (globalThis as SchedulerYieldGlobal).scheduler;
  return typeof schedulerGlobal?.yield === 'function';
}

/** True when the `MessageChannel` constructor is present on this runtime. */
export function supportsMessageChannel(): boolean {
  return typeof MessageChannel === 'function';
}

/** True when `navigator.scheduling.isInputPending()` is present. */
export function supportsInputPending(): boolean {
  const navigatorGlobal = (globalThis as NavigatorSchedulingGlobal).navigator;
  return typeof navigatorGlobal?.scheduling?.isInputPending === 'function';
}

/**
 * Best-effort read of whether the browser has pending input right now.
 * Returns `false` — never throws — when the API is unavailable or errors,
 * since the caller's fallback (a plain time budget) is always safe.
 */
export function isInputPending(): boolean {
  try {
    const navigatorGlobal = (globalThis as NavigatorSchedulingGlobal).navigator;
    return navigatorGlobal?.scheduling?.isInputPending?.() ?? false;
  } catch {
    return false;
  }
}

/** Picks the best strategy this runtime actually supports. */
export function resolveYieldStrategy(): YieldStrategy {
  if (supportsSchedulerYield()) return 'scheduler-yield';
  if (supportsMessageChannel()) return 'message-channel';
  return 'set-timeout';
}

function yieldViaMessageChannel(): Promise<void> {
  return new Promise((resolve) => {
    // A fresh channel per call, deliberately — not a shared module-level
    // singleton. Two chunk schedulers can easily be yielding in the same
    // tick (two independent useChunkedTask calls on one page is a normal
    // app, not an edge case), and a shared port's onmessage handler would
    // get clobbered by whichever call registered second, permanently
    // hanging the first caller's promise. A new MessageChannel is a few
    // microseconds; a silently-hung promise is a production incident.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      // Closed the moment its one message lands. A port with a listener is
      // a live handle: in Node it keeps the process from ever exiting (a
      // CLI script would finish its work and then hang), and in a browser
      // without scheduler.yield() a long task opens hundreds of these.
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function yieldViaSetTimeout(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export interface YieldToMainOptions {
  /**
   * Force a specific strategy instead of auto-detecting one. Exists for
   * deterministic tests of each fallback path; application code should
   * leave this unset.
   */
  strategy?: YieldStrategy;
}

/**
 * Yields control back to the browser's main thread, resolving once the
 * browser has had a chance to handle any pending input, then resuming the
 * caller. Never rejects: a runtime that half-implements `scheduler.yield()`
 * (the property exists but the call throws, or the returned promise
 * rejects) falls through to the next strategy rather than propagating the
 * failure into unrelated application code.
 */
export async function yieldToMain(options?: YieldToMainOptions): Promise<void> {
  const strategy = options?.strategy ?? resolveYieldStrategy();

  if (strategy === 'scheduler-yield') {
    const schedulerGlobal = (globalThis as SchedulerYieldGlobal).scheduler;
    if (typeof schedulerGlobal?.yield === 'function') {
      try {
        await schedulerGlobal.yield();
        return;
      } catch {
        // Fall through to the next strategy below.
      }
    }
    await (supportsMessageChannel() ? yieldViaMessageChannel() : yieldViaSetTimeout());
    return;
  }

  if (strategy === 'message-channel') {
    if (supportsMessageChannel()) {
      await yieldViaMessageChannel();
      return;
    }
    await yieldViaSetTimeout();
    return;
  }

  await yieldViaSetTimeout();
}

/** `performance.now()` when available, `Date.now()` otherwise. Never throws. */
export function now(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    // fall through
  }
  return Date.now();
}

export interface ShouldYieldOptions {
  /** `now()` timestamp when the current uninterrupted run of work began. */
  sliceStartedAt: number;
  /** Max ms to run before yielding regardless of input-pending state. */
  timeSliceMs?: number;
}

/**
 * Whether the caller should yield right now: either the time slice has run
 * out, or the browser is reporting pending input (a stronger, earlier
 * signal than the clock — used only when the runtime exposes it).
 */
export function shouldYieldNow(options: ShouldYieldOptions): boolean {
  const timeSliceMs = options.timeSliceMs ?? DEFAULT_TIME_SLICE_MS;
  const elapsed = now() - options.sliceStartedAt;
  if (elapsed >= timeSliceMs) return true;
  return isInputPending();
}
