import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TaskContract } from "@agentgitops/core";
import { VerificationGate, summarizeVerificationOutput } from "../src/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentgitops-verification-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("VerificationGate", () => {
  it("runs quoted cross-platform commands and summarizes output", async () => {
    const [run] = await new VerificationGate(tmpDir).run(taskContract(), tmpDir, [
      {
        kind: "command",
        name: "vitest sample",
        command: "node -e \"console.log('Tests 3 passed'); console.error('1 warning')\"",
      },
    ]);

    expect(run.status).toBe("passed");
    expect(run.outputSummary).toMatchObject({ warnings: 1, testsPassed: 3 });
    expect(run.outputPath).toBeTruthy();
  });

  it("blocks forbidden verification commands before execution", async () => {
    const [run] = await new VerificationGate(tmpDir, {
      commands: { forbidden: ["node"] },
    }).run(taskContract(), tmpDir, [
      { kind: "command", name: "danger", command: "node -e \"console.log('nope')\"" },
    ]);

    expect(run.status).toBe("failed");
    expect(run.exitCode).toBe(126);
    expect(run.outputSummary?.errors).toBeGreaterThan(0);
  });

  it("summarizes common verification output signals", () => {
    expect(summarizeVerificationOutput("Tests 10 passed\nTests 2 failed\n3 warnings")).toEqual({
      errors: 1,
      warnings: 1,
      testsPassed: 10,
      testsFailed: 2,
      testsSkipped: undefined,
    });
  });
});

function taskContract(): TaskContract {
  return {
    id: "task-1",
    projectId: "demo",
    title: "Task",
    objective: "Task objective",
    baseBranch: "main",
    targetBranch: "agent/task-1/codex",
    agentId: "codex",
    allowedPaths: [],
    forbiddenPaths: [],
    requiredChecks: [],
    riskLevel: "low",
    approval: { required: false },
    merge: { strategy: "manual", squash: true },
    status: "testing",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
  };
}
