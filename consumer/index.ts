/**
 * Compiles the published declarations the way a consumer does: importing
 * by package name, so the exports map and the .d.ts files are exercised
 * together. Checked under both module-resolution modes (see the two
 * tsconfigs beside this file) and against every supported TypeScript
 * version in CI.
 *
 * Nothing here runs. If it compiles, the types are usable.
 */
import {
  type ChunkStatus,
  type DeferredGenerator,
  type UseChunkedTaskState,
  useChunkedTask,
  useDeferredTask,
} from 'react-inp-chunker';
import {
  type ChunkScheduler,
  type ChunkSnapshot,
  type TerminalChunkStatus,
  createChunkScheduler,
  createDeferredTask,
  isTerminal,
  yieldToMain,
} from 'react-inp-chunker/core';

interface Row {
  readonly id: string;
  readonly weight: number;
}

declare const rows: readonly Row[];

// Results are inferred from processItem's return type, not declared.
const scored: UseChunkedTaskState<number> = useChunkedTask(rows, (row) => row.weight * 2);
const results: readonly number[] | undefined = scored.results;
const status: ChunkStatus = scored.status;
void results;
void status;

// Every option, with the types they are documented to take.
useChunkedTask(rows, (row, index) => `${row.id}:${String(index)}`, {
  timeSliceMs: 8,
  batchSize: 64,
  collectResults: false,
  autoStart: false,
  onItem: (result: string, item: Row, index: number) => {
    void result;
    void item;
    void index;
  },
});

function* indexRows(items: readonly Row[]): DeferredGenerator<number> {
  for (const _row of items) yield;
  return items.length;
}
const indexed = useDeferredTask(() => indexRows(rows), [rows], { batchSize: 16 });
const indexedValue: number | undefined = indexed.value;
void indexedValue;

// The core engine, with the same inference.
const scheduler: ChunkScheduler<number> = createChunkScheduler({
  items: rows,
  processItem: (row) => row.weight,
  batchSize: 32,
  collectResults: true,
  signal: new AbortController().signal,
});
const snapshot: ChunkSnapshot<number> = scheduler.getSnapshot();
void snapshot.results;

const deferred = createDeferredTask({ task: () => indexRows(rows), timeSliceMs: 4 });
void deferred.getValue();

// isTerminal narrows, and the type it narrows to is nameable.
declare const someStatus: ChunkStatus;
if (isTerminal(someStatus)) {
  const terminal: TerminalChunkStatus = someStatus;
  void terminal;
}

export async function run(): Promise<void> {
  await yieldToMain();
  const outcome = await scheduler.settled;
  if (outcome.status === 'done') {
    const total: number = outcome.results.reduce((sum, value) => sum + value, 0);
    void total;
  }
  if (outcome.status === 'error') void outcome.error;
}
