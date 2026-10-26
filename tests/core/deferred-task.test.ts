import { describe, expect, it, vi } from 'vitest';

import type { DeferredGenerator } from '../../src/core/deferred-task.js';
import { createDeferredTask } from '../../src/core/deferred-task.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A generator that marks `n` checkpoints, pushing to `progress` at each, then returns `n`. */
function* countingTask(n: number, progress: number[]): DeferredGenerator<number> {
  for (let i = 0; i < n; i++) {
    progress.push(i);
    yield;
  }
  return n;
}

describe('createDeferredTask() — happy path', () => {
  it('drives the generator to completion and resolves with its return value', async () => {
    const progress: number[] = [];
    const deferred = createDeferredTask({ task: () => countingTask(5, progress) });
    deferred.start();
    const result = await deferred.settled;
    expect(result).toEqual({ status: 'done', value: 5 });
    expect(progress).toEqual([0, 1, 2, 3, 4]);
    expect(deferred.getValue()).toBe(5);
    expect(deferred.getSnapshot().status).toBe('done');
  });

  it('a generator that never yields still runs to completion', async () => {
    // eslint-disable-next-line require-yield -- the whole point of this test is a generator that legitimately never yields.
    function* noYield(): DeferredGenerator<string> {
      return 'done without ever pausing';
    }
    const deferred = createDeferredTask({ task: noYield });
    deferred.start();
    const result = await deferred.settled;
    expect(result).toEqual({ status: 'done', value: 'done without ever pausing' });
  });

  it('a generator that returns undefined settles done with no `value` key at all', async () => {
    function* voidTask(): DeferredGenerator<undefined> {
      yield;
      return undefined;
    }
    const deferred = createDeferredTask({ task: voidTask });
    deferred.start();
    const result = await deferred.settled;
    expect(result.status).toBe('done');
    expect('value' in result).toBe(false);
    // getValue() is typed `T | undefined`, and T is `undefined` for this
    // task specifically — TypeScript's VoidLike flag set (which this rule
    // checks against) groups `undefined` in with `void`, so it reads this
    // legitimate call as "void-like" even though it's a real, meaningful
    // value for this test's deliberately degenerate T.
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const value = deferred.getValue();
    expect(value).toBeUndefined();
  });

  it('actually yields to the main thread on a tight time budget, and still finishes correctly', async () => {
    const progress: number[] = [];
    const deferred = createDeferredTask({
      task: () => countingTask(200, progress),
      timeSliceMs: 0.0001, // forces a yield checkpoint after virtually every step
    });
    const notifications: number[] = [];
    deferred.subscribe(() => {
      notifications.push(progress.length);
    });
    deferred.start();
    const result = await deferred.settled;
    expect(result).toEqual({ status: 'done', value: 200 });
    expect(progress).toHaveLength(200);
    // With a near-zero budget we expect many yield checkpoints, not one.
    expect(notifications.length).toBeGreaterThan(5);
  });
});

describe('createDeferredTask() — explicit yieldStrategy', () => {
  it('threads an explicit yieldStrategy through to a real, in-flight yield checkpoint', async () => {
    const progress: number[] = [];
    const deferred = createDeferredTask({
      task: () => countingTask(50, progress),
      timeSliceMs: 0.0001,
      yieldStrategy: 'set-timeout',
    });
    deferred.start();
    const result = await deferred.settled;
    expect(result).toEqual({ status: 'done', value: 50 });
  });
});

describe('createDeferredTask() — pause / resume', () => {
  it('stops advancing while paused, and resumes correctly', async () => {
    const progress: number[] = [];
    const deferred = createDeferredTask({
      task: () => countingTask(50, progress),
      timeSliceMs: 0.0001,
    });
    // subscribe()'s notify fires more than once per item (once for the
    // mid-loop yield-checkpoint progress, again for the PAUSE transition
    // itself) — unlike a hypothetical per-item callback, so this guard is
    // what keeps the intent "pause once, at 5" instead of "keep re-pausing
    // every time length is still 5", which would include every resume()
    // whose own reentrant notification still observes length 5.
    let pausedOnce = false;
    deferred.subscribe(() => {
      if (progress.length === 5 && !pausedOnce) {
        pausedOnce = true;
        deferred.pause();
      }
    });
    deferred.start();

    await sleep(20);
    expect(deferred.getSnapshot().status).toBe('paused');
    const progressAtPause = progress.length;
    expect(progressAtPause).toBeGreaterThanOrEqual(5);

    await sleep(20);
    expect(progress.length).toBe(progressAtPause);

    deferred.resume();
    const result = await deferred.settled;
    expect(result).toEqual({ status: 'done', value: 50 });
    expect(progress).toHaveLength(50);
  });

  it("a resume() undone by a reentrant pause() (fired synchronously from resume()'s own notification) does not leak a step, and a later genuine resume() still completes the task", async () => {
    // Regression test for a real race: resume() dispatches RESUME, whose
    // notify() runs subscribers synchronously — if one of them calls
    // pause() before resume() returns, an earlier draft of the engine
    // still treated the *original* dispatch's "changed" flag as proof the
    // gate should open, let the suspended loop wake up, and ran one more
    // generator step before the loop noticed it was paused again. Worse,
    // the gate it then re-blocked on was a brand-new one nobody held a
    // reference to resolve, permanently wedging the task. Both are wrong:
    // a resume() that gets reentrantly undone must behave as if it never
    // happened (no leaked work), and the task must still be recoverable
    // by a later, un-sabotaged resume().
    const progress: number[] = [];
    const deferred = createDeferredTask({
      task: () => countingTask(50, progress),
      timeSliceMs: 0.0001,
    });

    let pausedAtFive = false;
    deferred.subscribe(() => {
      if (progress.length === 5 && !pausedAtFive) {
        pausedAtFive = true;
        deferred.pause();
      }
    });
    deferred.start();
    await sleep(20);
    expect(deferred.getSnapshot().status).toBe('paused');
    const progressAtFirstPause = progress.length;

    // Arm a second listener that re-pauses, synchronously, the next time
    // it observes 'processing' — simulating a consumer whose own
    // subscriber decides mid-notification that the task should stay
    // paused after all.
    let reentrantArmed = true;
    deferred.subscribe(() => {
      if (reentrantArmed && deferred.getSnapshot().status === 'processing') {
        reentrantArmed = false;
        deferred.pause();
      }
    });

    deferred.resume();
    // The reentrant pause() ran synchronously inside resume()'s own
    // notification, so resume() must not claim success it didn't actually
    // achieve: by the time it returns, status should already read
    // 'paused' again, not 'processing' and not some inconsistent state.
    expect(deferred.getSnapshot().status).toBe('paused');

    // Give a buggy engine a chance to have leaked one step through before
    // re-blocking.
    await sleep(20);
    expect(progress.length).toBe(progressAtFirstPause);

    // An un-sabotaged resume() afterward must still work — the task isn't
    // permanently wedged by the earlier reentrancy.
    deferred.resume();
    const result = await deferred.settled;
    expect(result).toEqual({ status: 'done', value: 50 });
    expect(progress).toHaveLength(50);
  });

  it('pause() while idle (before start) is a harmless no-op', () => {
    const deferred = createDeferredTask({ task: () => countingTask(1, []) });
    expect(() => {
      deferred.pause();
    }).not.toThrow();
    expect(deferred.getSnapshot().status).toBe('idle');
  });

  it('resume() without a prior pause is a harmless no-op', async () => {
    const deferred = createDeferredTask({ task: () => countingTask(2, []) });
    deferred.start();
    expect(() => {
      deferred.resume();
    }).not.toThrow();
    const result = await deferred.settled;
    expect(result.status).toBe('done');
  });

  it('pause() after the task has already settled is a no-op', async () => {
    const deferred = createDeferredTask({ task: () => countingTask(1, []) });
    deferred.start();
    await deferred.settled;
    deferred.pause();
    expect(deferred.getSnapshot().status).toBe('done');
  });
});

describe('createDeferredTask() — cancellation', () => {
  it('cancel() mid-processing stops the task without a resolved value', async () => {
    const progress: number[] = [];
    const deferred = createDeferredTask({
      task: () => countingTask(100, progress),
      timeSliceMs: 0.0001,
    });
    deferred.subscribe(() => {
      if (progress.length === 10) deferred.cancel();
    });
    deferred.start();
    const result = await deferred.settled;
    expect(result.status).toBe('cancelled');
    expect(result.value).toBeUndefined();
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.length).toBeLessThan(100);
  });

  it('cancel() while paused resolves promptly instead of hanging forever', async () => {
    const progress: number[] = [];
    const deferred = createDeferredTask({
      task: () => countingTask(20, progress),
      timeSliceMs: 0.0001,
    });
    deferred.subscribe(() => {
      if (progress.length === 2) deferred.pause();
    });
    deferred.start();
    await sleep(20);
    expect(deferred.getSnapshot().status).toBe('paused');

    deferred.cancel();

    // The race condition that matters most: a paused loop is blocked on an
    // internal promise, and cancel() must wake it, not leave it hanging. If
    // this hangs, the test times out.
    const result = await deferred.settled;
    expect(result.status).toBe('cancelled');
  });

  it('cancel() before start() settles immediately with no value', async () => {
    const task = vi.fn(() => countingTask(3, []));
    const deferred = createDeferredTask({ task });
    deferred.cancel();
    const result = await deferred.settled;
    expect(result).toEqual({ status: 'cancelled' });
    expect(deferred.getValue()).toBeUndefined();
    // start() after cancel-before-start must not resurrect the task.
    deferred.start();
    expect(deferred.getSnapshot().status).toBe('cancelled');
    expect(task).not.toHaveBeenCalled();
  });

  it('calling cancel() twice is idempotent', async () => {
    // Force real yield checkpoints so cancel() actually lands mid-flight —
    // a tiny generator with the default budget could otherwise run to
    // completion synchronously inside start() itself.
    const progress: number[] = [];
    const deferred = createDeferredTask({
      task: () => countingTask(50, progress),
      timeSliceMs: 0.0001,
    });
    deferred.start();
    deferred.cancel();
    expect(() => {
      deferred.cancel();
    }).not.toThrow();
    const result = await deferred.settled;
    expect(result.status).toBe('cancelled');
  });

  it('a tiny task that never needs to yield still completes correctly, and cancel() after is a no-op', async () => {
    const deferred = createDeferredTask({ task: () => countingTask(3, []) });
    deferred.start();
    // For a generator this small, the task may well have already finished
    // synchronously inside start() — that's the point of this test.
    const result = await deferred.settled;
    expect(result).toEqual({ status: 'done', value: 3 });
    expect(() => {
      deferred.cancel();
    }).not.toThrow();
    expect(deferred.getSnapshot().status).toBe('done');
  });

  it('an AbortSignal aborted before creation cancels the task without ever invoking the generator', async () => {
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn(() => countingTask(3, []));
    const deferred = createDeferredTask({ task, signal: controller.signal });
    deferred.start();
    const result = await deferred.settled;
    expect(result.status).toBe('cancelled');
    expect(task).not.toHaveBeenCalled();
  });

  it('aborting the signal mid-run behaves exactly like calling cancel()', async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    const deferred = createDeferredTask({
      task: () => countingTask(100, progress),
      timeSliceMs: 0.0001,
      signal: controller.signal,
    });
    deferred.subscribe(() => {
      if (progress.length === 10) controller.abort();
    });
    deferred.start();
    const result = await deferred.settled;
    expect(result.status).toBe('cancelled');
    expect(progress.length).toBeLessThan(100);
  });
});

describe('createDeferredTask() — start() idempotency', () => {
  it('a second start() call while already processing does not restart or duplicate work', async () => {
    const progress: number[] = [];
    const taskFactory = vi.fn(() => countingTask(50, progress));
    const deferred = createDeferredTask({ task: taskFactory, timeSliceMs: 0.0001 });
    deferred.start();
    expect(deferred.getSnapshot().status).toBe('processing');
    deferred.start();
    deferred.start();
    await deferred.settled;
    expect(taskFactory).toHaveBeenCalledTimes(1);
    expect(progress).toHaveLength(50);
  });

  it('start() after the task is done is a no-op and settled resolves only once', async () => {
    const deferred = createDeferredTask({ task: () => countingTask(1, []) });
    deferred.start();
    const first = await deferred.settled;
    deferred.start();
    const second = await deferred.settled;
    expect(second).toBe(first);
  });
});

describe('createDeferredTask() — errors', () => {
  it('a thrown error inside the generator stops the task, with no resolved value', async () => {
    function* throwing(): DeferredGenerator<number> {
      yield;
      throw new Error('bad step');
    }
    const deferred = createDeferredTask({ task: throwing });
    deferred.start();
    const result = await deferred.settled;
    expect(result.status).toBe('error');
    expect((result.error as Error).message).toBe('bad step');
    expect(result.value).toBeUndefined();
    expect(deferred.getSnapshot().status).toBe('error');
    expect(deferred.getSnapshot().error).toEqual(new Error('bad step'));
  });

  it('an error thrown on the very first step (before any yield) is still caught', async () => {
    function* throwsImmediately(): DeferredGenerator<number> {
      throw new Error('nope');

      yield;
    }
    const deferred = createDeferredTask({ task: throwsImmediately });
    deferred.start();
    const result = await deferred.settled;
    expect(result.status).toBe('error');
  });

  it('settled never rejects, even on error — only resolves with status "error"', async () => {
    function* throwing(): DeferredGenerator<number> {
      throw new Error('nope');

      yield;
    }
    const deferred = createDeferredTask({ task: throwing });
    deferred.start();
    await expect(deferred.settled).resolves.toMatchObject({ status: 'error' });
  });

  it('non-Error throw values are preserved as-is', async () => {
    function* throwsString(): DeferredGenerator<number> {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'a plain string failure';

      yield;
    }
    const deferred = createDeferredTask({ task: throwsString });
    deferred.start();
    const result = await deferred.settled;
    expect(result.error).toBe('a plain string failure');
  });
});

describe('createDeferredTask() — getSnapshot() referential stability', () => {
  it('returns the exact same reference across repeated calls between transitions', async () => {
    // useSyncExternalStore requires this: if getSnapshot() returns a new
    // object every call even when nothing changed, React treats the store
    // as "changed" on every render and spins forever. Regression coverage
    // for a real bug where this factory allocated a fresh object literal
    // on every getSnapshot() call instead of caching it like
    // createChunkScheduler() does.
    const deferred = createDeferredTask({ task: () => countingTask(3, []) });
    const beforeStart = deferred.getSnapshot();
    expect(deferred.getSnapshot()).toBe(beforeStart);

    deferred.start();
    await deferred.settled;
    const afterDone = deferred.getSnapshot();
    expect(deferred.getSnapshot()).toBe(afterDone);
    expect(afterDone).not.toBe(beforeStart);
  });

  it('the snapshot reference changes exactly once per actual transition, not per notification side-effect', async () => {
    const seenSnapshots = new Set<unknown>();
    const deferred = createDeferredTask({
      task: () => countingTask(20, []),
      timeSliceMs: 0.0001,
    });
    deferred.subscribe(() => {
      seenSnapshots.add(deferred.getSnapshot());
    });
    deferred.start();
    await deferred.settled;
    // idle->processing, then processing->done: exactly two distinct
    // snapshot objects should ever have existed, no matter how many
    // mid-flight notify() calls happened for yield-checkpoint progress.
    expect(seenSnapshots.size).toBe(2);
  });
});

describe('createDeferredTask() — getValue() timing contract', () => {
  it('returns undefined before the task settles, and the final value only once it does', async () => {
    const deferred = createDeferredTask({
      task: () => countingTask(3, []),
      timeSliceMs: 0.0001,
    });
    expect(deferred.getValue()).toBeUndefined();
    deferred.start();
    expect(deferred.getValue()).toBeUndefined();
    await deferred.settled;
    expect(deferred.getValue()).toBe(3);
  });
});

describe('createDeferredTask() — subscribe/unsubscribe', () => {
  it('notifies subscribers and stops notifying after unsubscribe', async () => {
    const listener = vi.fn();
    const deferred = createDeferredTask({ task: () => countingTask(2, []) });
    const unsubscribe = deferred.subscribe(listener);
    deferred.start();
    await deferred.settled;
    const callsSoFar = listener.mock.calls.length;
    expect(callsSoFar).toBeGreaterThan(0);

    unsubscribe();
    deferred.cancel(); // already terminal, nothing to notify about anyway
    expect(listener.mock.calls.length).toBe(callsSoFar);
  });
});

describe('createDeferredTask() — concurrent independent tasks', () => {
  it('two tasks running at once never cross-contaminate progress or results', async () => {
    const progressA: number[] = [];
    const progressB: number[] = [];

    const deferredA = createDeferredTask({
      task: () => countingTask(80, progressA),
      timeSliceMs: 0.0001,
    });
    const deferredB = createDeferredTask({
      task: () => countingTask(60, progressB),
      timeSliceMs: 0.0001,
    });

    deferredA.start();
    deferredB.start();

    const [resultA, resultB] = await Promise.all([deferredA.settled, deferredB.settled]);
    expect(resultA).toEqual({ status: 'done', value: 80 });
    expect(resultB).toEqual({ status: 'done', value: 60 });
    expect(progressA).toHaveLength(80);
    expect(progressB).toHaveLength(60);
  });
});
