// Turns results/results.json into blog-ready images:
//   results/chart-second-click.png   2nd click → next frame, per variant
//   results/chart-total-time.png     total time to finish, per variant
//   results/table.png                full results table with the setup
// and captures the demo itself after a run:
//   results/demo-chunker.png, results/demo-sync.png
//
// Needs the preview server running (npm run build && npm run preview).
// Run: npm run report   (CHROMIUM_PATH and BASE_URL as in measure.mjs)
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const env = process.env;
const BASE_URL = env.BASE_URL ?? 'http://localhost:4173/';
const out = (name) => new URL(`../results/${name}`, import.meta.url);
const { environment, results } = JSON.parse(await readFile(out('results.json'), 'utf8'));

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const round = (n) => Math.round(n);
const setup = `${esc(environment.browser)} · ${esc(environment.cpu)} (${environment.cores} cores) · CPU throttling ${esc(environment.cpuThrottling)} · ${environment.rows.toLocaleString('en')} rows × ${environment.hashRoundsPerRow} hash rounds · median of ${environment.runsPerVariant} runs per variant · ${esc(environment.date.slice(0, 10))}`;

function barChart({ title, subtitle, key, threshold, thresholdLabel, unit = 'ms' }) {
  const width = 1200;
  const left = 250;
  const right = 120;
  const rowH = 64;
  const top = 40;
  const max = Math.max(...results.map((r) => r[key].p75), threshold ?? 0) * 1.08;
  const x = (v) => left + ((width - left - right) * v) / max;
  const height = top + rowH * results.length + 40;
  const bars = results
    .map((r, i) => {
      const y = top + i * rowH;
      const median = r[key].median;
      const p75 = r[key].p75;
      const bad = threshold !== undefined && median > threshold;
      const fill =
        r.id === 'chunker'
          ? 'var(--accent)'
          : threshold === undefined
            ? 'var(--neutral)'
            : bad
              ? 'var(--bad)'
              : 'var(--ok)';
      return `
        <text x="${left - 16}" y="${y + 30}" text-anchor="end" class="label${r.id === 'chunker' ? ' strong' : ''}">${esc(r.label)}</text>
        <rect x="${left}" y="${y + 12}" width="${Math.max(2, x(median) - left)}" height="28" rx="6" fill="${fill}" />
        <line x1="${x(p75)}" x2="${x(p75)}" y1="${y + 8}" y2="${y + 44}" class="p75" />
        <text x="${Math.max(x(median), x(p75)) + 10}" y="${y + 31}" class="value">${round(median)} ${unit}<tspan class="muted"> · p75 ${round(p75)}</tspan></text>`;
    })
    .join('');
  const line =
    threshold === undefined
      ? ''
      : `<line x1="${x(threshold)}" x2="${x(threshold)}" y1="${top - 4}" y2="${height - 30}" class="threshold" />
         <text x="${x(threshold) + 6}" y="${top - 10}" class="muted">${esc(thresholdLabel)}</text>`;
  return `<section class="card"><h2>${esc(title)}</h2><p class="sub">${esc(subtitle)}</p>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">${line}${bars}</svg>
    <p class="setup">${setup}</p></section>`;
}

const table = `<section class="card"><h2>Same work, five ways: results</h2>
  <p class="sub">Median values in ms. "→ frame" is the time from the click to the next animation frame, when its response can first paint.</p>
  <table><thead><tr><th>Variant</th><th>Run click → frame</th><th>2nd click → frame</th><th>2nd click p75</th><th>Longest frame</th><th>Total time</th></tr></thead>
  <tbody>${results
    .map(
      (r) =>
        `<tr${r.id === 'chunker' ? ' class="hl"' : ''}><td>${esc(r.label)}</td><td>${round(r.runClick.median)}</td><td>${round(r.pingClick.median)}</td><td>${round(r.pingClick.p75)}</td><td>${round(r.longestFrame.median)}</td><td>${round(r.total.median)}</td></tr>`,
    )
    .join('')}</tbody></table><p class="setup">${setup}</p></section>`;

const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  :root { --bg:#f6f7f9; --card:#fff; --text:#15181e; --muted:#5b6372; --line:#e2e5eb; --accent:#e2481f; --ok:#2f9e63; --bad:#9aa1ad; --neutral:#9aa1ad; }
  * { box-sizing:border-box } body { margin:0; padding:32px; background:var(--bg); color:var(--text); font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }
  .card { width:1200px; padding:32px 36px; border:1px solid var(--line); border-radius:18px; background:var(--card); }
  h2 { margin:0 0 6px; font-size:28px; letter-spacing:-0.02em } .sub { margin:0 0 22px; color:var(--muted); font-size:16px; line-height:1.5 }
  svg { display:block; width:100%; height:auto } .label { font-size:17px; fill:var(--text) } .strong { font-weight:700 }
  .value { font: 600 16px ui-monospace,monospace; fill:var(--text) } .muted { fill:var(--muted); font-weight:400 }
  .p75 { stroke:var(--text); stroke-width:2 } .threshold { stroke:var(--muted); stroke-width:1.5; stroke-dasharray:5 5 }
  .setup { margin:18px 0 0; color:var(--muted); font-size:13px; line-height:1.5 }
  table { width:100%; border-collapse:collapse; font-size:16px } th,td { padding:12px 10px; border-bottom:1px solid var(--line); text-align:right }
  th:first-child,td:first-child { text-align:left } th { color:var(--muted); font-weight:600; font-size:14px }
  td { font-family:ui-monospace,monospace } td:first-child { font-family:inherit; font-weight:600 } tr.hl td { background:#fdebe5 }
</style></head><body>${body}</body></html>`;

const charts = {
  'chart-second-click': barChart({
    title: 'A click while the work runs: time to next frame',
    subtitle:
      'The second click lands 50 ms after the first, while 20,000 rows are being scored. Bar = median, tick = p75. Green = under 200 ms, grey = over.',
    key: 'pingClick',
    threshold: 200,
    thresholdLabel: '200 ms: "good" INP limit',
  }),
  'chart-total-time': barChart({
    title: 'The trade-off: total time until results appear',
    subtitle:
      'Yielding keeps the page responsive but the same work finishes later. Bar = median, tick = p75.',
    key: 'total',
  }),
  table,
};

const browser = await chromium.launch(
  env.CHROMIUM_PATH ? { executablePath: env.CHROMIUM_PATH } : {},
);
const shots = await browser.newPage({
  viewport: { width: 1264, height: 800 },
  deviceScaleFactor: 2,
});
for (const [name, body] of Object.entries(charts)) {
  const html = page(body);
  await writeFile(out(`${name}.html`), html);
  await shots.setContent(html);
  await shots.locator('.card').screenshot({ path: out(`${name}.png`).pathname });
}

// The demo itself after a run: react-inp-chunker at the same 4x throttling
// as the measurements, second run (no first-run warm-up), with two clicks on
// the second button made while the rows were being scored.
const demo = await browser.newPage({
  viewport: { width: 980, height: 820 },
  deviceScaleFactor: 2,
});
const client = await demo.context().newCDPSession(demo);
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const press = async (selector) => {
  const box = await demo.locator(selector).boundingBox();
  const at = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    button: 'left',
    clickCount: 1,
  };
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
};
for (const [variant, file] of [
  ['chunker', 'demo-chunker.png'],
  ['sync', 'demo-sync.png'],
]) {
  await demo.goto(`${BASE_URL}?variant=${variant}`);
  for (let i = 1; i <= 2; i += 1) {
    const started = press('[data-testid="run"]');
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (i === 2) {
      await press('[data-testid="ping"]');
      await press('[data-testid="ping"]');
    }
    await started;
    await demo.waitForFunction((n) => window.__runs.length >= n, i, { timeout: 60_000 });
  }
  await demo.waitForTimeout(300);
  await demo.screenshot({ path: out(file).pathname });
}
await browser.close();
console.log('Wrote chart, table and demo screenshots to results/');
