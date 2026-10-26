import { formatCount, formatMs } from '../lib/format.ts';
import { DEFAULT_TIME_SLICE_MS } from './constants.ts';

interface CodeSettings {
  readonly items: number;
  readonly perItemMs: number;
  readonly timeSliceMs: number;
}

/** What most apps write first: correct, simple, and one long task. */
export function blockingCode({ items, perItemMs }: CodeSettings): string {
  const total = formatMs(items * perItemMs);
  return `import { useMemo } from 'react';

function Report({ rows }: { rows: readonly Row[] }) {
  // ${formatCount(items)} rows × ~${formatMs(perItemMs)} each = one ~${total} task.
  // Until it ends, clicks and key presses wait and nothing repaints.
  const results = useMemo(() => rows.map(analyze), [rows]);

  return <Results data={results} />;
}`;
}

/** The same component with react-inp-chunker: one hook, and a progress state. */
export function chunkedCode({ items, timeSliceMs }: CodeSettings): string {
  const options =
    timeSliceMs === DEFAULT_TIME_SLICE_MS
      ? ''
      : `, { timeSliceMs: ${String(timeSliceMs)} }`;
  const sliceNote =
    timeSliceMs === DEFAULT_TIME_SLICE_MS
      ? `in slices of up to ${String(DEFAULT_TIME_SLICE_MS)} ms (the default)`
      : `in slices of up to ${String(timeSliceMs)} ms`;
  return `import { useChunkedTask } from 'react-inp-chunker';

function Report({ rows }: { rows: readonly Row[] }) {
  // The same ${formatCount(items)} rows, ${sliceNote}.
  // Between slices, the browser handles input and paints.
  const task = useChunkedTask(rows, analyze${options});

  if (!task.isDone || task.results === undefined) {
    return <progress value={task.processed} max={task.total} aria-label="Analyzing rows" />;
  }
  return <Results data={task.results} />;
}`;
}
