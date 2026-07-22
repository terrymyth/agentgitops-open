import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { TaskManager } from "../src/task-manager.js";
import { LocalDb } from "../src/local-db.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-task-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("TaskManager", () => {
  it("should generate task id with date prefix", () => {
    const mgr = new TaskManager(tmpDir);
    const id = mgr.generateTaskId();
    expect(id).toMatch(/^task-\d{8}-\d{3}$/);
  });

  it("should create a task", async () => {
    const mgr = new TaskManager(tmpDir);
    const task = await mgr.create({
      projectName: "test-project",
      title: "Fix bug",
      agentName: "generic",
      riskLevel: "medium",
    });

    expect(task.id).toMatch(/^task-/);
    expect(task.title).toBe("Fix bug");
    expect(task.agentId).toBe("generic");
    expect(task.riskLevel).toBe("medium");
    expect(task.status).toBe("created");
    expect(task.targetBranch).toContain("agent/");
    expect(task.approval.required).toBe(false); // medium 不需要审批，high/critical 才需要
  });

  it("should save and load task", async () => {
    const mgr = new TaskManager(tmpDir);
    const task = await mgr.create({
      projectName: "test-project",
      title: "Fix bug",
      agentName: "generic",
    });

    const loaded = await mgr.load(task.id);
    expect(loaded.id).toBe(task.id);
    expect(loaded.title).toBe("Fix bug");
  });

  it("should list tasks", async () => {
    const mgr = new TaskManager(tmpDir);
    await mgr.create({ projectName: "p", title: "t1", agentName: "a" });
    await mgr.create({ projectName: "p", title: "t2", agentName: "a" });

    const tasks = await mgr.list();
    expect(tasks).toHaveLength(2);
  });

  it("should update task status", async () => {
    const mgr = new TaskManager(tmpDir);
    const task = await mgr.create({
      projectName: "p",
      title: "t1",
      agentName: "a",
    });

    await mgr.updateStatus(task.id, "running");
    const loaded = await mgr.load(task.id);
    expect(loaded.status).toBe("running");
  });

  it("updates task contract fields in SQLite and YAML", async () => {
    const mgr = new TaskManager(tmpDir);
    const task = await mgr.create({
      projectName: "p",
      title: "before",
      agentName: "a",
    });

    const updated = await mgr.update(task.id, {
      title: "after",
      objective: "new objective",
      allowedPaths: ["apps/web/src/**"],
      requiredChecks: ["pnpm typecheck"],
      riskLevel: "high",
      reviewers: ["owner"],
    });

    expect(updated.title).toBe("after");
    expect(updated.objective).toBe("new objective");
    expect(updated.allowedPaths).toEqual(["apps/web/src/**"]);
    expect(updated.requiredChecks).toEqual(["pnpm typecheck"]);
    expect(updated.riskLevel).toBe("high");
    expect(updated.approval.required).toBe(true);
    expect(updated.approval.reviewers).toEqual(["owner"]);

    const loaded = await mgr.load(task.id);
    expect(loaded.title).toBe("after");
    expect(loaded.allowedPaths).toEqual(["apps/web/src/**"]);

    const yaml = await fs.readFile(
      path.join(tmpDir, ".agentgitops", "tasks", `${task.id}.yml`),
      "utf-8",
    );
    expect(yaml).toContain("title: after");
    expect(yaml).toContain("apps/web/src/**");
  });

  it("loads tasks from SQLite when YAML snapshot is missing", async () => {
    const mgr = new TaskManager(tmpDir);
    const task = await mgr.create({
      projectName: "p",
      title: "sqlite source",
      agentName: "a",
    });
    await fs.rm(path.join(tmpDir, ".agentgitops", "tasks", `${task.id}.yml`));

    const loaded = await mgr.load(task.id);
    expect(loaded.id).toBe(task.id);
    expect(loaded.title).toBe("sqlite source");
  });

  it("prefers YAML task snapshots over stale local SQLite state", async () => {
    const mgr = new TaskManager(tmpDir);
    const task = await mgr.create({
      projectName: "p",
      title: "git-native source",
      agentName: "a",
    });
    const db = new LocalDb(tmpDir);
    try {
      db.updateTaskStatus(task.id, "failed");
      expect(db.getTask(task.id)?.status).toBe("failed");
    } finally {
      db.close();
    }

    const loaded = await mgr.load(task.id);
    expect(loaded.status).toBe("created");

    const listed = await mgr.list();
    expect(listed.find((item) => item.id === task.id)?.status).toBe("created");
  });

  it("reports and reconciles local SQLite drift from task snapshots", async () => {
    const mgr = new TaskManager(tmpDir);
    const task = await mgr.create({
      projectName: "p",
      title: "reconcile drift",
      agentName: "a",
    });
    const db = new LocalDb(tmpDir);
    try {
      db.updateTaskStatus(task.id, "failed");
    } finally {
      db.close();
    }

    const drift = await mgr.inspectSnapshotDrift();
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      taskId: task.id,
      reason: "status-mismatch",
      snapshotStatus: "created",
      sqliteStatus: "failed",
    });

    const dryRun = await mgr.reconcileFromSnapshots({ dryRun: true });
    expect(dryRun.pending).toBe(1);
    expect(dryRun.updated).toBe(0);
    const afterDryRun = new LocalDb(tmpDir);
    try {
      expect(afterDryRun.getTask(task.id)?.status).toBe("failed");
    } finally {
      afterDryRun.close();
    }

    const result = await mgr.reconcileFromSnapshots();
    expect(result.updated).toBe(1);
    const afterReconcile = new LocalDb(tmpDir);
    try {
      expect(afterReconcile.getTask(task.id)?.status).toBe("created");
    } finally {
      afterReconcile.close();
    }
  });

  it("migrates legacy YAML tasks into SQLite on load", async () => {
    const mgr = new TaskManager(tmpDir);
    const task = await mgr.create({
      projectName: "p",
      title: "legacy yaml",
      agentName: "a",
    });
    const db = new LocalDb(tmpDir);
    db.close();
    await fs.rm(path.join(tmpDir, ".agentgitops", "db.sqlite"));
    await fs.rm(path.join(tmpDir, ".agentgitops", "db.sqlite-wal"), { force: true });
    await fs.rm(path.join(tmpDir, ".agentgitops", "db.sqlite-shm"), { force: true });

    const loaded = await mgr.load(task.id);
    expect(loaded.id).toBe(task.id);

    const nextDb = new LocalDb(tmpDir);
    try {
      expect(nextDb.getTask(task.id)?.title).toBe("legacy yaml");
    } finally {
      nextDb.close();
    }
  });

  it("should return empty list when no tasks", async () => {
    const mgr = new TaskManager(tmpDir);
    const tasks = await mgr.list();
    expect(tasks).toEqual([]);
  });
});
