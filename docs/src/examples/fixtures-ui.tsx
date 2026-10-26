import type { Score } from './fixtures.ts';

/** A stand-in results view for the samples. */
export function ResultsTable({ scores }: { readonly scores: readonly Score[] }) {
  return <p>{scores.length} rows scored.</p>;
}
