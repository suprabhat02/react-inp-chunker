// #region hidden
import { scoreRow, type Row } from './fixtures.ts';
declare const rows: readonly Row[];
// #endregion
import { createChunkScheduler } from 'react-inp-chunker/core';

const controller = new AbortController();

const scheduler = createChunkScheduler({
  items: rows,
  processItem: scoreRow,
  timeSliceMs: 8,
  signal: controller.signal, // controller.abort() cancels, like scheduler.cancel()
});

const unsubscribe = scheduler.subscribe(() => {
  const { status, processed, total } = scheduler.getSnapshot();
  console.log(`${status}: ${processed}/${total}`);
});

scheduler.start();

// Resolves once, with 'done', 'cancelled' or 'error'. Never rejects.
const outcome = await scheduler.settled;
unsubscribe();

if (outcome.status === 'done') console.log(`${outcome.results.length} rows scored`);
if (outcome.status === 'error') console.error(outcome.error);
