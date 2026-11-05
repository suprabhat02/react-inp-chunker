# INP benchmark results

Measured 2026-11-05T09:30:35.539Z — Chromium 141.0.7390.37 (headless), Linux 6.18.44-fc-v236 (x64), Intel(R) Xeon(R) Processor @ 2.80GHz (2 cores), CPU throttling 4x. 20,000 rows × 30 hash rounds, 30 runs per variant after 3 warm-up runs. A second click lands 50 ms after the first.

"Click → next frame" is the time from the click event to the next animation frame, i.e. the earliest moment its visual response can paint (an INP-style measure with no 16 ms threshold). Values in ms.

| Variant | Run click → frame (median) | 2nd click → frame (median) | 2nd click → frame (p75) | Longest frame (median) | Total time (median) |
|---|---:|---:|---:|---:|---:|
| Synchronous | 339 | 299 | 367 | 339 | 339 |
| setTimeout chunks | 8 | 12 | 17 | 65 | 714 |
| startTransition | 7 | 330 | 420 | 371 | 403 |
| react-inp-chunker | 18 | 12 | 16 | 127 | 534 |
| scheduler.yield | 7 | 13 | 17 | 121 | 660 |
