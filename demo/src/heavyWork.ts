/**
 * Deliberately expensive per-item work with no real-world meaning — the
 * point is CPU cost, not the output. Tuned so ~400 items takes a few
 * seconds total, long enough to make a blocked main thread obvious.
 */
export function heavyWork(seed: number): number {
  let acc = 0;
  for (let i = 0; i < 80_000; i++) {
    acc += Math.sqrt(i * (seed + 1)) % 7;
  }
  return acc;
}

export function makeItems(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}
