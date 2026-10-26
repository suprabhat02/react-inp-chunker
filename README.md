# react-inp-chunker

[![npm version](https://img.shields.io/npm/v/react-inp-chunker.svg)](https://www.npmjs.com/package/react-inp-chunker)
[![CI](https://github.com/suprabhat02/react-inp-chunker/actions/workflows/ci.yml/badge.svg)](https://github.com/suprabhat02/react-inp-chunker/actions/workflows/ci.yml)

**Headless React/TypeScript hooks that chunk heavy synchronous work and yield to
the main thread, so a long update never costs you Interaction to Next Paint (INP).**

Processing a big array, running a multi-phase algorithm, or rendering a large
canvas frame-by-frame inside a React update blocks the main thread for as long
as it takes — every click, keypress, and tap queued behind it waits too. This
package breaks that work into small slices and hands control back to the
browser between them, using the best yielding primitive the current runtime
actually has:

1. [`scheduler.yield()`](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield) —
   the purpose-built API, Baseline across Chromium and Firefox.
2. `MessageChannel` — not clamped to the ~4ms floor nested `setTimeout` calls
   get, so it yields sooner.
3. `setTimeout(0)` — the universal fallback.

No dependencies beyond React itself. Nothing here touches the DOM directly, so
the scheduling engine (`react-inp-chunker/core`) works just as well outside
React — a Node script, a Web Worker, anywhere a long synchronous task would
otherwise block something else.

## Install

```sh
npm install react-inp-chunker
```

Requires React 18 or 19 as a peer dependency.

## Usage

### Chunking an array — `useChunkedTask`

```tsx
import { useChunkedTask } from 'react-inp-chunker';

function RowScorer({ rows }: { rows: Row[] }) {
  const { status, processed, total, results, isDone, pause, resume, cancel } =
    useChunkedTask(rows, (row) => expensiveScore(row));

  if (!isDone) {
    return (
      <p>
        Scoring… {processed}/{total}
      </p>
    );
  }

  return <ResultsTable rows={results} />;
}
```

`processItem` is called once per item, each call in its own chunk, yielding to
the browser whenever a time slice (5ms by default) runs out or the browser
reports pending input. Pass a fresh closure every render — it's always the
latest one that runs, without restarting the task. What _does_ restart it is
`rows` becoming a new array reference, or `timeSliceMs`/`autoStart` changing.

### Chunking arbitrary work — `useDeferredTask`

For work that isn't "one function applied to every item of an array" — a
multi-phase algorithm, a big canvas render — mark your own safe-to-pause
checkpoints with a generator:

```tsx
import { useDeferredTask } from 'react-inp-chunker';

function* renderFrames(frameCount: number) {
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

### Outside React — `react-inp-chunker/core`

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
`subscribe()`/`getSnapshot()` pair, and a `settled` promise that always
resolves — never rejects — with `'done' | 'cancelled' | 'error'`. An
`AbortSignal` can drive cancellation too.

## Status

Phase 1 — the core scheduling engine, both hooks, and an exhaustive test
suite (state-machine truth table, every yield fallback path, pause/resume/
cancel race conditions, reentrancy, SSR safety) at 100% statement, branch,
function, and line coverage. See [CONTRIBUTING.md](CONTRIBUTING.md) for how
the project is organised and verified.

**[Live demo](https://suprabhat02.github.io/react-inp-chunker/)** — a
blocking vs. chunked comparison (same work, watch the difference) plus a
`useDeferredTask` example, installing the real published package like any
consumer would. Source in [`demo/`](demo/).

## License

MIT © [Suprabhat Kumar](https://suprabhat-dev.com)
