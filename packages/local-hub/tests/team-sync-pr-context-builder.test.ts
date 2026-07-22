import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ChangePackage,
  LocalHubRegistration,
  SyncEvent,
  SyncedChangePackage,
  SyncedTask,
  TaskContract,
  TeamMember,
  TeamProject,
} from "@agentgitops/core";
import { TeamSyncPullRequestContextBuilder } from "../src/team-sync-pr-context-builder.js";
import { TeamSyncStore } from "../src/team-sync-store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-team-sync-pr-context-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("TeamSyncPullRequestContextBuilder", () => {
  it("falls back to local-only context when Team Sync is not initialized", async () => {
    const builder = new TeamSyncPullRequestContextBuilder(tmpDir);
    try {
      const context = await builder.build(makeTask(), makeChangePackage());
      expect(context.syncStatus).toBe("local-only");
      expect(context.controlPlane).toBe("disabled");
      expect(context.offlineChanges).toBe(true);
    } finally {
      builder.close();
    }
  });

  it("builds real PR context from local Team Sync cache", async () => {
    seedTeamSyncData(tmpDir);
    const builder = new TeamSyncPullRequestContextBuilder(tmpDir);
    try {
      const context = await builder.build(makeTask(), makeChangePackage());
      expect(context.teamProject).toBe("Platform Team");
      expect(context.localHubInstance).toBe("hub_001");
      expect(context.relatedTasks).toContain("task-002");
      expect(context.relatedBranches).toEqual(
        expect.arrayContaining(["agent/task-001/codex", "agent/task-002/claude"]),
      );
      expect(context.touchedDomains).toEqual(["team-sync"]);
      expect(context.overlappingFiles).toContain("src/app.ts");
      expect(context.conflictSignals).toContain("medium:same_file");
      expect(context.contextFeedId).toMatch(/^feed_task-001_/);
      expect(context.sourceChangePackages).toEqual(expect.arrayContaining(["pkg_task-001"]));
      expect(context.usedByAgent).toBe(true);
      expect(context.syncStatus).toBe("pending-local-events");
      expect(context.controlPlane).toBe("disabled");
      expect(context.offlineChanges).toBe(true);
    } finally {
      builder.close();
    }
  });
});

function seedTeamSyncData(projectPath: string): void {
  const store = new TeamSyncStore(projectPath);
  try {
    store.upsertTeamProject(makeProject());
    store.upsertTeamMember(makeMember());
    store.upsertLocalHubRegistration(makeLocalHub());
    store.upsertSyncedTask(
      makeSyncedTask("task-001", "codex", "agent/task-001/codex", ["src/app.ts"]),
    );
    store.upsertSyncedTask(
      makeSyncedTask("task-002", "claude", "agent/task-002/claude", ["src/app.ts"]),
    );
    store.upsertSyncedChangePackage(makeSyncedPackage());
    store.enqueueSyncEvent(makePendingEvent());
  } finally {
    store.close();
  }
}

function makeTask(): TaskContract {
  return {
    id: "task-001",
    projectId: "proj_demo",
    title: "Wire Team Sync PR context",
    objective: "Inject Team Sync context into PR bodies",
    baseBranch: "main",
    targetBranch: "agent/task-001/codex",
    agentId: "codex",
    allowedPaths: [],
    forbiddenPaths: [],
    requiredChecks: ["pnpm test"],
    riskLevel: "medium",
    approval: { required: false },
    merge: { strategy: "manual", squash: true },
    status: "reviewing",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:01:00.000Z",
  };
}

function makeChangePackage(): ChangePackage {
  const task = makeTask();
  return {
    id: "pkg_task-001",
    taskId: task.id,
    projectId: task.projectId,
    version: "1.0",
    agent: { name: "codex", adapter: "generic-cli" },
    baseBranch: task.baseBranch,
    targetBranch: task.targetBranch,
    objective: task.objective,
    summary: "1 files changed (+4 -1)",
    changedFiles: ["src/app.ts"],
    stats: { filesChanged: 1, insertions: 4, deletions: 1 },
    checks: [],
    risk: {
      level: "medium",
      domains: ["team-sync"],
      highRiskFilesTouched: false,
      forbiddenFilesTouched: false,
      violations: [],
    },
    evidence: {
      comparison: {
        comparedPackages: 1,
        overlappingFiles: ["src/app.ts"],
        insertionDelta: 4,
        deletionDelta: 1,
      },
    },
    unverifiedItems: [],
    conflicts: [],
    mergeRecommendation: "Coordinate with related task owners before merge.",
    createdAt: "2026-07-10T00:02:00.000Z",
  };
}

function makeProject(): TeamProject {
  return {
    teamId: "team_001",
    name: "Platform Team",
    repoUrl: "local:repo",
    syncMode: "local",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    settings: {
      syncIntervalSeconds: 60,
      contextFeedCompression: "standard",
      conflictDetectionLevel: "file",
      autoSyncOnTaskChange: false,
    },
  };
}

function makeMember(): TeamMember {
  return {
    memberId: "member_001",
    teamId: "team_001",
    displayName: "Local Owner",
    hubId: "hub_001",
    role: "owner",
    joinedAt: "2026-07-10T00:00:00.000Z",
    lastSeenAt: "2026-07-10T00:00:00.000Z",
    status: "active",
  };
}

function makeLocalHub(): LocalHubRegistration {
  return {
    hubId: "hub_001",
    teamId: "team_001",
    memberId: "member_001",
    agentgitopsVersion: "0.1.0",
    registeredAt: "2026-07-10T00:00:00.000Z",
    lastSyncAt: "2026-07-10T00:00:00.000Z",
    status: "connected",
  };
}

function makeSyncedTask(
  taskId: string,
  agentId: string,
  targetBranch: string,
  changedFiles: string[],
): SyncedTask {
  return {
    taskId,
    teamId: "team_001",
    projectId: "proj_demo",
    sourceHubId: "hub_001",
    ownerMemberId: "member_001",
    title: `Task ${taskId}`,
    objective: "Coordinate Team Sync changes",
    status: "running",
    agentId,
    baseBranch: "main",
    targetBranch,
    riskLevel: "medium",
    riskDomains: ["team-sync"],
    changedFiles,
    relatedTasks: taskId === "task-001" ? ["task-002"] : [],
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:01:00.000Z",
  };
}

function makeSyncedPackage(): SyncedChangePackage {
  return {
    packageId: "pkg_task-001",
    taskId: "task-001",
    teamId: "team_001",
    sourceHubId: "hub_001",
    summary: "Injected Team Sync PR context",
    changedFiles: ["src/app.ts"],
    riskLevel: "medium",
    riskDomains: ["team-sync"],
    verificationSummary: { passed: 1, failed: 0, skipped: 0 },
    createdAt: "2026-07-10T00:02:00.000Z",
    updatedAt: "2026-07-10T00:03:00.000Z",
  };
}

function makePendingEvent(): SyncEvent {
  return {
    eventId: "event_001",
    teamId: "team_001",
    hubId: "hub_001",
    actorId: "member_001",
    action: "change_package.created",
    resourceType: "change_package",
    resourceId: "pkg_task-001",
    idempotencyKey: "change_package.created:pkg_task-001",
    payload: { taskId: "task-001" },
    status: "pending",
    createdAt: "2026-07-10T00:04:00.000Z",
    updatedAt: "2026-07-10T00:04:00.000Z",
  };
}
