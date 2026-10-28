import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  type ChunkEvent,
  type ChunkMachineState,
  initialChunkState,
  isTerminal,
  transition,
} from '../../src/core/chunk-machine.js';
import { createChunkScheduler } from '../../src/core/chunk-scheduler.js';
import { createDeferredTask } from '../../src/core/deferred-task.js';
import type { DeferredGenerator } from '../../src/core/deferred-task.js';

/**
 * The example-based tests cover the interleavings anyone thought to write
 * down. These cover the ones nobody did: random sequences of control calls,
 * checked against invariants that must hold for every sequence.
 *
 * Each invariant is a promise the README makes.
 */

const anyEvent: fc.Arbitrary<ChunkEvent> = fc.oneof(
  fc.constant<ChunkEvent>({ type: 'START' }),
  fc.constant<ChunkEvent>({ type: 'PAUSE' }),
  fc.constant<ChunkEvent>({ type: 'RESUME' }),
  fc.constant<ChunkEvent>({ type: 'CANCEL' }),
  fc.constant<ChunkEvent>({ type: 'COMPLETE' }),
  fc.record({ type: fc.constant<'ERROR'>('ERROR'), error: fc.anything() }),
);

describe('the state machine, over random event sequences', () => {
  it('never leaves a terminal state', () => {
    fc.assert(
      fc.property(fc.array(anyEvent, { maxLength: 40 }), (events) => {
        let state: ChunkMachineState = initialChunkState;
        let terminalAt: ChunkMachineState | null = null;
        for (const event of events) {
          state = transition(state, event);
          if (terminalAt !== null) {
            // Once finished, a task stays finished with the same status.
            expect(state.status).toBe(terminalAt.status);
          } else if (isTerminal(state.status)) {
            terminalAt = state;
          }
        }
      }),
    );
  });

  it('returns the identical state object when an event does not apply', () => {
    fc.assert(
      fc.property(fc.array(anyEvent, { maxLength: 40 }), (events) => {
        let state: ChunkMachineState = initialChunkState;
        for (const event of events) {
          const next = transition(state, event);
          // Referential equality is what lets callers skip notifying
          // subscribers for a no-op, so it is part of the contract.
          if (next.status === state.status && next.error === state.error) {
            expect(next).toBe(state);
          }
          state = next;
        }
      }),
    );
  });

  it('only ever reports a status the type allows', () => {
    const allowed = ['idle', 'processing', 'paused', 'done', 'cancelled', 'error'];
    fc.assert(
      fc.property(fc.array(anyEvent, { maxLength: 40 }), (events) => {
        let state: ChunkMachineState = initialChunkState;
        for (const event of events) state = transition(state, event);
        expect(allowed).toContain(state.status);
      }),
    );
  });
});

/** The control calls a caller can make, in any order, at any time. */
type Control = 'start' | 'pause' | 'resume' | 'cancel' | 'tick';

const anyControl: fc.Arbitrary<Control> = fc.constantFrom(
  'start',
  'pause',
  'resume',
  'cancel',
  'tick',
);

/** Lets the engine's async loop make progress between calls. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the chunk scheduler, over random control sequences', () => {
  it('settles exactly once, having processed each item at most once, in order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(anyControl, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 1, max: 4 }),
        async (controls, itemCount, batchSize) => {
          const seen: number[] = [];
          const items = Array.from({ length: itemCount }, (_, i) => i);
          const scheduler = createChunkScheduler({
            items,
            processItem: (item: number) => {
              seen.push(item);
              return item;
            },
            batchSize,
            timeSliceMs: 0.0001, // yield at every opportunity
          });

          let settleCount = 0;
          void scheduler.settled.then(() => {
            settleCount += 1;
          });

          for (const control of controls) {
            if (control === 'tick') await tick();
            else scheduler[control]();
          }
          // Always finish: cancel breaks any pause the sequence left behind.
          scheduler.cancel();
          const outcome = await scheduler.settled;
          await tick();

          expect(settleCount).toBe(1);
          expect(['done', 'cancelled']).toContain(outcome.status);
          // Items are processed in order, each at most once, never past the end.
          expect(seen).toEqual(items.slice(0, seen.length));
          expect(seen.length).toBeLessThanOrEqual(itemCount);

          const snapshot = scheduler.getSnapshot();
          expect(snapshot.processed).toBe(seen.length);
          expect(snapshot.total).toBe(itemCount);
          expect(outcome.results).toHaveLength(seen.length);
          // A settled task always carries its results in the snapshot.
          expect(snapshot.results).toEqual(outcome.results);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('runs nothing after it reports cancelled', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 30 }), async (itemCount) => {
        let processedCalls = 0;
        const scheduler = createChunkScheduler({
          items: Array.from({ length: itemCount }, (_, i) => i),
          processItem: (item: number) => {
            processedCalls += 1;
            return item;
          },
          timeSliceMs: 0.0001,
        });

        scheduler.start();
        await tick();
        scheduler.cancel();
        const atCancel = processedCalls;
        await scheduler.settled;
        await tick();
        await tick();

        expect(processedCalls).toBe(atCancel);
      }),
      { numRuns: 40 },
    );
  });
});

describe('the deferred task, over random control sequences', () => {
  it('settles exactly once and never resumes a finished generator', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(anyControl, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 20 }),
        async (controls, segmentCount) => {
          let segmentsRun = 0;
          function* work(): DeferredGenerator<number> {
            for (let i = 0; i < segmentCount; i++) {
              segmentsRun += 1;
              yield;
            }
            return segmentCount;
          }

          const task = createDeferredTask({ task: work, timeSliceMs: 0.0001 });
          let settleCount = 0;
          void task.settled.then(() => {
            settleCount += 1;
          });

          for (const control of controls) {
            if (control === 'tick') await tick();
            else task[control]();
          }
          task.cancel();
          const outcome = await task.settled;
          const afterSettle = segmentsRun;
          await tick();
          await tick();

          expect(settleCount).toBe(1);
          expect(['done', 'cancelled']).toContain(outcome.status);
          expect(segmentsRun).toBe(afterSettle);
          expect(segmentsRun).toBeLessThanOrEqual(segmentCount);
          if (outcome.status === 'done') expect(outcome.value).toBe(segmentCount);
        },
      ),
      { numRuns: 60 },
    );
  });
});
