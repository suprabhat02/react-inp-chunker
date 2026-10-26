# Changelog

All notable changes to this package are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); this package
follows [Semantic Versioning](https://semver.org/).

## 0.1.3 — 2026-10-26

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

### Added

- CI runs the type check, the whole test suite, and a packed-package smoke
  test (`import` and `require`) on React 18, from `compat/react18` and its
  own lockfile.
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
