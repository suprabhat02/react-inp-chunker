// What jsdom cannot test: whether the main thread is actually given back.
//
// jsdom has no renderer, no input queue and no scheduler.yield(), so the
// unit suite can only prove the engine's bookkeeping. These run the built
// package in real engines — Chromium for the scheduler.yield() path, WebKit
// for the MessageChannel fallback — and measure how long a high-priority
// task has to wait while the engine is working. That wait is the thing the
// library exists to bound.
//
//   npm run test:browser                  # whatever BROWSERS says, default chromium
//   BROWSERS=chromium,webkit npm run test:browser
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import process from 'node:process';

import playwright from 'playwright';

const root = process.cwd();
const browsers = (process.env['BROWSERS'] ?? 'chromium').split(',').filter(Boolean);

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>react-inp-chunker browser tests</title>
<body><script type="module">
  import * as lib from '/dist/core/index.js';
  window.lib = lib;
  window.ready = true;
</script></body>`;

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Serves the repository so the page can import the real built files. */
async function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(PAGE);
      return;
    }
    // Normalized and prefix-checked: this serves a directory to a browser.
    const filePath = join(root, normalize(url.pathname));
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    readFile(filePath).then(
      (contents) => {
        response.writeHead(200, {
          'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
        });
        response.end(contents);
      },
      () => response.writeHead(404).end(),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * Runs in the page. Measures how long a user-blocking task waits while the
 * same workload runs chunked and unchunked — the input delay a real click
 * would see at that moment.
 */
async function measureInPage({ totalWorkMs, timeSliceMs, hideSchedulerYield }) {
  const { createChunkScheduler, resolveYieldStrategy, supportsSchedulerYield } =
    window.lib;

  // Simulates an engine without scheduler.yield() — Safari today, and any
  // browser older than Chrome 129 or Firefox 142 — so the MessageChannel
  // fallback is exercised wherever these tests run, not only where a
  // WebKit build happens to be installed.
  const hiddenScheduler = globalThis.scheduler;
  if (hideSchedulerYield && hiddenScheduler !== undefined) {
    Object.defineProperty(globalThis, 'scheduler', {
      value: undefined,
      configurable: true,
    });
  }
  const restoreScheduler = () => {
    if (hideSchedulerYield && hiddenScheduler !== undefined) {
      Object.defineProperty(globalThis, 'scheduler', {
        value: hiddenScheduler,
        configurable: true,
      });
    }
  };

  /** Busy-waits for about `ms`, the way slow synchronous work does. */
  const burn = (ms) => {
    const end = performance.now() + ms;
    let sink = 0;
    while (performance.now() < end) sink += Math.sqrt(sink + 1);
    return sink;
  };

  const PROBE_INTERVAL_MS = 4;
  // The probe must keep working even when scheduler is hidden above, so it
  // reads from the saved reference rather than the global.
  const probeScheduler = hideSchedulerYield ? hiddenScheduler : globalThis.scheduler;
  const canPostTask = typeof probeScheduler?.postTask === 'function';

  /**
   * A probe at the priority input gets: it cannot run until whatever holds
   * the thread lets go, so how late it runs is the input delay.
   */
  function startProbe() {
    let stopped = false;
    let worst = 0;
    const schedule = () => {
      if (stopped) return;
      const due = performance.now() + PROBE_INTERVAL_MS;
      const run = () => {
        if (stopped) return;
        worst = Math.max(worst, performance.now() - due);
        schedule();
      };
      if (canPostTask) {
        probeScheduler
          .postTask(run, { priority: 'user-blocking', delay: PROBE_INTERVAL_MS })
          .catch(() => undefined);
      } else {
        setTimeout(run, PROBE_INTERVAL_MS);
      }
    };
    schedule();
    return () => {
      stopped = true;
      return worst;
    };
  }

  // Calibrate so both runs do the same amount of work on this machine.
  const ITEMS = 400;
  const perItemMs = totalWorkMs / ITEMS;
  const items = Array.from({ length: ITEMS }, (_, i) => i);

  // Unchunked: one long task.
  const stopBlockingProbe = startProbe();
  const blockingStarted = performance.now();
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  for (const _item of items) burn(perItemMs);
  const blockingMs = performance.now() - blockingStarted;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const blockingWorstDelay = stopBlockingProbe();

  // Chunked: the same work through the engine.
  let schedulerYieldCalls = 0;
  let messageChannelCount = 0;
  const nativeYield = globalThis.scheduler?.yield;
  const NativeMessageChannel = globalThis.MessageChannel;
  if (typeof nativeYield === 'function') {
    globalThis.scheduler.yield = function patched(...args) {
      schedulerYieldCalls += 1;
      return nativeYield.apply(this, args);
    };
  }
  globalThis.MessageChannel = class CountingMessageChannel extends NativeMessageChannel {
    constructor() {
      super();
      messageChannelCount += 1;
    }
  };

  const stopChunkedProbe = startProbe();
  const chunkedStarted = performance.now();
  const engine = createChunkScheduler({
    items,
    processItem: () => burn(perItemMs),
    timeSliceMs,
    collectResults: false,
  });
  engine.start();
  const outcome = await engine.settled;
  const chunkedMs = performance.now() - chunkedStarted;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const chunkedWorstDelay = stopChunkedProbe();

  // Read while the environment is still the one under test: restoring the
  // scheduler first would report what this browser can do, not what the
  // run actually did.
  const strategy = resolveYieldStrategy();
  const schedulerYieldAvailable = supportsSchedulerYield();

  if (typeof nativeYield === 'function') globalThis.scheduler.yield = nativeYield;
  globalThis.MessageChannel = NativeMessageChannel;
  restoreScheduler();

  return {
    status: outcome.status,
    processed: engine.getSnapshot().processed,
    blockingMs,
    chunkedMs,
    blockingWorstDelay,
    chunkedWorstDelay,
    strategy,
    supportsSchedulerYield: schedulerYieldAvailable,
    schedulerYieldCalls,
    messageChannelCount,
    usedPostTaskProbe: canPostTask,
  };
}

/** A long task by the browser's own definition: past this, input waits. */
const LONG_TASK_MS = 50;

async function runFor(browserName, url) {
  const browser = await playwright[browserName].launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.ready === true);

    for (const hideSchedulerYield of [false, true]) {
      const measured = await page.evaluate(measureInPage, {
        totalWorkMs: 600,
        timeSliceMs: 5,
        hideSchedulerYield,
      });
      assert.deepEqual(pageErrors, [], 'the page threw');
      check(browserName, browser.version(), measured, hideSchedulerYield);
    }
  } finally {
    await browser.close();
  }
}

function check(browserName, browserVersion, measured, hideSchedulerYield) {
  const report = [
    `  work ran chunked in ${measured.chunkedMs.toFixed(0)}ms, unchunked in ${measured.blockingMs.toFixed(0)}ms`,
    `  worst input delay: ${measured.chunkedWorstDelay.toFixed(0)}ms chunked, ${measured.blockingWorstDelay.toFixed(0)}ms unchunked`,
    `  strategy: ${measured.strategy} (scheduler.yield calls: ${measured.schedulerYieldCalls}, MessageChannels: ${measured.messageChannelCount})`,
  ].join('\n');

  // The work actually happened, both times.
  assert.equal(measured.status, 'done');
  assert.equal(measured.processed, 400);

  // The promise: while the engine works, a user-blocking task still runs
  // promptly. The bound is the browser's own long-task threshold.
  assert.ok(
    measured.chunkedWorstDelay < LONG_TASK_MS,
    `chunked run blocked input for ${measured.chunkedWorstDelay.toFixed(0)}ms, expected under ${LONG_TASK_MS}ms\n${report}`,
  );

  // And the control: the same work unchunked really does block, so the
  // measurement above is measuring something.
  assert.ok(
    measured.blockingWorstDelay > 3 * LONG_TASK_MS,
    `unchunked run only blocked input for ${measured.blockingWorstDelay.toFixed(0)}ms, so this test is not measuring what it claims\n${report}`,
  );

  // The engine picked the best primitive this engine offers, and actually
  // used it — not just reported it.
  const expectedStrategy = measured.supportsSchedulerYield
    ? 'scheduler-yield'
    : 'message-channel';
  assert.equal(measured.strategy, expectedStrategy);
  if (expectedStrategy === 'scheduler-yield') {
    assert.ok(
      measured.schedulerYieldCalls > 0,
      `strategy is scheduler-yield but scheduler.yield() was never called\n${report}`,
    );
  } else {
    assert.ok(
      measured.messageChannelCount > 0,
      `strategy is message-channel but no MessageChannel was created\n${report}`,
    );
  }

  const scenario = hideSchedulerYield ? 'without scheduler.yield()' : 'as shipped';
  console.log(`✓ ${browserName} ${browserVersion}, ${scenario}`);
  console.log(report);
}

const server = await startServer();
let failed = false;
try {
  for (const browserName of browsers) {
    try {
      await runFor(browserName, server.url);
    } catch (error) {
      failed = true;
      console.error(`✗ ${browserName}: ${error.message}`);
    }
  }
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
