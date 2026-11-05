// Measures the five variants in a real Chromium with CPU throttling.
//
//   npm run build && npm run preview      (terminal 1)
//   npm run measure                       (terminal 2)
//
// Environment variables (all optional):
//   BASE_URL       default http://localhost:4173/
//   RUNS           measured runs per variant, default 30
//   WARMUP         unmeasured runs first, default 3
//   CPU_RATE       Chrome CPU throttling factor, default 4 (mid-range phone)
//   WORK           hash rounds per row, default 30
//   PING_DELAY_MS  when the second click lands after the first, default 50
//   HEADED=1       show the browser window
//   CHROMIUM_PATH  use a specific Chromium/Chrome executable
//
// Writes results/results.json and results/RESULTS.md.
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { chromium } from 'playwright';

const env = process.env;
const BASE_URL = env.BASE_URL ?? 'http://localhost:4173/';
const RUNS = Number(env.RUNS ?? 30);
const WARMUP = Number(env.WARMUP ?? 3);
const CPU_RATE = Number(env.CPU_RATE ?? 4);
const WORK = Number(env.WORK ?? 30);
const PING_DELAY_MS = Number(env.PING_DELAY_MS ?? 50);

const VARIANTS = [
  ['sync', 'Synchronous'],
  ['setTimeout', 'setTimeout chunks'],
  ['startTransition', 'startTransition'],
  ['chunker', 'react-inp-chunker'],
  ['yield', 'scheduler.yield'],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const summary = (values) => ({
  median: quantile(values, 0.5),
  p75: quantile(values, 0.75),
  max: Math.max(...values),
});

// Trusted clicks through the DevTools protocol. DevTools delivers injected
// input one event at a time, waiting for the page to finish handling the
// previous one, so a click sent while the main thread is busy would
// otherwise be stamped with the time it was finally delivered. Passing the
// real wall-clock time as `timestamp` makes event.timeStamp the moment the
// user clicked, so the wait for the main thread counts, as it does for a
// real user.
function clickAt(client, { x, y }) {
  const pressedAt = Date.now() / 1000;
  const base = { x, y, button: 'left', clickCount: 1 };
  return client
    .send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      timestamp: pressedAt,
      ...base,
    })
    .then(() =>
      client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        timestamp: pressedAt + 0.01,
        ...base,
      }),
    );
}

async function center(page, selector) {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const browser = await chromium.launch({
  headless: env.HEADED !== '1',
  ...(env.CHROMIUM_PATH ? { executablePath: env.CHROMIUM_PATH } : {}),
});
const results = [];

for (const [id, label] of VARIANTS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
  await page.goto(`${BASE_URL}?variant=${id}&work=${WORK}`);
  await page.locator('[data-testid="run"]').waitFor();
  const run = await center(page, '[data-testid="run"]');
  const ping = await center(page, '[data-testid="ping"]');

  const samples = [];
  for (let i = 0; i < WARMUP + RUNS; i += 1) {
    const before = await page.evaluate(() => {
      window.__interactions.length = 0;
      window.__events.length = 0;
      return window.__runs.length;
    });
    const first = clickAt(client, run);
    await sleep(PING_DELAY_MS);
    const second = clickAt(client, ping);
    await Promise.all([first, second]);
    await page.waitForFunction((n) => window.__runs.length > n, before, {
      timeout: 120_000,
    });
    // Let the ping's frame callback and any Event Timing entries arrive.
    await page.waitForFunction(() => window.__interactions.length >= 2, null, {
      timeout: 30_000,
    });
    await sleep(250);
    const sample = await page.evaluate(() => {
      const byName = (name) => window.__interactions.find((r) => r.name === name);
      const eventMax = (target) =>
        Math.max(
          0,
          ...window.__events.filter((e) => e.target === target).map((e) => e.duration),
        );
      const lastRun = window.__runs.at(-1);
      return {
        runClick: byName('run')?.toNextFrameMs,
        pingClick: byName('ping')?.toNextFrameMs,
        pingInputDelay: byName('ping')?.inputDelayMs,
        runEventTiming: eventMax('run'),
        pingEventTiming: eventMax('ping'),
        totalMs: lastRun.totalMs,
        longestFrameMs: lastRun.longestFrameMs,
      };
    });
    if (i >= WARMUP) samples.push(sample);
  }
  await page.close();

  const pick = (key) => samples.map((s) => s[key]).filter((v) => typeof v === 'number');
  const row = {
    id,
    label,
    runs: samples.length,
    runClick: summary(pick('runClick')),
    pingClick: summary(pick('pingClick')),
    pingInputDelay: summary(pick('pingInputDelay')),
    longestFrame: summary(pick('longestFrameMs')),
    total: summary(pick('totalMs')),
    samples,
  };
  results.push(row);
  console.log(
    `${label.padEnd(20)} click→frame ${row.runClick.median.toFixed(0)} ms | ping→frame median ${row.pingClick.median.toFixed(0)} p75 ${row.pingClick.p75.toFixed(0)} ms | longest frame ${row.longestFrame.median.toFixed(0)} ms | total ${row.total.median.toFixed(0)} ms`,
  );
}

const environment = {
  date: new Date().toISOString(),
  browser: `Chromium ${browser.version()}${env.HEADED === '1' ? '' : ' (headless)'}`,
  os: `${os.type()} ${os.release()} (${os.arch()})`,
  cpu: os.cpus()[0]?.model ?? 'unknown',
  cores: os.cpus().length,
  cpuThrottling: `${CPU_RATE}x`,
  rows: 20_000,
  hashRoundsPerRow: WORK,
  runsPerVariant: RUNS,
  warmupRuns: WARMUP,
  pingDelayMs: PING_DELAY_MS,
};
await browser.close();

const fmt = (n) => `${Math.round(n)}`;
const md = [
  '# INP benchmark results',
  '',
  `Measured ${environment.date} — ${environment.browser}, ${environment.os}, ${environment.cpu} (${environment.cores} cores), CPU throttling ${environment.cpuThrottling}. ${environment.rows.toLocaleString('en')} rows × ${WORK} hash rounds, ${RUNS} runs per variant after ${WARMUP} warm-up runs. A second click lands ${PING_DELAY_MS} ms after the first.`,
  '',
  '"Click → next frame" is the time from the click event to the next animation frame, i.e. the earliest moment its visual response can paint (an INP-style measure with no 16 ms threshold). Values in ms.',
  '',
  '| Variant | Run click → frame (median) | 2nd click → frame (median) | 2nd click → frame (p75) | Longest frame (median) | Total time (median) |',
  '|---|---:|---:|---:|---:|---:|',
  ...results.map(
    (r) =>
      `| ${r.label} | ${fmt(r.runClick.median)} | ${fmt(r.pingClick.median)} | ${fmt(r.pingClick.p75)} | ${fmt(r.longestFrame.median)} | ${fmt(r.total.median)} |`,
  ),
  '',
];
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../results/results.json', import.meta.url),
  JSON.stringify({ environment, results }, null, 2),
);
await writeFile(new URL('../results/RESULTS.md', import.meta.url), md.join('\n'));
console.log('\nWrote results/results.json and results/RESULTS.md');
