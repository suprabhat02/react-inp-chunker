import { afterEach, describe, expect, it, vi } from 'vitest';

import { notifyAll } from '../../src/core/listeners.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('notifyAll()', () => {
  it('calls every listener, in subscription order', () => {
    const calls: string[] = [];
    notifyAll(new Set([() => calls.push('a'), () => calls.push('b')]));
    expect(calls).toEqual(['a', 'b']);
  });

  it('keeps calling the rest when one throws, and reports the error through reportError()', () => {
    const reported: unknown[] = [];
    vi.stubGlobal('reportError', (error: unknown) => reported.push(error));
    const boom = new Error('listener failed');
    const calls: string[] = [];

    expect(() => {
      notifyAll(
        new Set([
          () => calls.push('before'),
          () => {
            throw boom;
          },
          () => calls.push('after'),
        ]),
      );
    }).not.toThrow();

    expect(calls).toEqual(['before', 'after']);
    expect(reported).toEqual([boom]);
  });

  it('rethrows from a microtask where there is no reportError() (Node), rather than swallowing it', () => {
    vi.stubGlobal('reportError', undefined);
    const queued: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (task: () => void) => queued.push(task));
    const boom = new Error('listener failed');

    notifyAll(
      new Set([
        () => {
          throw boom;
        },
      ]),
    );

    expect(queued).toHaveLength(1);
    expect(() => {
      queued[0]?.();
    }).toThrow(boom);
  });
});
