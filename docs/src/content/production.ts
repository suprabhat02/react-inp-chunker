/**
 * The production facts, as data. Every row here corresponds to something
 * CI checks on each push, so the page cannot drift from the repository
 * without a test going red first.
 */

export interface SupportRow {
  readonly what: string;
  readonly supported: string;
  readonly provenBy: string;
}

export const SUPPORT: readonly SupportRow[] = [
  {
    what: 'React',
    supported: '18 and 19',
    provenBy: 'the whole test suite runs on both majors',
  },
  {
    what: 'Node',
    supported: '18, 20, 22, 24',
    provenBy: 'the packed tarball is imported and required on each',
  },
  {
    what: 'TypeScript',
    supported: '5.0 to 7',
    provenBy: 'the published declarations are compiled by both ends of the range',
  },
  {
    what: 'Module systems',
    supported: 'ESM and CommonJS',
    provenBy: 'separate builds and declarations, both loaded in CI',
  },
  {
    what: 'Resolution',
    supported: 'bundler, NodeNext, node10',
    provenBy: 'publint and are-the-types-wrong run over the tarball',
  },
  {
    what: 'Browsers',
    supported: 'anything with MessageChannel',
    provenBy: 'yielding is measured in real Chromium and WebKit',
  },
  {
    what: 'Server rendering',
    supported: 'yes',
    provenBy: 'both hooks render an idle state and run nothing',
  },
];

export interface SizeRow {
  readonly name: string;
  readonly size: string;
}

/** Minified and brotli-compressed, measured on the production build. */
export const SIZES: readonly SizeRow[] = [
  { name: 'useChunkedTask', size: '1.83 kB' },
  { name: 'useDeferredTask', size: '1.72 kB' },
  { name: 'createChunkScheduler, without React', size: '1.34 kB' },
  { name: 'Everything', size: '2.35 kB' },
];

export interface GuaranteeRow {
  readonly title: string;
  readonly body: string;
}

export const GUARANTEES: readonly GuaranteeRow[] = [
  {
    title: 'A slice overruns by at most one item',
    body: 'Not by an average, and not on a good day. The clock is read after every item, so however wildly per-item cost varies, a slice stops as soon as its budget is spent. Raising batchSize trades exactly batchSize items of that bound for throughput.',
  },
  {
    title: 'A finished task never reports results late',
    body: 'Results are published before the terminal status is announced, so a render can never see isDone without them. That matters under concurrent React, where the two could otherwise be read a render apart.',
  },
  {
    title: 'Nothing runs after cancel',
    body: 'Cancelling, unmounting, or passing new inputs stops the work at the next boundary and settles the task. No state update arrives after unmount, and the settled promise resolves exactly once — never rejects.',
  },
  {
    title: 'No allocation per item',
    body: 'The loop allocates nothing per item: no iterator tuples, no snapshot objects, no options objects. Progress is published once per slice rather than once per item.',
  },
];
