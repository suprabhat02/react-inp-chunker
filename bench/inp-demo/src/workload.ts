// The same work for every variant: score 20,000 rows, keep the best 25.
// The per-row cost is real CPU work (string hashing), so no variant can skip
// it; only *when* it runs differs.

export interface Row {
  readonly id: number;
  readonly name: string;
  readonly team: string;
}

export interface Scored {
  readonly id: number;
  readonly name: string;
  readonly team: string;
  readonly score: number;
}

const params = new URLSearchParams(location.search);
/** Hash rounds per row: the knob for how heavy each row is. */
export const ROUNDS = Number(params.get('work') ?? 30);
export const ROW_COUNT = Number(params.get('rows') ?? 20_000);

const FIRST = [
  'Asha',
  'Ben',
  'Chen',
  'Dara',
  'Eli',
  'Fatima',
  'Goran',
  'Hana',
  'Ivan',
  'Jun',
];
const LAST = [
  'Kapoor',
  'Lopez',
  'Moreau',
  'Nakamura',
  'Okafor',
  'Petrov',
  'Quinn',
  'Rossi',
];
const TEAMS = ['Platform', 'Growth', 'Payments', 'Search', 'Design Systems', 'Data'];

/** Deterministic rows, so every run and every variant sees the same data. */
export const ROWS: readonly Row[] = (() => {
  let seed = 42;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
  return Array.from({ length: ROW_COUNT }, (_, id) => ({
    id,
    name: `${FIRST[next() % FIRST.length]} ${LAST[next() % LAST.length]} ${id}`,
    team: TEAMS[next() % TEAMS.length]!,
  }));
})();

/** FNV-1a over the row text, repeated ROUNDS times. */
export function scoreRow(row: Row): Scored {
  const text = `${row.name}|${row.team}`;
  let hash = 2166136261;
  for (let round = 0; round < ROUNDS; round += 1) {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i) + round;
      hash = Math.imul(hash, 16777619);
    }
  }
  return { ...row, score: (hash >>> 0) % 10_000 };
}

/** Cheap final step shared by all variants: top 25 by score. */
export function topResults(scored: readonly Scored[]): Scored[] {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, 25);
}

export function scoreAll(rows: readonly Row[]): Scored[] {
  return rows.map(scoreRow);
}
