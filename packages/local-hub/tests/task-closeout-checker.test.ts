import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { TaskCloseoutChecker, TaskManager, type AgentgitopsConfig } from "../src/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-closeout-"));
  await execa("git", ["init"], { cwd: tmpDir });
  await execa("git", ["checkout", "-b", "main"], { cwd: tmpDir });
  await execa("git", ["config", "user.name", "AgentGitOps Test"], { cwd: tmpDir });
  await execa("git", ["config", "user.email", "agentgitops-test@example.com"], { cwd: tmpDir });
  await execa("git", ["remote", "add", "origin", "https://example.com/acme/repo.git"], {
    cwd: tmpDir,
  });
  await fs.writeFile(path.join(tmpDir, "README.md"), "# test\n", "utf-8");
  await execa("git", ["add", "README.md"], { cwd: tmpDir });
  await execa("git", ["commit", "-m", "init"], { cwd: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("TaskCloseoutChecker", () => {
  it("reports an error when the task does not exist", async () => {
    const report = await new TaskCloseoutChecker(tmpDir, testConfig()).check("task-missing");

    expect(report.summary.error).toBe(1);
    expect(report.summary.readyForHandoff).toBe(false);
    expect(report.checks[0]).toMatchObject({ name: "task", status: "error" });
  });

  it("detects local-only task snapshots, outbox files, and missing remote branch", async () => {
    const task = await new TaskManager(tmpDir).create({
      taskId: "task-20260713-001",
      projectName: "repo",
      title: "Closeout diagnostics",
      agentName: "generic",
      baseBranch: "main",
    });
    await fs.mkdir(path.join(tmpDir, ".agentgitops", "sync", "outbox", "events"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, ".agentgitops", "sync", "outbox", "events", "sync_test.json"),
      JSON.stringify({ schemaVersion: 1, event: { eventId: "sync_test" } }, null, 2),
      "utf-8",
    );

    const report = await new TaskCloseoutChecker(tmpDir, testConfig()).check(task.id);
    const byName = new Map(report.checks.map((check) => [check.name, check]));

    expect(byName.get("task-snapshot")?.status).toBe("error");
    expect(byName.get("sync-outbox")?.status).toBe("error");
    expect(byName.get("remote-head")?.status).toBe("error");
    expect(report.summary.readyForHandoff).toBe(false);
  });

  it("writes a portable CloseoutRecord for the report", async () => {
    const task = await new TaskManager(tmpDir).create({
      taskId: "task-20260713-002",
      projectName: "repo",
      title: "Record closeout",
      agentName: "generic",
      baseBranch: "main",
    });
    const checker = new TaskCloseoutChecker(tmpDir, testConfig());
    const report = await checker.check(task.id);

    const result = await checker.writeRecord(report);
    const content = JSON.parse(await fs.readFile(result.path, "utf-8")) as {
      schemaVersion: number;
      taskId: string;
      status: string;
      summary: { readyForHandoff: boolean };
      checks: Array<{ name: string }>;
    };

    expect(result.path).toContain(path.join(".agentgitops", "closeouts", task.id));
    expect(content.schemaVersion).toBe(1);
    expect(content.taskId).toBe(task.id);
    expect(content.status).toBe("blocked");
    expect(content.summary.readyForHandoff).toBe(false);
    expect(content.checks.map((check) => check.name)).toContain("remote-head");
  });

  it("accepts committed markdown handoff documents for a task", async () => {
    const task = await new TaskManager(tmpDir).create({
      taskId: "task-20260713-003",
      projectName: "repo",
      title: "Markdown handoff",
      agentName: "generic",
      baseBranch: "main",
    });
    await fs.mkdir(path.join(tmpDir, ".agentgitops", "handoffs"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".agentgitops", "handoffs", `${task.id}-continue.md`),
      `# Handoff Package: ${task.id}\n\nTask ${task.id} is ready.\n`,
      "utf-8",
    );
    await execa("git", ["add", ".agentgitops"], { cwd: tmpDir });
    await execa("git", ["commit", "-m", "task artifacts"], { cwd: tmpDir });

    const report = await new TaskCloseoutChecker(tmpDir, testConfig()).check(task.id);
    const handoff = report.checks.find((check) => check.name === "handoff");

    expect(handoff).toMatchObject({ name: "handoff", status: "ok" });
    expect(handoff?.detail).toContain(`${task.id}-continue.md`);
  });

  it("uses committed Change Package checks as cross-machine verification evidence", async () => {
    const task = await new TaskManager(tmpDir).create({
      taskId: "task-20260713-004",
      projectName: "repo",
      title: "Packaged verification",
      agentName: "generic",
      baseBranch: "main",
    });
    await fs.mkdir(path.join(tmpDir, ".agentgitops", "packages"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".agentgitops", "packages", `${task.id}.json`),
      `${JSON.stringify(
        {
          id: `pkg_${task.id}`,
          taskId: task.id,
          baseBranch: task.baseBranch,
          targetBranch: task.targetBranch,
          changedFiles: ["README.md"],
          stats: { filesChanged: 1, insertions: 1, deletions: 0 },
          createdAt: new Date().toISOString(),
          checks: [{ name: "pnpm test", status: "passed", summary: "ok" }],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    await execa("git", ["add", ".agentgitops"], { cwd: tmpDir });
    await execa("git", ["commit", "-m", "task package"], { cwd: tmpDir });

    const report = await new TaskCloseoutChecker(tmpDir, testConfig()).check(task.id);
    const verification = report.checks.find((check) => check.name === "verification");

    expect(verification).toMatchObject({ name: "verification", status: "ok" });
    expect(verification?.detail).toContain("packaged verification checks passed");
  });

  it("does not mark a package stale only because the package artifact was committed later", async () => {
    const task = await new TaskManager(tmpDir).create({
      taskId: "task-20260713-005",
      projectName: "repo",
      title: "Artifact freshness",
      agentName: "generic",
      baseBranch: "main",
    });
    await fs.writeFile(path.join(tmpDir, "README.md"), "# test\n\ncode change\n", "utf-8");
    await execa("git", ["add", "README.md"], { cwd: tmpDir });
    await execa("git", ["commit", "-m", "code change"], {
      cwd: tmpDir,
      env: { GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
    });

    await fs.mkdir(path.join(tmpDir, ".agentgitops", "packages"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".agentgitops", "packages", `${task.id}.json`),
      `${JSON.stringify(
        {
          id: `pkg_${task.id}`,
          taskId: task.id,
          projectId: task.projectId,
          baseBranch: task.baseBranch,
          targetBranch: task.targetBranch,
          changedFiles: ["README.md"],
          stats: { filesChanged: 1, insertions: 1, deletions: 0 },
          createdAt: "2026-01-02T00:00:00.000Z",
          checks: [{ name: "pnpm test", status: "passed", summary: "ok" }],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    await execa("git", ["add", ".agentgitops"], { cwd: tmpDir });
    await execa("git", ["commit", "-m", "package artifact"], {
      cwd: tmpDir,
      env: { GIT_AUTHOR_DATE: "2026-01-03T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-03T00:00:00Z" },
    });

    const report = await new TaskCloseoutChecker(tmpDir, testConfig()).check(task.id);
    const changePackage = report.checks.find((check) => check.name === "change-package");

    expect(changePackage).toMatchObject({ name: "change-package", status: "ok" });
    expect(changePackage?.detail).not.toContain("generated before");
  });
});

function testConfig(): AgentgitopsConfig {
  return {
    version: 1,
    project: {
      name: "repo",
      default_branch: "main",
      worktree_root: "../.agentgitops-worktrees",
    },
    git: {
      provider: "github",
      remote: "origin",
    },
    agents: {
      generic: {
        type: "generic",
        command: "echo",
      },
    },
  };
}
