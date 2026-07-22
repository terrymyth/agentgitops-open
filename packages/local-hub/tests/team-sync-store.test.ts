import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  BranchAdoption,
  HandoffPackage,
  SyncEvent,
  SyncedTask,
  TeamProject,
} from "@agentgitops/core";
import { TeamSyncStore } from "../src/team-sync-store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-team-sync-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("TeamSyncStore", () => {
  it("returns an empty status for projects without Team Sync configuration", () => {
    const store = new TeamSyncStore(tmpDir);
    try {
      const status = store.getStatusSummary();
      expect(status.team).toBeUndefined();
      expect(status.pendingEvents).toBe(0);
      expect(status.cachedTasks).toBe(0);
    } finally {
      store.close();
    }
  });

  it("persists team state, cursors, and cached tasks", () => {
    const store = new TeamSyncStore(tmpDir);
    try {
      const project = makeTeamProject();
      store.upsertTeamProject(project);
      store.upsertTeamMember({
        memberId: "member_001",
        teamId: project.teamId,
        displayName: "Terry",
        hubId: "hub_001",
        role: "owner",
        joinedAt: project.createdAt,
        lastSeenAt: project.updatedAt,
        status: "active",
      });
      store.upsertLocalHubRegistration({
        hubId: "hub_001",
        teamId: project.teamId,
        memberId: "member_001",
        machineFingerprint: "fingerprint",
        agentType: "codex",
        agentgitopsVersion: "0.1.0",
        registeredAt: project.createdAt,
        status: "connected",
      });
      store.setSyncCursor({
        teamId: project.teamId,
        hubId: "hub_001",
        direction: "push",
        cursor: "cursor_001",
        eventId: "sync_001",
        updatedAt: project.updatedAt,
      });
      store.upsertSyncedTask(makeSyncedTask());

      const status = store.getStatusSummary(project.teamId);
      expect(status.team?.name).toBe("Platform Team");
      expect(status.localHub?.hubId).toBe("hub_001");
      expect(status.members).toBe(1);
      expect(status.cachedTasks).toBe(1);
      expect(status.lastPushCursor?.cursor).toBe("cursor_001");
    } finally {
      store.close();
    }
  });

  it("deduplicates sync events by event id and idempotency key", () => {
    const store = new TeamSyncStore(tmpDir);
    try {
      const project = makeTeamProject();
      store.upsertTeamProject(project);
      const event = makeSyncEvent();

      store.enqueueSyncEvent(event);
      store.enqueueSyncEvent(event);
      store.enqueueSyncEvent({ ...event, eventId: "sync_duplicate" });

      const pending = store.listPendingEvents(project.teamId);
      expect(pending).toHaveLength(1);
      expect(pending[0].eventId).toBe("sync_001");
    } finally {
      store.close();
    }
  });

  it("persists handoff packages and active branch adoptions", () => {
    const store = new TeamSyncStore(tmpDir);
    try {
      const project = makeTeamProject();
      store.upsertTeamProject(project);
      store.upsertHandoffPackage(makeHandoffPackage());
      store.upsertBranchAdoption(makeBranchAdoption());

      const status = store.getStatusSummary(project.teamId);
      expect(status.handoffPackages).toBe(1);
      expect(status.activeAdoptions).toBe(1);
      expect(store.listHandoffPackages(project.teamId, "task-20260709-001")[0].summary).toContain(
        "Adopt",
      );
      expect(store.getActiveBranchAdoption(project.teamId, "task-20260709-001")?.adoptedBy).toBe(
        "member_002",
      );
    } finally {
      store.close();
    }
  });
});

function makeTeamProject(): TeamProject {
  return {
    teamId: "team_001",
    name: "Platform Team",
    repoUrl: "https://github.com/example/repo.git",
    syncMode: "local",
    teamSecretHash: "hash",
    createdAt: "2026-07-09T00:00:00Z",
    updatedAt: "2026-07-09T00:01:00Z",
    settings: {
      syncIntervalSeconds: 60,
      contextFeedCompression: "standard",
      conflictDetectionLevel: "file",
      autoSyncOnTaskChange: false,
    },
  };
}

function makeSyncEvent(): SyncEvent {
  return {
    eventId: "sync_001",
    teamId: "team_001",
    hubId: "hub_001",
    actorId: "member_001",
    action: "team.initialized",
    resourceType: "team",
    resourceId: "team_001",
    idempotencyKey: "team.initialized:team_001:hub_001",
    payload: { name: "Platform Team" },
    status: "pending",
    createdAt: "2026-07-09T00:00:00Z",
    updatedAt: "2026-07-09T00:00:00Z",
  };
}

function makeSyncedTask(): SyncedTask {
  return {
    taskId: "task-20260709-001",
    teamId: "team_001",
    projectId: "proj_demo",
    sourceHubId: "hub_001",
    ownerMemberId: "member_001",
    title: "Implement Team Sync Store",
    objective: "Persist local Team Sync state",
    status: "running",
    agentId: "codex",
    baseBranch: "main",
    targetBranch: "agent/team-sync-store",
    riskLevel: "medium",
    riskDomains: ["storage"],
    changedFiles: ["packages/local-hub/src/team-sync-store.ts"],
    relatedTasks: [],
    createdAt: "2026-07-09T00:00:00Z",
    updatedAt: "2026-07-09T00:01:00Z",
  };
}

function makeHandoffPackage(): HandoffPackage {
  return {
    handoffId: "handoff_001",
    type: "adopt",
    teamId: "team_001",
    sourceTaskId: "task-20260709-001",
    sourceBranch: "agent/team-sync-store",
    createdBy: "member_002",
    createdAt: "2026-07-09T00:02:00Z",
    summary: "Adopt task-20260709-001",
    remainingWork: ["Run verification"],
    knownRisks: ["Medium risk"],
    contextFeedId: "feed_001",
  };
}

function makeBranchAdoption(): BranchAdoption {
  return {
    adoptionId: "adopt_001",
    teamId: "team_001",
    taskId: "task-20260709-001",
    sourceBranch: "agent/team-sync-store",
    adoptedBy: "member_002",
    previousOwner: "member_001",
    status: "active",
    createdAt: "2026-07-09T00:02:00Z",
    updatedAt: "2026-07-09T00:02:00Z",
  };
}
