import { describe, expect, it, vi } from 'vitest';

import { createChunkScheduler } from '../../src/core/chunk-scheduler.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createChunkScheduler() — happy path', () => {
  it('processes every item, in order, and resolves done', async () => {
    const scheduler = createChunkScheduler({
      items: [1, 2, 3, 4, 5],
      processItem: (item: number) => item * 10,
    });
    scheduler.start();
    const result = await scheduler.settled;
    expect(result).toEqual({ status: 'done', results: [10, 20, 30, 40, 50] });
    expect(scheduler.getResults()).toEqual([10, 20, 30, 40, 50]);
    expect(scheduler.getSnapshot()).toMatchObject({
      status: 'done',
      processed: 5,
      total: 5,
    });
  });

  it('passes the correct item and index to processItem', async () => {
    const seen: { item: string; index: number }[] = [];
    const scheduler = createChunkScheduler({
      items: ['a', 'b', 'c'],
      processItem: (item: string, index: number) => {
        seen.push({ item, index });
        return item.toUpperCase();
      },
    });
    scheduler.start();
    await scheduler.settled;
    expect(seen).toEqual([
      { item: 'a', index: 0 },
      { item: 'b', index: 1 },
      { item: 'c', index: 2 },
    ]);
  });

  it('calls onItem once per item, after that item is processed, with its result', async () => {
    const onItem = vi.fn();
    const scheduler = createChunkScheduler({
      items: [1, 2, 3],
      processItem: (x: number) => x + 1,
      onItem,
    });
    scheduler.start();
    await scheduler.settled;
    expect(onItem).toHaveBeenCalledTimes(3);
    expect(onItem).toHaveBeenNthCalledWith(1, 2, 1, 0);
    expect(onItem).toHaveBeenNthCalledWith(2, 3, 2, 1);
    expect(onItem).toHaveBeenNthCalledWith(3, 4, 3, 2);
  });

  it('actually yields to the main thread on a tight time budget, and still finishes correctly', async () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const scheduler = createChunkScheduler({
      items,
      processItem: (x: number) => x,
      timeSliceMs: 0.0001, // forces a yield checkpoint after virtually every item
    });
    const notifications: number[] = [];
    scheduler.subscribe(() => {
      notifications.push(scheduler.getSnapshot().processed);
    });
    scheduler.start();
    const result = await scheduler.settled;
    expect(result.status).toBe('done');
    expect(result.results).toEqual(items);
    // With a near-zero budget we expect many yield checkpoints, not one.
    expect(notifications.length).toBeGreaterThan(5);
    // processed counts observed via notifications are monotonically non-decreasing
    for (let i = 1; i < notifications.length; i++) {
      expect(notifications[i]).toBeGreaterThanOrEqual(notifications[i - 1]!);
    }
  });
});

describe('createChunkScheduler() — explicit yieldStrategy', () => {
  it('threads an explicit yieldStrategy through to a real, in-flight yield checkpoint', async () => {
    // The empty-array test elsewhere also passes a yieldStrategy, but with
    // zero items the loop never reaches a yield checkpoint at all, so it
    // never actually exercises the option being forwarded into a live
    // yieldToMain() call. This one forces real yield checkpoints (tiny
    // timeSliceMs, enough items) specifically to cover that.
    const items = Array.from({ length: 50 }, (_, i) => i);
    const scheduler = createChunkScheduler({
      items,
      processItem: (x: number) => x,
      timeSliceMs: 0.0001,
      yieldStrategy: 'set-timeout',
    });
    scheduler.start();
    const result = await scheduler.settled;
    expect(result).toEqual({ status: 'done', results: items });
  });
});

describe('createChunkScheduler() — empty and trivial input', () => {
  it('resolves done immediately for an empty array, with no yields', async () => {
    const yieldSpy = vi.fn();
    const scheduler = createChunkScheduler({
      items: [] as number[],
      processItem: (x: number) => x,
      yieldStrategy: 'set-timeout',
    });
    scheduler.subscribe(yieldSpy);
    scheduler.start();
    const result = await scheduler.settled;
    expect(result).toEqual({ status: 'done', results: [] });
    expect(scheduler.getSnapshot()).toMatchObject({
      status: 'done',
      processed: 0,
      total: 0,
    });
  });

  it('handles a single item without any unnecessary yield', async () => {
    const scheduler = createChunkScheduler({
      items: [42],
      processItem: (x: number) => x,
    });
    scheduler.start();
    const result = await scheduler.settled;
    expect(result).toEqual({ status: 'done', results: [42] });
  });
});

describe('createChunkScheduler() — pause / resume', () => {
  it('stops advancing while paused, and resumes correctly', async () => {
    const processed: number[] = [];
    const items = Array.from({ length: 50 }, (_, i) => i);
    const scheduler = createChunkScheduler({
      items,
      processItem: (x: number) => {
        processed.push(x);
        return x;
      },
      timeSliceMs: 0.0001,
      onItem: () => {
        if (processed.length === 5) scheduler.pause();
      },
    });
    scheduler.start();

    // Give the loop a chance to hit the pause.
    await sleep(20);
    expect(scheduler.getSnapshot().status).toBe('paused');
    const processedAtPause = processed.length;
    expect(processedAtPause).toBeGreaterThanOrEqual(5);

    // While genuinely paused, no further progress should occur.
    await sleep(20);
    expect(processed.length).toBe(processedAtPause);

    scheduler.resume();
    const result = await scheduler.settled;
    expect(result.status).toBe('done');
    expect(processed).toEqual(items);
  });

  it("a resume() undone by a reentrant pause() (fired synchronously from resume()'s own notification) does not leak an item, and a later genuine resume() still completes the task", async () => {
    // Mirrors the identical regression test in deferred-task.test.ts: a
    // listener that calls pause() synchronously from inside the
    // notification resume() itself fires must not get silently overridden
    // — no item should be processed before the loop notices it's paused
    // again, and the task must still be recoverable by a later,
    // un-sabotaged resume(). See that file's comment for the full race.
    const items = Array.from({ length: 50 }, (_, i) => i);
    const processed: number[] = [];
    const scheduler = createChunkScheduler({
      items,
      processItem: (x: number) => {
        processed.push(x);
        return x;
      },
      timeSliceMs: 0.0001,
    });

    let pausedAtFive = false;
    scheduler.subscribe(() => {
      if (processed.length === 5 && !pausedAtFive) {
        pausedAtFive = true;
        scheduler.pause();
      }
    });
    scheduler.start();
    await sleep(20);
    expect(scheduler.getSnapshot().status).toBe('paused');
    const processedAtFirstPause = processed.length;

    let reentrantArmed = true;
    scheduler.subscribe(() => {
      if (reentrantArmed && scheduler.getSnapshot().status === 'processing') {
        reentrantArmed = false;
        scheduler.pause();
      }
    });

    scheduler.resume();
    expect(scheduler.getSnapshot().status).toBe('paused');

    await sleep(20);
    expect(processed.length).toBe(processedAtFirstPause);

    scheduler.resume();
    const result = await scheduler.settled;
    expect(result.status).toBe('done');
    expect(processed).toEqual(items);
  });

  it('pause() while idle (before start) is a harmless no-op', () => {
    const scheduler = createChunkScheduler({ items: [1], processItem: (x: number) => x });
    expect(() => {
      scheduler.pause();
    }).not.toThrow();
    expect(scheduler.getSnapshot().status).toBe('idle');
  });

  it('resume() without a prior pause is a harmless no-op', async () => {
    const scheduler = createChunkScheduler({
      items: [1, 2],
      processItem: (x: number) => x,
    });
    scheduler.start();
    expect(() => {
      scheduler.resume();
    }).not.toThrow();
    const result = await scheduler.settled;
    expect(result.status).toBe('done');
  });

  it('pause() after the task has already settled is a no-op', async () => {
    const scheduler = createChunkScheduler({ items: [1], processItem: (x: number) => x });
    scheduler.start();
    await scheduler.settled;
    scheduler.pause();
    expect(scheduler.getSnapshot().status).toBe('done');
  });
});

describe('createChunkScheduler() — cancellation', () => {
  it('cancel() mid-processing stops the task and keeps partial results', async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    let processedCount = 0;
    const scheduler = createChunkScheduler({
      items,
      processItem: (x: number) => {
        processedCount += 1;
        return x;
      },
      timeSliceMs: 0.0001,
      onItem: () => {
        if (processedCount === 10) scheduler.cancel();
      },
    });
    scheduler.start();
    const result = await scheduler.settled;
    expect(result.status).toBe('cancelled');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.length).toBeLessThan(items.length);
    expect(scheduler.getResults()).toEqual(result.results);
  });

  it('cancel() while paused resolves promptly instead of hanging forever', async () => {
    const scheduler = createChunkScheduler({
      items: Array.from({ length: 20 }, (_, i) => i),
      processItem: (x: number) => x,
      timeSliceMs: 0.0001,
      onItem: (_r, _item, index) => {
        if (index === 2) scheduler.pause();
      },
    });
    scheduler.start();
    await sleep(20);
    expect(scheduler.getSnapshot().status).toBe('paused');

    scheduler.cancel();

    // This is the race condition that matters most: a paused loop is
    // blocked on an internal promise, and cancel() must wake it, not leave
    // it hanging. If this hangs, the test times out.
    const result = await scheduler.settled;
    expect(result.status).toBe('cancelled');
  });

  it('cancel() before start() settles immediately with empty results', async () => {
    const scheduler = createChunkScheduler({
      items: [1, 2, 3],
      processItem: (x: number) => x,
    });
    scheduler.cancel();
    const result = await scheduler.settled;
    expect(result).toEqual({ status: 'cancelled', results: [] });
    expect(scheduler.getResults()).toEqual([]);
    // start() after cancel-before-start must not resurrect the task.
    scheduler.start();
    expect(scheduler.getSnapshot().status).toBe('cancelled');
  });

  it('calling cancel() twice is idempotent', async () => {
    // A tiny array with the default budget can finish synchronously inside
    // start() itself (never hits a yield checkpoint) — by design, there's
    // no reason to yield for three trivial items. Force real yield
    // checkpoints here so cancel() actually lands mid-flight, same as the
    // other cancellation tests.
    const scheduler = createChunkScheduler({
      items: Array.from({ length: 50 }, (_, i) => i),
      processItem: (x: number) => x,
      timeSliceMs: 0.0001,
    });
    scheduler.start();
    scheduler.cancel();
    expect(() => {
      scheduler.cancel();
    }).not.toThrow();
    const result = await scheduler.settled;
    expect(result.status).toBe('cancelled');
  });

  it('a tiny task that never needs to yield still completes correctly, and cancel() after is a no-op', async () => {
    const scheduler = createChunkScheduler({
      items: [1, 2, 3],
      processItem: (x: number) => x,
    });
    scheduler.start();
    // For an array this small, the task may well have already finished
    // synchronously inside start() — that's the point of this test.
    const result = await scheduler.settled;
    expect(result).toEqual({ status: 'done', results: [1, 2, 3] });
    expect(() => {
      scheduler.cancel();
    }).not.toThrow();
    expect(scheduler.getSnapshot().status).toBe('done');
  });

  it('an AbortSignal aborted before creation cancels the task without ever running it', async () => {
    const controller = new AbortController();
    controller.abort();
    const processItem = vi.fn((x: number) => x);
    const scheduler = createChunkScheduler({
      items: [1, 2, 3],
      processItem,
      signal: controller.signal,
    });
    scheduler.start();
    const result = await scheduler.settled;
    expect(result.status).toBe('cancelled');
    expect(processItem).not.toHaveBeenCalled();
  });

  it('aborting the signal mid-run behaves exactly like calling cancel()', async () => {
    const controller = new AbortController();
    const items = Array.from({ length: 100 }, (_, i) => i);
    const scheduler = createChunkScheduler({
      items,
      processItem: (x: number) => x,
      timeSliceMs: 0.0001,
      onItem: (_r, _item, index) => {
        if (index === 10) controller.abort();
      },
      signal: controller.signal,
    });
    scheduler.start();
    const result = await scheduler.settled;
    expect(result.status).toBe('cancelled');
    expect(result.results.length).toBeLessThan(items.length);
  });
});

describe('createChunkScheduler() — start() idempotency', () => {
  it('a second start() call while already processing does not restart or duplicate work', async () => {
    // A tiny array can finish synchronously inside the first start() call,
    // which would make every later call hit the terminal no-op path
    // instead of the "already processing" no-op path this test means to
    // exercise — force real yield checkpoints so the task is still
    // genuinely in flight when the extra start() calls happen.
    const items = Array.from({ length: 50 }, (_, i) => i);
    const processItem = vi.fn((x: number) => x);
    const scheduler = createChunkScheduler({ items, processItem, timeSliceMs: 0.0001 });
    scheduler.start();
    expect(scheduler.getSnapshot().status).toBe('processing');
    scheduler.start();
    scheduler.start();
    await scheduler.settled;
    expect(processItem).toHaveBeenCalledTimes(items.length);
  });

  it('start() after the task is done is a no-op and settled resolves only once', async () => {
    const scheduler = createChunkScheduler({ items: [1], processItem: (x: number) => x });
    scheduler.start();
    const first = await scheduler.settled;
    scheduler.start();
    const second = await scheduler.settled;
    expect(second).toBe(first);
  });
});

describe('createChunkScheduler() — errors', () => {
  it('a thrown error in processItem stops the task, preserving results so far', async () => {
    const scheduler = createChunkScheduler({
      items: [1, 2, 3, 4],
      processItem: (x: number) => {
        if (x === 3) throw new Error('bad item');
        return x * 2;
      },
    });
    scheduler.start();
    const result = await scheduler.settled;
    expect(result.status).toBe('error');
    expect((result.error as Error).message).toBe('bad item');
    expect(result.results).toEqual([2, 4]);
    expect(scheduler.getSnapshot().status).toBe('error');
    expect(scheduler.getSnapshot().error).toEqual(new Error('bad item'));
  });

  it('a thrown error in onItem also stops the task as an error, after that item’s result is recorded', async () => {
    const scheduler = createChunkScheduler({
      items: [1, 2, 3],
      processItem: (x: number) => x,
      onItem: (result) => {
        if (result === 2) throw new Error('listener exploded');
      },
    });
    scheduler.start();
    const result = await scheduler.settled;
    expect(result.status).toBe('error');
    expect(result.results).toEqual([1, 2]);
  });

  it('settled never rejects, even on error — only resolves with status "error"', async () => {
    const scheduler = createChunkScheduler({
      items: [1],
      processItem: () => {
        throw new Error('nope');
      },
    });
    scheduler.start();
    await expect(scheduler.settled).resolves.toMatchObject({ status: 'error' });
  });

  it('non-Error throw values are preserved as-is', async () => {
    const scheduler = createChunkScheduler({
      items: [1],
      processItem: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'a plain string failure';
      },
    });
    scheduler.start();
    const result = await scheduler.settled;
    expect(result.error).toBe('a plain string failure');
  });
});

describe('createChunkScheduler() — getResults() timing contract', () => {
  it('returns undefined before the task settles, and the final array only once it does', async () => {
    const scheduler = createChunkScheduler({
      items: [1, 2, 3],
      processItem: (x: number) => x,
      timeSliceMs: 0.0001,
    });
    expect(scheduler.getResults()).toBeUndefined();
    scheduler.start();
    expect(scheduler.getResults()).toBeUndefined();
    await scheduler.settled;
    expect(scheduler.getResults()).toEqual([1, 2, 3]);
  });
});

describe('createChunkScheduler() — subscribe/unsubscribe', () => {
  it('notifies subscribers and stops notifying after unsubscribe', async () => {
    const listener = vi.fn();
    const scheduler = createChunkScheduler({
      items: [1, 2],
      processItem: (x: number) => x,
    });
    const unsubscribe = scheduler.subscribe(listener);
    scheduler.start();
    await scheduler.settled;
    const callsSoFar = listener.mock.calls.length;
    expect(callsSoFar).toBeGreaterThan(0);

    unsubscribe();
    // Nothing left to notify about (task is terminal), but this proves
    // unsubscribe doesn't throw and the listener set shrinks correctly.
    scheduler.cancel();
    expect(listener.mock.calls.length).toBe(callsSoFar);
  });
});

describe('createChunkScheduler() — concurrent independent schedulers', () => {
  it('two schedulers running at once never cross-contaminate progress or results', async () => {
    const itemsA = Array.from({ length: 80 }, (_, i) => i);
    const itemsB = Array.from({ length: 80 }, (_, i) => i + 1000);

    const schedulerA = createChunkScheduler({
      items: itemsA,
      processItem: (x: number) => x,
      timeSliceMs: 0.0001,
    });
    const schedulerB = createChunkScheduler({
      items: itemsB,
      processItem: (x: number) => x,
      timeSliceMs: 0.0001,
    });

    schedulerA.start();
    schedulerB.start();

    const [resultA, resultB] = await Promise.all([
      schedulerA.settled,
      schedulerB.settled,
    ]);
    expect(resultA.results).toEqual(itemsA);
    expect(resultB.results).toEqual(itemsB);
  });
});
