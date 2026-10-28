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

export interface Diagnostics {
  /** Every clock check: `at` is that reading, `unitsDone` the running total. */
  check(at: number, unitsDone: number): void;
  /** The check that ended a slice, before yielding. */
  sliceEnded(at: number, unitsDone: number): void;
  /** Work resuming after a pause, so the gap is not mistaken for slow work. */
  resumed(at: number, unitsDone: number): void;
}

function warn(message: string): void {
  console.warn(`[react-inp-chunker] ${message}`);
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
): Diagnostics {
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
      warn(
        `${where}. A slice can never be shorter than that, so this still blocks the main thread. ${fix} (development only)`,
      );
    },

    sliceEnded(at, unitsDone) {
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
      warn(
        `${unit}s are averaging ${micros}µs, so checking the clock after each one costs more than the work itself. Pass batchSize: ${String(suggestedBatchSize(unitCostMs))} to check once per batch instead. (development only)`,
      );
    },

    resumed(at, unitsDone) {
      rebase(at, unitsDone);
    },
  };
}
