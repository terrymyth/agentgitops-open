import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SyncEvent, TeamProject } from "@agentgitops/core";
import { TeamSyncStore } from "@agentgitops/local-hub";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signTeamSyncRequest, TeamSyncService } from "./team-sync-service.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentgitops-team-sync-service-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("TeamSyncService", () => {
  it("accepts signed pushes, applies metadata, and serves cursor-based pulls", () => {
    seedRelayTeam(tmpDir);
    const service = new TeamSyncService(tmpDir);
    const event = makeTaskEvent();
    const headers = signedHeaders("hub_a");

    const pushed = service.push({ teamId: "team_001", hubId: "hub_a", events: [event] }, headers);
    expect(pushed.accepted).toBe(1);
    expect(pushed.applied).toBe(1);
    expect(pushed.cursor).toBeTruthy();

    const duplicated = service.push(
      { teamId: "team_001", hubId: "hub_a", events: [event] },
      headers,
    );
    expect(duplicated.accepted).toBe(0);
    expect(duplicated.duplicated).toBe(1);

    const store = new TeamSyncStore(tmpDir);
    try {
      expect(store.getSyncedTask("task-001")?.title).toBe("Relay task");
      expect(store.getSyncEvent("sync_001")?.payload).not.toHaveProperty("prompt");
    } finally {
      store.close();
    }

    const pulled = service.pull({ teamId: "team_001", hubId: "hub_b" }, signedHeaders("hub_b"));
    expect(pulled.events.map((item) => item.eventId)).toEqual(["sync_001"]);
    expect(pulled.cursor).toBeTruthy();

    const empty = service.pull(
      { teamId: "team_001", hubId: "hub_b", cursor: pulled.cursor },
      signedHeaders("hub_b"),
    );
    expect(empty.events).toHaveLength(0);
  });

  it("rejects invalid signatures", () => {
    seedRelayTeam(tmpDir);
    const service = new TeamSyncService(tmpDir);

    expect(() =>
      service.push(
        {
          teamId: "team_001",
          hubId: "hub_a",
          events: [makeTaskEvent()],
        },
        {
          "x-agentgitops-timestamp": "2026-07-10T00:00:00.000Z",
          "x-agentgitops-signature": "bad",
        },
      ),
    ).toThrow("Invalid Team Sync signature.");
  });
});

function seedRelayTeam(projectPath: string): void {
  const store = new TeamSyncStore(projectPath);
  try {
    store.upsertTeamProject(makeProject());
  } finally {
    store.close();
  }
}

function signedHeaders(hubId: string): Record<string, string> {
  const timestamp = "2026-07-10T00:00:00.000Z";
  return {
    "x-agentgitops-timestamp": timestamp,
    "x-agentgitops-signature": signTeamSyncRequest({
      teamSecretHash: hashSecret("secret"),
      teamId: "team_001",
      hubId,
      timestamp,
    }),
  };
}

function makeProject(): TeamProject {
  return {
    teamId: "team_001",
    name: "Relay Team",
    repoUrl: "local:repo",
    syncMode: "relay",
    teamSecretHash: hashSecret("secret"),
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

function makeTaskEvent(): SyncEvent {
  return {
    eventId: "sync_001",
    teamId: "team_001",
    hubId: "hub_a",
    actorId: "member_a",
    action: "task.created",
    resourceType: "task",
    resourceId: "task-001",
    idempotencyKey: "task.created:task-001",
    payload: {
      taskId: "task-001",
      projectId: "proj_demo",
      title: "Relay task",
      objective: "Share task metadata",
      status: "created",
      agentId: "codex",
      baseBranch: "main",
      targetBranch: "agent/task-001/codex",
      riskLevel: "low",
      prompt: "must not be stored",
    },
    status: "pending",
    createdAt: "2026-07-10T00:01:00.000Z",
    updatedAt: "2026-07-10T00:01:00.000Z",
  };
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
