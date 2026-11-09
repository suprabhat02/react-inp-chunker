# INP benchmark: same work, five ways

A small React app that does the same heavy update five ways and measures how
responsive the page stays. It installs the published `react-inp-chunker` from
npm, the way any consumer would.

The work: score 20,000 rows (30 rounds of string hashing per row), then sort
and show the top results. Only the scheduling differs:

| Variant           | What it does                                                                    |
| ----------------- | ------------------------------------------------------------------------------- |
| Synchronous       | Scores every row inside the click handler.                                      |
| setTimeout chunks | Hand-written 5 ms slices, yielding with `setTimeout(0)`.                        |
| startTransition   | Wraps the update in a transition; the scoring runs during render.               |
| react-inp-chunker | `useChunkedTask(rows, scoreRow)`: 5 ms slices, yields with `scheduler.yield()`. |
| scheduler.yield   | Hand-written 5 ms slices, yielding with `scheduler.yield()`.                    |

## What is measured

Each run clicks **Score 20,000 rows**, then clicks **Click me while it runs**
50 ms later, while the rows are still being scored. For both clicks the app
records the time from the click event to the next animation frame: the
earliest moment its response can be painted. This is the delay INP measures,
recorded without the Event Timing API's 16 ms reporting threshold. It also
records the longest gap between frames during the run and the total time
until the results are on screen.

The script dispatches trusted clicks through the DevTools protocol and stamps
each one with the real time it was sent. DevTools delivers injected input one
event at a time, so without the timestamp a click sent while the main thread
is busy would be timed from when it was finally delivered, hiding the wait.

## Results

See [`results/RESULTS.md`](results/RESULTS.md) for the latest run, with the
browser, CPU and settings it was measured on, and
[`results/results.json`](results/results.json) for every sample.

The checked-in numbers come from headless Chromium on a 2-core cloud VM with
4x CPU throttling. Absolute values depend on the machine; run it on yours.

What the numbers show, and what they do not:

- Synchronous scoring and `startTransition` both leave a click made during
  the work waiting for the whole job. `startTransition` keeps the _first_
  click fast, but one long render still blocks the next interaction.
- All three time-sliced variants keep that second click near one frame.
- Yielding has a cost: the same work takes longer to finish than doing it in
  one block. How much depends on how the loop yields and how often the page
  repaints in between, not only on the clamp nested timers get.
- The hand-written `scheduler.yield()` loop keeps the longest frame around
  100 ms. That is not the final sort: Chromium runs `scheduler.yield()`
  continuations ahead of rendering, so the page paints only when its own
  starvation guard steps in. The `setTimeout` variant does the same sort but
  yields through ordinary tasks, so it paints between slices; its longest
  frame is that sort and the render after it.
- react-inp-chunker (0.5.0 and later) uses `scheduler.yield()` too, but once
  `paintIntervalMs` (33 ms) passes without a frame it yields behind rendering
  instead, so its longest frame matches the `setTimeout` variant's while it
  keeps `scheduler.yield()`'s throughput. In the checked-in run it also
  finished sooner than the hand-written loop, which publishes progress through
  a separate React render on every slice; treat that gap as specific to this
  page, not a general claim.

## Run it

```bash
cd bench/inp-demo
npm install
npm run build
npm run preview          # keep running, http://localhost:4173/
```

In a second terminal:

```bash
npx playwright install chromium   # once
npm run measure                   # writes results/results.json and RESULTS.md
npm run report                    # writes the charts, table and screenshots
```

Settings are environment variables: `RUNS` (default 30), `WARMUP` (3),
`CPU_RATE` (4), `WORK` (30 hash rounds per row), `PING_DELAY_MS` (50),
`HEADED=1` to watch, and `CHROMIUM_PATH` for a specific browser. For field
numbers, open the preview on a real phone and use DevTools remote debugging.
