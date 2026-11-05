import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
} from 'react';
import { useChunkedTask } from 'react-inp-chunker';
import { beginRun, endRun } from './metrics';
import { ROWS, scoreAll, scoreRow, topResults, type Scored } from './workload';

export interface PanelState {
  readonly status: 'idle' | 'processing' | 'done';
  readonly processed: number;
  readonly results: readonly Scored[];
  readonly onRun: (event: MouseEvent<HTMLButtonElement>) => void;
}

const SLICE_MS = 5;
const total = ROWS.length;

/** 1. Everything inside the click handler. */
export function useSyncVariant(): PanelState {
  const [results, setResults] = useState<readonly Scored[]>([]);
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    if (runs) endRun();
  }, [runs]);
  return {
    status: runs ? 'done' : 'idle',
    processed: runs ? total : 0,
    results,
    onRun: (event) => {
      beginRun('sync', event.timeStamp);
      setResults(topResults(scoreAll(ROWS)));
      setRuns((n) => n + 1);
    },
  };
}

/** 2. Hand-written time slices with setTimeout(0). */
export function useTimeoutVariant(): PanelState {
  const [status, setStatus] = useState<PanelState['status']>('idle');
  const [processed, setProcessed] = useState(0);
  const [results, setResults] = useState<readonly Scored[]>([]);
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    if (runs) endRun();
  }, [runs]);
  return {
    status,
    processed,
    results,
    onRun: (event) => {
      beginRun('setTimeout', event.timeStamp);
      setStatus('processing');
      const out: Scored[] = [];
      let index = 0;
      const step = () => {
        const start = performance.now();
        while (index < total && performance.now() - start < SLICE_MS) {
          out.push(scoreRow(ROWS[index]!));
          index += 1;
        }
        setProcessed(index);
        if (index < total) {
          setTimeout(step, 0);
          return;
        }
        setResults(topResults(out));
        setStatus('done');
        setRuns((n) => n + 1);
      };
      setTimeout(step, 0);
    },
  };
}

/** 3. startTransition around the state update; the work runs in render. */
export function useTransitionVariant(): PanelState {
  const [runId, setRunId] = useState(0);
  const [isPending, startTransition] = useTransition();
  const results = useMemo(() => (runId ? topResults(scoreAll(ROWS)) : []), [runId]);
  useEffect(() => {
    if (runId) endRun();
  }, [runId]);
  return {
    status: isPending ? 'processing' : runId ? 'done' : 'idle',
    processed: runId && !isPending ? total : 0,
    results,
    onRun: (event) => {
      beginRun('startTransition', event.timeStamp);
      startTransition(() => setRunId((n) => n + 1));
    },
  };
}

/** 5. Hand-written time slices with scheduler.yield(). */
export function useYieldVariant(): PanelState {
  const [status, setStatus] = useState<PanelState['status']>('idle');
  const [processed, setProcessed] = useState(0);
  const [results, setResults] = useState<readonly Scored[]>([]);
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    if (runs) endRun();
  }, [runs]);
  return {
    status,
    processed,
    results,
    onRun: async (event) => {
      beginRun('scheduler.yield', event.timeStamp);
      setStatus('processing');
      const out: Scored[] = [];
      let index = 0;
      while (index < total) {
        await yieldToMain();
        const start = performance.now();
        while (index < total && performance.now() - start < SLICE_MS) {
          out.push(scoreRow(ROWS[index]!));
          index += 1;
        }
        setProcessed(index);
      }
      setResults(topResults(out));
      setStatus('done');
      setRuns((n) => n + 1);
    },
  };
}

function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } })
    .scheduler;
  return scheduler?.yield
    ? scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 4. react-inp-chunker. Each run mounts a fresh task (the caller keys this
 * by run number), so the hook starts from idle with the same ROWS every
 * time. The panel renders straight from the hook's state: one render per
 * slice, like the hand-written variants.
 */
export function useChunkerRunState(
  active: boolean,
  onRun: PanelState['onRun'],
): PanelState {
  const task = useChunkedTask(active ? ROWS : NO_ROWS, scoreRow);
  const results = useMemo(
    () => (active && task.status === 'done' ? topResults(task.results) : []),
    [active, task.status, task.results],
  );
  const reported = useRef(false);
  useEffect(() => {
    if (active && task.status === 'done' && !reported.current) {
      reported.current = true;
      endRun();
    }
  }, [active, task.status]);
  return {
    status: !active ? 'idle' : task.status === 'done' ? 'done' : 'processing',
    processed: active ? task.processed : 0,
    results,
    onRun,
  };
}

const NO_ROWS: readonly (typeof ROWS)[number][] = [];
