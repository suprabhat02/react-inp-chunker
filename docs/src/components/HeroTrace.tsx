import { useId, useState } from 'react';

import { formatMs } from '../lib/format.ts';
import { LONG_TASK_MS, RATING_LABEL, rateInp } from '../lib/inp.ts';

import './trace.css';

/*
 * An illustration, not a measurement: the playground below measures for
 * real. The numbers follow how the two approaches actually behave.
 *   Without chunking: one 1.2 s task. A click waits for all of it.
 *   With chunking: the same work in 5 ms slices, with a short yield after
 *     each, which is where the slight extra total time comes from. A click
 *     waits only for the slice in progress.
 * Either way, once the click is handled, the browser paints its result
 * right away (browsers prioritize rendering after input). The time from
 * click to that paint is what INP measures.
 */
const WORK_MS = 1200;
const SLICE_MS = 5;
const YIELD_MS = 0.4;
/** The click handler runs, React renders what it changed, and the frame paints. */
const RESPOND_MS = 6;
const SCALE_MS = 1400;
const RULER_STEP_MS = 200;

interface Slice {
  readonly start: number;
  readonly end: number;
}

function buildSlices(): readonly Slice[] {
  const slices: Slice[] = [];
  for (
    let done = 0, at = 0;
    done < WORK_MS;
    done += SLICE_MS, at += SLICE_MS + YIELD_MS
  ) {
    slices.push({ start: at, end: at + Math.min(SLICE_MS, WORK_MS - done) });
  }
  return slices;
}

const SLICES = buildSlices();
const CHUNKED_TOTAL = SLICES.at(-1)?.end ?? WORK_MS;
const RULER = Array.from(
  { length: SCALE_MS / RULER_STEP_MS + 1 },
  (_, i) => i * RULER_STEP_MS,
);

/** When a click at `clickAt` gets handled: after the task (or the slice) in progress. */
function handledAt(clickAt: number, chunked: boolean): number {
  if (!chunked) return Math.max(clickAt, WORK_MS);
  const running = SLICES.find((slice) => clickAt >= slice.start && clickAt < slice.end);
  return running === undefined ? clickAt : running.end;
}

const pct = (ms: number): string => `${((ms / SCALE_MS) * 100).toFixed(3)}%`;

function Readout({ ms, sliderId }: { readonly ms: number; readonly sliderId: string }) {
  const rating = rateInp(ms);
  return (
    <output className="trace__readout" htmlFor={sliderId}>
      <span className="trace__readout-value">{formatMs(ms)}</span>
      <span className="rating" data-rating={rating}>
        {RATING_LABEL[rating]}
      </span>
    </output>
  );
}

export function HeroTrace() {
  const [clickAt, setClickAt] = useState(300);
  const sliderId = useId();
  const captionId = useId();

  const blockingPaint = handledAt(clickAt, false) + RESPOND_MS;
  const chunkedPaint = handledAt(clickAt, true) + RESPOND_MS;

  return (
    <figure className="trace trace--hero" aria-labelledby={captionId}>
      <div className="trace__grid">
        <div className="trace__head" aria-hidden="true">
          <span />
          <div className="trace__ruler">
            {RULER.map((ms) => (
              <span key={ms} className="trace__tick" style={{ left: pct(ms) }}>
                {ms === SCALE_MS ? `${ms} ms` : ms}
              </span>
            ))}
          </div>
          <span className="trace__column-title">Click to next paint</span>
        </div>

        <div className="trace__row">
          <div className="trace__label">
            <span className="trace__name">Without chunking</span>
            <span className="trace__detail">one 1.2 s task</span>
          </div>
          <div className="trace__lane" aria-hidden="true">
            <span className="trace__task" style={{ left: 0, width: pct(LONG_TASK_MS) }} />
            <span
              className="trace__task trace__task--long"
              style={{ left: pct(LONG_TASK_MS), width: pct(WORK_MS - LONG_TASK_MS) }}
            />
            <span
              className="trace__wait"
              style={{ left: pct(clickAt), width: pct(blockingPaint - clickAt) }}
            />
            <span className="trace__frame" style={{ left: pct(blockingPaint) }} />
            <span className="trace__click" style={{ left: pct(clickAt) }} />
          </div>
          <Readout ms={blockingPaint - clickAt} sliderId={sliderId} />
        </div>

        <div className="trace__row">
          <div className="trace__label">
            <span className="trace__name">With react-inp-chunker</span>
            <span className="trace__detail">5 ms slices</span>
          </div>
          <div className="trace__lane" aria-hidden="true">
            {SLICES.map((slice) => (
              <span
                key={slice.start}
                className="trace__task trace__task--slice"
                style={{ left: pct(slice.start), width: pct(slice.end - slice.start) }}
              />
            ))}
            <span
              className="trace__wait"
              style={{ left: pct(clickAt), width: pct(chunkedPaint - clickAt) }}
            />
            <span className="trace__frame" style={{ left: pct(chunkedPaint) }} />
            <span className="trace__click" style={{ left: pct(clickAt) }} />
          </div>
          <Readout ms={chunkedPaint - clickAt} sliderId={sliderId} />
        </div>

        <div className="trace__control">
          <span />
          <div>
            <label className="trace__control-label" htmlFor={sliderId}>
              Click at <strong>{formatMs(clickAt)}</strong> into the work
            </label>
            <input
              id={sliderId}
              type="range"
              min={0}
              max={WORK_MS - 20}
              step={10}
              value={clickAt}
              aria-valuetext={`${formatMs(clickAt)} into the work`}
              onChange={(event) => {
                setClickAt(Number(event.currentTarget.value));
              }}
            />
          </div>
        </div>
      </div>

      <figcaption id={captionId} className="trace__caption">
        <ul className="trace__legend" aria-label="Legend">
          <li>
            <span className="trace__key trace__key--task" aria-hidden="true" />
            JavaScript running
          </li>
          <li>
            <span className="trace__key trace__key--long" aria-hidden="true" />
            Long task: input has to wait
          </li>
          <li>
            <span className="trace__key trace__key--click" aria-hidden="true" />
            Your click, and the wait until it shows
          </li>
          <li>
            <span className="trace__key trace__key--frame" aria-hidden="true" />
            The frame that shows it
          </li>
        </ul>
        <p className="trace__note">
          An illustration of the same 1.2 seconds of work, done both ways. Move the slider
          to click at a different moment: without chunking, the click waits for the whole
          task; with chunking, only for the slice in progress. The short pauses between
          slices make the job about {formatMs(CHUNKED_TOTAL - WORK_MS)} longer in total.
        </p>
      </figcaption>
    </figure>
  );
}
