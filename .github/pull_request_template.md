## What this changes

<!-- And why. Link the issue if there is one. -->

## Checks

- [ ] `npm run verify` passes (lint, types, 100% coverage, build, API
      surface, package manifest, type resolution, size budgets)
- [ ] Tests cover the change, including the edge cases — pause/resume/cancel
      interleavings, reentrancy, and server rendering where relevant
- [ ] `npm run test:browser` passes, if scheduling behaviour changed
- [ ] `npm run bench` is no worse, if the hot loop changed (paste the before
      and after)
- [ ] The changelog has an entry, if this is user-visible
- [ ] `npm run api:update` was run and the diff is included, if the public
      API changed

## Anything a reviewer should know

<!-- A measurement, a trade-off you made, a budget you had to raise. -->
