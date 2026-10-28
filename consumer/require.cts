// The same package through `require`, which resolves the .d.cts
// declarations rather than the .d.ts ones.
import { useChunkedTask } from 'react-inp-chunker';
import { createChunkScheduler, yieldToMain } from 'react-inp-chunker/core';

export const scheduler = createChunkScheduler({
  items: [1, 2, 3],
  processItem: (value: number): number => value * 2,
  batchSize: 2,
});

export const hook = useChunkedTask;
export const yielder: () => Promise<void> = yieldToMain;
