import { memo } from 'react';

import { formatMs } from '../lib/format.ts';
import { type RunMode, type RunRecord, type RunRecords, summarize } from './recorder.ts';

const LANES: readonly { readonly mode: RunMode; readonly name: string }[] = [
  { mode: 'blocking', name: 'Without chunking' },
  { mode: 'chunked', name: 'With react-inp-chunker' },
];

const NICE_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 5000];

function rulerStep(scaleMs: number): number {
  return NICE_STEPS.find((step) => scaleMs / step <= 7) ?? 10_000;
}

function Lane({
  record,
  scaleMs,
}: {
  readonly record: RunRecord;
  readonly scaleMs: number;
}) {
  const pct = (ms: number): string =>
    `${((Math.max(0, ms) / scaleMs) * 100).toFixed(3)}%`;
  const { blocked } = summarize(record);
  const framePath = record.frames
    .filter((frame) => frame <= scaleMs)
    .map((frame) => `M${frame.toFixed(2)} 0V10`)
    .join('');

  return (
    <div className="trace__lane" aria-hidden="true">
      <span
        className="trace__task trace__task--work"
        style={{
          left: pct(record.workStart),
          width: pct(record.workEnd - record.workStart),
        }}
      />
      {blocked.map((segment) => (
        <span
          key={segment.start}
          className="trace__task trace__task--long"
          style={{ left: pct(segment.start), width: pct(segment.end - segment.start) }}
        />
      ))}
      <svg
        className="trace__frames"
        viewBox={`0 0 ${scaleMs} 10`}
        preserveAspectRatio="none"
      >
        <path d={framePath} vectorEffect="non-scaling-stroke" />
      </svg>
      {record.interactions.map((interaction, index) => (
        <span key={index}>
          <span
            className="trace__wait"
            style={{ left: pct(interaction.at), width: pct(interaction.latency) }}
          />
          <span
            className="trace__click trace__click--small"
            style={{ left: pct(interaction.at) }}
          />
        </span>
      ))}
    </div>
  );
}

/**
 * Both runs on one time axis, drawn only from what was recorded: the
 * frames the browser rendered, the stretches where input would have had
 * to wait (hatched), and every interaction with how long it took to show.
 */
export const RunTrace = memo(function RunTrace({
  records,
}: {
  readonly records: RunRecords;
}) {
  const recorded = LANES.flatMap((lane) => {
    const record = records[lane.mode];
    return record === undefined ? [] : [{ ...lane, record }];
  });
  if (recorded.length === 0) return null;

  const longest = Math.max(
    ...recorded.map(({ record }) => record.frames.at(-1) ?? record.workEnd),
  );
  const step = rulerStep(longest);
  const scaleMs = Math.ceil(longest / step) * step;
  const ruler = Array.from({ length: scaleMs / step + 1 }, (_, index) => index * step);

  return (
    <div className="trace trace--results">
      <div className="trace__head" aria-hidden="true">
        <span />
        <div className="trace__ruler">
          {ruler.map((ms) => (
            <span
              key={ms}
              className="trace__tick"
              style={{ left: `${(ms / scaleMs) * 100}%` }}
            >
              {ms === 0 ? '0' : formatMs(ms)}
            </span>
          ))}
        </div>
        <span className="trace__column-title">Longest input delay</span>
      </div>
      {recorded.map(({ mode, name, record }) => (
        <div className="trace__row" key={mode}>
          <div className="trace__label">
            <span className="trace__name">{name}</span>
            <span className="trace__detail">
              {record.outcome === 'cancelled'
                ? 'cancelled'
                : `${formatMs(record.workEnd - record.workStart)} total`}
            </span>
          </div>
          <Lane record={record} scaleMs={scaleMs} />
          <span className="trace__freeze">
            {formatMs(summarize(record).longestInputDelayMs)}
          </span>
        </div>
      ))}
      <ul className="trace__legend trace__legend--results" aria-label="Legend">
        <li>
          <span className="trace__key trace__key--task" aria-hidden="true" />
          Work running
        </li>
        <li>
          <span className="trace__key trace__key--long" aria-hidden="true" />
          Input would have waited over 50 ms
        </li>
        <li>
          <span className="trace__key trace__key--frame" aria-hidden="true" />
          Frame painted
        </li>
        <li>
          <span className="trace__key trace__key--click" aria-hidden="true" />
          Your input, and the wait until it showed
        </li>
      </ul>
    </div>
  );
});
