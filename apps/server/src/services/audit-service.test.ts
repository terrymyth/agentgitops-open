import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AuditEvent } from "@agentgitops/core";
import { ConfigLoader, createExtensionRegistry } from "@agentgitops/local-hub";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditService } from "./audit-service.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentgitops-audit-service-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("AuditService", () => {
  it("records and filters local audit events", async () => {
    const config = ConfigLoader.generateDefault("audit-test");
    const service = new AuditService(tmpDir, config);

    await service.record("task.created", { taskId: "task-1" }, "task-1", "owner");
    await service.record("review.submitted", { action: "approve" }, "task-1", "reviewer");

    const reviews = await service.list({ taskId: "task-1", eventType: "review.submitted" });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      projectId: "audit-test",
      taskId: "task-1",
      actorId: "reviewer",
      eventType: "review.submitted",
      payload: { action: "approve" },
    });
  });

  it("delegates to extension audit sinks when present", async () => {
    const config = ConfigLoader.generateDefault("audit-test");
    const events: AuditEvent[] = [];
    const service = new AuditService(
      tmpDir,
      config,
      createExtensionRegistry({
        auditSink: {
          append: (event) => {
            events.push(event);
          },
          list: () => events,
        },
      }),
    );

    await service.record("security.event", { source: "sink" }, undefined, "owner");

    expect(events).toHaveLength(1);
    expect(await service.list({ eventType: "security.event" })).toHaveLength(1);
  });
});
