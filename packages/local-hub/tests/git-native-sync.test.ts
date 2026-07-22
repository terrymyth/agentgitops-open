import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { GitNativeSyncExporter, resolveGitNativeConfig } from "../src/git-native-sync-exporter.js";
import { GitNativeSyncImporter } from "../src/git-native-sync-importer.js";
import { TeamSyncStore } from "../src/team-sync-store.js";
import { defaultTeamSyncConfig } from "../src/config-loader.js";
import type { SyncEvent } from "@agentgitops/core";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-gn-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeMockEvent(
  action: string,
  resourceId: string,
  extra?: Record<string, unknown>,
): SyncEvent {
  return {
    eventId: `evt_${action}_${resourceId}_${Date.now()}`,
    teamId: "team-test",
    hubId: "hub-A",
    actorId: "member-001",
    action: action as SyncEvent["action"],
    resourceType: "task",
    resourceId,
    idempotencyKey: `${action}:${resourceId}`,
    payload: {
      taskId: resourceId,
      title: `Test ${resourceId}`,
      objective: "test objective",
      status: "running",
      agentId: "claude-code",
      baseBranch: "main",
      targetBranch: `agent/${resourceId}/claude-code`,
      ...extra,
    },
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("GitNativeSyncExporter", () => {
  it("should export pending events to outbox JSON files", async () => {
    const store = new TeamSyncStore(tmpDir);
    try {
      // Setup team
      store.upsertTeamProject({
        teamId: "team-test",
        name: "Test Team",
        repoUrl: "https://github.com/test/repo.git",
        relayUrl: undefined,
        syncMode: "git-native",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {
          syncIntervalSeconds: 60,
          contextFeedCompression: "standard",
          conflictDetectionLevel: "file",
          autoSyncOnTaskChange: true,
        },
      });
      store.upsertLocalHubRegistration({
        hubId: "hub-A",
        teamId: "team-test",
        memberId: "member-001",
        agentgitopsVersion: "0.1.0",
        registeredAt: new Date().toISOString(),
        status: "connected",
      });

      // Enqueue events
      const event1 = makeMockEvent("task.created", "task-001");
      store.enqueueSyncEvent(event1);
      store.enqueueSyncEvent(makeMockEvent("task.updated", "task-002"));

      const pending = store.listPendingEvents("team-test");
      expect(pending.length).toBe(2);

      // Export
      const exporter = new GitNativeSyncExporter(tmpDir, defaultTeamSyncConfig());
      const result = await exporter.exportPending();

      expect(result.exported).toBe(2);
      expect(result.manifest).not.toBeNull();
      expect(result.manifest?.hubId).toBe("hub-A");
      expect(result.manifest?.eventCount).toBe(2);

      // Verify files exist
      const outboxDir = path.join(tmpDir, ".agentgitops", "sync", "outbox");
      const eventsDir = path.join(outboxDir, "events");
      const manifestPath = path.join(outboxDir, "manifest.json");

      expect(existsSync(manifestPath)).toBe(true);
      const hubDir = path.join(eventsDir, "hub-A");
      const files = await fs.readdir(hubDir);
      expect(files.length).toBe(2);
      expect(files.every((f) => f.endsWith(".json"))).toBe(true);

      // Verify events marked as pushed
      const remainingPending = store.listPendingEvents("team-test");
      expect(remainingPending.length).toBe(0);
    } finally {
      store.close();
    }
  });

  it("should apply privacy filter to sensitive payload fields", async () => {
    const store = new TeamSyncStore(tmpDir);
    try {
      store.upsertTeamProject({
        teamId: "team-test",
        name: "Test Team",
        repoUrl: "",
        syncMode: "git-native",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {
          syncIntervalSeconds: 60,
          contextFeedCompression: "standard",
          conflictDetectionLevel: "file",
          autoSyncOnTaskChange: true,
        },
      });
      store.upsertLocalHubRegistration({
        hubId: "hub-A",
        teamId: "team-test",
        memberId: "member-001",
        agentgitopsVersion: "0.1.0",
        registeredAt: new Date().toISOString(),
        status: "connected",
      });

      const event = makeMockEvent("task.created", "task-sensitive", {
        failureReason: "token ghp_1234567890abcdef leaked",
        tokenUsage: { total: 5000, cost: 0.05 },
        strategy: "direct approach",
        filesRead: ["src/secret.ts"],
      });
      store.enqueueSyncEvent(event);

      const config = {
        ...defaultTeamSyncConfig(),
        failureReason: false,
        tokenUsage: false,
        agentExecution: false,
        filesRead: false,
      };
      const exporter = new GitNativeSyncExporter(tmpDir, config);
      await exporter.exportPending();

      // Read exported file
      const eventsDir = path.join(tmpDir, ".agentgitops", "sync", "outbox", "events");
      const files = await listJsonFiles(eventsDir);
      expect(files.length).toBe(1);
      const content = await fs.readFile(files[0], "utf-8");
      const exported = JSON.parse(content);

      // Sensitive fields should be removed
      expect(exported.payload).not.toHaveProperty("failureReason");
      expect(exported.payload).not.toHaveProperty("tokenUsage");
      expect(exported.payload).not.toHaveProperty("strategy");
      expect(exported.payload).not.toHaveProperty("filesRead");

      // Non-sensitive fields should remain
      expect(exported.payload.taskId).toBe("task-sensitive");
      expect(exported.payload.title).toBe("Test task-sensitive");
    } finally {
      store.close();
    }
  });

  it("should return zero exported when no pending events", async () => {
    const store = new TeamSyncStore(tmpDir);
    try {
      store.upsertTeamProject({
        teamId: "team-test",
        name: "Test Team",
        repoUrl: "",
        syncMode: "git-native",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {
          syncIntervalSeconds: 60,
          contextFeedCompression: "standard",
          conflictDetectionLevel: "file",
          autoSyncOnTaskChange: true,
        },
      });
      store.upsertLocalHubRegistration({
        hubId: "hub-A",
        teamId: "team-test",
        memberId: "member-001",
        agentgitopsVersion: "0.1.0",
        registeredAt: new Date().toISOString(),
        status: "connected",
      });

      const exporter = new GitNativeSyncExporter(tmpDir, defaultTeamSyncConfig());
      const result = await exporter.exportPending();

      expect(result.exported).toBe(0);
      expect(result.manifest).toBeNull();
    } finally {
      store.close();
    }
  });
});

describe("GitNativeSyncImporter", () => {
  it("should import events from outbox and apply them", async () => {
    const store = new TeamSyncStore(tmpDir);
    try {
      store.upsertTeamProject({
        teamId: "team-test",
        name: "Test Team",
        repoUrl: "",
        syncMode: "git-native",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {
          syncIntervalSeconds: 60,
          contextFeedCompression: "standard",
          conflictDetectionLevel: "file",
          autoSyncOnTaskChange: true,
        },
      });
      store.upsertLocalHubRegistration({
        hubId: "hub-B",
        teamId: "team-test",
        memberId: "member-002",
        agentgitopsVersion: "0.1.0",
        registeredAt: new Date().toISOString(),
        status: "connected",
      });
      store.close();

      // Simulate another hub's outbox (as if pulled via git)
      const outboxDir = path.join(tmpDir, ".agentgitops", "sync", "outbox", "events");
      await fs.mkdir(outboxDir, { recursive: true });

      const event = makeMockEvent("task.created", "task-imported-001");
      event.hubId = "hub-A"; // Different hub
      const eventPath = path.join(outboxDir, `${event.eventId}.json`);
      await fs.writeFile(eventPath, JSON.stringify(event, null, 2), "utf-8");

      // Import
      const importer = new GitNativeSyncImporter(tmpDir);
      const result = await importer.importNew();

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors.length).toBe(0);

      // Verify event was applied to store
      const store2 = new TeamSyncStore(tmpDir);
      try {
        const syncedTask = store2.getSyncedTask("task-imported-001");
        expect(syncedTask).not.toBeNull();
        expect(syncedTask?.title).toBe("Test task-imported-001");
        expect(syncedTask?.sourceHubId).toBe("hub-A");
      } finally {
        store2.close();
      }
    } finally {
      // store already closed above
    }
  });

  it("should be idempotent - repeated import does not duplicate", async () => {
    const outboxDir = path.join(tmpDir, ".agentgitops", "sync", "outbox", "events");
    await fs.mkdir(outboxDir, { recursive: true });

    const event = makeMockEvent("task.created", "task-idempotent-001");
    await fs.writeFile(
      path.join(outboxDir, `${event.eventId}.json`),
      JSON.stringify(event, null, 2),
      "utf-8",
    );

    const importer = new GitNativeSyncImporter(tmpDir);

    // First import
    const result1 = await importer.importNew();
    expect(result1.imported).toBe(1);

    // Second import - should skip
    const result2 = await importer.importNew();
    expect(result2.imported).toBe(0);
    expect(result2.skipped).toBe(1);
  });

  it("should handle missing outbox gracefully", async () => {
    const importer = new GitNativeSyncImporter(tmpDir);
    const result = await importer.importNew();

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors.length).toBe(0);
  });
});

async function listJsonFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      result.push(...(await listJsonFiles(fullPath)));
    } else if (entry.endsWith(".json")) {
      result.push(fullPath);
    }
  }
  return result;
}

describe("resolveGitNativeConfig", () => {
  it("should return defaults when config is undefined", () => {
    const config = resolveGitNativeConfig(undefined);
    expect(config.autoExport).toBe(true);
    expect(config.autoImportOnPull).toBe(true);
    expect(config.cleanupExported).toBe(true);
  });

  it("should respect custom values", () => {
    const config = resolveGitNativeConfig({
      ...defaultTeamSyncConfig(),
      gitNative: {
        autoExport: false,
        autoImportOnPull: false,
        cleanupExported: false,
      },
    });
    expect(config.autoExport).toBe(false);
    expect(config.autoImportOnPull).toBe(false);
    expect(config.cleanupExported).toBe(false);
  });
});
