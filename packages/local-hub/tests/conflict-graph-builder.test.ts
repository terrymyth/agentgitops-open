import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SyncedTask, TeamProject } from "@agentgitops/core";
import { ConflictGraphBuilder } from "../src/conflict-graph-builder.js";
import { TeamSyncStore } from "../src/team-sync-store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-conflict-graph-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("ConflictGraphBuilder", () => {
  it("builds and persists file-level conflict edges from synced metadata", () => {
    seedConflictData(tmpDir);
    const builder = new ConflictGraphBuilder(tmpDir);
    try {
      const result = builder.build();
      expect(result.edges).toHaveLength(3);
      expect(result.edges.map((edge) => edge.type)).toEqual(
        expect.arrayContaining(["same_file", "lockfile", "risk_domain"]),
      );
      expect(result.edges.find((edge) => edge.type === "lockfile")?.severity).toBe("high");
    } finally {
      builder.close();
    }

    const store = new TeamSyncStore(tmpDir);
    try {
      expect(store.getStatusSummary("team_001").conflictEdges).toBe(3);
      expect(store.listConflictGraphEdges("team_001")[0].severity).toBe("high");
    } finally {
      store.close();
    }
  });
});

function seedConflictData(projectPath: string): void {
  const store = new TeamSyncStore(projectPath);
  try {
    const project = makeProject();
    store.upsertTeamProject(project);
    store.upsertSyncedTask(makeTask("task-001", ["src/app.ts", "pnpm-lock.yaml"]));
    store.upsertSyncedTask(makeTask("task-002", ["src/app.ts"]));
    store.upsertSyncedTask(makeTask("task-003", ["pnpm-lock.yaml"]));
  } finally {
    store.close();
  }
}

function makeProject(): TeamProject {
  return {
    teamId: "team_001",
    name: "Platform Team",
    repoUrl: "local:repo",
    syncMode: "local",
    createdAt: "2026-07-10T00:00:00Z",
    updatedAt: "2026-07-10T00:00:00Z",
    settings: {
      syncIntervalSeconds: 60,
      contextFeedCompression: "standard",
      conflictDetectionLevel: "file",
      autoSyncOnTaskChange: false,
    },
  };
}

function makeTask(taskId: string, changedFiles: string[]): SyncedTask {
  return {
    taskId,
    teamId: "team_001",
    projectId: "proj_demo",
    sourceHubId: "hub_001",
    ownerMemberId: "member_001",
    title: `Task ${taskId}`,
    objective: "Edit team sync metadata",
    status: "running",
    agentId: "codex",
    baseBranch: "main",
    targetBranch: `agent/${taskId}/codex`,
    riskLevel: "medium",
    riskDomains: ["team-sync"],
    changedFiles,
    relatedTasks: [],
    createdAt: "2026-07-10T00:00:00Z",
    updatedAt: "2026-07-10T00:01:00Z",
  };
}
