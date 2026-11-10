/**
 * Development-only guidance for the two ways a chunked task quietly fails
 * to do what the caller wanted:
 *
 *  1. A single item takes longer than a long task. Chunking cannot help:
 *     a slice is never shorter than one item, so the page still freezes.
 *  2. Items are so cheap that reading the clock — around 300ns in a
 *     browser, where it is coarsened to 0.1ms anyway — costs more than the
 *     work between reads. `batchSize` exists for exactly this.
 *
 * Neither is visible from the outside without a profiler, and both have a
 * concrete fix, which is what makes them worth a warning.
 *
 * It also draws every task in the Chrome DevTools Performance panel, on a
 * track of its own beside React's: one entry per slice, nested under one
 * for the whole run. See `stamp()` below for how, and why not
 * `performance.measure()`.
 *
 * Nothing here costs anything in production. The engines guard every call
 * with `isDevelopment`, which the production build (see tsdown.config.ts)
 * replaces with a literal `false`, so the calls and this module both
 * disappear. The checks also ride on clock reads the loop already makes and
 * keep their own baselines, so the hot loop needs no extra bookkeeping.
 */

export const isDevelopment: boolean =
  typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'production';

/** The Long Tasks API's definition: past this, the browser calls it a long task. */
const LONG_UNIT_MS = 50;

/** Below this average cost, the clock read dominates the work. */
const CLOCK_BOUND_UNIT_MS = 0.002;

/** Units per slice below which the sample is too small to judge. */
const MIN_UNITS_TO_JUDGE = 64;

/** A suggested batch should take about this long, bounding the overshoot it buys. */
const TARGET_BATCH_MS = 0.1;
const MAX_SUGGESTED_BATCH = 512;

/** How a task ended, for the colour and text of its DevTools entry. */
export type FinishedStatus = 'done' | 'cancelled' | 'error';

export interface Diagnostics {
  /** Every clock check: `at` is that reading, `unitsDone` the running total. */
  check(at: number, unitsDone: number): void;
  /** The check that ended a slice, before yielding. */
  sliceEnded(at: number, unitsDone: number): void;
  /** Work starting, or resuming after a yield or pause: a new slice begins. */
  resumed(at: number, unitsDone: number): void;
  /** The task settled. Draws its last slice and the span of the whole run. */
  finished(at: number, status: FinishedStatus): void;
  /** A development warning, prefixed with the task's label when it has one. */
  warn(message: string): void;
}

function warn(message: string): void {
  console.warn(`[react-inp-chunker] ${message}`);
}

/** Every track this package draws sits in one group, collapsible as a unit. */
const TRACK_GROUP = 'react-inp-chunker';

/** The colours Chrome's Performance panel accepts for an entry. */
type TrackColor = 'primary' | 'primary-dark' | 'secondary' | 'tertiary' | 'error';

type TimeStamp = (
  label: string,
  start: number,
  end: number,
  track: string,
  trackGroup: string,
  color: TrackColor,
) => void;

/**
 * One entry on a custom track in the Chrome DevTools Performance panel,
 * through the extended `console.timeStamp()` — the same API React 19.2 uses
 * for its own tracks. Chosen over `performance.measure()` with a
 * `detail.devtools` payload deliberately: a measure is a PerformanceEntry
 * that stays in the page's timeline buffer, which nothing ever empties, so a
 * long task would add one per slice for as long as the page lives — and any
 * script reading that buffer (an analytics or RUM snippet) would see them.
 * A time stamp leaves nothing behind. Browsers without the extension take
 * the label alone and ignore the rest; DevTools closed, it costs next to
 * nothing.
 */
function stamp(
  label: string,
  start: number,
  end: number,
  track: string,
  color: TrackColor,
): void {
  const timeStamp = (console as { timeStamp?: unknown }).timeStamp;
  if (typeof timeStamp !== 'function') return;
  (timeStamp as TimeStamp).call(console, label, start, end, track, TRACK_GROUP, color);
}

const FINISHED_COLOR: Record<FinishedStatus, TrackColor> = {
  done: 'primary-dark',
  cancelled: 'secondary',
  error: 'error',
};

/**
 * Unlabelled tasks each get a track of their own, numbered: two of them
 * running at once interleave their slices, and on one shared track their
 * whole-run entries would overlap without nesting.
 */
let unlabelledTasks = 0;

/** A label as given, or `undefined` for anything that isn't a non-empty string. */
function normalizeLabel(label: unknown): string | undefined {
  return typeof label === 'string' && label.trim() !== '' ? label.trim() : undefined;
}

function plural(count: number, unit: string): string {
  return `${count.toLocaleString('en-US')} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * A batch that should take about TARGET_BATCH_MS, which is also the
 * overshoot the caller takes on by accepting it. No lower bound is needed:
 * the warning only fires below CLOCK_BOUND_UNIT_MS, so the result is
 * always at least TARGET_BATCH_MS / CLOCK_BOUND_UNIT_MS.
 */
function suggestedBatchSize(unitCostMs: number): number {
  const target = Math.round(TARGET_BATCH_MS / unitCostMs);
  return target > MAX_SUGGESTED_BATCH ? MAX_SUGGESTED_BATCH : target;
}

/**
 * `unit` names what one step of this task is, so the message can say
 * "item" for a chunked array and "segment" for a generator.
 */
export function createDiagnostics(
  unit: 'item' | 'segment',
  batchSize: number,
  label?: string,
): Diagnostics {
  const name = normalizeLabel(label);
  const track = name ?? `task ${String(++unlabelledTasks)}`;
  const say = (message: string): void => {
    warn(name === undefined ? message : `"${name}": ${message}`);
  };
  let taskStartedAt: number | undefined;
  let slices = 0;
  let lastCheckAt = 0;
  let lastCheckUnits = 0;
  let sliceStartedAt = 0;
  let sliceStartUnits = 0;
  let started = false;
  let warnedAboutLongUnit = false;
  let warnedAboutClockCost = false;

  const rebase = (at: number, unitsDone: number): void => {
    lastCheckAt = at;
    lastCheckUnits = unitsDone;
    sliceStartedAt = at;
    sliceStartUnits = unitsDone;
    started = true;
    taskStartedAt ??= at;
  };

  /** Draws the slice that ran from the last rebase to `at`, if it did any work. */
  const drawSlice = (at: number, unitsDone: number): void => {
    if (unitsDone <= sliceStartUnits) return;
    slices += 1;
    const first = sliceStartUnits;
    const last = unitsDone - 1;
    const which =
      first === last
        ? `${unit} ${String(first)}`
        : `${unit}s ${String(first)}–${String(last)}`;
    stamp(which, sliceStartedAt, at, track, 'primary');
  };

  return {
    check(at, unitsDone) {
      if (!started) {
        rebase(at, unitsDone);
        return;
      }
      const batchMs = at - lastCheckAt;
      const unitsInBatch = unitsDone - lastCheckUnits;
      lastCheckAt = at;
      lastCheckUnits = unitsDone;

      if (warnedAboutLongUnit || batchMs <= LONG_UNIT_MS) return;
      warnedAboutLongUnit = true;
      const where =
        unitsInBatch === 1
          ? `One ${unit} (index ${String(unitsDone - 1)}) took ${batchMs.toFixed(0)}ms`
          : `A batch of ${String(unitsInBatch)} ${unit}s took ${batchMs.toFixed(0)}ms`;
      const fix =
        unit === 'item'
          ? 'Split the work inside processItem into smaller items, or move it to useDeferredTask and yield part-way through.'
          : 'Add more yield points, so each segment is shorter.';
      say(
        `${where}. A slice can never be shorter than that, so this still blocks the main thread. ${fix} (development only)`,
      );
    },

    sliceEnded(at, unitsDone) {
      drawSlice(at, unitsDone);
      const sliceMs = at - sliceStartedAt;
      const unitsInSlice = unitsDone - sliceStartUnits;
      sliceStartedAt = at;
      sliceStartUnits = unitsDone;

      if (warnedAboutClockCost || batchSize > 1) return;
      if (unitsInSlice < MIN_UNITS_TO_JUDGE || sliceMs <= 0) return;
      const unitCostMs = sliceMs / unitsInSlice;
      if (unitCostMs >= CLOCK_BOUND_UNIT_MS) return;
      warnedAboutClockCost = true;
      const micros = (unitCostMs * 1000).toFixed(2);
      say(
        `${unit}s are averaging ${micros}µs, so checking the clock after each one costs more than the work itself. Pass batchSize: ${String(suggestedBatchSize(unitCostMs))} to check once per batch instead. (development only)`,
      );
    },

    resumed(at, unitsDone) {
      rebase(at, unitsDone);
    },

    finished(at, status) {
      // Nothing to show for a task that never started, or was cancelled
      // before it did any work. One that failed on its first item still
      // gets drawn: that is worth seeing.
      if (taskStartedAt === undefined) return;
      if (status === 'cancelled' && lastCheckUnits === 0) return;
      drawSlice(at, lastCheckUnits);
      const summary = `${name ?? 'task'}: ${status}, ${plural(lastCheckUnits, unit)} in ${plural(slices, 'slice')}`;
      stamp(summary, taskStartedAt, at, track, FINISHED_COLOR[status]);
    },

    warn: say,
  };
}
