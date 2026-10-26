import { useMemo, useState } from 'react';
import { useChunkedTask } from 'react-inp-chunker';
import { heavyWork, makeItems } from './heavyWork';

const ITEM_COUNT = 400;

export function BlockingVsChunked() {
  const items = useMemo(() => makeItems(ITEM_COUNT), []);
  const [blockingState, setBlockingState] = useState<
    'idle' | 'running' | 'done'
  >('idle');
  const [blockingMs, setBlockingMs] = useState<number | null>(null);
  const [clickCount, setClickCount] = useState(0);

  const chunked = useChunkedTask(items, heavyWork, { autoStart: false });

  const runBlocking = () => {
    setBlockingState('running');
    setBlockingMs(null);
    // Deliberately synchronous — no yielding at all. This is the thing
    // react-inp-chunker exists to prevent: the browser cannot paint,
    // respond to clicks, or tick the heartbeat above until this returns.
    const start = performance.now();
    for (const item of items) heavyWork(item);
    setBlockingMs(performance.now() - start);
    setBlockingState('done');
  };

  const running = blockingState === 'running' || chunked.isProcessing;

  return (
    <section className="panel">
      <h2>Blocking vs. chunked</h2>
      <p>
        Both run the exact same {ITEM_COUNT} expensive calls. Watch the
        heartbeat above, and try clicking the counter button below, while
        each one runs.
      </p>

      <button
        type="button"
        onClick={() => {
          setClickCount((c) => c + 1);
        }}
      >
        click me (responded {clickCount} times)
      </button>

      <div className="panel__runs">
        <div>
          <button type="button" onClick={runBlocking} disabled={running}>
            Run blocking (no chunking)
          </button>
          <p>
            {blockingState === 'idle' && 'Not run yet.'}
            {blockingState === 'running' &&
              'Running — the heartbeat and click button are frozen right now.'}
            {blockingState === 'done' &&
              `Done in ${blockingMs?.toFixed(0)}ms, all in one uninterrupted block.`}
          </p>
        </div>

        <div>
          <button type="button" onClick={chunked.start} disabled={running}>
            Run with useChunkedTask
          </button>
          <p>
            {chunked.isIdle && 'Not run yet.'}
            {chunked.isProcessing &&
              `Processing ${chunked.processed}/${chunked.total} — heartbeat keeps ticking, clicks keep registering.`}
            {chunked.isDone && `Done — all ${chunked.total} items processed in chunks.`}
          </p>
        </div>
      </div>
    </section>
  );
}
