import { test, expect, describe, beforeEach } from "bun:test";

import {
  backgroundTaskRegistry,
  onBackgroundTaskComplete,
  notifyTaskComplete,
  type BackgroundTask,
} from "./backgroundTasks.ts";

function makeTask(id: string): BackgroundTask {
  return {
    taskId: id,
    type: "bash",
    description: "test task",
    status: "running",
    partialOutput: "",
    outputFile: `/tmp/${id}.out`,
    promise: Promise.resolve("done"),
    controller: new AbortController(),
    startedAt: Date.now(),
  };
}

// ── backgroundTaskRegistry ──────────────────────────────────────────────────

describe("backgroundTaskRegistry", () => {
  beforeEach(() => {
    backgroundTaskRegistry.clear();
  });

  test("is a Map", () => {
    expect(backgroundTaskRegistry).toBeInstanceOf(Map);
  });

  test("starts empty (after clear)", () => {
    expect(backgroundTaskRegistry.size).toBe(0);
  });

  test("can store and retrieve a task by id", () => {
    const task = makeTask("t1");
    backgroundTaskRegistry.set("t1", task);
    expect(backgroundTaskRegistry.get("t1")).toBe(task);
  });

  test("can delete a task", () => {
    backgroundTaskRegistry.set("t2", makeTask("t2"));
    backgroundTaskRegistry.delete("t2");
    expect(backgroundTaskRegistry.has("t2")).toBe(false);
  });
});

// ── onBackgroundTaskComplete ────────────────────────────────────────────────

describe("onBackgroundTaskComplete", () => {
  beforeEach(() => {
    backgroundTaskRegistry.clear();
  });

  test("returns an unsubscribe function", () => {
    const unsub = onBackgroundTaskComplete(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });

  test("callback is called when notifyTaskComplete fires for that task", () => {
    const task = makeTask("cb-test");
    backgroundTaskRegistry.set("cb-test", task);

    let received: BackgroundTask | null = null;
    const unsub = onBackgroundTaskComplete((t) => { received = t; });

    notifyTaskComplete("cb-test");
    unsub();

    expect(received).toBe(task);
  });

  test("multiple listeners are each called", () => {
    const task = makeTask("multi");
    backgroundTaskRegistry.set("multi", task);

    let count = 0;
    const unsub1 = onBackgroundTaskComplete(() => { count++; });
    const unsub2 = onBackgroundTaskComplete(() => { count++; });

    notifyTaskComplete("multi");

    unsub1();
    unsub2();

    expect(count).toBe(2);
  });

  test("unsubscribed listener is not called after removal", () => {
    const task = makeTask("unsub");
    backgroundTaskRegistry.set("unsub", task);

    let called = false;
    const unsub = onBackgroundTaskComplete(() => { called = true; });
    unsub(); // remove immediately

    notifyTaskComplete("unsub");

    expect(called).toBe(false);
  });

  test("calling unsub twice does not throw", () => {
    const unsub = onBackgroundTaskComplete(() => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  test("listener receives the exact task object from the registry", () => {
    const task = makeTask("exact");
    task.status = "completed";
    task.partialOutput = "hello";
    backgroundTaskRegistry.set("exact", task);

    let received: BackgroundTask | null = null;
    const unsub = onBackgroundTaskComplete((t) => { received = t; });
    notifyTaskComplete("exact");
    unsub();

    expect(received?.taskId).toBe("exact");
    expect(received?.status).toBe("completed");
    expect(received?.partialOutput).toBe("hello");
  });

  test("listener receives agent-type task", () => {
    const task = makeTask("agent1");
    task.type = "agent";
    task.transcriptFile = "/tmp/agent1.jsonl";
    backgroundTaskRegistry.set("agent1", task);

    let received: BackgroundTask | null = null;
    const unsub = onBackgroundTaskComplete((t) => { received = t; });
    notifyTaskComplete("agent1");
    unsub();

    expect(received?.type).toBe("agent");
    expect(received?.transcriptFile).toBe("/tmp/agent1.jsonl");
  });

  test("does not call listeners that threw on a previous notify (error is swallowed)", () => {
    const task = makeTask("err");
    backgroundTaskRegistry.set("err", task);

    let secondCalled = false;
    const unsub1 = onBackgroundTaskComplete(() => { throw new Error("boom"); });
    const unsub2 = onBackgroundTaskComplete(() => { secondCalled = true; });

    expect(() => notifyTaskComplete("err")).not.toThrow();
    expect(secondCalled).toBe(true);

    unsub1();
    unsub2();
  });
});

// ── notifyTaskComplete ──────────────────────────────────────────────────────

describe("notifyTaskComplete", () => {
  beforeEach(() => {
    backgroundTaskRegistry.clear();
  });

  test("does nothing (no throw) when task id is not in registry", () => {
    expect(() => notifyTaskComplete("nonexistent")).not.toThrow();
  });

  test("does nothing when registry is empty", () => {
    expect(() => notifyTaskComplete("whatever")).not.toThrow();
  });

  test("notifies with the task object, not a copy", () => {
    const task = makeTask("ref");
    backgroundTaskRegistry.set("ref", task);

    let ref: BackgroundTask | null = null;
    const unsub = onBackgroundTaskComplete((t) => { ref = t; });
    notifyTaskComplete("ref");
    unsub();

    expect(ref).toBe(task); // same reference
  });

  test("can notify the same task multiple times", () => {
    const task = makeTask("repeat");
    backgroundTaskRegistry.set("repeat", task);

    let count = 0;
    const unsub = onBackgroundTaskComplete(() => { count++; });
    notifyTaskComplete("repeat");
    notifyTaskComplete("repeat");
    unsub();

    expect(count).toBe(2);
  });
});
