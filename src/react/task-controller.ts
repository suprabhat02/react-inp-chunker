/**
 * The glue between a task handle (`ChunkScheduler<R>`, `DeferredTask<T>` —
 * anything with `subscribe`/`getSnapshot`) recreated from scratch whenever a
 * hook's deps change, inside an effect, and `useSyncExternalStore`, which
 * wants one stable `subscribe` function for a component's whole lifetime.
 *
 * `useSyncExternalStore` resubscribes whenever the `subscribe` function
 * identity changes — fine for correctness, but it means the naive approach
 * (pass the current task's own `.subscribe` directly) either churns
 * subscriptions every render or, worse, drifts: the component keeps
 * `subscribe`d to whichever task was current when it last resubscribed, not
 * necessarily the one `getSnapshot` is reading from after a swap.
 *
 * A controller sidesteps that: it's created once per hook instance (lazy
 * `useState` initializer in the hook, so it's stable without touching a
 * ref), hands `useSyncExternalStore` a `subscribe`/`getSnapshot` pair that
 * never change identity, and internally forwards to whichever task is
 * "current" — re-pointing itself via `replace()` every time the effect
 * swaps in a new one. Generic over the task shape so both `useChunkedTask`
 * and `useDeferredTask` share this one implementation.
 *
 * Every property below is an arrow function, deliberately — not method
 * shorthand — so none of them close over `this`, and `controller.subscribe`
 * can be handed to `useSyncExternalStore` directly as a plain function
 * reference without an unbound-method footgun.
 */
export interface SubscribableTask<Snapshot> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Snapshot;
}

export interface TaskController<Task extends SubscribableTask<unknown>> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ReturnType<Task['getSnapshot']> | undefined;
  getCurrent: () => Task | null;
  /** Swaps in a new task (or none), detaching from the previous one first. */
  replace: (task: Task | null) => void;
}

export function createTaskController<
  Task extends SubscribableTask<unknown>,
>(): TaskController<Task> {
  let current: Task | null = null;
  let detachFromCurrent: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () =>
      current?.getSnapshot() as ReturnType<Task['getSnapshot']> | undefined,
    getCurrent: () => current,
    replace: (task) => {
      detachFromCurrent?.();
      current = task;
      detachFromCurrent = task?.subscribe(notify);
      notify();
    },
  };
}
