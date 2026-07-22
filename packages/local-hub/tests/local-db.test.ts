import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import type { TaskContract } from "@agentgitops/core";

// node:sqlite 在 Node 22+ 默认可用（仍触发 ExperimentalWarning）。
// 若不可用则说明运行环境不满足要求，应显式失败而非静默跳过，避免 CI 假绿。
let LocalDb: typeof import("../src/local-db.js").LocalDb | undefined;
try {
  const mod = await import("../src/local-db.js");
  LocalDb = mod.LocalDb;
} catch (err) {
  // 仅在确实无法加载时抛出，让测试套件明确感知环境问题
  throw new Error(
    `node:sqlite 不可用，LocalDb 测试无法运行。请使用 Node 22+。原始错误: ${err instanceof Error ? err.message : String(err)}`,
  );
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeTask(overrides?: Partial<TaskContract>): TaskContract {
  return {
    id: "task-test-001",
    projectId: "proj_test",
    title: "Test task",
    objective: "Test objective",
    baseBranch: "main",
    targetBranch: "agent/task-test-001/generic",
    agentId: "generic",
    allowedPaths: ["src/**"],
    forbiddenPaths: ["db/**"],
    requiredChecks: ["npm test"],
    riskLevel: "low",
    approval: { required: false },
    merge: { strategy: "manual", squash: true },
    status: "created",
    createdAt: "2026-07-03T00:00:00Z",
    updatedAt: "2026-07-03T00:00:00Z",
    ...overrides,
  };
}

describe("LocalDb", () => {
  it("should create tables on init", () => {
    const db = new LocalDb!(tmpDir);
    const tables = db.listTasks();
    expect(tables).toEqual([]);
    db.close();
  });

  it("should insert and get a task", () => {
    const db = new LocalDb!(tmpDir);
    const task = makeTask();
    db.insertTask(task);

    const retrieved = db.getTask("task-test-001");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("task-test-001");
    expect(retrieved!.title).toBe("Test task");
    expect(retrieved!.allowedPaths).toEqual(["src/**"]);
    expect(retrieved!.forbiddenPaths).toEqual(["db/**"]);
    expect(retrieved!.requiredChecks).toEqual(["npm test"]);
    db.close();
  });

  it("should update task status", () => {
    const db = new LocalDb!(tmpDir);
    db.insertTask(makeTask());

    db.updateTaskStatus("task-test-001", "running");
    const task = db.getTask("task-test-001");
    expect(task!.status).toBe("running");
    db.close();
  });

  it("should list tasks sorted by created_at desc", () => {
    const db = new LocalDb!(tmpDir);
    db.insertTask(makeTask({ id: "task-001", createdAt: "2026-07-01T00:00:00Z" }));
    db.insertTask(makeTask({ id: "task-002", createdAt: "2026-07-03T00:00:00Z" }));
    db.insertTask(makeTask({ id: "task-003", createdAt: "2026-07-02T00:00:00Z" }));

    const tasks = db.listTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBe("task-002");
    expect(tasks[1].id).toBe("task-003");
    expect(tasks[2].id).toBe("task-001");
    db.close();
  });

  it("should insert and list audit events", () => {
    const db = new LocalDb!(tmpDir);
    db.insertAuditEvent({
      id: "audit-001",
      projectId: "proj_test",
      taskId: "task-test-001",
      actorType: "system",
      actorId: "system",
      eventType: "task.created",
    });

    const events = db.listAuditEvents("task-test-001");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("task.created");
    db.close();
  });

  it("should filter audit events by actor, type, time, and limit", () => {
    const db = new LocalDb!(tmpDir);
    db.insertAuditEvent({
      id: "audit-001",
      projectId: "proj_test",
      taskId: "task-test-001",
      actorType: "system",
      actorId: "github",
      eventType: "ci.check_run",
    });
    db.insertAuditEvent({
      id: "audit-002",
      projectId: "proj_test",
      taskId: "task-test-001",
      actorType: "human",
      actorId: "owner",
      eventType: "review.submitted",
    });

    const events = db.listAuditEvents({
      actorId: "owner",
      actorType: "human",
      eventType: "review.submitted",
      limit: 1,
    });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("audit-002");
    db.close();
  });

  it("should insert agentops snapshots", () => {
    const db = new LocalDb!(tmpDir);
    db.insertAgentOpsSnapshot({
      id: "agentops-001",
      projectId: "proj_test",
      metrics: { taskTotals: { reviewing: 1 }, auditTotal: 0 },
    });

    const snapshots = db.listAgentOpsSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(JSON.parse(snapshots[0].metrics)).toEqual({
      taskTotals: { reviewing: 1 },
      auditTotal: 0,
    });
    db.close();
  });

  it("should insert and list agent notes", () => {
    const db = new LocalDb!(tmpDir);
    db.insertAgentNote({
      id: "note-001",
      taskId: "task-test-001",
      agentId: "codex",
      summary: "Implemented governance notes",
      files: ["apps/cli/src/index.ts"],
      verification: ["pnpm test"],
      reviewFocus: ["note persistence"],
      risks: ["none"],
    });

    const notes = db.listAgentNotes("task-test-001");
    expect(notes).toHaveLength(1);
    expect(notes[0].summary).toBe("Implemented governance notes");
    expect(notes[0].reviewFocus).toEqual(["note persistence"]);
    db.close();
  });

  it("should insert, update, and list workflow jobs", () => {
    const db = new LocalDb!(tmpDir);
    const queued = db.insertWorkflowJob({
      id: "job-001",
      action: "task.test",
      taskId: "task-test-001",
      actorId: "tester",
      source: "cli",
      payload: { command: "pnpm test" },
    });
    expect(queued.status).toBe("queued");

    const running = db.updateWorkflowJob({
      id: "job-001",
      status: "running",
      startedAt: "2026-07-05T00:00:00Z",
    });
    expect(running.status).toBe("running");
    expect(running.started_at).toBe("2026-07-05T00:00:00Z");

    const completed = db.updateWorkflowJob({
      id: "job-001",
      status: "completed",
      result: { message: "ok" },
      completedAt: "2026-07-05T00:01:00Z",
    });
    expect(completed.status).toBe("completed");
    expect(JSON.parse(completed.result ?? "{}")).toEqual({ message: "ok" });

    const jobs = db.listWorkflowJobs({ taskId: "task-test-001" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].action).toBe("task.test");
    db.close();
  });

  it("should return null for non-existent task", () => {
    const db = new LocalDb!(tmpDir);
    const task = db.getTask("non-existent");
    expect(task).toBeNull();
    db.close();
  });
});
