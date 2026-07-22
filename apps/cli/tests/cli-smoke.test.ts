import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../dist/index.js");

// Windows 下 git worktree 子进程释放文件句柄有延迟，清理需重试
const IS_WIN = process.platform === "win32";
// 跨平台写文件的 agent 命令：用 node -e 避免依赖 /bin/sh
const WRITER_COMMAND = process.execPath;
const WRITER_ARGS = ["-e", "require('fs').writeFileSync('preflight.txt','preflight\\n')"];

let projectPath: string;

beforeEach(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "agops-cli-test-"));
  await git(["init"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);
  await fs.writeFile(path.join(projectPath, "README.md"), "# smoke\n", "utf-8");
  await git(["add", "README.md"]);
  await git(["commit", "-m", "initial"]);
  await git(["branch", "-M", "main"]);
});

afterEach(async () => {
  await removeDirWithRetry(projectPath);
});

describe("agentgitops CLI", () => {
  // Windows 下 git worktree 创建/删除较慢，给足超时
  it("manages agents, tasks, workspaces, and audit events", async () => {
    await runCli(["init", "--name", "cli-smoke", "--force"]);
    await runCli(["agent", "register", "temp", "--command", "echo", "--arg", "hello"]);
    const remove = await runCli(["agent", "remove", "temp"]);
    expect(remove.stdout).toContain("Agent removed: temp");

    const created = await runCli([
      "task",
      "create",
      "Smoke task",
      "--agent",
      "generic",
      "--objective",
      "Smoke objective",
    ]);
    const taskId = /Task created: (?<taskId>\S+)/.exec(created.stdout)?.groups?.taskId;
    expect(taskId).toBeTruthy();

    const started = await runCli(["task", "start", taskId!]);
    expect(started.stdout).toContain("Task workspace ready");

    try {
      await runCli(["task", "closeout", taskId!, "--mode", "checkpoint"]);
      throw new Error("Expected closeout dry-run to fail before artifacts are committed.");
    } catch (error) {
      const result = error as { code?: number; stdout?: string; stderr?: string };
      expect(result.code).toBe(1);
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      expect(output).toContain("Task closeout dry-run");
      expect(output).toContain("task-snapshot");
      expect(output).toContain("remote-head");
    }

    const workspaces = await runCli(["workspace", "list"]);
    expect(workspaces.stdout).toContain(taskId);

    const board = await runCli(["board"]);
    expect(board.stdout).toContain("WORKSPACE_CREATED");

    const audit = await runCli(["audit", "list"]);
    expect(audit.stdout).toContain("task.started");

    const replay = await runCli(["audit", "replay", taskId!]);
    expect(replay.stdout).toContain("workspace.created");

    const note = await runCli([
      "note",
      "add",
      taskId!,
      "--summary",
      "Implemented smoke coverage",
      "--agent",
      "codex",
      "--file",
      "apps/cli/src/index.ts",
      "--verify",
      "pnpm test",
      "--review-focus",
      "handoff note persistence",
    ]);
    expect(note.stdout).toContain("Agent note recorded");

    const notes = await runCli(["note", "list", taskId!]);
    expect(notes.stdout).toContain("Implemented smoke coverage");

    const context = await runCli(["review", "context", taskId!, "--json", "--record"]);
    expect(context.stdout).toContain('"agentNotes"');
    expect(context.stdout).toContain("Implemented smoke coverage");

    const sync = await runCli(["sync"]);
    expect(sync.stdout).toContain("Control-plane sync is not configured");

    // 先清理 worktree（释放 git 对工作区的句柄），再 cancel
    await runCli(["workspace", "remove", taskId!]);
    // Windows 下 worktree remove 后 git 进程可能仍持有句柄，短暂等待
    if (IS_WIN) await sleep(300);
    const canceled = await runCli(["task", "cancel", taskId!]);
    expect(canceled.stdout).toContain(`Task canceled: ${taskId}`);
  }, 30000);

  it("returns a non-zero exit for missing agents", async () => {
    await runCli(["init", "--name", "cli-smoke", "--force"]);
    await expect(runCli(["agent", "remove", "missing"])).rejects.toMatchObject({
      code: 1,
    });
  });

  it("keeps explicit web --port above the project registry serverPort", async () => {
    const webIndexPath = path.resolve(__dirname, "../../web/dist/index.html");
    try {
      await fs.access(webIndexPath);
    } catch {
      console.warn("Skipping web port priority smoke because apps/web/dist is not built.");
      return;
    }

    const homePath = await fs.mkdtemp(path.join(os.tmpdir(), "agops-cli-home-"));
    const env = isolatedHomeEnv(homePath);
    let cliPort: number;
    let registryPort: number;
    try {
      cliPort = await getFreePort();
      registryPort = await getFreePort();
      while (registryPort === cliPort) {
        registryPort = await getFreePort();
      }
    } catch (error) {
      await removeDirWithRetry(homePath);
      if (isListenPermissionError(error)) {
        console.warn("Skipping web port priority smoke because local TCP bind is not permitted.");
        return;
      }
      throw error;
    }

    try {
      await runCli(["project", "add", projectPath, "--name", "port-priority"], { env });
      const registryPath = path.join(homePath, ".agentgitops", "projects.json");
      const registry = JSON.parse(await fs.readFile(registryPath, "utf-8")) as {
        projects: Array<{ id: string; serverPort?: number }>;
      };
      const projectId = registry.projects[0]?.id;
      expect(projectId).toBeTruthy();
      registry.projects[0]!.serverPort = registryPort;
      await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");

      const child = spawn(
        "node",
        [cliPath, "web", "--host", "127.0.0.1", "--port", String(cliPort), "--project", projectId!],
        {
          cwd: projectPath,
          env: { ...process.env, ...env },
        },
      );

      try {
        const output = await waitForOutput(
          child,
          `agentgitops web listening on http://127.0.0.1:${cliPort}`,
          10000,
        );
        expect(output).not.toContain(`http://127.0.0.1:${registryPort}`);
      } finally {
        await stopChild(child);
      }
    } finally {
      await removeDirWithRetry(homePath);
    }
  }, 30000);

  it("manages local Team Sync state", async () => {
    await runCli(["init", "--name", "cli-smoke", "--force"]);
    await keepWorktreesInsideProject();

    const init = await runCli(["team", "init", "--name", "Platform Team", "--sync-mode", "hybrid"]);
    expect(init.stdout).toContain("Team initialized: Platform Team");
    expect(init.stdout).toContain("Team secret stored as hash only");
    expect(init.stdout).not.toContain("teamSecretHash");

    const teamId = /Team: (?<teamId>team_\S+)/.exec(init.stdout)?.groups?.teamId;
    expect(teamId).toBeTruthy();

    const created = await runCli([
      "task",
      "create",
      "Team context task",
      "--agent",
      "generic",
      "--objective",
      "Generate Team Sync context",
    ]);
    const taskId = /Task created: (?<taskId>\S+)/.exec(created.stdout)?.groups?.taskId;
    expect(taskId).toBeTruthy();
    const targetBranch = /Branch: (?<branch>\S+)/.exec(created.stdout)?.groups?.branch;
    expect(targetBranch).toBeTruthy();
    await git(["branch", targetBranch!, "main"]);

    const status = await runCli(["sync", "status", "--json"]);
    const parsed = JSON.parse(status.stdout) as {
      team: { teamId: string; name: string };
      pendingEvents: number;
      cachedTasks: number;
    };
    expect(parsed.team.teamId).toBe(teamId);
    expect(parsed.team.name).toBe("Platform Team");
    expect(parsed.pendingEvents).toBe(2);
    expect(parsed.cachedTasks).toBe(1);
    expect(status.stdout).not.toContain("teamSecretHash");

    const feed = await runCli([
      "context",
      "feed",
      "--task",
      taskId!,
      "--agent",
      "codex",
      "--format",
      "json",
    ]);
    const parsedFeed = JSON.parse(feed.stdout) as {
      taskId: string;
      agentType: string;
      items: Array<{ title: string }>;
    };
    expect(parsedFeed.taskId).toBe(taskId);
    expect(parsedFeed.agentType).toBe("codex");
    expect(parsedFeed.items.map((item) => item.title)).toContain("Current Task");

    const handoffPreview = await runCli(["handoff", "preview", taskId!, "--type", "adopt"]);
    expect(handoffPreview.stdout).toContain("# Handoff");
    expect(handoffPreview.stdout).toContain("Type: adopt");

    const handoffGenerate = await runCli(["handoff", "generate", taskId!, "--type", "continue"]);
    expect(handoffGenerate.stdout).toContain("Handoff generated");
    // 兼容 Windows（反斜杠）和 Unix（正斜杠）路径分隔符
    expect(handoffGenerate.stdout).toMatch(/\.agentgitops[\\/]+handoffs[\\/]+/);

    const continuePreview = await runCli(["task", "continue", taskId!, "--preview"]);
    expect(continuePreview.stdout).toContain("Type: continue");
    expect(continuePreview.stdout).toContain("Target branch: agent/preview-");

    const adopted = await runCli(["task", "adopt", taskId!]);
    expect(adopted.stdout).toContain(`Task adopted: ${taskId}`);
    expect(adopted.stdout).toMatch(/\.agentgitops[\\/]+handoffs[\\/]+/);
    await expect(runCli(["task", "adopt", taskId!])).rejects.toMatchObject({ code: 1 });

    const continued = await runCli(["task", "continue", taskId!, "--agent", "generic"]);
    expect(continued.stdout).toContain("Task continued:");
    expect(continued.stdout).toContain(`Base branch: ${targetBranch}`);
    expect(continued.stdout).toMatch(/\.agentgitops[\\/]+handoffs[\\/]+/);

    const push = await runCli(["sync", "push", "--dry-run"]);
    expect(push.stdout).toContain("Pending Sync Events:");
    expect(push.stdout).toContain("team.initialized");
    expect(push.stdout).toContain("task.adopted");
    expect(push.stdout).toContain("task.continued");
  }, 30000);

  it("runs PR preflight without provider writes", async () => {
    await runCli(["init", "--name", "cli-smoke", "--force"]);
    await git(["remote", "add", "origin", "https://github.com/example/repo.git"]);
    // 跨平台 agent：用 node -e 写文件，不依赖 /bin/sh
    await runCli([
      "agent",
      "register",
      "writer",
      "--command",
      WRITER_COMMAND,
      "--arg",
      WRITER_ARGS[0],
      "--arg",
      WRITER_ARGS[1],
    ]);
    const created = await runCli([
      "task",
      "create",
      "Preflight task",
      "--agent",
      "writer",
      "--objective",
      "Create preflight.txt",
    ]);
    const taskId = /Task created: (?<taskId>\S+)/.exec(created.stdout)?.groups?.taskId;
    expect(taskId).toBeTruthy();

    await runCli(["run", "--agent", "writer", "--task", taskId!]);
    await runCli(["package", taskId!]);
    // 不在此删除 workspace：pr preflight 需要 workspace 存在。
    // 清理由 afterEach 的 removeDirWithRetry 负责（含 EBUSY 重试）。
    const preflight = await runCli(["pr", "preflight", taskId!, "--no-commit"]);
    expect(preflight.stdout).toContain("provider: github / example/repo");
    expect(preflight.stdout).toContain("provider-token");
    expect(preflight.stdout).toContain("dry-run/preflight-only");
  }, 30000);
});

async function runCli(args: string[], options: { env?: NodeJS.ProcessEnv } = {}) {
  return execFileAsync("node", [cliPath, ...args], {
    cwd: projectPath,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    maxBuffer: 1024 * 1024,
  });
}

async function git(args: string[]) {
  return execFileAsync("git", args, {
    cwd: projectPath,
    maxBuffer: 1024 * 1024,
  });
}

async function keepWorktreesInsideProject(): Promise<void> {
  const configPath = path.join(projectPath, ".agentgitops.yml");
  const content = await fs.readFile(configPath, "utf-8");
  await fs.writeFile(
    configPath,
    content.replace("../.agentgitops-worktrees", ".agentgitops-worktrees"),
    "utf-8",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isolatedHomeEnv(homePath: string): NodeJS.ProcessEnv {
  return {
    HOME: homePath,
    USERPROFILE: homePath,
  };
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate a TCP port.")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function waitForOutput(
  child: ReturnType<typeof spawn>,
  expected: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for CLI output: ${expected}\n${output}`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf-8");
      if (output.includes(expected)) {
        cleanup();
        resolve(output);
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(`CLI exited before expected output (code=${code}, signal=${signal}).\n${output}`),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
  });
}

function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function isListenPermissionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("listen EPERM");
}

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
      await sleep(500 * (attempt + 1));
    }
  }
}
