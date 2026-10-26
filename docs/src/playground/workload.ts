export type Weight = 'light' | 'medium' | 'heavy';

export const WEIGHTS: Readonly<
  Record<Weight, { readonly label: string; readonly targetMs: number }>
> = {
  light: { label: 'Light', targetMs: 0.25 },
  medium: { label: 'Medium', targetMs: 1 },
  heavy: { label: 'Heavy', targetMs: 3 },
};

export const WEIGHT_ORDER: readonly Weight[] = ['light', 'medium', 'heavy'];

/**
 * Pure CPU work standing in for "analyze one row": deterministic, with a
 * result that is returned (so the engine can't skip it), and no memory
 * churn (so garbage collection doesn't muddy the measurements).
 */
export function crunch(seed: number, iterations: number): number {
  let acc = seed;
  for (let i = 0; i < iterations; i++) {
    acc = (acc * 1664525 + 1013904223 + Math.sqrt(i)) % 4294967296;
  }
  return acc;
}

const CALIBRATION_ITERATIONS = 150_000;

/**
 * How many `crunch` iterations this device runs per millisecond. Measured a
 * few times and the fastest run kept: the first is usually slower, before
 * the engine has optimized the loop. Each run is a few milliseconds, well
 * under a long task.
 */
export function measureIterationsPerMs(): number {
  let best = Number.POSITIVE_INFINITY;
  let sink = 0;
  for (let run = 0; run < 4; run++) {
    const start = performance.now();
    sink += crunch(run, CALIBRATION_ITERATIONS);
    best = Math.min(best, performance.now() - start);
  }
  // `sink` keeps the work observable; it is never actually this small.
  if (sink < 0) return 1;
  return CALIBRATION_ITERATIONS / Math.max(best, 0.05);
}

export function iterationsFor(weight: Weight, iterationsPerMs: number): number {
  return Math.max(1, Math.round(WEIGHTS[weight].targetMs * iterationsPerMs));
}

export function makeItems(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index);
}
