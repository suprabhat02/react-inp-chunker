// The CommonJS half of consumer-smoke.mjs: the same checks through `require`.
const assert = require('node:assert/strict');

const { createElement: h, version } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { useChunkedTask, useDeferredTask } = require('react-inp-chunker');
const { createChunkScheduler, yieldToMain } = require('react-inp-chunker/core');

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

async function main() {
  const scheduler = createChunkScheduler({ items: [1, 2, 3], processItem: (n) => n * 2 });
  scheduler.start();
  assert.deepEqual(await scheduler.settled, { status: 'done', results: [2, 4, 6] });
  await yieldToMain();
  console.log(`✓ require: react-inp-chunker loads and renders on React ${version}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
