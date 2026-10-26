// #region hidden
import type { Doc, SearchIndex } from './fixtures.ts';
// #endregion
import { type DeferredGenerator, useDeferredTask } from 'react-inp-chunker';

// Not one function per item, so mark where it's safe to pause with `yield`.
function* buildSearchIndex(docs: readonly Doc[]): DeferredGenerator<SearchIndex> {
  const index: SearchIndex = new Map();
  for (const doc of docs) {
    for (const word of doc.text.toLowerCase().split(/\W+/)) {
      if (word === '') continue;
      const ids = index.get(word) ?? new Set<string>();
      ids.add(doc.id);
      index.set(word, ids);
    }
    yield; // between documents: fine to pause here
  }
  return index;
}

export function SearchStatus({ docs }: { docs: readonly Doc[] }) {
  // Like useEffect: when `docs` changes, the old run is cancelled and a new one starts.
  const indexing = useDeferredTask(() => buildSearchIndex(docs), [docs]);

  if (indexing.isError) return <p role="alert">Indexing failed.</p>;
  if (!indexing.isDone || indexing.value === undefined)
    return <p>Indexing {docs.length} documents…</p>;
  return <p>Search ready: {indexing.value.size} words indexed.</p>;
}
