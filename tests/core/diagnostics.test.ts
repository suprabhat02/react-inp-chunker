import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createChunkScheduler } from '../../src/core/chunk-scheduler.js';
import { createDeferredTask } from '../../src/core/deferred-task.js';
import type { DeferredGenerator } from '../../src/core/deferred-task.js';
import { createDiagnostics, isDevelopment } from '../../src/core/diagnostics.js';

/**
 * The warnings exist to catch the two failures a caller cannot see from the
 * outside: work that no slice can shorten, and work so cheap that the clock
 * read costs more than it does. Both are asserted through the real engines,
 * on a virtual clock, so the thresholds are exact.
 */
function virtualClock() {
  let current = 0;
  vi.stubGlobal('performance', { now: () => current });
  return {
    advance: (ms: number) => {
      current += ms;
    },
  };
}

type WarnSpy = MockInstance<(...args: unknown[]) => void>;
let warn: WarnSpy;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as WarnSpy;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const messages = (): string[] =>
  warn.mock.calls.map((call: unknown[]) => String(call[0]));

/** The slice-level observation, as the engines make it: a baseline, then the check that ends the slice. */
function observeSlice(
  diagnostics: ReturnType<typeof createDiagnostics>,
  sliceMs: number,
  unitsInSlice: number,
): void {
  diagnostics.resumed(0, 0);
  diagnostics.sliceEnded(sliceMs, unitsInSlice);
}

describe('development diagnostics', () => {
  it('runs in this test environment, so the assertions below mean something', () => {
    expect(isDevelopment).toBe(true);
  });

  it('warns once when a single item outlasts a long task, naming the index and the fix', async () => {
    const clock = virtualClock();
    const scheduler = createChunkScheduler({
      items: [0, 1, 2, 3],
      processItem: (_item: number, index: number) => {
        clock.advance(index === 2 ? 73 : 0.1);
      },
    });
    scheduler.start();
    await scheduler.settled;

    const longTaskWarnings = messages().filter((message) => message.includes('73ms'));
    expect(longTaskWarnings).toHaveLength(1);
    expect(longTaskWarnings[0]).toContain('index 2');
    expect(longTaskWarnings[0]).toContain('processItem');
    expect(longTaskWarnings[0]).toContain('development only');
  });

  it('catches a slow first item too, which the warning used to treat as its baseline', async () => {
    const clock = virtualClock();
    const scheduler = createChunkScheduler({
      items: [0, 1, 2],
      processItem: (_item: number, index: number) => {
        clock.advance(index === 0 ? 61 : 0.1);
      },
    });
    scheduler.start();
    await scheduler.settled;

    const longTaskWarnings = messages().filter((message) => message.includes('61ms'));
    expect(longTaskWarnings).toHaveLength(1);
    expect(longTaskWarnings[0]).toContain('index 0');
  });

  it('warns only once however many slow items follow', async () => {
    const clock = virtualClock();
    const scheduler = createChunkScheduler({
      items: [0, 1, 2, 3, 4],
      processItem: () => {
        clock.advance(80);
      },
    });
    scheduler.start();
    await scheduler.settled;

    expect(
      messages().filter((message) => message.includes('blocks the main thread')),
    ).toHaveLength(1);
  });

  it('tells a generator to add yield points rather than to split items', async () => {
    const clock = virtualClock();
    function* work(): DeferredGenerator<number> {
      for (let i = 0; i < 3; i++) {
        clock.advance(60);
        yield;
      }
      return 3;
    }
    const task = createDeferredTask({ task: work });
    task.start();
    await task.settled;

    const warning = messages().find((message) =>
      message.includes('blocks the main thread'),
    );
    expect(warning).toBeDefined();
    expect(warning).toContain('segment');
    expect(warning).toContain('yield');
  });

  it('suggests a batch size when the clock costs more than the work', async () => {
    const clock = virtualClock();
    const scheduler = createChunkScheduler({
      // 0.1µs an item: a slice fits thousands, so the clock dominates.
      items: Array.from({ length: 100_000 }, (_, i) => i),
      processItem: () => {
        clock.advance(0.0001);
      },
      timeSliceMs: 5,
    });
    scheduler.start();
    await scheduler.settled;

    const suggestion = messages().find((message) => message.includes('batchSize'));
    expect(suggestion).toBeDefined();
    expect(suggestion).toMatch(/batchSize: \d+/);
    expect(suggestion).toContain('µs');
  });

  it('stays quiet when the caller already passed a batch size', async () => {
    const clock = virtualClock();
    const scheduler = createChunkScheduler({
      items: Array.from({ length: 100_000 }, (_, i) => i),
      processItem: () => {
        clock.advance(0.0001);
      },
      timeSliceMs: 5,
      batchSize: 64,
    });
    scheduler.start();
    await scheduler.settled;

    expect(messages().filter((message) => message.includes('batchSize'))).toHaveLength(0);
  });

  it('stays quiet for ordinary work', async () => {
    const clock = virtualClock();
    const scheduler = createChunkScheduler({
      items: Array.from({ length: 200 }, (_, i) => i),
      processItem: () => {
        clock.advance(1); // 1ms an item: neither too slow nor too cheap
      },
      timeSliceMs: 5,
    });
    scheduler.start();
    await scheduler.settled;

    expect(warn).not.toHaveBeenCalled();
  });

  it('judges nothing from a slice too small to be representative', () => {
    const diagnostics = createDiagnostics('item', 1);
    // Ten units is not enough to conclude anything about per-unit cost.
    observeSlice(diagnostics, 0.0001, 10);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores a slice the clock reported as taking no time at all', () => {
    const diagnostics = createDiagnostics('item', 1);
    observeSlice(diagnostics, 0, 10_000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('clamps its suggestion into a range that is worth taking', () => {
    const diagnostics = createDiagnostics('item', 1);
    // Absurdly cheap units would otherwise suggest an unbounded batch.
    observeSlice(diagnostics, 5, 50_000_000);
    const suggestion = messages().find((message) => message.includes('batchSize'));
    expect(suggestion).toContain('batchSize: 512');
  });

  it('scales the suggestion to the measured cost, never below a batch worth having', () => {
    const diagnostics = createDiagnostics('item', 1);
    // 1µs an item, the slowest work that still trips the warning: the
    // suggestion is the smallest one this can ever produce.
    observeSlice(diagnostics, 0.1, 100);
    const suggestion = messages().find((message) => message.includes('batchSize'));
    expect(suggestion).toContain('batchSize: 100');
  });

  it('says nothing when NODE_ENV is production, end to end through the engine', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    // A fresh module graph, so the engine picks up isDevelopment === false
    // and skips every diagnostic call — what a Node or SSR build does.
    const { createChunkScheduler: createProductionScheduler } =
      await import('../../src/core/chunk-scheduler.js');
    const { isDevelopment: productionFlag } =
      await import('../../src/core/diagnostics.js');
    expect(productionFlag).toBe(false);

    const clock = virtualClock();
    const scheduler = createProductionScheduler({
      items: [0, 1, 2],
      processItem: () => {
        clock.advance(5000); // would warn loudly in development
      },
    });
    scheduler.start();
    await scheduler.settled;

    expect(warn).not.toHaveBeenCalled();
  });

  it('ships a production twin that is inert and interchangeable', async () => {
    const twin = await import('../../src/core/diagnostics.production.js');

    expect(twin.isDevelopment).toBe(false);
    const diagnostics = twin.createDiagnostics();
    diagnostics.resumed(0, 0);
    diagnostics.check(5000, 1);
    diagnostics.sliceEnded(5, 100_000);
    diagnostics.finished(10, 'done');
    diagnostics.warn('never shown');

    expect(warn).not.toHaveBeenCalled();
  });

  it('describes a whole batch when the batch, not one item, was slow', () => {
    const diagnostics = createDiagnostics('item', 4);
    diagnostics.check(0, 4); // first check only sets the baseline
    diagnostics.check(120, 8);
    const warning = messages().find((message) => message.includes('120ms'));
    expect(warning).toContain('batch of 4 items');
  });

  it('does not mistake time spent paused for slow work', () => {
    const diagnostics = createDiagnostics('item', 1);
    diagnostics.check(0, 1);
    // A pause of a full minute, then work resumes.
    diagnostics.resumed(60_000, 1);
    diagnostics.check(60_001, 2);
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * The same engines with the development flag off: what Node, a server
 * render, or any build with NODE_ENV=production actually runs. These cover
 * the production side of every `isDevelopment` guard in the hot loops.
 */
describe('production module graph', () => {
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * Waits until the loop has actually parked on its pause gate, rather
   * than until pause() has merely been called. Asserting the status only
   * proves the flag was set; the loop may still be between yields, and
   * resuming then means the paused branch never runs. Progress standing
   * still across two macrotasks is the observable form of "parked".
   */
  async function waitUntilParked(readProgress: () => number): Promise<void> {
    let previous = -1;
    for (let attempt = 0; attempt < 50; attempt++) {
      await tick();
      const current = readProgress();
      if (current === previous) return;
      previous = current;
    }
    throw new Error('the task never parked');
  }

  async function loadProduction() {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const [chunkScheduler, deferredTask, diagnostics] = await Promise.all([
      import('../../src/core/chunk-scheduler.js'),
      import('../../src/core/deferred-task.js'),
      import('../../src/core/diagnostics.js'),
    ]);
    expect(diagnostics.isDevelopment).toBe(false);
    return {
      createChunkScheduler: chunkScheduler.createChunkScheduler,
      createDeferredTask: deferredTask.createDeferredTask,
    };
  }

  it('pauses, resumes and finishes a chunked task without a word', async () => {
    const { createChunkScheduler: create } = await loadProduction();
    // Paused from inside the work, so the loop's next status check is
    // guaranteed to see it and park.
    const scheduler = create({
      items: Array.from({ length: 200 }, (_, i) => i),
      processItem: (item: number) => {
        // Reads `scheduler` only once the work runs, which is after the
        // declaration below has completed.
        if (item === 20) scheduler.pause();
        return item;
      },
      timeSliceMs: 0.0001, // yield at every opportunity
    });

    scheduler.start();
    await waitUntilParked(() => scheduler.getSnapshot().processed);
    expect(scheduler.getSnapshot().status).toBe('paused');
    scheduler.resume();
    const outcome = await scheduler.settled;

    expect(outcome.status).toBe('done');
    expect(outcome.results).toHaveLength(200);
    expect(warn).not.toHaveBeenCalled();
  });

  it('pauses, resumes and finishes a generator task without a word', async () => {
    const { createDeferredTask: create } = await loadProduction();
    let segmentsRun = 0;
    function* work(): DeferredGenerator<number> {
      for (let i = 0; i < 200; i++) {
        segmentsRun += 1;
        // `task` is initialized before the generator is ever advanced.
        if (i === 20) task.pause();
        yield;
      }
      return 200;
    }
    const task = create({ task: work, timeSliceMs: 0.0001 });

    task.start();
    await waitUntilParked(() => segmentsRun);
    expect(task.getSnapshot().status).toBe('paused');
    task.resume();
    const outcome = await task.settled;

    expect(outcome.status).toBe('done');
    expect(outcome.value).toBe(200);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the Chrome DevTools Performance track (development only)', () => {
  type StampFn = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  let stamps: StampFn;
  const consoleWithStamp = console as { timeStamp?: unknown };
  let originalTimeStamp: unknown;

  // Not every console has timeStamp (vitest's doesn't; Chrome's does), so
  // install one rather than spy on one.
  beforeEach(() => {
    originalTimeStamp = consoleWithStamp.timeStamp;
    stamps = vi.fn<(...args: unknown[]) => void>();
    consoleWithStamp.timeStamp = stamps;
  });

  afterEach(() => {
    consoleWithStamp.timeStamp = originalTimeStamp;
  });

  /** A scheduler whose items each take 10 ms of virtual time. */
  function tenMsItems(
    count: number,
    options: { label?: string; timeSliceMs?: number } = {},
  ) {
    const clock = virtualClock();
    return createChunkScheduler({
      items: Array.from({ length: count }, (_, i) => i),
      processItem: (x: number) => {
        clock.advance(10);
        return x;
      },
      timeSliceMs: options.timeSliceMs ?? 15,
      ...(options.label !== undefined ? { label: options.label } : {}),
    });
  }

  it("draws every slice, then the whole run around them, on the task's own track", async () => {
    const scheduler = tenMsItems(5, { label: 'scoreRows' });
    scheduler.start();
    await scheduler.settled;

    const track = ['scoreRows', 'react-inp-chunker'];
    expect(stamps.mock.calls).toEqual([
      ['items 0–1', 0, 20, ...track, 'primary'],
      ['items 2–3', 20, 40, ...track, 'primary'],
      // The last slice ends with the task rather than with a yield.
      ['item 4', 40, 50, ...track, 'primary'],
      ['scoreRows: done, 5 items in 3 slices', 0, 50, ...track, 'primary-dark'],
    ]);
  });

  it('gives every unlabelled task a numbered track of its own, so concurrent runs never overlap', async () => {
    const first = tenMsItems(1);
    const second = tenMsItems(1);
    first.start();
    second.start();
    await Promise.all([first.settled, second.settled]);

    const tracks = new Set(stamps.mock.calls.map((call) => call[3]));
    expect(tracks.size).toBe(2);
    for (const track of tracks) expect(track).toMatch(/^task \d+$/);
    expect(stamps.mock.calls.at(-1)?.[0]).toBe('task: done, 1 item in 1 slice');
  });

  it('treats a blank label as no label', async () => {
    const scheduler = tenMsItems(1, { label: '   ' });
    scheduler.start();
    await scheduler.settled;
    expect(stamps.mock.calls.at(-1)?.[3]).toMatch(/^task \d+$/);
  });

  it('colours the run by how it ended: cancelled, and failed, for a generator task too', async () => {
    const clock = virtualClock();
    const holder: { task?: ReturnType<typeof createChunkScheduler<number, number>> } = {};
    holder.task = createChunkScheduler({
      items: [0, 1, 2, 3],
      processItem: (x: number) => {
        clock.advance(10);
        return x;
      },
      timeSliceMs: 15,
      label: 'cancelled',
      onSlice: () => {
        queueMicrotask(() => holder.task?.cancel());
      },
    });
    holder.task.start();
    await holder.task.settled;
    expect(stamps.mock.calls.at(-1)).toEqual([
      'cancelled: cancelled, 2 items in 1 slice',
      0,
      20,
      'cancelled',
      'react-inp-chunker',
      'secondary',
    ]);

    stamps.mockClear();
    function* failing(): DeferredGenerator<number> {
      clock.advance(10);
      yield;
      throw new Error('bad segment');
    }
    const failed = createDeferredTask({ task: failing, label: 'parse' });
    failed.start();
    await failed.settled;
    expect(stamps.mock.calls.at(-1)).toEqual([
      'parse: error, 1 segment in 1 slice',
      // The same virtual clock as the cancelled run above, which ended at 20.
      20,
      30,
      'parse',
      'react-inp-chunker',
      'error',
    ]);
  });

  it('draws nothing for a task cancelled before its first slice', async () => {
    const scheduler = tenMsItems(3, { label: 'never ran' });
    scheduler.start();
    scheduler.cancel();
    await scheduler.settled;
    expect(stamps).not.toHaveBeenCalled();
  });

  it('carries on silently where console.timeStamp does not exist', async () => {
    consoleWithStamp.timeStamp = undefined;
    const scheduler = tenMsItems(2, { label: 'no devtools' });
    scheduler.start();
    await expect(scheduler.settled).resolves.toMatchObject({ status: 'done' });
  });

  it("prefixes the task's development warnings with its label", async () => {
    const scheduler = createChunkScheduler({
      items: [1],
      processItem: (x: number) => Promise.resolve(x),
      label: 'importRows',
    });
    scheduler.start();
    await scheduler.settled;
    expect(messages()[0]).toMatch(
      /^\[react-inp-chunker\] "importRows": processItem returned a Promise/,
    );
  });
});
