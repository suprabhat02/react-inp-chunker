/**
 * The state machine a chunk task moves through. Deliberately separate from
 * `chunk-scheduler.ts`'s async orchestration: this file is pure, synchronous,
 * and has nothing to fake-timer around, which is what makes it possible to
 * exhaustively test every (state, event) pair — all of them, not a sample.
 *
 *          START                    CANCEL
 *   idle ---------> processing ----------------> cancelled
 *                    |      ^                   ^         ^
 *              PAUSE |      | RESUME      CANCEL|         | CANCEL
 *                    v      |                   |         |
 *                   paused -+-------------------+         |
 *                    |                                    |
 *          COMPLETE  |  ERROR                              |
 *                    v                                     |
 *                   done / error  (terminal, absorb everything)
 *
 * `done`, `cancelled` and `error` are terminal: once reached, every further
 * event is a no-op that returns the same state object (referentially equal,
 * so a React reducer built on this never re-renders for a dead task). A
 * scheduler is one-shot by design — to run another task, create another
 * scheduler. That one rule is what keeps this table small enough to verify
 * completely instead of "pretty thoroughly".
 */

export type ChunkStatus =
  'idle' | 'processing' | 'paused' | 'done' | 'cancelled' | 'error';

export type ChunkEvent =
  | { readonly type: 'START' }
  | { readonly type: 'PAUSE' }
  | { readonly type: 'RESUME' }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'COMPLETE' }
  | { readonly type: 'ERROR'; readonly error: unknown };

export interface ChunkMachineState {
  readonly status: ChunkStatus;
  readonly error?: unknown;
}

export const initialChunkState: ChunkMachineState = { status: 'idle' };

export type TerminalChunkStatus = 'done' | 'cancelled' | 'error';

const TERMINAL_STATUSES: ReadonlySet<ChunkStatus> = new Set<ChunkStatus>([
  'done',
  'cancelled',
  'error',
]);

export function isTerminal(status: ChunkStatus): status is TerminalChunkStatus {
  return TERMINAL_STATUSES.has(status);
}

function transitionIdle(state: ChunkMachineState, event: ChunkEvent): ChunkMachineState {
  switch (event.type) {
    case 'START':
      return { status: 'processing' };
    case 'CANCEL':
      return { status: 'cancelled' };
    case 'PAUSE':
    case 'RESUME':
    case 'COMPLETE':
    case 'ERROR':
      return state;
  }
}

function transitionProcessing(
  state: ChunkMachineState,
  event: ChunkEvent,
): ChunkMachineState {
  switch (event.type) {
    case 'PAUSE':
      return { status: 'paused' };
    case 'CANCEL':
      return { status: 'cancelled' };
    case 'COMPLETE':
      return { status: 'done' };
    case 'ERROR':
      return { status: 'error', error: event.error };
    case 'START':
    case 'RESUME':
      return state;
  }
}

function transitionPaused(
  state: ChunkMachineState,
  event: ChunkEvent,
): ChunkMachineState {
  switch (event.type) {
    case 'RESUME':
      return { status: 'processing' };
    case 'CANCEL':
      return { status: 'cancelled' };
    case 'START':
    case 'PAUSE':
    case 'COMPLETE':
    case 'ERROR':
      return state;
  }
}

/**
 * Advances the machine by one event. Pure: same inputs always produce an
 * equal output, and the input state is never mutated.
 */
export function transition(
  state: ChunkMachineState,
  event: ChunkEvent,
): ChunkMachineState {
  switch (state.status) {
    case 'idle':
      return transitionIdle(state, event);
    case 'processing':
      return transitionProcessing(state, event);
    case 'paused':
      return transitionPaused(state, event);
    case 'done':
    case 'cancelled':
    case 'error':
      // Terminal: absorb every event and return the same reference, so a
      // React reducer built on this never re-renders for a dead task.
      return state;
  }
}
