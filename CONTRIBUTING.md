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

## Setup

```sh
npm install
npm run test:watch   # tests while you work
npm run verify        # lint + format + typecheck + test:coverage + build + size — what CI runs
```

## Commit authorship

Every commit in this repository is authored by a person, under their own
name — no automated-tool attribution of any kind (author, committer,
co-author trailer, or "generated with" footer). CI fails the build
otherwise (`scripts/check-authorship.mjs`), checking the full commit
history. Human contributors are, of course, entirely welcome.

## Bundle size

`npm run size` runs [size-limit](https://www.npmjs.com/package/size-limit) against
the budgets in `package.json`'s `size-limit` field. A budget increase needs a
real reason in the PR description — a correctness fix that costs a few bytes
is fine; an increase to make room for something that could be written more
tightly is not.
