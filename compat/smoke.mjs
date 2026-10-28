// The packed package, installed and loaded the way a consumer loads it.
// CI runs this on every supported Node version, against both supported
// React majors, and once more with --conditions=production.
//
// It is the check that would have caught 0.1.2 failing to load on React 18:
// a test suite that imports from src/ cannot see a broken exports map, a
// missing file, or a build that references an API the runtime lacks.
import assert from 'node:assert/strict';

import { createElement as h, version } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useChunkedTask, useDeferredTask } from 'react-inp-chunker';
import {
  DEFAULT_TIME_SLICE_MS,
  createChunkScheduler,
  createDeferredTask,
  resolveYieldStrategy,
  yieldToMain,
} from 'react-inp-chunker/core';

const expectedReactMajor = process.env.EXPECT_REACT_MAJOR;
if (expectedReactMajor !== undefined) {
  assert.equal(
    version.split('.')[0],
    expectedReactMajor,
    `expected React ${expectedReactMajor}, got ${version}`,
  );
}

function Chunked() {
  const task = useChunkedTask([1, 2, 3], (n) => n * 2, { batchSize: 2 });
  return h('p', null, `${task.status}:${String(task.processed)}/${String(task.total)}`);
}

function* answer() {
  yield;
  return 42;
}

function Deferred() {
  const task = useDeferredTask(() => answer(), []);
  return h('p', null, task.status);
}

// Server rendering must never run the work, on either hook.
assert.equal(
  renderToStaticMarkup(h('div', null, h(Chunked), h(Deferred))),
  '<div><p>idle:0/3</p><p>idle</p></div>',
);

assert.equal(DEFAULT_TIME_SLICE_MS, 5);
assert.ok(
  ['scheduler-yield', 'message-channel', 'set-timeout'].includes(resolveYieldStrategy()),
);

const scheduler = createChunkScheduler({ items: [1, 2, 3], processItem: (n) => n * 2 });
scheduler.start();
assert.deepEqual(await scheduler.settled, { status: 'done', results: [2, 4, 6] });
// The results arrive in the snapshot that reports the terminal status.
assert.deepEqual(scheduler.getSnapshot().results, [2, 4, 6]);

// collectResults: false streams through onItem without retaining anything.
const streamed = [];
const streaming = createChunkScheduler({
  items: [1, 2, 3],
  processItem: (n) => n + 1,
  onItem: (result) => streamed.push(result),
  collectResults: false,
  batchSize: 2,
});
streaming.start();
const streamingOutcome = await streaming.settled;
assert.deepEqual(streamed, [2, 3, 4]);
assert.deepEqual(streamingOutcome.results, []);

const deferred = createDeferredTask({ task: answer, batchSize: 4 });
deferred.start();
assert.deepEqual(await deferred.settled, { status: 'done', value: 42 });

// A leaked handle shows up as a process that finishes its work and then
// never exits, which the timeout around this script catches.
await yieldToMain();

const url = import.meta.resolve('react-inp-chunker/core');
const condition = url.includes('/dist/production/') ? 'production' : 'default';
console.log(
  `✓ import: Node ${process.versions.node}, React ${version}, ${condition} build`,
);
