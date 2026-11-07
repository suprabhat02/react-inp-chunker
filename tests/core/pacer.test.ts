import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PAINT_INTERVAL_MS,
  createPacer,
  normalizePaintIntervalMs,
} from '../../src/core/pacer.js';

/**
 * The pacer decides, at each yield, between the fast yield
 * (`scheduler.yield()`) and an ordinary task that queues behind rendering.
 * Everything that decision reads is controlled here: the clock is virtual,
 * frames render only when a test calls `frames.render()`, and
 * `scheduler.yield` is a spy — so a test can tell which path a yield took
 * by whether the spy was called. Ordinary yields use a real MessageChannel.
 */

let clock = 0;
let schedulerYield: ReturnType<typeof vi.fn<() => Promise<void>>>;

function fakeFrames() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const request = vi.fn((callback: () => void): number => {
    const handle = nextHandle++;
    pending.set(handle, callback);
    return handle;
  });
  const cancel = vi.fn((handle: number): void => {
    pending.delete(handle);
  });
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return {
    request,
    cancel,
    get pending(): number {
      return pending.size;
    },
    /** Renders one frame: runs every callback pending right now. */
    render(): void {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
  };
}

/** Yields once, and reports which path it took. */
async function yieldVia(
  pacer: ReturnType<typeof createPacer>,
): Promise<'fast' | 'ordinary'> {
  const before = schedulerYield.mock.calls.length;
  await pacer.yield();
  return schedulerYield.mock.calls.length > before ? 'fast' : 'ordinary';
}

beforeEach(() => {
  clock = 0;
  vi.stubGlobal('performance', { now: () => clock });
  schedulerYield = vi.fn(() => Promise.resolve());
  vi.stubGlobal('scheduler', { yield: schedulerYield });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizePaintIntervalMs()', () => {
  it('falls back to the default for NaN, a negative number or a non-number', () => {
    expect(normalizePaintIntervalMs(undefined)).toBe(DEFAULT_PAINT_INTERVAL_MS);
    expect(normalizePaintIntervalMs(Number.NaN)).toBe(DEFAULT_PAINT_INTERVAL_MS);
    expect(normalizePaintIntervalMs(-16)).toBe(DEFAULT_PAINT_INTERVAL_MS);
    expect(normalizePaintIntervalMs('16' as unknown as number)).toBe(
      DEFAULT_PAINT_INTERVAL_MS,
    );
  });

  it('keeps zero, positive values and Infinity, which each mean something', () => {
    expect(normalizePaintIntervalMs(0)).toBe(0);
    expect(normalizePaintIntervalMs(16)).toBe(16);
    expect(normalizePaintIntervalMs(Infinity)).toBe(Infinity);
  });

  it('defaults to about 30 frames a second', () => {
    expect(DEFAULT_PAINT_INTERVAL_MS).toBe(33);
  });
});

describe('createPacer() — where there is nothing to paint', () => {
  it.each(['requestAnimationFrame', 'cancelAnimationFrame'])(
    'always takes the fast yield when %s is missing',
    async (missing) => {
      fakeFrames();
      vi.stubGlobal(missing, undefined);
      const pacer = createPacer(33, undefined);
      clock = 1000;
      expect(await yieldVia(pacer)).toBe('fast');
      pacer.dispose();
    },
  );

  it('always takes the fast yield without a document — a worker, which may have requestAnimationFrame', async () => {
    const frames = fakeFrames();
    vi.stubGlobal('document', undefined);
    const pacer = createPacer(33, undefined);
    clock = 1000;
    expect(await yieldVia(pacer)).toBe('fast');
    expect(frames.request).not.toHaveBeenCalled();
  });

  it('never registers an animation-frame callback with paintIntervalMs: Infinity', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(Infinity, undefined);
    clock = 1_000_000;
    expect(await yieldVia(pacer)).toBe('fast');
    expect(await yieldVia(pacer)).toBe('fast');
    pacer.dispose();
    expect(frames.request).not.toHaveBeenCalled();
  });
});

describe('createPacer() — on the main thread', () => {
  it('yields behind rendering until it has seen a frame', async () => {
    fakeFrames();
    const pacer = createPacer(33, undefined);
    expect(await yieldVia(pacer)).toBe('ordinary');
    clock = 5;
    expect(await yieldVia(pacer)).toBe('ordinary');
    pacer.dispose();
  });

  it('takes the fast yield while the last frame is recent, and yields behind rendering once one is overdue', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, undefined);
    expect(await yieldVia(pacer)).toBe('ordinary'); // arms the sentinel
    clock = 10;
    frames.render(); // a frame at t = 10

    clock = 20;
    expect(await yieldVia(pacer)).toBe('fast');
    clock = 42;
    expect(await yieldVia(pacer)).toBe('fast');
    clock = 43; // 33 ms since that frame
    expect(await yieldVia(pacer)).toBe('ordinary');

    clock = 50;
    frames.render(); // the browser rendered; the sentinel saw it
    clock = 60;
    expect(await yieldVia(pacer)).toBe('fast');
    pacer.dispose();
  });

  it('keeps exactly one frame sentinel pending, re-armed only after it fires', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, undefined);
    await pacer.yield();
    await pacer.yield();
    await pacer.yield();
    expect(frames.request).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(1);

    frames.render();
    await pacer.yield();
    expect(frames.request).toHaveBeenCalledTimes(2);
    pacer.dispose();
  });

  it('never stalls when frames never come — a hidden tab, a throttled iframe, frozen fake timers', async () => {
    fakeFrames(); // frames are requested but never rendered
    const pacer = createPacer(33, undefined);
    const paths: string[] = [];
    for (let i = 0; i < 20; i++) {
      clock += 7;
      paths.push(await yieldVia(pacer));
    }
    expect(new Set(paths)).toEqual(new Set(['ordinary']));
    pacer.dispose();
  });

  it('with paintIntervalMs: 0, yields behind rendering even right after a frame', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(0, undefined);
    await pacer.yield();
    frames.render();
    expect(await yieldVia(pacer)).toBe('ordinary');
    pacer.dispose();
  });

  it('yields behind rendering with setTimeout, not MessageChannel, when that is the strategy asked for', async () => {
    fakeFrames();
    const channels = vi.fn();
    const RealMessageChannel = MessageChannel;
    vi.stubGlobal(
      'MessageChannel',
      class extends RealMessageChannel {
        constructor() {
          super();
          channels();
        }
      },
    );
    await createPacer(33, 'set-timeout').yield();
    expect(channels).not.toHaveBeenCalled();
    await createPacer(33, 'message-channel').yield();
    expect(channels).toHaveBeenCalledTimes(1);
  });

  it('works with a requestAnimationFrame that calls back synchronously, a common test stub', async () => {
    const request = vi.fn((callback: () => void): number => {
      callback();
      return 7;
    });
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const pacer = createPacer(33, undefined);

    // The sentinel fires at once, so this very yield sees a fresh frame.
    expect(await yieldVia(pacer)).toBe('fast');
    // It isn't kept as pending, so the next yield arms a fresh one.
    clock = 10;
    await pacer.yield();
    expect(request).toHaveBeenCalledTimes(2);
    pacer.dispose();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('dispose() cancels the pending sentinel, is idempotent, and arms no new one', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, undefined);
    await pacer.yield();
    expect(frames.pending).toBe(1);

    pacer.dispose();
    pacer.dispose();
    expect(frames.cancel).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(0);

    await pacer.yield();
    expect(frames.request).toHaveBeenCalledTimes(1);
  });

  it('dispose() after the sentinel has fired has nothing to cancel', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, undefined);
    await pacer.yield();
    frames.render();
    pacer.dispose();
    expect(frames.cancel).not.toHaveBeenCalled();
  });
});
