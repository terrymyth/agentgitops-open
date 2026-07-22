import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execa } from "execa";
import { GitService } from "../src/git-service.js";
import { WorktreeService } from "../src/worktree-service.js";
import { DiffService } from "../src/diff-service.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-git-"));
  // init a git repo
  await execa("git", ["init"], { cwd: tmpDir });
  await execa("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
  await execa("git", ["config", "user.name", "Test"], { cwd: tmpDir });
  // create initial commit on main
  await fs.writeFile(path.join(tmpDir, "README.md"), "# test\n");
  await execa("git", ["add", "."], { cwd: tmpDir });
  await execa("git", ["commit", "-m", "initial"], { cwd: tmpDir });
});

afterEach(async () => {
  await removeDirWithRetry(tmpDir);
});

/**
 * 带重试的目录删除：Windows 下 git/文件句柄释放有延迟，EBUSY 时退避重试
 */
async function removeDirWithRetry(target: string, retries = 5): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (err) {
      const isBusy =
        err instanceof Error &&
        (err.message.includes("EBUSY") ||
          err.message.includes("ENOTEMPTY") ||
          err.message.includes("EPERM"));
      if (!isBusy || attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

describe("GitService", () => {
  it("should get current branch", async () => {
    const svc = new GitService(tmpDir);
    const branch = await svc.getCurrentBranch();
    expect(branch).toMatch(/main|master/);
  });

  it("should create and list branches", async () => {
    const svc = new GitService(tmpDir);
    await svc.createBranch("feature/test");
    const branches = await svc.listBranches();
    expect(branches).toContain("feature/test");
  });

  it("should get status", async () => {
    const svc = new GitService(tmpDir);
    const status = await svc.status();
    // porcelain output may be empty for clean tree
    expect(typeof status).toBe("string");
  });
});

describe("WorktreeService", () => {
  it("should add and remove worktree", async () => {
    const svc = new WorktreeService(tmpDir);
    const wtPath = path.join(tmpDir, "..", "wt-test");

    await svc.add(wtPath, "agent/test-branch");
    const stat = await fs.stat(wtPath);
    expect(stat.isDirectory()).toBe(true);

    await svc.remove(wtPath);
    await expect(fs.stat(wtPath)).rejects.toThrow();
  });

  it("should list worktrees", async () => {
    const svc = new WorktreeService(tmpDir);
    const list = await svc.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});

describe("DiffService", () => {
  it("should detect changed files against HEAD", async () => {
    // make a change
    await fs.writeFile(path.join(tmpDir, "new-file.txt"), "content");
    await execa("git", ["add", "."], { cwd: tmpDir });

    const diff = new DiffService(tmpDir);
    const files = await diff.getChangedFiles("HEAD");
    expect(files).toContain("new-file.txt");
  });

  it("should get diff stat", async () => {
    await fs.writeFile(path.join(tmpDir, "new-file2.txt"), "line1\nline2\n");
    await execa("git", ["add", "."], { cwd: tmpDir });

    const diff = new DiffService(tmpDir);
    const stat = await diff.getDiffStat("HEAD");
    expect(stat.changedFiles.length).toBeGreaterThan(0);
    expect(stat.insertions).toBeGreaterThan(0);
  });

  it("should include untracked files in working tree diffs", async () => {
    await fs.writeFile(path.join(tmpDir, "untracked.txt"), "line1\nline2\n");

    const diff = new DiffService(tmpDir);
    const stat = await diff.getDiffStat("HEAD");
    expect(stat.changedFiles).toContain("untracked.txt");
    expect(stat.insertions).toBe(2);
  });
});
