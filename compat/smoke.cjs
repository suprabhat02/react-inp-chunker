// The CommonJS half of smoke.mjs: the same package through `require`,
// which resolves the .d.cts declarations and the .cjs builds.
const assert = require('node:assert/strict');

const { createElement: h, version } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { useChunkedTask, useDeferredTask } = require('react-inp-chunker');
const { createChunkScheduler, yieldToMain } = require('react-inp-chunker/core');

const expectedReactMajor = process.env.EXPECT_REACT_MAJOR;
if (expectedReactMajor !== undefined) {
  assert.equal(
    version.split('.')[0],
    expectedReactMajor,
    `expected React ${expectedReactMajor}, got ${version}`,
  );
}

function Chunked() {
  const task = useChunkedTask([1, 2, 3], (n) => n * 2, { collectResults: false });
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
  const scheduler = createChunkScheduler({
    items: [1, 2, 3],
    processItem: (n) => n * 2,
    batchSize: 2,
  });
  scheduler.start();
  assert.deepEqual(await scheduler.settled, { status: 'done', results: [2, 4, 6] });
  await yieldToMain();

  const resolved = require.resolve('react-inp-chunker/core');
  const condition = resolved.includes('/dist/production/') ? 'production' : 'default';
  console.log(
    `✓ require: Node ${process.versions.node}, React ${version}, ${condition} build`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
