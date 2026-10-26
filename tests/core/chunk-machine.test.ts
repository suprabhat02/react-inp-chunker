import { describe, expect, it } from 'vitest';

import type {
  ChunkEvent,
  ChunkMachineState,
  ChunkStatus,
} from '../../src/core/chunk-machine.js';
import {
  initialChunkState,
  isTerminal,
  transition,
} from '../../src/core/chunk-machine.js';

const EVENT_TYPES = ['START', 'PAUSE', 'RESUME', 'CANCEL', 'COMPLETE', 'ERROR'] as const;

function eventOf(type: (typeof EVENT_TYPES)[number]): ChunkEvent {
  return type === 'ERROR' ? { type: 'ERROR', error: 'boom' } : { type };
}

/**
 * The complete (state, event) → next-status table. Every one of the 36
 * combinations is listed explicitly — no "and the rest behave the same"
 * shortcuts — so a change to the machine can't silently alter a transition
 * nobody wrote a case for.
 */
const TABLE: Record<ChunkStatus, Record<(typeof EVENT_TYPES)[number], ChunkStatus>> = {
  idle: {
    START: 'processing',
    PAUSE: 'idle',
    RESUME: 'idle',
    CANCEL: 'cancelled',
    COMPLETE: 'idle',
    ERROR: 'idle',
  },
  processing: {
    START: 'processing',
    PAUSE: 'paused',
    RESUME: 'processing',
    CANCEL: 'cancelled',
    COMPLETE: 'done',
    ERROR: 'error',
  },
  paused: {
    START: 'paused',
    PAUSE: 'paused',
    RESUME: 'processing',
    CANCEL: 'cancelled',
    COMPLETE: 'paused',
    ERROR: 'paused',
  },
  done: {
    START: 'done',
    PAUSE: 'done',
    RESUME: 'done',
    CANCEL: 'done',
    COMPLETE: 'done',
    ERROR: 'done',
  },
  cancelled: {
    START: 'cancelled',
    PAUSE: 'cancelled',
    RESUME: 'cancelled',
    CANCEL: 'cancelled',
    COMPLETE: 'cancelled',
    ERROR: 'cancelled',
  },
  error: {
    START: 'error',
    PAUSE: 'error',
    RESUME: 'error',
    CANCEL: 'error',
    COMPLETE: 'error',
    ERROR: 'error',
  },
};

const ALL_STATUSES = Object.keys(TABLE) as ChunkStatus[];

function stateOf(status: ChunkStatus): ChunkMachineState {
  return status === 'error' ? { status, error: 'pre-existing' } : { status };
}

describe('transition()', () => {
  for (const fromStatus of ALL_STATUSES) {
    for (const eventType of EVENT_TYPES) {
      const expectedStatus = TABLE[fromStatus][eventType];

      it(`${fromStatus} + ${eventType} -> ${expectedStatus}`, () => {
        const from = stateOf(fromStatus);
        const result = transition(from, eventOf(eventType));
        expect(result.status).toBe(expectedStatus);
      });
    }
  }

  it('every no-op transition returns the exact same object reference', () => {
    // Referential equality matters here: it's what lets a React reducer
    // built on this never re-render for an event that didn't change
    // anything.
    for (const fromStatus of ALL_STATUSES) {
      for (const eventType of EVENT_TYPES) {
        const from = stateOf(fromStatus);
        const expectedStatus = TABLE[fromStatus][eventType];
        const result = transition(from, eventOf(eventType));
        if (expectedStatus === fromStatus) {
          expect(result).toBe(from);
        }
      }
    }
  });

  it('terminal states absorb every event without changing their error payload', () => {
    const errored: ChunkMachineState = { status: 'error', error: 'original' };
    for (const eventType of EVENT_TYPES) {
      expect(transition(errored, eventOf(eventType))).toBe(errored);
    }
  });

  it('ERROR carries its payload into the new state when it actually transitions', () => {
    const processing: ChunkMachineState = { status: 'processing' };
    const result = transition(processing, { type: 'ERROR', error: 'disk on fire' });
    expect(result).toEqual({ status: 'error', error: 'disk on fire' });
  });

  it('idle is the documented starting state', () => {
    expect(initialChunkState).toEqual({ status: 'idle' });
  });

  it('transition() never mutates its input', () => {
    const before: ChunkMachineState = { status: 'idle' };
    const snapshot = { ...before };
    transition(before, { type: 'START' });
    expect(before).toEqual(snapshot);
  });
});

describe('isTerminal()', () => {
  it.each([
    ['idle', false],
    ['processing', false],
    ['paused', false],
    ['done', true],
    ['cancelled', true],
    ['error', true],
  ] as const)('%s -> %s', (status, expected) => {
    expect(isTerminal(status)).toBe(expected);
  });
});
