// #region hidden
import { scoreRow, type Row } from './fixtures.ts';
import { ResultsTable } from './fixtures-ui.tsx';
// #endregion
import { useChunkedTask } from 'react-inp-chunker';

export function ScoredRows({ rows }: { rows: readonly Row[] }) {
  // scoreRow runs once per row, in slices of up to 5 ms.
  const task = useChunkedTask(rows, scoreRow);

  if (task.isError) return <p role="alert">Couldn't score the rows.</p>;

  if (!task.isDone || task.results === undefined) {
    return <progress value={task.processed} max={task.total} aria-label="Scoring rows" />;
  }

  return <ResultsTable scores={task.results} />;
}
