// Event Timing entries and run records, exposed on window for the
// measurement script. Nothing here changes how the variants behave.

export interface EventRecord {
  readonly name: string;
  readonly target: string;
  readonly interactionId: number;
  readonly duration: number;
  readonly inputDelay: number;
  readonly startTime: number;
}

export interface RunRecord {
  readonly variant: string;
  readonly startedAt: number;
  readonly totalMs: number;
  readonly longestFrameMs: number;
}

/** A click measured from its event timestamp to the next animation frame. */
export interface InteractionRecord {
  readonly name: string;
  readonly inputDelayMs: number;
  readonly toNextFrameMs: number;
}

declare global {
  interface Window {
    __events: EventRecord[];
    __runs: RunRecord[];
    __interactions: InteractionRecord[];
  }
}

window.__events = [];
window.__runs = [];
window.__interactions = [];

/**
 * Call first thing in a click handler. Measures input delay (how long the
 * click waited for the main thread) and the time until the next frame can
 * start, which is when the click's visual response can first be painted.
 * Unlike Event Timing, this has no 16 ms reporting threshold.
 */
export function trackInteraction(name: string, event: { timeStamp: number }): void {
  const inputDelayMs = performance.now() - event.timeStamp;
  // The rAF argument is the frame's scheduled start, which can predate a
  // long task that delayed it; performance.now() inside the callback is when
  // the frame actually ran.
  requestAnimationFrame(() => {
    window.__interactions.push({
      name,
      inputDelayMs,
      toNextFrameMs: performance.now() - event.timeStamp,
    });
  });
}

const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries() as PerformanceEventTiming[]) {
    const target =
      entry.target instanceof Element
        ? (entry.target.closest('[data-testid]')?.getAttribute('data-testid') ?? '')
        : '';
    window.__events.push({
      name: entry.name,
      target,
      interactionId: entry.interactionId ?? 0,
      duration: entry.duration,
      inputDelay: entry.processingStart - entry.startTime,
      startTime: entry.startTime,
    });
  }
});
observer.observe({
  type: 'event',
  buffered: true,
  durationThreshold: 16,
} as PerformanceObserverInit);

// Longest gap between animation frames: how long the page could not paint.
let lastFrame = performance.now();
let longestGap = 0;
const tick = () => {
  const now = performance.now();
  longestGap = Math.max(longestGap, now - lastFrame);
  lastFrame = now;
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

let runStartedAt = 0;
let runVariant = '';

export function beginRun(variant: string, eventTimeStamp: number): void {
  runVariant = variant;
  runStartedAt = eventTimeStamp;
  longestGap = 0;
  lastFrame = performance.now();
}

/** Call once the results are committed; records after the next paint. */
export function endRun(): void {
  // The next frame is when the results can first be painted.
  requestAnimationFrame(() => {
    const record: RunRecord = {
      variant: runVariant,
      startedAt: runStartedAt,
      totalMs: performance.now() - runStartedAt,
      longestFrameMs: longestGap,
    };
    setTimeout(() => window.__runs.push(record), 0);
  });
}
