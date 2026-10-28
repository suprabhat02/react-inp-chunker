# Contributing

Thanks for helping. A few rules keep this package small, type-safe, and
reliable.

## 1. `core/` stays framework-free

`src/core/` is the scheduling engine — it must never import `react` or
`react-dom`. That's what lets it work outside React too (a Node script, a Web
Worker), and it's enforced by ESLint (`src/core/**` rejects those imports),
not just convention. `src/react/` is the only layer that may depend on React.

## 2. Every change ships with tests, and coverage stays at 100%

`npm run test:coverage` enforces 100% statement, branch, function, and line
coverage. A genuinely unreachable branch (defense-in-depth against a future
refactor breaking an invariant that currently makes it impossible) is marked
with a `/* v8 ignore next */` comment that explains _why_ it's unreachable —
never added just to make a number go green. If you find yourself reaching for
one, make sure the invariant it depends on is still true, and say so in the
comment.

Edge cases and race conditions matter more than line count here: pause/
resume/cancel interleavings, reentrant calls from a subscriber's own
notification, AbortSignal timing, and SSR (`getServerSnapshot`) all have
dedicated tests — look at `tests/core/chunk-scheduler.test.ts` and
`tests/core/deferred-task.test.ts` for the pattern before adding a new one.

## 3. Type safety is not optional

`tsconfig.json` runs in strict mode with `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, and friends on. `npm run typecheck` must pass with
zero errors, and `any` is not an escape hatch — if the types get in the way,
that's usually a sign the design needs another look, not a cast.

## 4. React 18 is supported, so it's tested

The peer range is `^18.0.0 || ^19.0.0`. The dev dependency is React 19; CI
also runs the type check, the whole suite, and a packed-package smoke test
on React 18, pinned in `compat/react18` with its own lockfile. Anything
newer than React 18.0 (an API added in 19.x, say) needs a fallback — see
`src/react/use-effect-event.ts` for the pattern.

```sh
npm ci --prefix compat/react18      # once
npm run typecheck:react18
REACT_VERSION=18 npm test           # bash; PowerShell: $env:REACT_VERSION=18; npm test
```

## 5. The published package is checked, not just the source

A green test suite proved nothing about the thing people install: 0.1.2
passed every test and could not be imported on React 18. So `npm run
verify` also checks the package itself, and CI runs each step separately
so a failure names itself:

| Command                    | What it would catch                                                |
| -------------------------- | ------------------------------------------------------------------ |
| `npm run api:check`        | an unintended change to the published types                        |
| `npm run lint:package`     | a broken `exports` map, a missing file, wrong types condition      |
| `npm run types:resolution` | types that resolve for ESM but not CJS, or not at all under node10 |
| `npm run types:consumer`   | declarations that do not compile in a real app                     |
| `npm run size`             | a bundle budget blown                                              |
| `npm run test:browser`     | yielding that stopped working in a real engine                     |
| `npm run bench`            | the hot loop getting slower                                        |

After changing anything exported, run `npm run api:update` and include the
diff: `api-surface.txt` is the public API, and reviewing it is how a
breaking change gets noticed before release rather than after.

## 6. The compatibility matrix is real

Each of these is pinned in its own directory with its own lockfile, so no
job ever installs an unpinned version.

```sh
npm ci --prefix compat/react18          # React 18
npm run typecheck:react18
REACT_VERSION=18 npm test               # bash; PowerShell: $env:REACT_VERSION=18; npm test

npm ci --prefix compat/typescript5      # the oldest TypeScript supported
compat/typescript5/node_modules/.bin/tsc -p consumer/tsconfig.bundler.json
```

The repository's own TypeScript stays on 6 even though the library compiles
under 7: typescript-eslint refuses to load with TypeScript 7. That is why a
Dependabot bump to TypeScript 7 cannot simply be merged — `compat/typescript7`
is what proves consumers on 7 are fine.

## 7. Dependency updates

Dependabot opens pull requests; they are not merged. Apply the ones worth
taking as your own commits, verify them, and close the bot's pull request
with a note. The contributor list stays people-only, which is the same rule
as commit authorship below.

## Setup

```sh
npm install
npm run test:watch   # tests while you work
npm run verify       # everything CI runs, in one command
npm run test:browser # real Chromium (and WebKit, if installed)
npm run bench        # per-item overhead against a plain loop
```

## Commit authorship

Every commit in this repository is authored by a person, under their own
name — no automated-tool attribution of any kind (author, committer,
co-author trailer, or "generated with" footer). CI fails the build
otherwise (`scripts/check-authorship.mjs`), checking the full commit
history. Human contributors are, of course, entirely welcome.

## Bundle size

`npm run size` runs [size-limit](https://www.npmjs.com/package/size-limit)
against the budgets in `package.json`'s `size-limit` field, measured on
`dist/production/` — what a bundled application actually ships. A budget
increase needs a real reason in the pull request description: a correctness
fix that costs a few bytes is fine; room for something that could be
written more tightly is not.

## Development-only code

Warnings and other guidance live in `src/core/diagnostics.ts` and must be
free in production. Two rules make that true:

- Every call site is wrapped in `if (isDevelopment)`.
- `src/core/diagnostics.production.ts` is a no-op twin, swapped in when
  building `dist/production/` (see `tsdown.config.ts`) and selected by the
  `production` export condition.

The swap exists because the usual `process.env.NODE_ENV` guard is not
enough: the `typeof process !== 'undefined'` check that keeps it safe
outside Node is not a constant, so esbuild — and therefore Vite — leaves
the strings in the bundle. A type assertion in the twin fails the build if
the two modules ever drift.

## Performance

The engine's cost per item is a feature. Before changing the hot loop, run
`npm run bench` and keep the output; after, run it again and put both in
the pull request. The benchmark deliberately uses trivial items, where the
scheduler's own bookkeeping dominates — that is where regressions show up.

Two invariants matter more than any number:

- A slice runs at most one item past its budget (`batchSize` items, when
  set). `tests/core/slice-bounds.test.ts` pins this on a virtual clock, and
  it is why the clock is read per item rather than sampled. Sampling was
  measured at 130ms of overshoot when per-item cost jumped, and 2.4s in a
  worse case.
- Nothing in the loop allocates per item.
