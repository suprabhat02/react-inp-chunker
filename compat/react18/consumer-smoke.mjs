// The packed package, installed into this folder the way a consumer installs
// it, on React 18: every entry point loads through `import`, and both hooks
// render. CI runs this after `npm pack` (see .github/workflows/ci.yml); it is
// the check that would have caught 0.1.2 failing to load on React 18.
import assert from 'node:assert/strict';

import { createElement as h, version } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useChunkedTask, useDeferredTask } from 'react-inp-chunker';
import { createChunkScheduler, yieldToMain } from 'react-inp-chunker/core';

assert.equal(version.split('.')[0], '18', `expected React 18, got ${version}`);

function Chunked() {
  const task = useChunkedTask([1, 2, 3], (n) => n * 2);
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

assert.equal(
  renderToStaticMarkup(h('div', null, h(Chunked), h(Deferred))),
  '<div><p>idle:0/3</p><p>idle</p></div>',
);

const scheduler = createChunkScheduler({ items: [1, 2, 3], processItem: (n) => n * 2 });
scheduler.start();
assert.deepEqual(await scheduler.settled, { status: 'done', results: [2, 4, 6] });
await yieldToMain();

console.log(`✓ import: react-inp-chunker loads and renders on React ${version}`);
