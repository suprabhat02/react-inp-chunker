/**
 * Measures how long input would have waited, without needing any input.
 *
 * A probe task is scheduled every few milliseconds at the priority input
 * gets: `scheduler.postTask` with 'user-blocking' where it exists, which
 * runs ahead of ordinary work and of scheduler.yield() continuations, just
 * as a click does. A probe can only run once the task in progress ends, so
 * how late it runs is how long a click at that moment would have waited
 * before its handler started (its input delay).
 *
 * Where postTask is missing (Safari), a timer does the same job: there,
 * nothing on the page runs ahead of timers the way yield continuations do.
 */
export interface ProbeSample {
  /** When the probe was due, in ms on the performance.now() clock. */
  readonly due: number;
  /** When it actually ran. `ran - due` is the input delay at that moment. */
  readonly ran: number;
}

interface PostTaskScheduler {
  postTask(
    callback: () => void,
    options: { readonly priority: 'user-blocking'; readonly delay: number },
  ): Promise<unknown>;
}

const PROBE_INTERVAL_MS = 4;

function postTaskScheduler(): PostTaskScheduler | null {
  const candidate = (globalThis as { scheduler?: Partial<PostTaskScheduler> }).scheduler;
  return typeof candidate?.postTask === 'function'
    ? (candidate as PostTaskScheduler)
    : null;
}

/**
 * Starts probing; returns the function that stops it. Samples are pushed
 * into `into`, and `onSample` is called after each one.
 */
export function startInputDelayProbe(
  into: ProbeSample[],
  onSample: () => void,
): () => void {
  let stopped = false;
  const scheduler = postTaskScheduler();

  const schedule = () => {
    if (stopped) return;
    const due = performance.now() + PROBE_INTERVAL_MS;
    const probe = () => {
      if (stopped) return;
      into.push({ due, ran: performance.now() });
      onSample();
      schedule();
    };
    if (scheduler !== null) {
      scheduler
        .postTask(probe, { priority: 'user-blocking', delay: PROBE_INTERVAL_MS })
        .catch(() => undefined);
    } else {
      setTimeout(probe, PROBE_INTERVAL_MS);
    }
  };

  schedule();
  return () => {
    stopped = true;
  };
}
