import { useId, useState } from 'react';

import { formatCount, formatNs } from '../lib/format.ts';
import { OVERHEAD_ITEMS, measureOverhead } from './overhead.ts';

const BATCH_SIZES = [1, 16, 64] as const;
type BatchSize = (typeof BATCH_SIZES)[number];

type Collect = 'keep' | 'discard';

type Phase = 'idle' | 'measuring' | 'done' | 'error';

interface Result {
  readonly plainLoopNs: number;
  readonly schedulerNs: number;
}

/** The taller of the two bars sets the scale; a result can't overflow it. */
function barWidth(ns: number, maxNs: number): string {
  if (maxNs <= 0) return '0%';
  return `${Math.max(2, Math.min(100, (ns / maxNs) * 100))}%`;
}

export function OverheadTuner() {
  const [batchSize, setBatchSize] = useState<BatchSize>(1);
  const [collect, setCollect] = useState<Collect>('keep');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result | undefined>(undefined);

  const batchId = useId();
  const collectId = useId();

  async function run() {
    setPhase('measuring');
    try {
      // Let "Measuring…" paint before the (synchronous, uninterrupted)
      // plain-loop half of the comparison blocks the thread.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const measured = await measureOverhead({
        batchSize,
        collectResults: collect === 'keep',
      });
      setResult(measured);
      setPhase('done');
    } catch {
      setPhase('error');
    }
  }

  const maxNs = result === undefined ? 0 : Math.max(result.plainLoopNs, result.schedulerNs);
  const overhead = result === undefined ? undefined : result.schedulerNs - result.plainLoopNs;

  return (
    <section
      className="playground__overhead"
      aria-labelledby="overhead-title"
      id="tune-the-overhead"
    >
      <h3 id="overhead-title" className="playground__results-title">
        Tune the engine's overhead
      </h3>
      <p className="playground__overhead-intro">
        The rows above are a few milliseconds of real work each — heavy enough that the
        engine's own cost disappears next to it. This runs <code>createChunkScheduler</code>{' '}
        over {formatCount(OVERHEAD_ITEMS)} items that take nanoseconds each, the case{' '}
        <code>batchSize</code> and <code>collectResults</code> exist for, measured live in
        this browser rather than quoted from a changelog.
      </p>

      <div className="playground__controls overhead__controls">
        <fieldset className="control control--group">
          <legend className="field-label" id={batchId}>
            batchSize — clock reads
          </legend>
          <div className="segmented" role="radiogroup" aria-labelledby={batchId}>
            {BATCH_SIZES.map((size) => (
              <label key={size} className="segmented__option">
                <input
                  type="radio"
                  name="overhead-batch-size"
                  value={size}
                  checked={batchSize === size}
                  onChange={() => {
                    setBatchSize(size);
                  }}
                />
                <span className="segmented__text">
                  {size}
                  <span className="segmented__detail">
                    {size === 1 ? 'every item' : `every ${String(size)}`}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="control__hint">
            How many items run between clock readings. Higher means the slice can overrun
            its budget by that many items — worth it only when, like here, the clock read
            costs more than the item does.
          </p>
        </fieldset>

        <fieldset className="control control--group">
          <legend className="field-label" id={collectId}>
            collectResults
          </legend>
          <div className="segmented segmented--two" role="radiogroup" aria-labelledby={collectId}>
            {(
              [
                ['keep', 'Keep', 'results: R[]'],
                ['discard', 'Discard', 'via onItem'],
              ] as const
            ).map(([value, label, detail]) => (
              <label key={value} className="segmented__option">
                <input
                  type="radio"
                  name="overhead-collect"
                  value={value}
                  checked={collect === value}
                  onChange={() => {
                    setCollect(value);
                  }}
                />
                <span className="segmented__text">
                  {label}
                  <span className="segmented__detail">{detail}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="control__hint">
            Discarding keeps nothing retained — results are handed to <code>onItem</code> as
            they finish, so a run of any size holds no array.
          </p>
        </fieldset>

        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            void run();
          }}
          disabled={phase === 'measuring'}
        >
          {phase === 'measuring' ? 'Measuring…' : 'Measure in this browser'}
        </button>
      </div>

      {phase === 'error' ? (
        <p className="playground__overhead-error" role="alert">
          Couldn't measure that here — your browser may be throttling background work in
          this tab.
        </p>
      ) : null}

      {result !== undefined && phase === 'done' ? (
        <div className="overhead__result">
          <div className="overhead__bars">
            <div className="overhead__bar-row">
              <span className="overhead__bar-label">Plain loop</span>
              <div className="overhead__bar-track">
                <span
                  className="overhead__bar overhead__bar--baseline"
                  style={{ width: barWidth(result.plainLoopNs, maxNs) }}
                />
              </div>
              <span className="overhead__bar-value">{formatNs(result.plainLoopNs)}/item</span>
            </div>
            <div className="overhead__bar-row">
              <span className="overhead__bar-label">createChunkScheduler</span>
              <div className="overhead__bar-track">
                <span
                  className="overhead__bar"
                  style={{ width: barWidth(result.schedulerNs, maxNs) }}
                />
              </div>
              <span className="overhead__bar-value">{formatNs(result.schedulerNs)}/item</span>
            </div>
          </div>
          <p className="playground__overhead-verdict">
            {overhead !== undefined && overhead > 0
              ? `${formatNs(overhead)} of overhead per item, in this browser, right now`
              : "No measurable overhead over the plain loop, in this browser, right now"}{' '}
            — at <code>batchSize: {batchSize}</code>
            {collect === 'discard' ? ', not collecting results' : ''}.{' '}
            {batchSize === 64 && collect === 'discard'
              ? "That's the smallest this gets."
              : 'Try batchSize: 64 with results discarded for the smallest gap.'}
          </p>
        </div>
      ) : null}
    </section>
  );
}
