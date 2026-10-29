// A live version of `npm run bench`: the same comparison — a plain loop
// against `createChunkScheduler` over trivial items — run in the visitor's
// own browser instead of in Node. Trivial items are the worst case on
// purpose: when the work itself is nanoseconds, everything the engine does
// around it is the cost, and that's exactly what `batchSize` and
// `collectResults` trade away.
import { createChunkScheduler } from 'react-inp-chunker/core';

export const OVERHEAD_ITEMS = 200_000;
const RUNS = 5;

/** Deterministic, with a result that is returned, so nothing gets skipped. */
const work = (n: number): number => (n * 2654435761) % 4294967296;

function nsPerItem(ms: number): number {
  return (ms * 1e6) / OVERHEAD_ITEMS;
}

/** Fastest of RUNS: the one least disturbed by GC and by anything else on the page. */
async function fastest(run: () => void | Promise<void>): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    // eslint-disable-next-line no-await-in-loop -- each run must finish before the next starts
    await run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

export interface OverheadSettings {
  readonly batchSize: number;
  readonly collectResults: boolean;
}

export interface OverheadMeasurement {
  readonly plainLoopNs: number;
  readonly schedulerNs: number;
}

export async function measureOverhead(
  settings: OverheadSettings,
): Promise<OverheadMeasurement> {
  const items = Array.from({ length: OVERHEAD_ITEMS }, (_, i) => i);

  // Compared against a loop doing the same amount of work: collecting
  // results costs an array push per item, same as the scheduler does.
  const plainMs = await fastest(() => {
    if (!settings.collectResults) {
      let sink = 0;
      for (let i = 0; i < items.length; i++) sink += work(items[i] as number);
      return;
    }
    const out: number[] = [];
    for (let i = 0; i < items.length; i++) out.push(work(items[i] as number));
  });

  const schedulerMs = await fastest(async () => {
    const scheduler = createChunkScheduler({
      items,
      processItem: work,
      batchSize: settings.batchSize,
      collectResults: settings.collectResults,
    });
    scheduler.start();
    await scheduler.settled;
  });

  return { plainLoopNs: nsPerItem(plainMs), schedulerNs: nsPerItem(schedulerMs) };
}
