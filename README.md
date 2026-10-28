# react-inp-chunker

[![npm version](https://img.shields.io/npm/v/react-inp-chunker.svg)](https://www.npmjs.com/package/react-inp-chunker)
[![CI](https://github.com/suprabhat02/react-inp-chunker/actions/workflows/ci.yml/badge.svg)](https://github.com/suprabhat02/react-inp-chunker/actions/workflows/ci.yml)

**Run heavy JavaScript without freezing your React app.** React/TypeScript hooks
that split long-running work into slices of a few milliseconds and hand the main
thread back to the browser between them, so clicks and typing stay responsive and
Interaction to Next Paint (INP) stays good.

**[Documentation and live playground](https://suprabhat02.github.io/react-inp-chunker/)**:
run the same work with and without chunking, type while it runs, and see the
difference measured in your own browser.

## The problem

One thread runs your JavaScript, handles every click and key press, and paints the
screen. While a function runs, everything else waits. Filter 20,000 rows, parse a
large CSV or build a search index inside a React component, and a click in that
window sits in a queue until the function returns. Any task over 50 ms is a _long
task_, and an interaction that lands in one is the most common way to fail
[INP](https://web.dev/articles/inp), the Core Web Vital for responsiveness.

## What this does

It doesn't make the work faster. It makes sure the work never holds the main
thread for more than a few milliseconds at a time: process items until the time
slice (5 ms by default) is used up, yield so the browser can handle input and
paint, then carry on where it stopped. It yields with the best tool the browser
has:

1. [`scheduler.yield()`](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield)
   in Chrome 129+, Edge 129+ and Firefox 142+. Made for exactly this: the work
   resumes ahead of other queued tasks.
2. `MessageChannel` in Safari and older browsers. Not clamped to the ~4 ms floor
   that nested `setTimeout` calls get.
3. `setTimeout(0)` as the last resort.

No dependencies beyond React. The scheduling engine (`react-inp-chunker/core`)
doesn't import React at all, so it also works in plain TypeScript, a Web Worker or
a Node script.

## Install

```sh
npm install react-inp-chunker
```

Works with React 18 and 19; CI runs the full test suite on both.

## Usage

### Process a list: `useChunkedTask`

```tsx
import { useChunkedTask } from 'react-inp-chunker';

function ScoredRows({ rows }: { rows: readonly Row[] }) {
  // scoreRow runs once per row, in slices of up to 5 ms.
  const task = useChunkedTask(rows, scoreRow);

  if (task.isError) return <p role="alert">Couldn't score the rows.</p>;

  if (!task.isDone || task.results === undefined) {
    return <progress value={task.processed} max={task.total} aria-label="Scoring rows" />;
  }

  return <ResultsTable scores={task.results} />;
}
```

Items are processed back to back until the time slice runs out, or until the
browser reports pending input; then the hook yields, and resumes with the next
item. Your component re-renders with progress once per slice, not once per item.

- `scoreRow` can be a fresh closure every render: the latest one always runs,
  without restarting the task.
- What _does_ restart it is `rows` becoming a new array reference, or
  `timeSliceMs`/`autoStart` changing. Memoize derived arrays.
- Pass `{ autoStart: false }` to wait for `start()`, and `onItem` to consume
  results while the task is still running. `pause()`, `resume()` and `cancel()`
  work at any point, and unmounting cancels.
- `results` is `undefined` until the task settles, and is then set in the same
  render that first reports `done`, `cancelled` or `error` — never a render
  later, so there is nothing to tear under concurrent React.

Two options exist for work at the extremes, and most code needs neither:

| Option                    | Default | Use it when                                                                                                                                                         |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batchSize: number`       | `1`     | An item takes nanoseconds, so reading the clock costs more than the work. A slice may then overrun its budget by up to `batchSize` items — that is the whole trade. |
| `collectResults: boolean` | `true`  | You already take results through `onItem` and don't want a million-entry array retained. `results` settles as an empty array.                                       |

In development, the library measures itself and says so: a single item that
blocks for over 50 ms gets a warning naming its index, and work cheap enough that
the clock dominates gets a concrete `batchSize` suggestion. Both are compiled out
of production builds.

### Work that isn't a list: `useDeferredTask`

For a long computation that isn't one function over an array, write it as a
generator and put `yield` wherever it's safe to pause:

```tsx
import { type DeferredGenerator, useDeferredTask } from 'react-inp-chunker';

function* renderFrames(frameCount: number): DeferredGenerator<number> {
  for (let i = 0; i < frameCount; i++) {
    renderOneExpensiveFrame(i);
    yield; // "it's safe to pause here if we're over budget"
  }
  return frameCount;
}

function FrameRenderer({ frameCount }: { frameCount: number }) {
  const { isDone, value } = useDeferredTask(() => renderFrames(frameCount), [frameCount]);
  return isDone ? <p>Rendered {value} frames.</p> : <p>Rendering…</p>;
}
```

### Outside React: `react-inp-chunker/core`

```ts
import { createChunkScheduler } from 'react-inp-chunker/core';

const scheduler = createChunkScheduler({
  items: rows,
  processItem: (row) => expensiveScore(row),
});
scheduler.start();
const { status, results } = await scheduler.settled;
```

Both engines expose `start()`, `pause()`, `resume()`, `cancel()`, a
`subscribe()`/`getSnapshot()` pair, and a `settled` promise that always resolves
(never rejects) with `'done' | 'cancelled' | 'error'`. An `AbortSignal` can drive
cancellation too.

The [documentation](https://suprabhat02.github.io/react-inp-chunker/#api) has the
full API, when to reach for something else (a Web Worker, `startTransition`,
virtualization), and answers to common questions.

## In production

| What             | Supported                      | Proven by                                                |
| ---------------- | ------------------------------ | -------------------------------------------------------- |
| React            | 18 and 19                      | the whole test suite runs on both majors                 |
| Node             | 18, 20, 22, 24                 | the packed tarball is imported and required on each      |
| TypeScript       | 5.0 to 7                       | the published declarations compile at both ends          |
| Module systems   | ESM and CommonJS               | separate builds and declarations, both loaded in CI      |
| Resolution       | bundler, NodeNext, node10      | `publint` and `are-the-types-wrong` run over the tarball |
| Browsers         | anything with `MessageChannel` | yielding measured in real Chromium and WebKit            |
| Server rendering | yes                            | both hooks render an idle state and run nothing          |

Dropping any of these is a breaking change; [SUPPORT.md](SUPPORT.md) has the
versioning rules.

**Size**, minified and brotli-compressed, with no dependencies of its own:
`useChunkedTask` 1.83 kB, `useDeferredTask` 1.72 kB, `createChunkScheduler`
without React 1.34 kB, everything together 2.35 kB. CI fails if a change pushes
any of them over budget.

Bundlers that set the `production` export condition — webpack, Vite, Rspack,
Parcel — resolve to a build with the development warnings compiled out, not
merely guarded by a flag.

**What it guarantees.** A slice overruns by at most one item (or `batchSize`
items, if you raised it), because the clock is read after every item rather than
on an average. A settled task never reports its results a render late. Nothing
runs after `cancel()`, no state update arrives after unmount, and `settled`
resolves exactly once and never rejects. The loop allocates nothing per item.

**Supply chain.** Published from CI through npm Trusted Publishing, so no
long-lived token exists to leak, with signed provenance you can verify yourself:

```sh
npm audit signatures
gh attestation verify "$(npm pack react-inp-chunker --silent)" \
  -R suprabhat02/react-inp-chunker
```

GitHub Actions are pinned to commit SHAs, CI fails on a known vulnerability at
any severity, and there are no runtime dependencies to audit.

## Quality

An exhaustive test suite (state-machine truth table, every yield fallback path,
slice bounds on a virtual clock, property tests, pause/resume/cancel races,
reentrancy, SSR safety) at 100% statement, branch, function and line coverage,
run on React 19 and React 18. On top of that, every push checks the packed
tarball end to end: imported and required on four Node versions, compiled by two
TypeScript majors, linted by `publint`, resolved by `are-the-types-wrong`,
measured for real input delay in Chromium and WebKit, and diffed against a
golden public API surface so no export changes by accident. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how the project is organised and verified.

If react-inp-chunker saves you a long task, a
[star on GitHub](https://github.com/suprabhat02/react-inp-chunker) helps other
developers find it.

## License

MIT © [Suprabhat Kumar](https://suprabhat-dev.com)
