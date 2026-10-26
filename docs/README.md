# react-inp-chunker docs

The documentation site and playground, live at
**https://suprabhat02.github.io/react-inp-chunker/**. Every push to `main` that
touches this folder redeploys it (`.github/workflows/deploy-docs.yml`).

It installs the published `react-inp-chunker` from npm, the way any consumer
would, so it always shows what's actually shipped rather than whatever is in
`../src`.

## What's here

- `src/sections/`: the page, in reading order. Why the UI freezes, how the
  library works, the playground, a getting-started guide, the API reference,
  when to use it (and when not), and the author.
- `src/playground/`: the live comparison. Everything it shows is measured in
  the visitor's browser: frames painted (`requestAnimationFrame`), how long
  input would have waited (a high-priority probe task, see `probe.ts`), and how
  long real key presses and clicks took to reach the screen.
- `src/examples/`: every code sample on the page is a real module, compiled by
  `tsc -b` against the published package's types. Lines that only exist to make
  a sample compile sit between `// #region hidden` and `// #endregion` and are
  dropped for display. The Mandelbrot demo runs the same file it displays.
- `src/styles/tokens.css`: colors from the author's portfolio design system
  (OKLCH, dark and light themes, AA contrast throughout).

## Local development

```sh
npm ci
npm run dev       # http://localhost:5173/react-inp-chunker/
npm run lint      # oxlint
npm run build     # type-checks everything (samples included), then builds
npm run preview   # serves the production build, as GitHub Pages will
```

This folder is excluded from the library's own `npm run verify`: it consumes the
library, it isn't part of it.
