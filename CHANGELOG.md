# Changelog

All notable changes to this package are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); this package
follows [Semantic Versioning](https://semver.org/).

## 0.5.0 — 2026-11-07

Scheduling that plays fair with rendering, and several ways a task could hang
or misreport itself, closed. The scheduling changes came out of the
[benchmark app](bench/inp-demo/README.md). Measured with it over 80 runs per
variant — two passes in opposite orders, with 0.4.0 installed from npm under an
alias in the same session; headless Chromium 153, 4× CPU throttling, 20,000
rows — the click that starts a task reaches its next frame in a median 7.2 ms
instead of 11.7 ms, and the longest gap between frames while the task runs drops
from 108 ms to 55 ms. Total time moves from 339 ms to 344 ms, inside the
run-to-run spread.

### Changed

- **The first item (or generator segment) runs after one yield, never inside
  `start()` — and the next one after one yield, never inside `resume()`.**
  Tasks are usually started from an effect, and React runs the effects of an
  update caused by a click before the browser paints, so the first slice used
  to sit between the click and its frame; a click on a resume button had the
  same problem. A task with no items still settles synchronously. A task
  started other than by input — from a timer, say — still gets its first frame
  at most one slice late, and much sooner than before (in Chromium, a median
  5.4 ms after starting instead of 14.2 ms).

  What to change: tests that read `onItem` side effects or `processItem` calls
  synchronously right after starting a task now need to await a tick, or
  `waitFor` them. Hook state right after the first render is `processing`
  even for a task small enough that 0.4.0 had already reported `done` by then.
  And `createDeferredTask` calls its `task` factory just before the first
  segment, not inside `start()`.

- **Paint-aware pacing, on by default.** `scheduler.yield()` resumes the work
  ahead of other queued tasks, which in Chromium includes rendering: on its own
  the page painted only when the browser's starvation guard stepped in, about
  every 100 ms. A click still got its frame promptly, but a progress bar or
  anything else on screen updated at around 10 frames a second. Now, once
  `paintIntervalMs` (33 ms) has passed without a frame, the task yields through
  an ordinary task instead, which waits behind the due frame, until the
  browser has rendered one. It never waits on a frame itself, so a hidden tab,
  a throttled iframe or a test with faked timers can't stall it — without
  frames it just keeps yielding the way it does in Safari.
- Size budgets raised for the above: `createChunkScheduler` 1.47 kB → 1.81 kB,
  `useChunkedTask` 2.03 kB → 2.39 kB, `useDeferredTask` 1.83 kB → 2.18 kB
  (minified, brotli-compressed). Much of it is browser API names a minifier
  can't shorten.

### Added

- **`paintIntervalMs`** on both hooks and both core engines, and
  **`DEFAULT_PAINT_INTERVAL_MS`** (33) from `react-inp-chunker/core`. Lower it
  for smoother animation while the work runs (`0` always yields behind
  rendering); `Infinity` turns pacing off for the most throughput.

### Fixed

- **A subscriber that threw could hang a task.** Listeners were called in a
  plain loop, so one that threw stopped every listener after it — React's own
  `useSyncExternalStore` subscriber among them — and the exception escaped into
  the engine: out of `start()` before the loop ran, or out of the final `done`
  notification before `settled` resolved, leaving it pending forever. Each
  listener is now isolated, and a throw is reported as an uncaught exception,
  the way a throwing event listener's is: `reportError()` in browsers, rethrown
  from a microtask elsewhere. In Node that ends the process unless an
  `uncaughtException` handler is installed, as for any uncaught exception —
  where 0.4.0 might instead have hung, crashed on an unhandled rejection, or
  turned the subscriber's bug into the task's `error`, depending on when it
  threw.
- **`createDeferredTask` (and `useDeferredTask`) hung if the `task` factory
  threw.** It was called outside the loop's error handling, so the task stayed
  `processing` with `settled` never resolving. It now settles as an error, like
  a throw from inside the generator.
- **A task paused from inside the `START` notification never ran.** `start()`
  only began the processing loop if the task was still `processing` after
  notifying, so a subscriber that paused it there left no loop to resume:
  `resume()` then sat in `processing` forever.
- **`onYield` and a progress notification could run after `cancel()`.** A
  cancel that landed while the loop was yielding — the usual moment for an
  unmount — was only noticed after both had run.
- **A task cancelled from inside its own work, which then threw, settled as
  `error` while its snapshot said `cancelled`.** The two now agree on
  `cancelled`. The error is reported rather than lost — unless it is the abort
  reason itself, as `signal.throwIfAborted()` throws — and so is one thrown by a
  generator's `finally` block when cancellation returns it.
- The development warning for an item that blocks for more than 50 ms never
  judged the _first_ item, which it used as its baseline. It does now.
- The `onError` documentation said omitting `onItem`, rather than `onError`,
  defaults to `'abort'`.
- `SECURITY.md`'s supported-versions table named a specific minor version and
  went stale with every release (it said 0.3.x while 0.4.0 was current). It now
  says what it means: the latest minor release.
- CI installed WebKit for the real-browser tests but never launched it, so
  yielding was measured in Chromium only, although the README and the 0.2.0
  entry below said WebKit too. It now runs in both.

## 0.4.0 — 2026-11-04

Type safety and supply-chain hardening: the return shapes you were already
getting, made precise enough for the compiler to check them, plus a `signal`
option on both hooks and a build-time SBOM on every release. No change to
existing behavior — `is*` booleans, flat field access, and every documented
default all still work exactly as before.

### Changed

- **Discriminated return types.** `ChunkSchedulerResult`, `ChunkSnapshot`,
  `DeferredTaskResult`, `DeferredTaskSnapshot`, and both hooks' return state
  are now unions discriminated on `status`, not flat interfaces with
  independently-optional fields. Narrowing `status === 'done'` (or
  `'cancelled'`) now narrows `results`/`value` to defined, and
  `status === 'error'` narrows `error` to defined — the
  `!task.isDone || task.results === undefined` double-check this README
  used to show is no longer necessary, though it still compiles. Pure type
  change: every field name, every runtime value, and the `is*` booleans are
  exactly what they were.
- **`useDeferredTask`'s `value` (and `createDeferredTask`'s `.getSnapshot().value`
  / settled `.value`) is now reliably present once `status` is `'done'`,**
  even when the generator's `T` allows `undefined` and it genuinely returns
  it. Previously the key was omitted whenever the returned value happened
  to be `undefined`, which worked for every plain `!== undefined` check but
  made the two true discriminated-union branches ("done, returned
  `undefined`" and "not done yet") indistinguishable by shape — the thing
  that was blocking the type change above for this one case. Fixed by
  tracking whether a value was published, not what it was.

### Added

- **`signal`** on `useChunkedTask` and `useDeferredTask` — the `AbortSignal`
  option `createChunkScheduler`/`createDeferredTask` already had, now on the
  hooks too, with the same `reason` passthrough: a cancellation caused by
  the signal is distinguishable from a direct `cancel()` call via the new
  **`reason`** field on both hooks' return state.
- **A CycloneDX SBOM** (`sbom.cdx.json`), generated fresh and attached to
  every GitHub Release from 0.4.0 on. Covers the full tree that fed the
  build — dev toolchain included — not just the (zero) runtime dependencies
  that ship in the tarball, so a vulnerable build-time dependency (like the
  minimatch one fixed in 0.3.0) shows up in it.

## 0.3.0 — 2026-11-02

Hardening, not new surface: closes the gaps a team running this on real,
semi-trusted data would hit first. No change to existing behavior when the
new options are left unset.

### Added

- **`onError`** on `useChunkedTask` and `createChunkScheduler`. Until now, one
  `processItem` throw ended the whole task — the right default, but no escape
  hatch for a caller chunking data they don't fully control (a CSV import, API
  responses) where one bad row shouldn't sink the other 99,999. Return
  `'skip'` to drop that item and keep going (it's recorded in the new
  `skipped` array, both live on the snapshot and on the settled result) or
  `'abort'` to end the task exactly as before — the default when `onError` is
  omitted, so nothing changes for existing callers. Not added to
  `useDeferredTask`/`createDeferredTask`: skipping one step of a stateful
  generator mid-flight has no well-defined meaning the way skipping an
  independent array item does.
- **`onSlice`/`onYield`** on both hooks and both core engines. The
  development-only diagnostics added in 0.1.x can tell you, while you're
  building, that a task is misconfigured — but they're compiled out of
  production, so a team running this in production had no way to confirm, on
  their own real traffic, that it's actually staying under `timeSliceMs`.
  These ship in the production build: `onSlice(durationMs, processed)` fires
  every time a slice ends, `onYield()` right after work resumes. Wire them to
  your own telemetry instead of trusting this package's own benchmark
  numbers.
- **`AbortSignal.reason` passthrough.** Cancelling via an aborted signal now
  carries that signal's `reason` through to `result.reason` and
  `getSnapshot().reason`, on both engines — so a cancellation caused by a
  shared `AbortController` is distinguishable from a direct `cancel()` call
  (which still reports no `reason`). Previously the reason was silently
  dropped.
- **Two development-only misuse warnings**, compiled out of production
  builds like the existing ones: `processItem` returning a `Promise` (the
  engine calls it synchronously and never awaits it, so `results` would
  otherwise silently contain unresolved promises instead of their resolved
  values), and `collectResults: false` with no `onItem` passed (every result
  computed and discarded, with nothing to retrieve — almost always a mistake,
  not a choice).

### Changed

- Size budgets adjusted for the above: `createChunkScheduler` 1.34 kB → 1.47
  kB, `useDeferredTask` 1.72 kB → 1.81 kB (both minified, brotli-compressed).
  `useChunkedTask` and the combined bundle still fit their existing budgets.

### Fixed

- A transitive `minimatch` dependency (pulled in by `eslint`/`typescript-eslint`,
  neither of which has moved past the vulnerable range upstream yet) carried a
  known moderate-severity advisory (GHSA-g3hv-75wg-m249). Forced to a patched
  version via `npm overrides`; this package has no runtime dependencies of its
  own either way, so nothing published to npm was ever affected.

## 0.2.0 — 2026-10-28

Performance, packaging and proof. The engine does the same work for less than
half the overhead, production builds no longer carry development code, and
every compatibility claim this package makes is now checked by a job on every
push.

0.1.3 was prepared but never published; its fixes are included here.

### Added

- **`batchSize`** on both hooks and both core engines. The loop reads the clock
  after every item, which is what keeps a slice from overrunning — but for work
  measured in nanoseconds the clock read costs more than the item does. Raising
  `batchSize` reads the clock every _n_ items instead, trading exactly _n_ items
  of the slice bound for throughput. Default 1, so nothing changes unless you
  ask.
- **`collectResults`** on `useChunkedTask` and `createChunkScheduler`. With
  `false`, results are handed to `onItem` and not retained, so a million-item
  run no longer keeps a million-entry array alive. Default `true`.
- **Development warnings**, compiled out of production builds. A single item
  that blocks for more than 50 ms is reported with its index, because no time
  slice can shorten it. Work cheap enough that the clock read dominates gets a
  measured `batchSize` suggestion.
- **A production build**, selected by the `production` export condition that
  webpack, Vite, Rspack and Parcel all set. The warnings are not merely
  disabled in it; the code is not there. It saves 918 bytes raw, 509
  compressed.
- `ChunkSnapshot<R>` now carries `results`, and `DeferredTaskSnapshot<T>`
  carries `value`, so a subscriber sees the outcome without a second call.
  Both type parameters default to `unknown`, so existing annotations still
  compile.
- `TerminalChunkStatus` is exported from `react-inp-chunker/core`, so the
  narrowing `isTerminal()` performs can be named.

### Changed

- **Per-item overhead roughly halved**: from about 410 ns to about 210 ns at
  the defaults, about 60 ns at `batchSize: 64`, and under 20 ns with
  `collectResults: false`. (Measured by `npm run bench`; the absolute figures
  depend on the machine, the ratios much less so.) The loop now
  allocates nothing per item — no iterator tuples, no snapshot objects, no
  options objects — and publishes progress once per slice rather than once per
  item.
- **A settled task can no longer report its results a render late.** Results
  are published before the terminal status is announced. Under concurrent
  React the two could previously be read a render apart, so a component could
  observe `isDone` with `results` still `undefined`.
- CommonJS consumers now get their own `.d.cts` declarations through the
  `require` condition, instead of ESM declarations that only looked right.
- `react-inp-chunker/core` resolves under TypeScript's `node10` module
  resolution, through a proxy `core/package.json`.

### Fixed

- **React 18 and React 19.0–19.1 could not load the package.** Both hooks
  imported `useEffectEvent` from `react`, which only exists from React 19.2,
  so on older versions the import failed outright (Node ESM) or crashed on
  first render (bundlers) — despite the peer range promising React 18. The
  hooks now use React's own `useEffectEvent` when it exists and a small
  fallback with the same contract otherwise.
- **Node processes could hang after the work finished.** Where
  `scheduler.yield()` is unavailable (Node, Safari), each yield opened a
  `MessageChannel` and never closed it. In Node an open port keeps the
  process alive, so a script would finish its work and never exit; in
  browsers a long task left hundreds of ports open. Each port is now closed
  as soon as its message arrives.

### Verified

Every claim below is a job that runs on every push, not a statement of intent.

- The packed tarball is imported and required on Node 18, 20, 22 and 24, and
  its declarations are compiled by TypeScript 5.0 and TypeScript 7.
- The whole suite runs on React 18 and React 19, each from its own lockfile.
- `publint` and `are-the-types-wrong` lint the tarball; a golden API surface
  file fails the build if an export changes without being written down.
- Yielding is measured in real Chromium and WebKit: 600 ms of work left a
  user-blocking task waiting 3 ms, against 598 ms unchunked. Both yield
  strategies are exercised, including the `MessageChannel` path Safari takes.
- Slice bounds are asserted on a virtual clock, so the guarantee is exact
  rather than timing-dependent, and the state machine is covered by property
  tests.
- Releases are published from CI through npm Trusted Publishing with signed
  provenance; Actions are pinned to commit SHAs and CI fails on a known
  vulnerability at any severity.
- `homepage` now points at the documentation site.

## 0.1.2 — 2026-10-26

- No functional change. First release cut through the GitHub Release →
  CI → npm pipeline (OIDC trusted publishing) instead of a manual local
  `npm publish`, validating the pipeline end to end.

## 0.1.1 — 2026-10-26

- Fixed `homepage` in `package.json`, which was still pointing at an
  unrelated site left over from this repo's previous life. No code change.

## 0.1.0 — 2026-10-26

- First published release. Phase 1: the core scheduling engine
  (`react-inp-chunker/core`), `useChunkedTask`, `useDeferredTask`, the
  `scheduler.yield()` → `MessageChannel` → `setTimeout(0)` fallback chain,
  and a 100%-statement/branch/function/line test suite covering pause/
  resume/cancel races, reentrancy, AbortSignal, and SSR.
