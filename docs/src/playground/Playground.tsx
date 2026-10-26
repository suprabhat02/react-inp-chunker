import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useChunkedTask } from 'react-inp-chunker';

import { CodeBlock } from '../components/CodeBlock.tsx';
import { TableWrap } from '../components/TableWrap.tsx';
import { formatCount, formatMs } from '../lib/format.ts';
import { LONG_TASK_MS, RATING_LABEL, rateInp } from '../lib/inp.ts';
import { blockingCode, chunkedCode } from './codeForRun.ts';
import {
  DEFAULT_TIME_SLICE_MS,
  ITEMS_DEFAULT,
  ITEMS_MAX,
  ITEMS_MIN,
  ITEMS_STEP,
  SLICE_MAX,
  SLICE_MIN,
} from './constants.ts';
import { Probe } from './Probe.tsx';
import {
  type RunMode,
  type RunRecord,
  type RunSettings,
  type RunSummary,
  summarize,
  useRunRecorder,
} from './recorder.ts';
import { RunTrace } from './RunTrace.tsx';
import {
  WEIGHT_ORDER,
  WEIGHTS,
  type Weight,
  crunch,
  iterationsFor,
  makeItems,
  measureIterationsPerMs,
} from './workload.ts';

import './playground.css';

type Phase = 'idle' | RunMode;

const NO_ITEMS: readonly number[] = [];

/** One frame at 60 Hz. */
const FRAME_MS = 16.7;

const RUN_NAME: Readonly<Record<RunMode, string>> = {
  blocking: 'Without chunking',
  chunked: 'With react-inp-chunker',
};

interface ComparisonProps {
  readonly blocking: RunRecord | undefined;
  readonly chunked: RunRecord | undefined;
}

function Rating({ ms }: { readonly ms: number }) {
  const rating = rateInp(ms);
  return (
    <span className="rating" data-rating={rating}>
      {RATING_LABEL[rating]}
    </span>
  );
}

function Verdict({ blocking, chunked }: ComparisonProps) {
  if (blocking === undefined || chunked === undefined) {
    const missing =
      blocking === undefined ? 'without chunking' : 'with react-inp-chunker';
    return (
      <p className="playground__verdict">
        Now run it {missing} to compare. With the same settings, it's exactly the same
        work.
      </p>
    );
  }
  if (blocking.outcome === 'cancelled' || chunked.outcome === 'cancelled') {
    return (
      <p className="playground__verdict">
        One run was cancelled. Run both to the end to compare them.
      </p>
    );
  }
  const a = summarize(blocking);
  const b = summarize(chunked);
  const extra = b.totalMs - a.totalMs;
  const sameWork =
    blocking.settings.items === chunked.settings.items &&
    blocking.settings.weight === chunked.settings.weight;
  const totalComparison =
    Math.abs(extra) < a.totalMs * 0.05
      ? 'about the same time in total'
      : `${formatMs(Math.abs(extra))} ${extra > 0 ? 'longer' : 'less'} in total`;

  return (
    <div className="playground__verdict">
      <p>
        {sameWork
          ? 'The same work, done twice. '
          : 'These two runs did different amounts of work. '}
        Without chunking, a click could have waited{' '}
        <strong>{formatMs(a.longestInputDelayMs)}</strong> before the page even noticed
        it. With react-inp-chunker, the longest wait was{' '}
        <strong>{formatMs(b.longestInputDelayMs)}</strong>, and the job took{' '}
        {totalComparison}.
      </p>
      {chunked.settings.timeSliceMs > FRAME_MS ? (
        <p>
          Slices of {chunked.settings.timeSliceMs} ms are longer than a frame, so input
          can wait a whole slice
          {chunked.settings.timeSliceMs >= LONG_TASK_MS
            ? ', and each slice is a long task of its own'
            : ''}
          . The default, {DEFAULT_TIME_SLICE_MS} ms, keeps that wait short.
        </p>
      ) : null}
      {b.longestFrameGapMs > LONG_TASK_MS && b.longestInputDelayMs <= LONG_TASK_MS ? (
        <p>
          Fewer frames than usual were painted during the chunked run. That's the
          browser's choice, not a freeze: Chrome runs <code>scheduler.yield()</code>{' '}
          continuations ahead of routine frames, but never ahead of input, and it paints
          right after any click or key press.
        </p>
      ) : null}
      {a.interactionCount === 0 && b.interactionCount === 0 ? (
        <p>
          Next time, type in the box while each run is going, and see how long each key
          press takes to show up.
        </p>
      ) : null}
    </div>
  );
}

function SummaryTable({ blocking, chunked }: ComparisonProps) {
  const runs: readonly (RunSummary | undefined)[] = [blocking, chunked].map((record) =>
    record === undefined ? undefined : summarize(record),
  );

  const row = (label: string, render: (summary: RunSummary) => ReactNode) => (
    <tr>
      <th scope="row">{label}</th>
      {runs.map((summary, index) => (
        <td key={index}>
          {summary === undefined ? (
            <span className="muted">Not run yet</span>
          ) : (
            render(summary)
          )}
        </td>
      ))}
    </tr>
  );

  return (
    <TableWrap label="Measurements from your runs">
      <table className="playground__table">
        <caption className="visually-hidden">Measurements from your runs</caption>
        <thead>
          <tr>
            <th scope="col">Measured</th>
            <th scope="col">{RUN_NAME.blocking}</th>
            <th scope="col">{RUN_NAME.chunked}</th>
          </tr>
        </thead>
        <tbody>
          {row('Longest a click would have waited', (s) =>
            formatMs(s.longestInputDelayMs),
          )}
          {row('Time to finish the work', (s) => formatMs(s.totalMs))}
          {row('Frames painted during the work', (s) => formatCount(s.framesPainted))}
          {row('Slowest response to your typing or clicks', (s) =>
            s.slowestInteractionMs === null ? (
              <span className="muted">No input during this run</span>
            ) : (
              <span className="playground__inp">
                {formatMs(s.slowestInteractionMs)} <Rating ms={s.slowestInteractionMs} />
              </span>
            ),
          )}
        </tbody>
      </table>
    </TableWrap>
  );
}

function announcementFor(records: ComparisonProps): string {
  const latest = [records.blocking, records.chunked]
    .filter((record): record is RunRecord => record !== undefined)
    .sort((x, y) => y.id - x.id)[0];
  if (latest === undefined) return '';
  const summary = summarize(latest);
  const result =
    latest.outcome === 'cancelled'
      ? 'cancelled'
      : `finished in ${formatMs(summary.totalMs)}`;
  return `${RUN_NAME[latest.mode]}: ${result}. A click would have waited up to ${formatMs(summary.longestInputDelayMs)}.`;
}

export function Playground() {
  const [count, setCount] = useState(ITEMS_DEFAULT);
  const [weight, setWeight] = useState<Weight>('medium');
  const [timeSliceMs, setTimeSliceMs] = useState(DEFAULT_TIME_SLICE_MS);
  const [phase, setPhase] = useState<Phase>('idle');
  const [iterationsPerMs, setIterationsPerMs] = useState<number | null>(null);
  const [runItems, setRunItems] = useState<readonly number[]>(NO_ITEMS);

  const pendingStart = useRef(false);
  const sink = useRef(0);

  const countId = useId();
  const sliceId = useId();
  const sliceHintId = useId();

  const { records, begin, markWorkStart, end, noteInteraction } = useRunRecorder();

  // Measure this device once the page has settled, so estimates are in its real milliseconds.
  useEffect(() => {
    const timer = setTimeout(() => {
      setIterationsPerMs(measureIterationsPerMs());
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const iterations =
    iterationsPerMs === null ? 1 : iterationsFor(weight, iterationsPerMs);
  const perItemMs = WEIGHTS[weight].targetMs;
  const settings: RunSettings = { items: count, weight, timeSliceMs };

  const { start, cancel, processed, total } = useChunkedTask(
    runItems,
    (seed: number) => crunch(seed, iterations),
    {
      autoStart: false,
      timeSliceMs,
      onItem: (result, _item, index) => {
        sink.current += result;
        // The last item: the run is over the moment it returns.
        if (index === runItems.length - 1) {
          end('done');
          setPhase('idle');
        }
      },
    },
  );

  // A new run's items arrive in a render. By the time this effect runs, the
  // hook's own effect has created the task for them, so start() starts it.
  useEffect(() => {
    if (!pendingStart.current || runItems === NO_ITEMS) return;
    pendingStart.current = false;
    markWorkStart();
    start();
  }, [runItems, start, markWorkStart]);

  function cancelChunked() {
    cancel();
    end('cancelled');
    setPhase('idle');
  }

  const ready = iterationsPerMs !== null && phase === 'idle';
  const { blocking, chunked } = records;

  function runBlocking() {
    const items = makeItems(count);
    const iterationsNow = iterations;
    setPhase('blocking');
    begin('blocking', settings);
    // Let the "running" state paint first, so the freeze that follows is the work and nothing else.
    requestAnimationFrame(() => {
      setTimeout(() => {
        markWorkStart();
        let sum = 0;
        for (const item of items) sum += crunch(item, iterationsNow);
        sink.current += sum;
        end('done');
        setPhase('idle');
      }, 0);
    });
  }

  function runChunked() {
    pendingStart.current = true;
    setPhase('chunked');
    begin('chunked', settings);
    setRunItems(makeItems(count));
  }

  return (
    <div className="playground">
      <ol className="playground__steps">
        <li className="playground__step">
          <h3 className="playground__step-title">Choose the work</h3>
          <fieldset className="playground__controls" disabled={phase !== 'idle'}>
            <legend className="visually-hidden">Workload</legend>
            <div className="control">
              <label className="field-label" htmlFor={countId}>
                Rows to analyze <output htmlFor={countId}>{formatCount(count)}</output>
              </label>
              <input
                id={countId}
                type="range"
                min={ITEMS_MIN}
                max={ITEMS_MAX}
                step={ITEMS_STEP}
                value={count}
                onChange={(event) => {
                  setCount(Number(event.currentTarget.value));
                }}
              />
            </div>
            <fieldset className="control control--group">
              <legend className="field-label">Work per row</legend>
              <div className="segmented">
                {WEIGHT_ORDER.map((option) => (
                  <label key={option} className="segmented__option">
                    <input
                      type="radio"
                      name="playground-weight"
                      value={option}
                      checked={weight === option}
                      onChange={() => {
                        setWeight(option);
                      }}
                    />
                    <span className="segmented__text">
                      {WEIGHTS[option].label}
                      <span className="segmented__detail">
                        ~{formatMs(WEIGHTS[option].targetMs)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="control">
              <label className="field-label" htmlFor={sliceId}>
                Time slice <output htmlFor={sliceId}>{timeSliceMs} ms</output>
              </label>
              <input
                id={sliceId}
                type="range"
                min={SLICE_MIN}
                max={SLICE_MAX}
                step={1}
                value={timeSliceMs}
                aria-describedby={sliceHintId}
                onChange={(event) => {
                  setTimeSliceMs(Number(event.currentTarget.value));
                }}
              />
              <p className="control__hint" id={sliceHintId}>
                How long the hook works before giving the browser a turn. Only the chunked
                run uses it.
              </p>
            </div>
          </fieldset>
          <p className="playground__estimate">
            {iterationsPerMs === null
              ? 'Measuring this device…'
              : `About ${formatMs(count * perItemMs)} of work on this device: ${formatCount(count)} rows at ~${formatMs(perItemMs)} each.`}
          </p>
        </li>

        <li className="playground__step">
          <h3 className="playground__step-title">Run it</h3>
          <div className="playground__actions">
            <button
              type="button"
              className="button"
              disabled={!ready}
              onClick={runBlocking}
            >
              Run without chunking
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={!ready}
              onClick={runChunked}
            >
              Run with react-inp-chunker
            </button>
            {phase === 'chunked' ? (
              <button type="button" className="button" onClick={cancelChunked}>
                Cancel
              </button>
            ) : null}
          </div>
          <div className="playground__progress">
            {phase === 'blocking' ? (
              <p>Running without chunking. The page stays frozen until it's done.</p>
            ) : phase === 'chunked' ? (
              <>
                <progress
                  value={processed}
                  max={Math.max(total, 1)}
                  aria-label="Rows analyzed"
                />
                <p>
                  {formatCount(processed)} of {formatCount(total)} rows
                </p>
              </>
            ) : (
              <p className="muted">Run both, in either order, then compare them below.</p>
            )}
          </div>
        </li>

        <li className="playground__step">
          <h3 className="playground__step-title">Use the page while it runs</h3>
          <Probe onInteraction={noteInteraction} />
        </li>
      </ol>

      <div className="visually-hidden" role="status">
        {announcementFor({ blocking, chunked })}
      </div>

      {blocking !== undefined || chunked !== undefined ? (
        <section className="playground__results" aria-labelledby="playground-results">
          <h3 id="playground-results" className="playground__results-title">
            What happened
          </h3>
          <RunTrace records={records} />
          <Verdict blocking={blocking} chunked={chunked} />
          <SummaryTable blocking={blocking} chunked={chunked} />
        </section>
      ) : null}

      <section className="playground__code" aria-labelledby="playground-code">
        <h3 id="playground-code" className="playground__results-title">
          The code for these settings
        </h3>
        <div className="playground__code-grid">
          <CodeBlock
            title="Before: one long task"
            copyLabel="code without chunking"
            code={blockingCode({ items: count, perItemMs, timeSliceMs })}
          />
          <CodeBlock
            title="After: with react-inp-chunker"
            copyLabel="code with react-inp-chunker"
            code={chunkedCode({ items: count, perItemMs, timeSliceMs })}
          />
        </div>
      </section>
    </div>
  );
}
