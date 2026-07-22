import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  SyncedAgentNote,
  SyncedChangePackage,
  SyncedTask,
  TeamProject,
} from "@agentgitops/core";
import { ContextFeedBuilder, formatAgentContextFeed } from "../src/context-feed-builder.js";
import { TeamSyncStore } from "../src/team-sync-store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-context-feed-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("ContextFeedBuilder", () => {
  it("builds a redacted team context feed from local Team Sync cache", async () => {
    seedFeedData(tmpDir);
    const builder = new ContextFeedBuilder(tmpDir);
    try {
      const feed = await builder.build({
        taskId: "task-001",
        agentType: "codex",
        compression: "detailed",
      });
      expect(feed.teamId).toBe("team_001");
      expect(feed.items.map((item) => item.title)).toEqual(
        expect.arrayContaining([
          "Current Task",
          "Change Package pkg_task-001",
          "Agent Note note_001",
          "File overlap with task-002",
        ]),
      );
      expect(feed.items.map((item) => item.layer)).toContain("survival");
      expect(JSON.stringify(feed)).toContain("[REDACTED:password]");
      expect(JSON.stringify(feed)).not.toContain("secret-value");

      const formatted = formatAgentContextFeed(feed, "prompt");
      expect(formatted).toContain("Team Sync Context for Codex");
      expect(formatted).toContain("Prefer verified/current items");
    } finally {
      builder.close();
    }
  });
});

function seedFeedData(projectPath: string): void {
  const store = new TeamSyncStore(projectPath);
  try {
    const project = makeProject();
    store.upsertTeamProject(project);
    store.upsertLocalHubRegistration({
      hubId: "hub_001",
      teamId: project.teamId,
      memberId: "member_001",
      agentgitopsVersion: "0.1.0",
      registeredAt: project.createdAt,
      status: "connected",
    });
    store.upsertSyncedTask(makeTask("task-001", ["src/app.ts"]));
    store.upsertSyncedTask(makeTask("task-002", ["src/app.ts"]));
    store.upsertSyncedChangePackage(makePackage());
    store.upsertSyncedAgentNote(makeNote());
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
    createdAt: "2026-07-09T00:00:00Z",
    updatedAt: "2026-07-09T00:00:00Z",
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
    objective: "Coordinate implementation",
    status: "running",
    agentId: "codex",
    baseBranch: "main",
    targetBranch: `agent/${taskId}/codex`,
    riskLevel: "medium",
    riskDomains: ["team-sync"],
    changedFiles,
    relatedTasks: [],
    createdAt: "2026-07-09T00:00:00Z",
    updatedAt: "2026-07-09T00:01:00Z",
  };
}

function makePackage(): SyncedChangePackage {
  return {
    packageId: "pkg_task-001",
    taskId: "task-001",
    teamId: "team_001",
    sourceHubId: "hub_001",
    summary: "Implemented context feed",
    changedFiles: ["src/app.ts"],
    riskLevel: "medium",
    riskDomains: ["team-sync"],
    verificationSummary: { passed: 1, failed: 0, skipped: 0 },
    createdAt: "2026-07-09T00:01:00Z",
    updatedAt: "2026-07-09T00:02:00Z",
  };
}

function makeNote(): SyncedAgentNote {
  return {
    noteId: "note_001",
    taskId: "task-001",
    teamId: "team_001",
    sourceHubId: "hub_001",
    authorId: "codex",
    noteType: "handoff",
    summary: "Continue from password=secret-value",
    files: ["src/app.ts"],
    createdAt: "2026-07-09T00:03:00Z",
  };
}
