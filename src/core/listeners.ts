/**
 * Calls every listener, isolating each one from the others and from the
 * engine that is notifying.
 *
 * A listener that throws is reported, not propagated — the way an
 * `EventTarget` treats a throwing event listener. Propagating would skip
 * every listener after it (React's own `useSyncExternalStore` subscriber
 * among them, so the component would never see the update), and once the
 * exception escaped into a scheduler it could leave a task that never
 * settles: thrown from `start()` before the loop ran, or from the final
 * `done` notification before the `settled` promise resolved.
 */
export function notifyAll(listeners: ReadonlySet<() => void>): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      reportUncaught(error);
    }
  }
}

interface ReportErrorGlobal {
  readonly reportError?: unknown;
}

/**
 * Reports an error that has nowhere else to go, as an uncaught exception —
 * the way `EventTarget` reports a throwing listener, and RxJS an unhandled
 * error. `reportError()` where the platform has it (browsers: it reaches
 * `window.onerror` and the console). Elsewhere — Node has no `reportError` —
 * the error is rethrown from a microtask: Node then treats it as any other
 * uncaught exception, which ends the process unless an `uncaughtException`
 * handler is installed. Swallowing it instead would hide the bug.
 */
export function reportUncaught(error: unknown): void {
  const { reportError } = globalThis as ReportErrorGlobal;
  if (typeof reportError === 'function') {
    (reportError as (error: unknown) => void)(error);
    return;
  }
  queueMicrotask(() => {
    throw error;
  });
}
