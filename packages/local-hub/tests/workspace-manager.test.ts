import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TaskContract } from "@agentgitops/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWorkspaceEnvironment, WorkspaceManager } from "../src/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-workspace-manager-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("WorkspaceManager lifecycle", () => {
  it("plans archive and cleanup for completed workspaces", async () => {
    const worktreeRoot = path.join(tmpDir, "worktrees");
    const manager = new WorkspaceManager(tmpDir, worktreeRoot);
    const task = makeTask({
      status: "merged",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    await fs.mkdir(path.join(worktreeRoot, `${task.projectId}-${task.id}`), { recursive: true });

    const result = await manager.sweep([task], {
      cleanupAfterDays: 3,
      now: new Date("2026-07-08T00:00:00.000Z"),
      dryRun: true,
    });

    expect(result.archived).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].status).toBe("removed");
  });

  it("merges workspace and agent env with agent values taking precedence", () => {
    expect(
      buildWorkspaceEnvironment(
        { NODE_ENV: "test", AGENT_MODE: "workspace" },
        { AGENT_MODE: "agent" },
      ),
    ).toEqual({ NODE_ENV: "test", AGENT_MODE: "agent" });
  });
});

function makeTask(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    id: "task-001",
    projectId: "project",
    title: "Task",
    objective: "Objective",
    baseBranch: "main",
    targetBranch: "agent/task-001/generic",
    agentId: "generic",
    allowedPaths: [],
    forbiddenPaths: [],
    requiredChecks: [],
    riskLevel: "low",
    approval: { required: false },
    merge: { strategy: "manual", squash: true },
    status: "created",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}
