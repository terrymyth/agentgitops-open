import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SyncedAgentNote, SyncedTask, TeamProject } from "@agentgitops/core";
import { HandoffPackageBuilder } from "../src/handoff-package-builder.js";
import { TeamSyncStore } from "../src/team-sync-store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-handoff-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("HandoffPackageBuilder", () => {
  it("builds and writes redacted handoff packages with context feed", async () => {
    seedHandoffData(tmpDir);
    const builder = new HandoffPackageBuilder(tmpDir);
    try {
      const written = await builder.write(
        await builder.build({
          type: "adopt",
          sourceTaskId: "task-001",
          createdBy: "member_002",
          remainingWork: ["Continue from password=secret-value"],
        }),
      );

      expect(written.handoff.type).toBe("adopt");
      expect(written.handoff.contextFeedId).toBe(written.contextFeed.feedId);
      expect(written.handoff.recommendedNextSteps?.length).toBeGreaterThan(0);
      expect(written.markdown).toContain("Recommended Next Steps");
      expect(written.markdown).toContain("Agent Context Feed");
      expect(written.markdown).toContain("[REDACTED:password]");
      expect(written.markdown).not.toContain("secret-value");
      expect(await fileExists(written.jsonPath)).toBe(true);
      expect(await fileExists(written.markdownPath)).toBe(true);
    } finally {
      builder.close();
    }
  });
});

function seedHandoffData(projectPath: string): void {
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
    store.upsertSyncedTask(makeTask());
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

function makeTask(): SyncedTask {
  return {
    taskId: "task-001",
    teamId: "team_001",
    projectId: "proj_demo",
    sourceHubId: "hub_001",
    ownerMemberId: "member_001",
    title: "Implement adoption",
    objective: "Make handoff testable",
    status: "running",
    agentId: "codex",
    baseBranch: "main",
    targetBranch: "agent/task-001/codex",
    riskLevel: "medium",
    riskDomains: ["team-sync"],
    changedFiles: ["src/app.ts"],
    relatedTasks: [],
    createdAt: "2026-07-10T00:00:00Z",
    updatedAt: "2026-07-10T00:01:00Z",
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
    summary: "Ready for handoff",
    files: ["src/app.ts"],
    createdAt: "2026-07-10T00:02:00Z",
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
