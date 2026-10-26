# react-inp-chunker demo

Live at **https://suprabhat02.github.io/react-inp-chunker/**, redeployed
automatically on any push to `main` that touches this folder (see
`.github/workflows/deploy-demo.yml` at the repo root).

Installs the real, published `react-inp-chunker` from npm — same as any
consumer would (`package.json`'s dependency is `^0.1.2`, not a local
workspace link) — so this demo always reflects what's actually shipped,
not whatever happens to be on disk in `../src`.

Three things on the page:

- **Heartbeat** — a `requestAnimationFrame` counter. It can only advance
  when the main thread is free to run JS, which is the actual point: a
  CSS-only animation would keep running on the compositor thread
  regardless of JS blocking and prove nothing.
- **Blocking vs. chunked** — the identical 400-item workload run two
  ways, plus a click counter so you can feel the difference yourself,
  not just watch a number.
- **`useDeferredTask`** — the generator/`yield` API, simulating 2,500
  expensive frames with pause/resume/cancel.

## Local dev

```sh
npm install
npm run dev
```

`npm run build && npm run preview` builds and serves the production
bundle the same way the deploy workflow does.

This folder has its own lint/format tooling (`oxlint`, via the Vite
scaffold) — it's intentionally excluded from the root package's own
`npm run verify` pipeline, since it's a consumer of the library, not
part of the library itself.
