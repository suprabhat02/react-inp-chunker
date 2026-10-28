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
  /** A macrotask, long enough for a yielding loop to reach its pause gate. */
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
    const scheduler = create({
      items: Array.from({ length: 200 }, (_, i) => i),
      processItem: (item: number) => item,
      timeSliceMs: 0.0001, // yield at every opportunity
    });

    scheduler.start();
    scheduler.pause();
    await tick();
    // The loop is parked on its gate, which is the branch under test.
    expect(scheduler.getSnapshot().status).toBe('paused');
    scheduler.resume();
    const outcome = await scheduler.settled;

    expect(outcome.status).toBe('done');
    expect(outcome.results).toHaveLength(200);
    expect(warn).not.toHaveBeenCalled();
  });

  it('pauses, resumes and finishes a generator task without a word', async () => {
    const { createDeferredTask: create } = await loadProduction();
    function* work(): DeferredGenerator<number> {
      for (let i = 0; i < 200; i++) yield;
      return 200;
    }
    const task = create({ task: work, timeSliceMs: 0.0001 });

    task.start();
    task.pause();
    await tick();
    expect(task.getSnapshot().status).toBe('paused');
    task.resume();
    const outcome = await task.settled;

    expect(outcome.status).toBe('done');
    expect(outcome.value).toBe(200);
    expect(warn).not.toHaveBeenCalled();
  });
});
