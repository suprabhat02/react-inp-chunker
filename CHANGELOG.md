# Changelog

All notable changes to this package are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); this package
follows [Semantic Versioning](https://semver.org/).

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
