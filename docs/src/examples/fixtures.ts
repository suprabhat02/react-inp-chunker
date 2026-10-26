/*
 * Stand-ins that let every sample in this folder compile, so the docs can't
 * show code that doesn't type-check against the published package. Samples
 * import these inside a `// #region hidden` block, which is removed before
 * the code is displayed.
 */

export interface Row {
  readonly id: string;
  readonly text: string;
}

export interface Score {
  readonly id: string;
  readonly score: number;
}

/** "Your expensive function": anything synchronous that takes a while per row. */
export function scoreRow(row: Row): Score {
  let score = 0;
  for (const char of row.text) score = (score * 31 + char.charCodeAt(0)) % 1_000_003;
  return { id: row.id, score };
}

export function formatCsvLine(row: Row): string {
  return `${row.id},"${row.text.replaceAll('"', '""')}"`;
}

export function saveFile(name: string, lines: readonly string[]): void {
  void name;
  void lines;
}

export interface Doc {
  readonly id: string;
  readonly text: string;
}

export type SearchIndex = Map<string, Set<string>>;
