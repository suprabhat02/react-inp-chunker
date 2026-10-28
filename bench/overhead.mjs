// Per-item overhead of the engine against a plain synchronous loop.
//
// Trivial items are the worst case, and the point of the measurement: when
// the work itself is nanoseconds, everything the scheduler does around it —
// the clock read above all — is the cost. Run with:
//
//   npm run bench
//
// Numbers are "best of N" rather than an average: the fastest run is the
// one least disturbed by GC and by other work on the machine.
//
// Node's performance.now() costs about 60ns a call. A browser's costs about
// 300ns and is coarsened to 0.1ms, so the batched rows matter more there
// than these numbers suggest.
// The production build: what a bundler resolves for a real app, with the
// development diagnostics compiled out.
import {
  createChunkScheduler,
  createDeferredTask,
} from '../dist/production/core/index.js';

const ITEMS = 500_000;
const RUNS = 7;
const items = Array.from({ length: ITEMS }, (_, i) => i);
const work = (n) => (n * 2654435761) % 4294967296;

const perItemNs = (ms) => (ms * 1e6) / ITEMS;

async function best(fn) {
  let fastest = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    await fn();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

const rows = [];
const record = async (name, fn) => {
  const ms = await best(fn);
  rows.push({ name, ms, perItem: perItemNs(ms) });
};

const runScheduler = (options) => async () => {
  const scheduler = createChunkScheduler({ items, processItem: work, ...options });
  scheduler.start();
  await scheduler.settled;
};

// Two baselines, so each row is compared against a loop that does the same
// amount of work: collecting results costs an array push per item.
/* eslint-disable @typescript-eslint/prefer-for-of -- an indexed loop is the
   baseline being measured; for-of allocates an iterator result per item and
   would make the comparison a different one. */
await record('plain loop, collecting', () => {
  const out = [];
  for (let i = 0; i < items.length; i++) out.push(work(items[i]));
  return out.length;
});
await record('plain loop, not collecting', () => {
  let sink = 0;
  for (let i = 0; i < items.length; i++) sink += work(items[i]);
  return sink;
});
/* eslint-enable @typescript-eslint/prefer-for-of */

await record('createChunkScheduler', runScheduler({}));
await record('  batchSize: 16', runScheduler({ batchSize: 16 }));
await record('  batchSize: 64', runScheduler({ batchSize: 64 }));
await record(
  '  batchSize: 64, no results',
  runScheduler({ batchSize: 64, collectResults: false }),
);

function* segments() {
  for (let i = 0; i < ITEMS; i++) {
    work(i);
    yield;
  }
  return ITEMS;
}
const runDeferred = (options) => async () => {
  const task = createDeferredTask({ task: segments, ...options });
  task.start();
  await task.settled;
};
await record('createDeferredTask', runDeferred({}));
await record('  batchSize: 64', runDeferred({ batchSize: 64 }));

const collecting = rows[0].perItem;
const notCollecting = rows[1].perItem;
console.log(`${ITEMS.toLocaleString()} trivial items, best of ${RUNS}\n`);
for (const [index, row] of rows.entries()) {
  const isBaseline = index < 2;
  const baseline = row.name.includes('no results') ? notCollecting : collecting;
  const overhead = row.perItem - baseline;
  const sign = overhead < 0 ? '-' : '+';
  const suffix = isBaseline
    ? ''
    : `  ${sign}${Math.abs(overhead).toFixed(0)} ns/item vs the plain loop`;
  console.log(
    `${row.name.padEnd(30)} ${row.ms.toFixed(0).padStart(5)} ms  ${row.perItem.toFixed(0).padStart(4)} ns/item${suffix}`,
  );
}
