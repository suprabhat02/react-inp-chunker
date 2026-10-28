import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChunkScheduler } from '../../src/core/chunk-scheduler.js';
import { createDeferredTask } from '../../src/core/deferred-task.js';
import type { DeferredGenerator } from '../../src/core/deferred-task.js';

/**
 * The library's central promise is a bound on how long a single slice can
 * hold the main thread. These tests prove it rather than time it: the clock
 * is virtual, so "a 20ms item" is exact and the assertions can be about the
 * bound itself instead of about whatever the CI machine happened to do.
 *
 * Slices are reconstructed from notifications: the engine notifies after
 * every yield, and the virtual clock only moves inside the work, so each
 * notification timestamp is the end of a slice.
 */
function virtualClock() {
  let current = 0;
  vi.stubGlobal('performance', { now: () => current });
  return {
    advance: (ms: number) => {
      current += ms;
    },
    read: () => current,
  };
}

interface Timeline {
  readonly sliceEnds: readonly number[];
  readonly longestSliceMs: number;
}

function timeline(sliceEnds: readonly number[]): Timeline {
  let longest = 0;
  let previous = 0;
  for (const end of sliceEnds) {
    longest = Math.max(longest, end - previous);
    previous = end;
  }
  return { sliceEnds, longestSliceMs: longest };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('slice bounds — one item of overshoot, whatever the work costs', () => {
  it('ends a slice as soon as the budget is spent, and never mid-item', async () => {
    const clock = virtualClock();
    const ends: number[] = [];

    // Each item costs 2ms against a 5ms budget, so three items spend it.
    const scheduler = createChunkScheduler({
      items: Array.from({ length: 9 }, (_, i) => i),
      processItem: () => {
        clock.advance(2);
      },
      timeSliceMs: 5,
    });
    scheduler.subscribe(() => ends.push(clock.read()));
    scheduler.start();
    await scheduler.settled;

    const { longestSliceMs } = timeline(ends);
    // 5ms of budget, plus the item that was running when it ran out.
    expect(longestSliceMs).toBeLessThanOrEqual(5 + 2);
    expect(longestSliceMs).toBe(6);
  });

  it('holds the bound when per-item cost jumps by four orders of magnitude', async () => {
    const clock = virtualClock();
    const ends: number[] = [];
    // 200 items of a microsecond, then items of 20ms each: the shape that
    // breaks any scheduler that extrapolates from how fast the last batch
    // went instead of checking the clock.
    const costOf = (index: number) => (index < 200 ? 0.001 : 20);

    const scheduler = createChunkScheduler({
      items: Array.from({ length: 210 }, (_, i) => i),
      processItem: (_item: number, index: number) => {
        clock.advance(costOf(index));
      },
      timeSliceMs: 5,
    });
    scheduler.subscribe(() => ends.push(clock.read()));
    scheduler.start();
    await scheduler.settled;

    const { longestSliceMs } = timeline(ends);
    // The worst slice is one that started, ran a single 20ms item and
    // stopped: the budget plus one item, never a run of them.
    expect(longestSliceMs).toBeLessThanOrEqual(5 + 20);
  });

  it('bounds a generator the same way, per segment', async () => {
    const clock = virtualClock();
    const ends: number[] = [];

    function* work(): DeferredGenerator<number> {
      for (let i = 0; i < 12; i++) {
        clock.advance(i < 6 ? 0.001 : 30);
        yield;
      }
      return 12;
    }

    const task = createDeferredTask({ task: work, timeSliceMs: 5 });
    task.subscribe(() => ends.push(clock.read()));
    task.start();
    await task.settled;

    expect(timeline(ends).longestSliceMs).toBeLessThanOrEqual(5 + 30);
  });
});

describe('batchSize — the documented trade-off, measured', () => {
  it('spends the clock check across the batch, and overshoots by at most one batch', async () => {
    const clock = virtualClock();
    const ends: number[] = [];
    const batchSize = 8;
    const itemCostMs = 20;

    const scheduler = createChunkScheduler({
      items: Array.from({ length: 200 }, (_, i) => i),
      processItem: (_item: number, index: number) => {
        clock.advance(index < 100 ? 0.001 : itemCostMs);
      },
      timeSliceMs: 5,
      batchSize,
    });
    scheduler.subscribe(() => ends.push(clock.read()));
    scheduler.start();
    await scheduler.settled;

    const { longestSliceMs } = timeline(ends);
    // Exactly what the option documents: the budget, plus a whole batch of
    // the most expensive items rather than a single one.
    expect(longestSliceMs).toBeLessThanOrEqual(5 + batchSize * itemCostMs);
    // And it really does cost more than the default would — the trade is
    // real, not theoretical.
    expect(longestSliceMs).toBeGreaterThan(5 + itemCostMs);
  });

  it('processes every item exactly once regardless of how the batches divide', async () => {
    const seen: number[] = [];
    const scheduler = createChunkScheduler({
      // 25 items with a batch of 8: the last batch is deliberately partial.
      items: Array.from({ length: 25 }, (_, i) => i),
      processItem: (item: number) => item,
      onItem: (result) => seen.push(result),
      batchSize: 8,
    });
    scheduler.start();
    const outcome = await scheduler.settled;

    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(outcome.results).toEqual(seen);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])(
    'falls back to one item per check for a %s batch size',
    async (_label, batchSize) => {
      const clock = virtualClock();
      const ends: number[] = [];
      const scheduler = createChunkScheduler({
        items: Array.from({ length: 6 }, (_, i) => i),
        processItem: () => {
          clock.advance(10);
        },
        timeSliceMs: 5,
        batchSize,
      });
      scheduler.subscribe(() => ends.push(clock.read()));
      scheduler.start();
      await scheduler.settled;

      expect(timeline(ends).longestSliceMs).toBe(10);
    },
  );

  it('rounds a fractional batch size down to whole items', async () => {
    const order: number[] = [];
    const scheduler = createChunkScheduler({
      items: [0, 1, 2, 3, 4],
      processItem: (item: number) => item,
      onItem: (result) => order.push(result),
      batchSize: 2.9,
      timeSliceMs: 0.0001, // yield at every opportunity
    });
    scheduler.start();
    await scheduler.settled;
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('collectResults', () => {
  it('still reports progress and streams through onItem without retaining results', async () => {
    const streamed: number[] = [];
    const scheduler = createChunkScheduler({
      items: Array.from({ length: 50 }, (_, i) => i),
      processItem: (item: number) => item * 2,
      onItem: (result) => streamed.push(result),
      collectResults: false,
    });
    scheduler.start();
    const outcome = await scheduler.settled;

    expect(streamed).toHaveLength(50);
    expect(outcome.status).toBe('done');
    // Documented: opting out means an empty array, not undefined.
    expect(outcome.results).toEqual([]);
    expect(scheduler.getResults()).toEqual([]);
    expect(scheduler.getSnapshot().processed).toBe(50);
  });

  it('collects by default', async () => {
    const scheduler = createChunkScheduler({
      items: [1, 2, 3],
      processItem: (item: number) => item * 10,
    });
    scheduler.start();
    await scheduler.settled;
    expect(scheduler.getResults()).toEqual([10, 20, 30]);
  });
});

describe('snapshot consistency', () => {
  it('carries the results in the same snapshot that first reports a terminal status', async () => {
    const observed: { status: string; hasResults: boolean }[] = [];
    const scheduler = createChunkScheduler({
      items: [1, 2, 3],
      processItem: (item: number) => item,
    });
    scheduler.subscribe(() => {
      const snapshot = scheduler.getSnapshot();
      observed.push({
        status: snapshot.status,
        hasResults: snapshot.results !== undefined,
      });
    });
    scheduler.start();
    await scheduler.settled;

    // Whenever a subscriber saw a terminal status, the results were there.
    const terminal = observed.filter((entry) => entry.status === 'done');
    expect(terminal.length).toBeGreaterThan(0);
    expect(terminal.every((entry) => entry.hasResults)).toBe(true);
  });

  it('carries partial results with a cancellation', async () => {
    const observed: { status: string; hasResults: boolean }[] = [];
    const scheduler = createChunkScheduler({
      items: Array.from({ length: 1000 }, (_, i) => i),
      processItem: (item: number) => item,
      timeSliceMs: 0.0001,
    });
    scheduler.subscribe(() => {
      const snapshot = scheduler.getSnapshot();
      observed.push({
        status: snapshot.status,
        hasResults: snapshot.results !== undefined,
      });
    });
    scheduler.start();
    scheduler.cancel();
    await scheduler.settled;

    const terminal = observed.filter((entry) => entry.status === 'cancelled');
    expect(terminal.some((entry) => entry.hasResults)).toBe(true);
  });

  it('returns the identical snapshot object until something actually changes', () => {
    const scheduler = createChunkScheduler({
      items: [1, 2, 3],
      processItem: (item: number) => item,
    });
    const first = scheduler.getSnapshot();
    expect(scheduler.getSnapshot()).toBe(first);
    scheduler.pause(); // idle, so nothing transitions
    expect(scheduler.getSnapshot()).toBe(first);
  });
});
