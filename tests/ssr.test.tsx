import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DeferredGenerator } from '../src/core/deferred-task.js';
import { useChunkedTask } from '../src/react/useChunkedTask.js';
import { useDeferredTask } from '../src/react/useDeferredTask.js';

/**
 * Server rendering never runs effects — that's the whole point of
 * useSyncExternalStore's third argument, getServerSnapshot. Both hooks
 * must report a safe, inert "idle" snapshot in that world rather than
 * throwing or hanging, since the real scheduler/task is only ever created
 * inside an effect that a server render will never execute.
 */

function ChunkedComponent({ items }: { items: readonly number[] }) {
  const state = useChunkedTask(items, (x: number) => x * 2);
  return (
    <div data-testid="chunked">
      {state.status}|{state.processed}|{state.total}|{String(state.results)}
    </div>
  );
}

function* countingTask(n: number): DeferredGenerator<number> {
  for (let i = 0; i < n; i++) yield;
  return n;
}

function DeferredComponent({ n }: { n: number }) {
  const state = useDeferredTask(() => countingTask(n), [n]);
  return (
    <div data-testid="deferred">
      {state.status}|{String(state.value)}
    </div>
  );
}

describe('SSR safety', () => {
  it('useChunkedTask renders an inert idle snapshot under renderToStaticMarkup, without running the scheduler', () => {
    const html = renderToStaticMarkup(<ChunkedComponent items={[1, 2, 3, 4, 5]} />);
    expect(html).toContain('idle');
    expect(html).toContain('|0|5|undefined');
  });

  it('useChunkedTask reports the correct idle total for whatever items length was passed, with no items at all included', () => {
    const html = renderToStaticMarkup(<ChunkedComponent items={[]} />);
    expect(html).toContain('idle|0|0|undefined');
  });

  it('useDeferredTask renders an inert idle snapshot under renderToStaticMarkup, without running the generator', () => {
    const html = renderToStaticMarkup(<DeferredComponent n={10} />);
    expect(html).toContain('idle|undefined');
  });

  it('does not throw when server-rendering either hook', () => {
    expect(() =>
      renderToStaticMarkup(<ChunkedComponent items={[1, 2, 3]} />),
    ).not.toThrow();
    expect(() => renderToStaticMarkup(<DeferredComponent n={3} />)).not.toThrow();
  });
});
