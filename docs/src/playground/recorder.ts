import { useCallback, useEffect, useRef, useState } from 'react';

import { LONG_TASK_MS } from '../lib/inp.ts';
import { type ProbeSample, startInputDelayProbe } from './probe.ts';
import type { Weight } from './workload.ts';

export type RunMode = 'blocking' | 'chunked';

export interface RunSettings {
  readonly items: number;
  readonly weight: Weight;
  readonly timeSliceMs: number;
}

export interface Interaction {
  /** When the input happened, in ms after the run started. */
  readonly at: number;
  /** From the input to the frame that shows its result: what INP measures. */
  readonly latency: number;
}

export interface RunRecord {
  readonly id: number;
  readonly mode: RunMode;
  readonly settings: RunSettings;
  readonly outcome: 'done' | 'cancelled';
  /** All times are in ms after the run started. */
  readonly workStart: number;
  readonly workEnd: number;
  /** One timestamp for every frame the browser rendered. */
  readonly frames: readonly number[];
  /** Input-delay probes (see probe.ts). */
  readonly probes: readonly ProbeSample[];
  readonly interactions: readonly Interaction[];
}

export type RunRecords = Partial<Readonly<Record<RunMode, RunRecord>>>;

interface ActiveRun {
  readonly id: number;
  readonly mode: RunMode;
  readonly settings: RunSettings;
  readonly startedAt: number;
  readonly frames: number[];
  readonly probes: ProbeSample[];
  stopProbe: () => void;
  workStart: number | null;
  rafId: number;
  /** Set once the work has ended; the record is finished once the measurements catch up. */
  ending: { readonly workEnd: number; readonly outcome: 'done' | 'cancelled' } | null;
  /** Builds and commits the record once both a frame and a probe have landed after the work. */
  tryFinish: () => void;
}

interface RunWindow {
  readonly id: number;
  readonly mode: RunMode;
  readonly start: number;
  end: number;
}

/** Interactions measured after their run has settled are retried this often, this many times. */
const ATTACH_RETRY_MS = 50;
const ATTACH_ATTEMPTS = 40;

/**
 * Records what happened while a run was going on: every frame the browser
 * rendered, how long input would have waited at each moment, and how long
 * each real interaction took to reach the screen. The trace and every
 * number shown come from these recordings; nothing is estimated.
 */
export function useRunRecorder() {
  const [records, setRecords] = useState<RunRecords>({});
  const recordsRef = useRef<RunRecords>({});
  const active = useRef<ActiveRun | null>(null);
  const windows = useRef<RunWindow[]>([]);
  const nextId = useRef(1);

  const commit = useCallback((update: (previous: RunRecords) => RunRecords) => {
    recordsRef.current = update(recordsRef.current);
    setRecords(recordsRef.current);
  }, []);

  useEffect(
    () => () => {
      const run = active.current;
      if (run === null) return;
      cancelAnimationFrame(run.rafId);
      run.stopProbe();
    },
    [],
  );

  const begin = useCallback(
    (mode: RunMode, settings: RunSettings) => {
      const previousRun = active.current;
      if (previousRun !== null) {
        cancelAnimationFrame(previousRun.rafId);
        previousRun.stopProbe();
      }
      const run: ActiveRun = {
        id: nextId.current++,
        mode,
        settings,
        startedAt: performance.now(),
        frames: [],
        probes: [],
        stopProbe: () => undefined,
        workStart: null,
        rafId: 0,
        ending: null,
        tryFinish: () => {
          const ending = run.ending;
          if (ending === null) return;
          // Not done until a probe has run after the work (so the one that was
          // waiting through it is counted) and a frame has painted after it.
          const probeAfter = run.probes.some(
            (sample) => sample.ran - run.startedAt >= ending.workEnd,
          );
          const frameAfter = run.frames.some((frame) => frame >= ending.workEnd);
          if (!probeAfter || !frameAfter) return;
          run.ending = null;
          run.stopProbe();
          cancelAnimationFrame(run.rafId);
          const record: RunRecord = {
            id: run.id,
            mode: run.mode,
            settings: run.settings,
            outcome: ending.outcome,
            workStart: run.workStart ?? 0,
            workEnd: ending.workEnd,
            frames: run.frames,
            probes: run.probes.map((sample) => ({
              due: sample.due - run.startedAt,
              ran: sample.ran - run.startedAt,
            })),
            interactions: [],
          };
          commit((previous) => ({ ...previous, [run.mode]: record }));
        },
      };
      run.stopProbe = startInputDelayProbe(run.probes, run.tryFinish);
      // performance.now(), not the callback's timestamp argument: that one is
      // the frame's scheduled start, which can fall inside a long task the
      // frame then had to wait out. What matters is when the frame really ran.
      const tick = () => {
        run.frames.push(performance.now() - run.startedAt);
        run.rafId = requestAnimationFrame(tick);
        run.tryFinish();
      };
      run.rafId = requestAnimationFrame(tick);
      active.current = run;
      windows.current = [
        ...windows.current.filter((window) => window.mode !== mode),
        { id: run.id, mode, start: run.startedAt, end: Number.POSITIVE_INFINITY },
      ];
      commit((previous) => {
        const next: Partial<Record<RunMode, RunRecord>> = { ...previous };
        delete next[mode];
        return next;
      });
    },
    [commit],
  );

  /** The moment the work itself starts, after the "running" state has painted. */
  const markWorkStart = useCallback(() => {
    const run = active.current;
    if (run !== null) run.workStart = performance.now() - run.startedAt;
  }, []);

  const end = useCallback((outcome: 'done' | 'cancelled') => {
    const run = active.current;
    if (run === null) return;
    active.current = null;
    const workEnd = performance.now() - run.startedAt;
    const window = windows.current.find((candidate) => candidate.id === run.id);
    if (window !== undefined) window.end = run.startedAt + workEnd;
    // Frames and probes keep being recorded until both have caught up with the end.
    run.ending = { workEnd, outcome };
    run.tryFinish();
  }, []);

  /**
   * Call from keydown and pointerdown handlers with the event's timeStamp:
   * when the input happened, not when its handler finally got to run.
   * Measures to the next frame (the one that paints the handler's result),
   * and files the result under the run it happened during, even if that
   * run has ended by then.
   *
   * Deliberately not "rAF, then setTimeout" (a common next-paint trick):
   * scheduler.yield() continuations run ahead of timers, so during a chunked
   * run that timer would wait for the whole job and report a false delay.
   */
  const noteInteraction = useCallback(
    (eventTimeStamp: number) => {
      const window = windows.current.find(
        (candidate) =>
          eventTimeStamp >= candidate.start && eventTimeStamp <= candidate.end,
      );
      if (window === undefined) return;
      requestAnimationFrame(() => {
        const interaction: Interaction = {
          at: eventTimeStamp - window.start,
          latency: performance.now() - eventTimeStamp,
        };
        const attach = (attempt: number) => {
          const record = recordsRef.current[window.mode];
          if (record?.id !== window.id) {
            // The run is still going, or settling: its record lands shortly.
            if (attempt < ATTACH_ATTEMPTS) {
              setTimeout(() => {
                attach(attempt + 1);
              }, ATTACH_RETRY_MS);
            }
            return;
          }
          commit((previous) => {
            const current = previous[window.mode];
            if (current?.id !== window.id) return previous;
            return {
              ...previous,
              [window.mode]: {
                ...current,
                interactions: [...current.interactions, interaction],
              },
            };
          });
        };
        attach(0);
      });
    },
    [commit],
  );

  return { records, begin, markWorkStart, end, noteInteraction };
}

export interface Segment {
  readonly start: number;
  readonly end: number;
}

export interface RunSummary {
  readonly totalMs: number;
  /** The longest a click would have waited before its handler could start. */
  readonly longestInputDelayMs: number;
  /** Stretches where input would have waited longer than a long task: [due, ran]. */
  readonly blocked: readonly Segment[];
  readonly framesPainted: number;
  readonly longestFrameGapMs: number;
  readonly slowestInteractionMs: number | null;
  readonly interactionCount: number;
}

/** The numbers shown for a run, all derived from its recording. */
export function summarize(record: RunRecord): RunSummary {
  const { frames, probes, workStart, workEnd, interactions } = record;

  let longestFrameGap = 0;
  let painted = 0;
  let previous = workStart;
  for (const frame of frames) {
    if (frame <= workStart) continue;
    longestFrameGap = Math.max(longestFrameGap, frame - previous);
    previous = frame;
    if (frame > workEnd) break;
    painted += 1;
  }

  let longestInputDelay = 0;
  const blocked: Segment[] = [];
  for (const sample of probes) {
    if (sample.ran < workStart || sample.due > workEnd) continue;
    const delay = sample.ran - sample.due;
    longestInputDelay = Math.max(longestInputDelay, delay);
    if (delay > LONG_TASK_MS) blocked.push({ start: sample.due, end: sample.ran });
  }

  let slowest: number | null = null;
  for (const interaction of interactions) {
    slowest =
      slowest === null ? interaction.latency : Math.max(slowest, interaction.latency);
  }

  return {
    totalMs: workEnd - workStart,
    longestInputDelayMs: longestInputDelay,
    blocked,
    framesPainted: painted,
    longestFrameGapMs: longestFrameGap,
    slowestInteractionMs: slowest,
    interactionCount: interactions.length,
  };
}
