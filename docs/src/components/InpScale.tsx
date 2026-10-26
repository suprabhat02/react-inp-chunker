import { INP_GOOD_MS, INP_POOR_MS } from '../lib/inp.ts';

import './inp-scale.css';

const SCALE_MAX_MS = 800;

const pct = (ms: number): string =>
  `${(Math.min(ms, SCALE_MAX_MS) / SCALE_MAX_MS) * 100}%`;

/** The INP thresholds as a scale, with an optional marker for a measured value. */
export function InpScale({
  markerMs,
  markerLabel,
}: {
  readonly markerMs?: number;
  readonly markerLabel?: string;
}) {
  return (
    <figure className="inp-scale">
      <div className="inp-scale__bar" aria-hidden="true">
        <span
          className="inp-scale__band inp-scale__band--good"
          style={{ width: pct(INP_GOOD_MS) }}
        />
        <span
          className="inp-scale__band inp-scale__band--ni"
          style={{ left: pct(INP_GOOD_MS), width: pct(INP_POOR_MS - INP_GOOD_MS) }}
        />
        <span
          className="inp-scale__band inp-scale__band--poor"
          style={{ left: pct(INP_POOR_MS), right: 0 }}
        />
        {markerMs !== undefined ? (
          <span className="inp-scale__marker" style={{ left: pct(markerMs) }} />
        ) : null}
      </div>
      <figcaption className="inp-scale__legend">
        <span>
          <strong>Good</strong> up to {INP_GOOD_MS} ms
        </span>
        <span>
          <strong>Needs improvement</strong> up to {INP_POOR_MS} ms
        </span>
        <span>
          <strong>Poor</strong> over {INP_POOR_MS} ms
        </span>
        {markerLabel !== undefined ? (
          <span className="inp-scale__marker-label">{markerLabel}</span>
        ) : null}
      </figcaption>
    </figure>
  );
}
