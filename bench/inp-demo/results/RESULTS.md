# INP benchmark results

Measured 2026-11-09T11:44:24.504Z — Chromium 153.0.8010.12 (headless), Linux 6.18.44-fc-v310 (x64), Intel(R) Xeon(R) Processor @ 2.30GHz (2 cores), CPU throttling 4x. 20,000 rows × 30 hash rounds, 30 runs per variant after 3 warm-up runs. A second click lands 50 ms after the first.

"Click → next frame" is the time from the click event to the next animation frame, i.e. the earliest moment its visual response can paint (an INP-style measure with no 16 ms threshold). Values in ms.

| Variant | Run click → frame (median) | 2nd click → frame (median) | 2nd click → frame (p75) | Longest frame (median) | Total time (median) |
|---|---:|---:|---:|---:|---:|
| Synchronous | 157 | 116 | 125 | 160 | 157 |
| setTimeout chunks | 7 | 9 | 11 | 39 | 326 |
| startTransition | 4 | 124 | 134 | 162 | 186 |
| react-inp-chunker | 6 | 6 | 9 | 48 | 274 |
| scheduler.yield | 8 | 10 | 11 | 104 | 404 |
