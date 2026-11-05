import { useEffect, useState, useSyncExternalStore } from 'react';
import { beginRun, trackInteraction } from './metrics';
import {
  useChunkerRunState,
  useSyncVariant,
  useTimeoutVariant,
  useTransitionVariant,
  useYieldVariant,
  type PanelState,
} from './variants';
import { ROUNDS, ROWS } from './workload';

export const VARIANTS = [
  {
    id: 'sync',
    label: 'Synchronous',
    note: 'All 20,000 rows are scored inside the click handler.',
  },
  {
    id: 'setTimeout',
    label: 'setTimeout chunks',
    note: 'Hand-written 5 ms slices, yielding with setTimeout(0).',
  },
  {
    id: 'startTransition',
    label: 'startTransition',
    note: 'The update is a transition; the scoring runs during render.',
  },
  {
    id: 'chunker',
    label: 'react-inp-chunker',
    note: 'useChunkedTask(rows, scoreRow): 5 ms slices, yields with scheduler.yield().',
  },
  {
    id: 'yield',
    label: 'scheduler.yield',
    note: 'Hand-written 5 ms slices, yielding with scheduler.yield().',
  },
] as const;

type VariantId = (typeof VARIANTS)[number]['id'];

const requested = new URLSearchParams(location.search).get('variant');
const current: VariantId = VARIANTS.some((v) => v.id === requested)
  ? (requested as VariantId)
  : 'chunker';

// The click counter lives outside the panels, so it survives the remount
// the react-inp-chunker variant does on every run.
let pingCount = 0;
const pingListeners = new Set<() => void>();
const pingStore = {
  subscribe(listener: () => void) {
    pingListeners.add(listener);
    return () => pingListeners.delete(listener);
  },
  get: () => pingCount,
  increment() {
    pingCount += 1;
    pingListeners.forEach((listener) => listener());
  },
};

function Panel({ state }: { state: PanelState }) {
  const pings = useSyncExternalStore(pingStore.subscribe, pingStore.get);
  const [lastFrame, setLastFrame] = useState<number | null>(null);
  useEffect(() => {
    if (state.status !== 'done') return;
    const id = setTimeout(() => {
      const runs = window.__runs;
      setLastFrame(runs.at(-1)?.longestFrameMs ?? null);
    }, 50);
    return () => clearTimeout(id);
  }, [state.status, state.results]);
  const percent = Math.round((state.processed / ROWS.length) * 100);
  return (
    <section className="panel" aria-labelledby="panel-title">
      <div className="controls">
        <button
          type="button"
          className="run"
          data-testid="run"
          onClick={(event) => {
            trackInteraction('run', event);
            state.onRun(event);
          }}
        >
          Score 20,000 rows
        </button>
        <button
          type="button"
          className="ping"
          data-testid="ping"
          onClick={(event) => {
            trackInteraction('ping', event);
            pingStore.increment();
          }}
        >
          Click me while it runs <span className="count">{pings}</span>
        </button>
      </div>
      <div className="status">
        <span data-testid="status" className={`badge ${state.status}`}>
          {state.status}
        </span>
        <div
          className="bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ inlineSize: `${percent}%` }} />
        </div>
        <span className="num">
          {state.processed.toLocaleString()} / {ROWS.length.toLocaleString()}
        </span>
      </div>
      <p className="frame">
        Longest frame in the last run:{' '}
        <strong>{lastFrame === null ? '—' : `${Math.round(lastFrame)} ms`}</strong>
      </p>
      <ol className="results">
        {state.results.slice(0, 6).map((row) => (
          <li key={row.id}>
            <span>{row.name}</span>
            <span className="team">{row.team}</span>
            <span className="score">{row.score}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SyncPanel() {
  return <Panel state={useSyncVariant()} />;
}
function TimeoutPanel() {
  return <Panel state={useTimeoutVariant()} />;
}
function TransitionPanel() {
  return <Panel state={useTransitionVariant()} />;
}
function YieldPanel() {
  return <Panel state={useYieldVariant()} />;
}
function ChunkerPanel() {
  const [runId, setRunId] = useState(0);
  return (
    <ChunkerRunPanel
      key={runId}
      active={runId > 0}
      onRun={(event) => {
        beginRun('react-inp-chunker', event.timeStamp);
        setRunId((n) => n + 1);
      }}
    />
  );
}

function ChunkerRunPanel({
  active,
  onRun,
}: {
  active: boolean;
  onRun: PanelState['onRun'];
}) {
  return <Panel state={useChunkerRunState(active, onRun)} />;
}

const PANELS: Record<VariantId, () => React.ReactNode> = {
  sync: SyncPanel,
  setTimeout: TimeoutPanel,
  startTransition: TransitionPanel,
  chunker: ChunkerPanel,
  yield: YieldPanel,
};

export function App() {
  const Current = PANELS[current];
  const meta = VARIANTS.find((v) => v.id === current)!;
  return (
    <main>
      <header>
        <p className="eyebrow">react-inp-chunker · INP benchmark</p>
        <h1 id="panel-title">Same work, five ways</h1>
        <p className="lead">
          Each version scores {ROWS.length.toLocaleString()} rows ({ROUNDS} hash rounds
          per row) and shows the top results. Only the scheduling differs.
        </p>
      </header>
      <nav aria-label="Variants" className="tabs">
        {VARIANTS.map((v) => (
          <a
            key={v.id}
            href={`?variant=${v.id}${location.search.includes('work=') ? `&work=${ROUNDS}` : ''}`}
            aria-current={v.id === current ? 'page' : undefined}
          >
            {v.label}
          </a>
        ))}
      </nav>
      <p className="note">
        <strong>{meta.label}:</strong> {meta.note}
      </p>
      <Current />
    </main>
  );
}
