const integer = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

/** "0.25 ms", "2.9 ms", "640 ms", "1.2 s": as precise as the size of the number warrants. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const value = Math.max(0, ms);
  if (value >= 1000) return `${oneDecimal.format(value / 1000)} s`;
  if (value >= 10) return `${integer.format(value)} ms`;
  if (value >= 1) return `${oneDecimal.format(value)} ms`;
  return `${twoDecimals.format(value)} ms`;
}

export function formatCount(value: number): string {
  return integer.format(value);
}
