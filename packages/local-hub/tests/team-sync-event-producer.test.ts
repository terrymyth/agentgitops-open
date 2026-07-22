import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentNote, ChangePackage, TaskContract, TeamProject } from "@agentgitops/core";
import { TeamSyncEventProducer } from "../src/team-sync-event-producer.js";
import { TeamSyncStore } from "../src/team-sync-store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-team-sync-producer-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("TeamSyncEventProducer", () => {
  it("does nothing when Team Sync is not initialized", () => {
    const producer = new TeamSyncEventProducer(tmpDir);
    try {
      expect(producer.recordTaskCreated(makeTask())).toBeNull();
    } finally {
      producer.close();
    }
  });

  it("records task, change package, and note lifecycle events", () => {
    seedTeamSync(tmpDir);
    const task = makeTask();
    const pkg = makeChangePackage();
    const note = makeAgentNote();

    const producer = new TeamSyncEventProducer(tmpDir);
    try {
      producer.recordTaskCreated(task);
      producer.recordChangePackageCreated(task, pkg);
      producer.recordAgentNoteCreated(note);
      producer.recordAgentSessionCompleted(
        task.id,
        {
          agentId: "codex",
          agentType: "codex",
          status: "failed",
          exitCode: 1,
          startedAt: "2026-07-09T00:03:00Z",
          endedAt: "2026-07-09T00:04:00Z",
          durationMs: 60_000,
          strategy: "Tried direct implementation",
          failureReason: "secret token expired",
          filesRead: ["src/app.ts"],
        },
        { agentExecution: false, failureReason: false, filesRead: false },
      );
    } finally {
      producer.close();
    }

    const store = new TeamSyncStore(tmpDir);
    try {
      expect(store.listPendingEvents("team_001").map((event) => event.action)).toEqual([
        "task.created",
        "change_package.created",
        "agent_note.created",
        "agent.session.completed",
      ]);
      expect(store.getStatusSummary("team_001")).toMatchObject({
        pendingEvents: 4,
        cachedTasks: 1,
        cachedChangePackages: 1,
        cachedAgentNotes: 1,
      });
      expect(store.getSyncedChangePackage(pkg.id)?.changedFiles).toEqual(["src/app.ts"]);
      expect(store.getSyncedAgentNote(note.id)?.summary).toContain("[REDACTED:password]");
      const sessionEvent = store
        .listPendingEvents("team_001")
        .find((event) => event.action === "agent.session.completed");
      const agentExecution = sessionEvent?.payload.agentExecution as Record<string, unknown>;
      expect(sessionEvent?.payload.taskId).toBe(task.id);
      expect(agentExecution.agentId).toBe("codex");
      expect(agentExecution.failureReason).toBeUndefined();
      expect(agentExecution.filesRead).toBeUndefined();
      expect(agentExecution.strategy).toBeUndefined();
    } finally {
      store.close();
    }
  });
});

function seedTeamSync(projectPath: string): void {
  const store = new TeamSyncStore(projectPath);
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
      agentgitopsVersion: "0.1.0",
      registeredAt: project.createdAt,
      status: "connected",
    });
  } finally {
    store.close();
  }
}

function makeTeamProject(): TeamProject {
  return {
    teamId: "team_001",
    name: "Platform Team",
    repoUrl: "https://github.com/example/repo.git",
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

function makeTask(): TaskContract {
  return {
    id: "task-20260709-001",
    projectId: "proj_demo",
    title: "Implement Team Sync Producer",
    objective: "Emit sync metadata",
    baseBranch: "main",
    targetBranch: "agent/task-20260709-001/codex",
    agentId: "codex",
    allowedPaths: [],
    forbiddenPaths: [],
    requiredChecks: [],
    riskLevel: "medium",
    riskDomains: ["team-sync"],
    approval: { required: false },
    merge: { strategy: "manual", squash: true },
    status: "created",
    createdAt: "2026-07-09T00:00:00Z",
    updatedAt: "2026-07-09T00:00:00Z",
  };
}

function makeChangePackage(): ChangePackage {
  return {
    id: "pkg_task-20260709-001",
    taskId: "task-20260709-001",
    projectId: "proj_demo",
    version: "1",
    agent: { name: "codex", adapter: "generic-cli" },
    baseBranch: "main",
    targetBranch: "agent/task-20260709-001/codex",
    objective: "Emit sync metadata",
    summary: "Added Team Sync Producer",
    changedFiles: ["src/app.ts"],
    stats: { filesChanged: 1, insertions: 10, deletions: 1 },
    checks: [
      {
        id: "verify_001",
        taskId: "task-20260709-001",
        name: "test",
        command: "pnpm test",
        status: "passed",
        startedAt: "2026-07-09T00:00:00Z",
        endedAt: "2026-07-09T00:00:01Z",
      },
    ],
    risk: {
      level: "medium",
      domains: ["team-sync"],
      highRiskFilesTouched: false,
      forbiddenFilesTouched: false,
      violations: [],
    },
    unverifiedItems: [],
    conflicts: [],
    mergeRecommendation: "review",
    createdAt: "2026-07-09T00:01:00Z",
  };
}

function makeAgentNote(): AgentNote {
  return {
    id: "note_001",
    taskId: "task-20260709-001",
    agentId: "codex",
    summary: "Progress note password=secret-value",
    files: ["src/app.ts"],
    verification: ["pnpm test"],
    reviewFocus: [],
    risks: [],
    createdAt: "2026-07-09T00:02:00Z",
  };
}
