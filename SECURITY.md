# Security policy

## Supported versions

Security fixes land on the latest minor release. There are no long-term
support branches: upgrade to the current version to receive them.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a vulnerability

Report privately through GitHub's
[security advisories](https://github.com/suprabhat02/react-inp-chunker/security/advisories/new)
rather than opening a public issue.

Expect an acknowledgement within three working days and an assessment
within seven. If a fix is needed, you will be credited in the advisory and
the changelog unless you ask not to be.

## What this package can and cannot do

It is a scheduler. It runs a function you supply, in slices, on the main
thread. It does not touch the network, the DOM, storage, or the clipboard,
has no runtime dependencies, and reads nothing from its environment beyond
feature detection: `scheduler.yield`, `MessageChannel`,
`navigator.scheduling.isInputPending`, `performance.now` and, in the
non-production build, `process.env.NODE_ENV`.

The practical consequence: a vulnerability here would have to be in the
scheduling logic itself — work that never finishes, work that runs after
cancellation, or a task that cannot be stopped. Those are the cases the
test suite is built around, and the ones worth reporting.

## Supply chain

- Releases are published from CI through npm Trusted Publishing (OIDC).
  No long-lived npm token exists to leak.
- Every release carries [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
  so you can verify the commit and workflow that built it:

  ```sh
  npm audit signatures
  gh attestation verify "$(npm pack react-inp-chunker --silent)" -R suprabhat02/react-inp-chunker
  ```

- Every GitHub Action is pinned to a commit SHA, not a tag.
- CI fails on any known vulnerability, in runtime or development
  dependencies, at any severity.
