/**
 * Interaction to Next Paint thresholds, as Core Web Vitals defines them:
 * 200 ms or less is good, more than 500 ms is poor.
 */
export const INP_GOOD_MS = 200;
export const INP_POOR_MS = 500;

/** A task longer than this is a "long task" (the Long Tasks API definition). */
export const LONG_TASK_MS = 50;

export type InpRating = 'good' | 'needs-improvement' | 'poor';

export function rateInp(ms: number): InpRating {
  if (ms <= INP_GOOD_MS) return 'good';
  if (ms <= INP_POOR_MS) return 'needs-improvement';
  return 'poor';
}

export const RATING_LABEL: Readonly<Record<InpRating, string>> = {
  good: 'Good',
  'needs-improvement': 'Needs improvement',
  poor: 'Poor',
};
