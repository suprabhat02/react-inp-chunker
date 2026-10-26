import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TIME_SLICE_MS,
  isInputPending,
  now,
  resolveYieldStrategy,
  shouldYieldNow,
  supportsInputPending,
  supportsMessageChannel,
  supportsSchedulerYield,
  yieldToMain,
} from '../../src/core/scheduler.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('feature detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('supportsSchedulerYield() is false by default in this environment (no Safari-equivalent gap)', () => {
    expect(supportsSchedulerYield()).toBe(false);
  });

  it('supportsSchedulerYield() is true once scheduler.yield exists', () => {
    vi.stubGlobal('scheduler', { yield: () => Promise.resolve() });
    expect(supportsSchedulerYield()).toBe(true);
  });

  it('supportsSchedulerYield() is false when `scheduler` exists but has no yield method', () => {
    vi.stubGlobal('scheduler', {});
    expect(supportsSchedulerYield()).toBe(false);
  });

  it('supportsMessageChannel() reflects the real global', () => {
    expect(supportsMessageChannel()).toBe(typeof MessageChannel === 'function');
  });

  it('supportsMessageChannel() is false once MessageChannel is removed', () => {
    vi.stubGlobal('MessageChannel', undefined);
    expect(supportsMessageChannel()).toBe(false);
  });

  it('supportsInputPending()/isInputPending() are false by default', () => {
    expect(supportsInputPending()).toBe(false);
    expect(isInputPending()).toBe(false);
  });

  it('isInputPending() reflects navigator.scheduling.isInputPending()', () => {
    vi.stubGlobal('navigator', { scheduling: { isInputPending: () => true } });
    expect(supportsInputPending()).toBe(true);
    expect(isInputPending()).toBe(true);
  });

  it('isInputPending() returns false, never throws, when the API itself throws', () => {
    vi.stubGlobal('navigator', {
      scheduling: {
        isInputPending: () => {
          throw new Error('platform says no');
        },
      },
    });
    expect(() => isInputPending()).not.toThrow();
    expect(isInputPending()).toBe(false);
  });

  it('resolveYieldStrategy() prefers scheduler-yield, then message-channel, then set-timeout', () => {
    // Baseline in this environment: no scheduler, MessageChannel present.
    expect(resolveYieldStrategy()).toBe('message-channel');

    vi.stubGlobal('scheduler', { yield: () => Promise.resolve() });
    expect(resolveYieldStrategy()).toBe('scheduler-yield');
    vi.unstubAllGlobals();

    vi.stubGlobal('MessageChannel', undefined);
    expect(resolveYieldStrategy()).toBe('set-timeout');
  });
});

describe('yieldToMain()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves using scheduler.yield() when available', async () => {
    const yieldSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('scheduler', { yield: yieldSpy });
    await yieldToMain();
    expect(yieldSpy).toHaveBeenCalledTimes(1);
  });

  it('falls through to a fallback when scheduler.yield() throws synchronously', async () => {
    vi.stubGlobal('scheduler', {
      yield: () => {
        throw new Error('half-implemented API');
      },
    });
    await expect(yieldToMain()).resolves.toBeUndefined();
  });

  it('falls through to a fallback when scheduler.yield() returns a rejecting promise', async () => {
    vi.stubGlobal('scheduler', { yield: () => Promise.reject(new Error('nope')) });
    await expect(yieldToMain()).resolves.toBeUndefined();
  });

  it('never rejects even when every strategy is unavailable but set-timeout', async () => {
    vi.stubGlobal('scheduler', undefined);
    vi.stubGlobal('MessageChannel', undefined);
    await expect(yieldToMain()).resolves.toBeUndefined();
  });

  it('honors an explicit forced strategy over auto-detection', async () => {
    const yieldSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('scheduler', { yield: yieldSpy });
    // scheduler.yield exists, but we force set-timeout instead.
    await yieldToMain({ strategy: 'set-timeout' });
    expect(yieldSpy).not.toHaveBeenCalled();
  });

  it('message-channel strategy falls back to set-timeout if MessageChannel is missing', async () => {
    vi.stubGlobal('MessageChannel', undefined);
    await expect(yieldToMain({ strategy: 'message-channel' })).resolves.toBeUndefined();
  });

  it('an explicitly forced "scheduler-yield" strategy falls back via message-channel when scheduler.yield does not actually exist', async () => {
    // Forcing a strategy skips resolveYieldStrategy()'s auto-detection
    // entirely, so this is reachable even though this environment would
    // never auto-pick scheduler-yield on its own (no `scheduler` global).
    vi.stubGlobal('scheduler', undefined);
    await expect(yieldToMain({ strategy: 'scheduler-yield' })).resolves.toBeUndefined();
  });

  it('an explicitly forced "scheduler-yield" strategy falls all the way back to set-timeout when neither scheduler.yield nor MessageChannel exist', async () => {
    vi.stubGlobal('scheduler', undefined);
    vi.stubGlobal('MessageChannel', undefined);
    await expect(yieldToMain({ strategy: 'scheduler-yield' })).resolves.toBeUndefined();
  });

  it('two concurrent message-channel yields both resolve independently (no cross-talk)', async () => {
    // Regression test: an earlier draft shared one MessageChannel across
    // all calls, so the second call's onmessage handler clobbered the
    // first's, permanently hanging it. Each call must get its own channel.
    const order: string[] = [];
    const a = yieldToMain({ strategy: 'message-channel' }).then(() => order.push('a'));
    const b = yieldToMain({ strategy: 'message-channel' }).then(() => order.push('b'));
    await Promise.all([a, b]);
    expect(order.sort()).toEqual(['a', 'b']);
  });

  it('closes each message-channel port once its message arrives, so no open handle outlives the yield', async () => {
    // Regression test: an open port with a listener is a live handle — in
    // Node it kept the process alive forever after the work was done.
    const close = vi.spyOn(MessagePort.prototype, 'close');
    await yieldToMain({ strategy: 'message-channel' });
    await yieldToMain({ strategy: 'message-channel' });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('a large number of concurrent yields all settle', async () => {
    const calls = Array.from({ length: 50 }, () => yieldToMain());
    await expect(Promise.all(calls)).resolves.toHaveLength(50);
  });
});

describe('now()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a number that increases over real time', async () => {
    const first = now();
    await sleep(5);
    const second = now();
    expect(second).toBeGreaterThan(first);
  });

  it('falls back to Date.now() when performance is unavailable, without throwing', () => {
    vi.stubGlobal('performance', undefined);
    const before = Date.now();
    let value = -1;
    expect(() => {
      value = now();
    }).not.toThrow();
    expect(value).toBeGreaterThanOrEqual(before - 1);
  });

  it('falls back to Date.now() when performance.now is not a function', () => {
    vi.stubGlobal('performance', {});
    expect(() => now()).not.toThrow();
  });
});

describe('shouldYieldNow()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false immediately after the slice starts, with ample budget left', () => {
    const sliceStartedAt = now();
    expect(shouldYieldNow({ sliceStartedAt, timeSliceMs: 10_000 })).toBe(false);
  });

  it('is true once the time slice has elapsed', async () => {
    const sliceStartedAt = now();
    await sleep(30);
    expect(shouldYieldNow({ sliceStartedAt, timeSliceMs: 10 })).toBe(true);
  });

  it('uses DEFAULT_TIME_SLICE_MS when timeSliceMs is omitted', async () => {
    const sliceStartedAt = now();
    await sleep(DEFAULT_TIME_SLICE_MS + 25);
    expect(shouldYieldNow({ sliceStartedAt })).toBe(true);
  });

  it('is true when input is pending, even with budget left', () => {
    vi.stubGlobal('navigator', { scheduling: { isInputPending: () => true } });
    const sliceStartedAt = now();
    expect(shouldYieldNow({ sliceStartedAt, timeSliceMs: 10_000 })).toBe(true);
  });

  it('is false when input is explicitly not pending and budget remains', () => {
    vi.stubGlobal('navigator', { scheduling: { isInputPending: () => false } });
    const sliceStartedAt = now();
    expect(shouldYieldNow({ sliceStartedAt, timeSliceMs: 10_000 })).toBe(false);
  });
});
