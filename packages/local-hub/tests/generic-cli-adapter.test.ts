import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TaskContract } from "@agentgitops/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAgentEnvironment, createAgentAdapter, GenericCliAdapter } from "../src/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentgitops-adapter-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("GenericCliAdapter environment handling", () => {
  it("creates dedicated adapters for supported agent runtimes", () => {
    expect(createAgentAdapter("claude-code").type).toBe("claude-code");
    expect(createAgentAdapter("codex").type).toBe("codex");
    expect(createAgentAdapter("opencode").type).toBe("opencode");
    expect(createAgentAdapter("unknown").type).toBe("generic-cli");
  });

  it("runs dedicated adapters through the unified factory while preserving explicit args", async () => {
    const result = await createAgentAdapter("codex").run({
      taskContract: createTaskContract(),
      workspacePath: tmpDir,
      command: process.execPath,
      args: ["-e", "console.log('codex adapter ok')"],
      logRoot: tmpDir,
    });

    expect(result.status).toBe("completed");
    expect(result.executionSummary).toMatchObject({
      agentId: "generic",
      status: "completed",
      exitCode: 0,
    });
    const stdout = await fs.readFile(path.join(result.logDir, "agent-stdout.log"), "utf-8");
    expect(stdout).toContain("codex adapter ok");
  });

  it("keeps only safe base environment variables", () => {
    const env = buildAgentEnvironment({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      LANG: "en_US.UTF-8",
      GITHUB_TOKEN: "ghp_secret",
      GH_TOKEN: "gh_secret",
      GITLAB_TOKEN: "gl_secret",
      AGENTGITOPS_GITHUB_WEBHOOK_SECRET: "webhook_secret",
      DATABASE_URL: "postgres://secret",
    });

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      LANG: "en_US.UTF-8",
    });
  });

  it("allows explicit non-sensitive agent env and blocks provider tokens", () => {
    const env = buildAgentEnvironment(
      { PATH: "/usr/bin" },
      {
        AGENT_MODE: "review",
        GITHUB_TOKEN: "must-not-leak",
        GITEA_TOKEN: "must-not-leak",
      },
    );

    expect(env).toEqual({
      PATH: "/usr/bin",
      AGENT_MODE: "review",
    });
  });

  it("blocks forbidden agent commands before running them", async () => {
    await expect(
      new GenericCliAdapter().run({
        taskContract: {
          id: "task-1",
          projectId: "demo",
          title: "Task",
          objective: "Objective",
          baseBranch: "main",
          targetBranch: "agent/task-1/generic",
          agentId: "generic",
          allowedPaths: [],
          forbiddenPaths: [],
          requiredChecks: [],
          riskLevel: "low",
          approval: { required: false },
          merge: { strategy: "manual", squash: true },
          status: "running",
          createdAt: "2026-07-06T00:00:00.000Z",
          updatedAt: "2026-07-06T00:00:00.000Z",
        },
        workspacePath: process.cwd(),
        command: "node",
        args: ["-e", "console.log('nope')"],
        policies: { commands: { forbidden: ["node"] } },
        logRoot: tmpDir,
      }),
    ).resolves.toMatchObject({
      exitCode: 1,
      status: "failed",
      executionSummary: {
        status: "failed",
      },
    });
  });
});

function createTaskContract(): TaskContract {
  return {
    id: "task-1",
    projectId: "demo",
    title: "Task",
    objective: "Objective",
    baseBranch: "main",
    targetBranch: "agent/task-1/generic",
    agentId: "generic",
    allowedPaths: [],
    forbiddenPaths: [],
    requiredChecks: [],
    riskLevel: "low",
    approval: { required: false },
    merge: { strategy: "manual", squash: true },
    status: "running",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
  };
}
