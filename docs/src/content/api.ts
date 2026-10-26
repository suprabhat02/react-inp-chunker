/**
 * The API reference, as data. Every entry here is checked against the
 * library's source (src/react/*.ts, src/core/*.ts in the repository).
 */

export interface ApiRow {
  readonly name: string;
  readonly type: string;
  /** Omitted for required arguments and for return values. */
  readonly defaultValue?: string;
  readonly description: string;
}

export const CHUNKED_ARGS: readonly ApiRow[] = [
  {
    name: 'items',
    type: 'readonly T[]',
    description:
      'The work. A new array (a new reference) cancels the current run and sets up a new one, so memoize arrays you derive.',
  },
  {
    name: 'processItem',
    type: '(item: T, index: number) => R',
    description:
      'Runs once per item, synchronously. It can be a new function on every render: the latest one is called, and the task does not restart.',
  },
  {
    name: 'options',
    type: 'UseChunkedTaskOptions<T, R>',
    defaultValue: '{}',
    description: 'See below.',
  },
];

export const CHUNKED_OPTIONS: readonly ApiRow[] = [
  {
    name: 'timeSliceMs',
    type: 'number',
    defaultValue: '5',
    description:
      'The longest stretch of work before yielding to the browser. Zero, negative or NaN fall back to 5. Changing it sets up a new run.',
  },
  {
    name: 'autoStart',
    type: 'boolean',
    defaultValue: 'true',
    description:
      'Start as soon as the task is created. With false, nothing runs until start().',
  },
  {
    name: 'onItem',
    type: '(result: R, item: T, index: number) => void',
    description:
      'Called after each item, with its result. Use it to consume results while the task is still running.',
  },
];

const STATUS_ROW: ApiRow = {
  name: 'status',
  type: "'idle' | 'processing' | 'paused' | 'done' | 'cancelled' | 'error'",
  description: 'Where the task is in its life. See Status below.',
};

const SHARED_STATE: readonly ApiRow[] = [
  {
    name: 'error',
    type: 'unknown',
    description: 'What your function threw, when status is error.',
  },
  {
    name: 'isIdle, isProcessing, isPaused, isDone, isCancelled, isError',
    type: 'boolean',
    description: 'One flag per status, for readable conditions.',
  },
  {
    name: 'start()',
    type: '() => void',
    description: 'Starts an idle task. Does nothing in any other status.',
  },
  {
    name: 'pause()',
    type: '() => void',
    description: 'Pauses a processing task after the item or segment in progress.',
  },
  {
    name: 'resume()',
    type: '() => void',
    description: 'Continues a paused task.',
  },
  {
    name: 'cancel()',
    type: '() => void',
    description:
      'Stops the task for good. Also happens automatically on unmount and when the inputs change.',
  },
];

export const CHUNKED_RETURNS: readonly ApiRow[] = [
  STATUS_ROW,
  {
    name: 'processed',
    type: 'number',
    description: 'Items finished so far. Updates once per slice.',
  },
  {
    name: 'total',
    type: 'number',
    description: 'items.length.',
  },
  {
    name: 'results',
    type: 'readonly R[] | undefined',
    description:
      'Set when the task ends: every result when done, the ones finished so far when cancelled or failed. undefined until then.',
  },
  ...SHARED_STATE,
];

export const DEFERRED_ARGS: readonly ApiRow[] = [
  {
    name: 'task',
    type: '() => DeferredGenerator<T>',
    description:
      'A generator function. Each yield marks a safe place to pause; the value it returns becomes value.',
  },
  {
    name: 'deps',
    type: 'readonly unknown[]',
    description:
      'Like useEffect dependencies: when one changes, the current run is cancelled and a new one is set up.',
  },
  {
    name: 'options',
    type: 'UseDeferredTaskOptions',
    defaultValue: '{}',
    description:
      'timeSliceMs (default 5) and autoStart (default true), as for useChunkedTask.',
  },
];

export const DEFERRED_RETURNS: readonly ApiRow[] = [
  STATUS_ROW,
  {
    name: 'value',
    type: 'T | undefined',
    description: "The generator's return value, once status is done.",
  },
  ...SHARED_STATE,
];

export const STATUSES: readonly { readonly status: string; readonly meaning: string }[] =
  [
    {
      status: 'idle',
      meaning: 'Created, not started yet. Only seen with autoStart: false.',
    },
    { status: 'processing', meaning: 'Working, one slice at a time.' },
    { status: 'paused', meaning: 'Waiting for resume(). Nothing runs.' },
    { status: 'done', meaning: 'Finished. results or value is set.' },
    {
      status: 'cancelled',
      meaning: 'Stopped by cancel(), by unmounting, or by new inputs.',
    },
    { status: 'error', meaning: 'Your function threw. The thrown value is in error.' },
  ];

export const CORE_EXPORTS: readonly ApiRow[] = [
  {
    name: 'createChunkScheduler(options)',
    type: 'ChunkScheduler<R>',
    description:
      'The engine behind useChunkedTask. Options: items, processItem, timeSliceMs, onItem, signal (an AbortSignal).',
  },
  {
    name: 'createDeferredTask(options)',
    type: 'DeferredTask<T>',
    description: 'The engine behind useDeferredTask. Options: task, timeSliceMs, signal.',
  },
  {
    name: '.start() .pause() .resume() .cancel()',
    type: '() => void',
    description: 'The same controls as the hooks.',
  },
  {
    name: '.subscribe(listener)',
    type: '(listener: () => void) => () => void',
    description:
      'Calls listener when the status changes and after every slice. Returns the unsubscribe function.',
  },
  {
    name: '.getSnapshot()',
    type: '{ status, processed, total, error? }',
    description:
      "The current state (a deferred task's has no processed or total). The same object until something changes, so it plugs straight into useSyncExternalStore.",
  },
  {
    name: '.settled',
    type: "Promise<{ status: 'done' | 'cancelled' | 'error', … }>",
    description:
      'Resolves once when the task ends, with its results or value. Never rejects.',
  },
  {
    name: 'yieldToMain()',
    type: '() => Promise<void>',
    description:
      'Yields once, with the best method available. For writing your own loops.',
  },
  {
    name: 'resolveYieldStrategy()',
    type: "'scheduler-yield' | 'message-channel' | 'set-timeout'",
    description: 'Which method yieldToMain() will use in this browser.',
  },
  {
    name: 'DEFAULT_TIME_SLICE_MS',
    type: 'number',
    description: '5.',
  },
];
