// The React entry point. For the framework-agnostic engine underneath
// (usable outside React — a Node script, a Web Worker, anything with a
// main thread worth protecting), import from 'react-inp-chunker/core'.
export * from './react/index.js';

export type {
  ChunkEvent,
  ChunkMachineState,
  ChunkScheduler,
  ChunkSchedulerOptions,
  ChunkSchedulerResult,
  ChunkSnapshot,
  ChunkStatus,
  DeferredGenerator,
  DeferredTask,
  DeferredTaskOptions,
  DeferredTaskResult,
  DeferredTaskSnapshot,
  YieldStrategy,
} from './core/index.js';
