import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PAINT_INTERVAL_MS,
  FRAME_TIMEOUT_MS,
  createPacer,
  normalizePaintIntervalMs,
} from '../../src/core/pacer.js';

/**
 * The pacer decides, at each yield, between a plain yield and waiting for a
 * frame. Everything that decision reads is controlled here: the clock is
 * virtual, frames render only when a test calls `frames.render()`, and
 * `document.hidden` is whatever the test sets. Plain yields use a real
 * MessageChannel, which is fast and needs no faking.
 */

let clock = 0;

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

let hidden = false;

function setHidden(value: boolean): void {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Resolves after a macrotask, so a promise that could settle has. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function isSettled(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await flush();
  await flush();
  return settled;
}

beforeEach(() => {
  clock = 0;
  vi.stubGlobal('performance', { now: () => clock });
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // Back to jsdom's own getter on Document.prototype.
  delete (document as { hidden?: boolean }).hidden;
});

describe('normalizePaintIntervalMs()', () => {
  it('falls back to the default for anything that is not a positive number, like timeSliceMs', () => {
    expect(normalizePaintIntervalMs(undefined)).toBe(DEFAULT_PAINT_INTERVAL_MS);
    expect(normalizePaintIntervalMs(Number.NaN)).toBe(DEFAULT_PAINT_INTERVAL_MS);
    expect(normalizePaintIntervalMs(0)).toBe(DEFAULT_PAINT_INTERVAL_MS);
    expect(normalizePaintIntervalMs(-16)).toBe(DEFAULT_PAINT_INTERVAL_MS);
    expect(normalizePaintIntervalMs('16' as unknown as number)).toBe(
      DEFAULT_PAINT_INTERVAL_MS,
    );
  });

  it('keeps positive values, and Infinity, which turns pacing off', () => {
    expect(normalizePaintIntervalMs(16)).toBe(16);
    expect(normalizePaintIntervalMs(0.5)).toBe(0.5);
    expect(normalizePaintIntervalMs(Infinity)).toBe(Infinity);
  });

  it('defaults to about 30 frames a second', () => {
    expect(DEFAULT_PAINT_INTERVAL_MS).toBe(33);
  });
});

describe('createPacer() — where there is nothing to paint', () => {
  it.each([
    ['requestAnimationFrame is missing', 'requestAnimationFrame'],
    ['cancelAnimationFrame is missing', 'cancelAnimationFrame'],
  ])('is a plain yield when %s', async (_label, missing) => {
    fakeFrames();
    vi.stubGlobal(missing, undefined);
    clock = 0;
    const pacer = createPacer(33, 'message-channel');
    clock = 1000; // long overdue, if frames counted
    await pacer.yield();
    pacer.dispose();
  });

  it('is a plain yield without a document — a worker, which may have requestAnimationFrame', async () => {
    const frames = fakeFrames();
    vi.stubGlobal('document', undefined);
    const pacer = createPacer(33, 'message-channel');
    clock = 1000;
    await pacer.yield();
    pacer.dispose();
    expect(frames.request).not.toHaveBeenCalled();
  });

  it('is a plain yield when the document cannot be listened to', async () => {
    const frames = fakeFrames();
    vi.stubGlobal('document', { addEventListener: () => undefined });
    const pacer = createPacer(33, 'message-channel');
    clock = 1000;
    await pacer.yield();
    expect(frames.request).not.toHaveBeenCalled();
  });

  it('never registers an animation-frame callback at all with paintIntervalMs: Infinity', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(Infinity, 'message-channel');
    clock = 1_000_000;
    await pacer.yield();
    await pacer.yield();
    pacer.dispose();
    expect(frames.request).not.toHaveBeenCalled();
  });
});

describe('createPacer() — on the main thread', () => {
  it('yields plainly while the last frame is recent, keeping one frame sentinel pending', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, 'message-channel');
    clock = 10;
    await pacer.yield();
    clock = 20;
    await pacer.yield();
    // One sentinel, re-armed only once it has fired, not one per yield.
    expect(frames.request).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(1);
    pacer.dispose();
  });

  it('waits for a frame once one is overdue, and resumes only after it renders', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, 'message-channel');
    clock = 40;
    const waiting = pacer.yield();
    expect(await isSettled(waiting)).toBe(false);

    frames.render();
    expect(await isSettled(waiting)).toBe(true);
    pacer.dispose();
  });

  it('counts frames the browser renders on its own, and so forces no wait while they keep coming', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, 'message-channel');
    clock = 10;
    await pacer.yield(); // arms the sentinel
    clock = 30;
    frames.render(); // a frame the browser chose to render: lastFrameAt = 30
    clock = 50; // 20 ms since that frame, under the interval
    expect(await isSettled(pacer.yield())).toBe(true);
    pacer.dispose();
  });

  it('measures the interval from the most recent frame it saw', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, 'message-channel');
    clock = 40;
    const first = pacer.yield();
    frames.render();
    await first; // waited, and saw a frame at 40
    clock = 60;
    expect(await isSettled(pacer.yield())).toBe(true); // 20 ms later: plain
    clock = 80;
    const overdue = pacer.yield(); // 40 ms after the last frame: waits
    expect(await isSettled(overdue)).toBe(false);
    frames.render();
    await overdue;
    pacer.dispose();
  });

  it('never waits for a frame in a hidden document, where none would come', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, 'message-channel');
    hidden = true;
    clock = 1000;
    expect(await isSettled(pacer.yield())).toBe(true);
    expect(frames.request).toHaveBeenCalledTimes(1); // the sentinel only
    pacer.dispose();
  });

  it('abandons a wait the moment the document becomes hidden, cancelling its frame request', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, 'message-channel');
    clock = 40;
    const waiting = pacer.yield();
    expect(await isSettled(waiting)).toBe(false);

    // A visibilitychange that leaves the page visible changes nothing.
    setHidden(false);
    expect(await isSettled(waiting)).toBe(false);

    setHidden(true);
    expect(await isSettled(waiting)).toBe(true);
    // The wait's own frame request was cancelled; only the sentinel is left.
    expect(frames.cancel).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(1);
    pacer.dispose();
  });

  it('gives up on a frame that never comes, then stops forcing waits until it sees one again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const frames = fakeFrames();
    const pacer = createPacer(33, 'message-channel');

    // Rendering is throttled (an offscreen cross-origin iframe, say): the
    // forced wait times out instead of hanging the task.
    clock = 40;
    const waiting = pacer.yield();
    vi.advanceTimersByTime(FRAME_TIMEOUT_MS - 1);
    expect(await isSettledWithFakeTimers(waiting)).toBe(false);
    vi.advanceTimersByTime(1);
    await waiting;

    // Stalled: a long-overdue frame no longer forces a wait.
    clock = 500;
    expect(await isSettledWithFakeTimers(pacer.yield())).toBe(true);

    // Rendering resumes; the sentinel sees it; waits are forced again.
    clock = 600;
    frames.render();
    clock = 700;
    const forced = pacer.yield();
    expect(await isSettledWithFakeTimers(forced)).toBe(false);
    frames.render();
    await forced;
    pacer.dispose();
  });

  it('dispose() cancels the pending sentinel, is idempotent, and arms no new one', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, 'message-channel');
    clock = 10;
    await pacer.yield();
    expect(frames.pending).toBe(1);

    pacer.dispose();
    pacer.dispose();
    expect(frames.cancel).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(0);
  });

  it('dispose() after the sentinel has fired has nothing to cancel', async () => {
    const frames = fakeFrames();
    const pacer = createPacer(33, 'message-channel');
    clock = 10;
    await pacer.yield();
    frames.render();
    pacer.dispose();
    expect(frames.cancel).not.toHaveBeenCalled();
  });

  it('works with a requestAnimationFrame that calls back synchronously, a common test stub', async () => {
    const request = vi.fn((callback: () => void): number => {
      callback();
      return 7;
    });
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const pacer = createPacer(33, 'message-channel');

    clock = 40;
    expect(await isSettled(pacer.yield())).toBe(true);
    // The synchronous sentinel already fired, so it isn't kept as pending:
    // the next yield arms a fresh one.
    clock = 50;
    await pacer.yield();
    expect(request).toHaveBeenCalledTimes(2);
    pacer.dispose();
    expect(cancel).not.toHaveBeenCalled();
  });
});

/** isSettled(), for tests that fake setTimeout: flushes with MessageChannel instead. */
async function isSettledWithFakeTimers(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return settled;
}
