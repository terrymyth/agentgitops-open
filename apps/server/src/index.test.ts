import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChangePackage, EnterpriseUser } from "@agentgitops/core";
import { CONFIG_DIR } from "@agentgitops/core";
import {
  ConfigLoader,
  LocalDb,
  TaskManager,
  createExtensionRegistry,
} from "@agentgitops/local-hub";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyConflictAction,
  buildAgentOpsMetrics,
  buildReviewContext,
  buildRuntimeProjectList,
  createAgentGitOpsServer,
  resolveEnterpriseAuthorizationTarget,
  verifyGitHubSignature,
} from "./index.js";

const fixturePaths = new Set<string>();

afterEach(async () => {
  const paths = [...fixturePaths];
  fixturePaths.clear();
  await Promise.all(
    paths.map((fixturePath) =>
      fs.rm(fixturePath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    ),
  );
});

describe("GitHub webhook signature", () => {
  it("validates sha256 signatures", () => {
    const secret = "webhook-secret";
    const body = JSON.stringify({ action: "opened" });
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    expect(verifyGitHubSignature(secret, body, signature)).toBe(true);
    expect(verifyGitHubSignature(secret, body, "sha256=bad")).toBe(false);
  });
});

describe("governance API", () => {
  it("maps enterprise API routes to RBAC resources and actions", () => {
    expect(resolveEnterpriseAuthorizationTarget("/api/tasks", "POST")).toEqual({
      resource: "task",
      action: "create",
    });
    expect(resolveEnterpriseAuthorizationTarget("/api/tasks/task-1/run", "POST")).toEqual({
      resource: "task",
      action: "run",
    });
    expect(resolveEnterpriseAuthorizationTarget("/api/tasks/task-1/test", "POST")).toEqual({
      resource: "task",
      action: "test",
    });
    expect(resolveEnterpriseAuthorizationTarget("/api/tasks/task-1/package", "POST")).toEqual({
      resource: "change_package",
      action: "package",
    });
    expect(resolveEnterpriseAuthorizationTarget("/api/merge-queue/task-1/approve", "POST")).toEqual(
      { resource: "merge", action: "approve" },
    );
    expect(
      resolveEnterpriseAuthorizationTarget("/api/conflicts/conflict-1/human-takeover", "POST"),
    ).toEqual({ resource: "conflict", action: "human_takeover" });
    expect(resolveEnterpriseAuthorizationTarget("/api/audit", "GET")).toEqual({
      resource: "audit",
      action: "read",
    });
  });

  it("enforces enterprise bearer authentication and RBAC before handlers", async () => {
    const { projectPath } = await createProjectFixture();
    const viewer: EnterpriseUser = {
      userId: "viewer-1",
      username: "viewer-1",
      displayName: "Viewer",
      groups: [],
      roles: ["viewer"],
    };
    const registry = createExtensionRegistry({
      identityProvider: {
        authenticate: (token) => (token === "valid-token" ? viewer : null),
        getCurrentUser: () => null,
      },
      authorizationProvider: {
        checkPermission: ({ action }) => ({
          allowed: action === "read",
          reason: "read-only account",
        }),
        getUserRoles: () => ["viewer"],
      },
    });
    const server = createAgentGitOpsServer({ projectPath, extensionRegistry: registry });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server address unavailable");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const missing = await fetch(`${baseUrl}/api/tasks`);
      expect(missing.status).toBe(401);

      const allowed = await fetch(`${baseUrl}/api/tasks`, {
        headers: { authorization: "Bearer valid-token" },
      });
      expect(allowed.status).toBe(200);

      const actor = await fetch(`${baseUrl}/api/actor`, {
        headers: {
          authorization: "Bearer valid-token",
          "x-agentgitops-actor": "spoofed-owner",
        },
      });
      expect(await actor.json()).toMatchObject({
        data: { id: "viewer-1", role: "viewer" },
      });

      const denied = await fetch(`${baseUrl}/api/tasks`, {
        method: "POST",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        body: JSON.stringify({ title: "must not be created" }),
      });
      expect(denied.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("marks the current runtime project and disables conflicting project ports", () => {
    const projects = [
      {
        id: "proj_agentgitops",
        name: "agentgitops",
        path: "/repo/agentgitops",
        serverPort: 4319,
        status: "active" as const,
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
      },
      {
        id: "proj_kateagent",
        name: "kateagent",
        path: "/repo/kateagent",
        serverPort: 4789,
        status: "active" as const,
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
      },
    ];

    const result = buildRuntimeProjectList(projects, "/repo/agentgitops", "127.0.0.1:4789");
    const current = result.projects.find((project) => project.id === "proj_agentgitops");
    const conflicting = result.projects.find((project) => project.id === "proj_kateagent");

    expect(result.currentProjectId).toBe("proj_agentgitops");
    expect(result.currentPort).toBe(4789);
    expect(current?.isCurrent).toBe(true);
    expect(current?.runtimePort).toBe(4789);
    expect(current?.openUrl).toBe("http://127.0.0.1:4789");
    expect(conflicting?.isPortConflict).toBe(true);
    expect(conflicting?.openUrl).toBeUndefined();
  });

  it("applies conflict resolution actions without provider side effects", () => {
    const conflict = {
      id: "conflict_1",
      type: "api_contract",
      conflictingTaskId: "task-other",
      filePath: "src/api/users.ts",
      severity: "high",
      suggestion: "human_takeover",
      status: "open",
    } as const;

    const resolved = { ...conflict };
    applyConflictAction(resolved, "resolve");
    expect(resolved.status).toBe("resolved");

    const falsePositive = { ...conflict };
    applyConflictAction(falsePositive, "false-positive");
    expect(falsePositive.status).toBe("resolved");
    expect(falsePositive.suggestion).toBe("mark_false_positive");

    const rebase = { ...conflict };
    applyConflictAction(rebase, "rebase");
    expect(rebase.status).toBe("resolved");
    expect(rebase.suggestion).toBe("rebase");

    const failedRebase = { ...conflict };
    applyConflictAction(failedRebase, "rebase", false);
    expect(failedRebase.status).toBe("open");
    expect(failedRebase.suggestion).toBe("rebase");
  });

  it("evaluates merge gates and exposes AgentOps metrics", async () => {
    const { projectPath, taskId } = await createProjectFixture();
    expect(taskId).toMatch(/^task-/);

    const metrics = await buildAgentOpsMetrics(projectPath);
    expect(metrics.mergeGate.queued).toBe(1);
    expect(metrics.mergeGate.blocked).toBe(1);
    expect(metrics.history.length).toBeGreaterThan(0);
    expect(metrics.history[0].metrics.mergeGate.queued).toBe(1);

    const second = await buildAgentOpsMetrics(projectPath);
    expect(second.history.length).toBe(metrics.history.length);
  });

  it("builds review-agent context from package, notes, and audit", async () => {
    const { projectPath, taskId } = await createProjectFixture();
    const db = new LocalDb(projectPath);
    try {
      db.insertAgentNote({
        id: "note_test",
        taskId,
        agentId: "codex",
        summary: "Implemented server-side review context",
        files: ["apps/server/src/index.ts"],
        verification: ["pnpm test"],
        reviewFocus: ["checklist blockers"],
        risks: ["none"],
      });
    } finally {
      db.close();
    }

    const context = await buildReviewContext(projectPath, taskId);
    expect(context.task.id).toBe(taskId);
    expect(context.changePackage?.id).toBe(`pkg_${taskId}`);
    expect(context.agentNotes[0].summary).toContain("review context");
    expect(context.summary.openConflicts).toBe(1);
    expect(context.checklist.some((item) => item.severity === "blocker")).toBe(true);
  });
});

async function createProjectFixture(): Promise<{ projectPath: string; taskId: string }> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentgitops-server-"));
  fixturePaths.add(projectPath);
  await ConfigLoader.init(projectPath, "server-test", { force: true });
  const task = await new TaskManager(projectPath).create({
    projectName: "server-test",
    title: "Test merge",
    objective: "Exercise governance API",
    agentName: "tester",
    riskLevel: "medium",
  });
  await new TaskManager(projectPath).updateStatus(task.id, "reviewing");

  const pkg: ChangePackage = {
    id: `pkg_${task.id}`,
    taskId: task.id,
    projectId: "server-test",
    version: "1",
    agent: { name: "tester", adapter: "generic-cli" },
    baseBranch: "main",
    targetBranch: task.targetBranch,
    objective: task.objective,
    summary: "Test package",
    changedFiles: ["src/api/users.ts"],
    stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    checks: [],
    risk: {
      level: "medium",
      domains: ["api"],
      highRiskFilesTouched: false,
      forbiddenFilesTouched: false,
      violations: [],
    },
    unverifiedItems: [],
    conflicts: [
      {
        id: "conflict_1",
        type: "api_contract",
        conflictingTaskId: "task-other",
        filePath: "src/api/users.ts",
        severity: "high",
        suggestion: "human_takeover",
        status: "open",
      },
    ],
    mergeRecommendation: "Resolve conflicts before merge",
    createdAt: new Date().toISOString(),
  };
  const packagesDir = path.join(projectPath, CONFIG_DIR, "packages");
  await fs.mkdir(packagesDir, { recursive: true });
  await fs.writeFile(path.join(packagesDir, `${task.id}.json`), JSON.stringify(pkg, null, 2));
  return { projectPath, taskId: task.id };
}
