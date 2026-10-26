import { describe, expect, it, vi } from 'vitest';

import type { SubscribableTask } from '../../src/react/task-controller.js';
import { createTaskController } from '../../src/react/task-controller.js';

interface FakeSnapshot {
  readonly value: number;
}

interface FakeTask extends SubscribableTask<FakeSnapshot> {
  emit: () => void;
  setSnapshot: (next: FakeSnapshot) => void;
  unsubscribeCalls: number;
}

function createFakeTask(initial: FakeSnapshot): FakeTask {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const fake: FakeTask = {
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        fake.unsubscribeCalls += 1;
      };
    }),
    getSnapshot: vi.fn(() => snapshot),
    emit: () => {
      for (const listener of listeners) listener();
    },
    setSnapshot: (next) => {
      snapshot = next;
      for (const listener of listeners) listener();
    },
    unsubscribeCalls: 0,
  };
  return fake;
}

describe('createTaskController()', () => {
  it('getCurrent() and getSnapshot() report nothing before replace() is ever called', () => {
    const controller = createTaskController<FakeTask>();
    expect(controller.getCurrent()).toBeNull();
    expect(controller.getSnapshot()).toBeUndefined();
  });

  it('subscribe and getSnapshot keep the same function identity across replace() calls', () => {
    // useSyncExternalStore resubscribes whenever `subscribe`'s identity
    // changes — the whole point of the controller is that it never does.
    const controller = createTaskController<FakeTask>();
    const { subscribe, getSnapshot } = controller;
    controller.replace(createFakeTask({ value: 1 }));
    controller.replace(createFakeTask({ value: 2 }));
    controller.replace(null);
    expect(controller.subscribe).toBe(subscribe);
    expect(controller.getSnapshot).toBe(getSnapshot);
  });

  it('replace() attaches to the new task and getSnapshot() forwards to it', () => {
    const controller = createTaskController<FakeTask>();
    const task = createFakeTask({ value: 42 });
    controller.replace(task);
    expect(controller.getCurrent()).toBe(task);
    expect(controller.getSnapshot()).toEqual({ value: 42 });
    // `subscribe` is method-shorthand on SubscribableTask (by design — see
    // task-controller.ts's doc comment on why TaskController's own fields
    // are arrow-typed instead); reading it here is just inspecting a test
    // spy, never an unbound call, so the rule doesn't apply.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(task.subscribe).toHaveBeenCalledTimes(1);
  });

  it('getSnapshot() tracks live changes on the current task, not a stale copy', () => {
    const controller = createTaskController<FakeTask>();
    const task = createFakeTask({ value: 1 });
    controller.replace(task);
    task.setSnapshot({ value: 2 });
    expect(controller.getSnapshot()).toEqual({ value: 2 });
  });

  it('notifies controller listeners when the underlying task notifies', () => {
    const controller = createTaskController<FakeTask>();
    const task = createFakeTask({ value: 1 });
    controller.replace(task);

    const listener = vi.fn();
    controller.subscribe(listener);
    task.emit();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('replace() itself notifies listeners immediately (even replacing with null)', () => {
    const controller = createTaskController<FakeTask>();
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.replace(createFakeTask({ value: 1 }));
    expect(listener).toHaveBeenCalledTimes(1);

    controller.replace(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('replace() detaches from the previous task before attaching the next one', () => {
    const controller = createTaskController<FakeTask>();
    const first = createFakeTask({ value: 1 });
    const second = createFakeTask({ value: 2 });

    controller.replace(first);
    controller.replace(second);

    expect(first.unsubscribeCalls).toBe(1);
    // The old task's own notifications must no longer reach the controller.
    const listener = vi.fn();
    controller.subscribe(listener);
    first.emit();
    expect(listener).not.toHaveBeenCalled();

    second.emit();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('replace(null) detaches from the current task and getSnapshot()/getCurrent() go back to empty', () => {
    const controller = createTaskController<FakeTask>();
    const task = createFakeTask({ value: 1 });
    controller.replace(task);
    controller.replace(null);

    expect(controller.getCurrent()).toBeNull();
    expect(controller.getSnapshot()).toBeUndefined();
    expect(task.unsubscribeCalls).toBe(1);

    const listener = vi.fn();
    controller.subscribe(listener);
    task.emit();
    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple independent listeners, and unsubscribe only removes its own', () => {
    const controller = createTaskController<FakeTask>();
    const task = createFakeTask({ value: 1 });
    controller.replace(task);

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const unsubscribeA = controller.subscribe(listenerA);
    controller.subscribe(listenerB);

    task.emit();
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);

    unsubscribeA();
    task.emit();
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(2);
  });

  it('two independent controllers never cross-notify each other', () => {
    const controllerA = createTaskController<FakeTask>();
    const controllerB = createTaskController<FakeTask>();
    const taskA = createFakeTask({ value: 1 });
    const taskB = createFakeTask({ value: 2 });
    controllerA.replace(taskA);
    controllerB.replace(taskB);

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    controllerA.subscribe(listenerA);
    controllerB.subscribe(listenerB);

    taskA.emit();
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
  });
});
