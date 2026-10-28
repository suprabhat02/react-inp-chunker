# Support and compatibility

## Where to ask

- **A question about using it** — open a
  [discussion](https://github.com/suprabhat02/react-inp-chunker/discussions).
- **Something is broken** — open an
  [issue](https://github.com/suprabhat02/react-inp-chunker/issues) with a
  reproduction.
- **A security problem** — see [SECURITY.md](SECURITY.md); do not open a
  public issue.

## What this package supports

Each row is tested in CI on every push, not merely intended.

|                  | Supported                      | Checked by                                           |
| ---------------- | ------------------------------ | ---------------------------------------------------- |
| React            | 18 and 19                      | the whole suite runs on both majors                  |
| Node             | 18, 20, 22, 24                 | the packed tarball is imported and required on each  |
| TypeScript       | 5.0 to 7                       | the published declarations are compiled by both ends |
| Module systems   | ESM and CommonJS               | separate builds, separate declarations, both loaded  |
| Resolution       | bundler, NodeNext, node10      | `publint` and `are-the-types-wrong` over the tarball |
| Browsers         | anything with `MessageChannel` | yielding is measured in Chromium and WebKit          |
| Server rendering | yes                            | both hooks render an idle state and run nothing      |

Dropping any of these is a breaking change.

## Browser behaviour

The library yields with the best primitive available, in this order:
`scheduler.yield()` (Chrome and Edge 129+, Firefox 142+), a
`MessageChannel` message (Safari, older browsers), then `setTimeout(0)`.
All three are tested; the first two are measured in a real browser.

## Versioning

[Semantic versioning](https://semver.org), with the public API defined as
everything in [api-surface.txt](api-surface.txt) — which is generated from
the published type declarations and checked in CI, so an accidental change
cannot slip through.

While the version is below 1.0, a minor release may contain a breaking
change; it will be called out at the top of the
[changelog](CHANGELOG.md) entry with the migration. Patch releases never
break.

Not covered by semantic versioning: the exact wording of development
warnings, the precise number of slices a given workload takes, and
anything documented as testing-only.

## Deprecation

A feature being removed is deprecated for at least one minor release
first: it keeps working, the changelog says what replaces it, and the
development build warns once when it is used.
