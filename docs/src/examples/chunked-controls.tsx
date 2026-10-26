// #region hidden
import { formatCsvLine, saveFile, type Row } from './fixtures.ts';
// #endregion
import { useEffect, useRef } from 'react';
import { useChunkedTask } from 'react-inp-chunker';

export function CsvExport({ rows }: { rows: readonly Row[] }) {
  const lines = useRef<string[]>([]);

  const exporter = useChunkedTask(rows, formatCsvLine, {
    autoStart: false, // wait for the button
    onItem: (line) => {
      lines.current.push(line); // take each result as it's made
    },
  });

  useEffect(() => {
    if (exporter.isDone) saveFile('rows.csv', lines.current);
  }, [exporter.isDone]);

  return (
    <div>
      <button
        onClick={() => {
          lines.current = [];
          exporter.start();
        }}
        disabled={!exporter.isIdle}
      >
        Export {exporter.total} rows
      </button>
      <button onClick={exporter.pause} disabled={!exporter.isProcessing}>
        Pause
      </button>
      <button onClick={exporter.resume} disabled={!exporter.isPaused}>
        Resume
      </button>
      <button
        onClick={exporter.cancel}
        disabled={!exporter.isProcessing && !exporter.isPaused}
      >
        Cancel
      </button>
      <p>
        {exporter.processed} of {exporter.total} rows, {exporter.status}
      </p>
    </div>
  );
}
