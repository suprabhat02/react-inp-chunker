# Changelog

All notable changes to this package are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); this package
follows [Semantic Versioning](https://semver.org/).

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
