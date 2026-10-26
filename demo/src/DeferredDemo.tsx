import { useState } from 'react';
import { useDeferredTask, type DeferredGenerator } from 'react-inp-chunker';

const FRAME_COUNT = 2500;
// Calibrated to ~1ms of real work per "frame" in this browser — uniform
// cost, unlike checking primality of a growing number, so each yield
// checkpoint represents roughly the same amount of work every time.
const WORK_PER_FRAME = 100_000;

function renderOneExpensiveFrame(seed: number): number {
  let acc = 0;
  for (let i = 0; i < WORK_PER_FRAME; i++) {
    acc += Math.sqrt(i * (seed + 1)) % 3;
  }
  return acc;
}

function* renderFrames(
  frameCount: number,
  onProgress: (rendered: number) => void,
): DeferredGenerator<number> {
  for (let i = 0; i < frameCount; i++) {
    renderOneExpensiveFrame(i);
    onProgress(i + 1);
    // One checkpoint per frame — the engine decides whether elapsed time
    // actually calls for ceding to the browser here. Each frame costs
    // roughly the same, so this is a good place to offer: no widening
    // gap between checkpoints as the task progresses (compare the
    // README's own renderFrames() example, which follows this exact
    // one-yield-per-unit-of-work shape).
    yield;
  }
  return frameCount;
}

export function DeferredDemo() {
  const [rendered, setRendered] = useState(0);

  const task = useDeferredTask(
    () => renderFrames(FRAME_COUNT, setRendered),
    [],
    { autoStart: false },
  );

  const pct = Math.round((rendered / FRAME_COUNT) * 100);

  return (
    <section className="panel">
      <h2>useDeferredTask — arbitrary chunked work</h2>
      <p>
        Simulates rendering {FRAME_COUNT.toLocaleString()} expensive frames
        one at a time via a generator with an explicit <code>yield</code>{' '}
        after each — the pattern for work that isn&apos;t "one function
        applied to every array item."
      </p>

      <div className="panel__controls">
        <button type="button" onClick={task.start} disabled={task.isProcessing}>
          Start
        </button>
        <button type="button" onClick={task.pause} disabled={!task.isProcessing}>
          Pause
        </button>
        <button type="button" onClick={task.resume} disabled={!task.isPaused}>
          Resume
        </button>
        <button
          type="button"
          onClick={task.cancel}
          disabled={task.isIdle || task.isDone || task.isCancelled}
        >
          Cancel
        </button>
      </div>

      <progress value={pct} max={100} />
      <p>
        {task.isIdle && 'Not started.'}
        {task.isProcessing &&
          `Rendered ${rendered.toLocaleString()}/${FRAME_COUNT.toLocaleString()} frames (${pct}%) — heartbeat above keeps ticking.`}
        {task.isPaused && `Paused at ${pct}% — heartbeat above keeps ticking.`}
        {task.isCancelled && 'Cancelled.'}
        {task.isDone && `Done — rendered all ${FRAME_COUNT.toLocaleString()} frames.`}
      </p>
    </section>
  );
}
