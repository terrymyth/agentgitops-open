#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createAgentGitOpsServer } from "../apps/server/dist/index.js";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const agops = path.join(repoRoot, "apps/cli/dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "agops-rebase-smoke-"));
const remote = path.join(root, "remote.git");
const project = path.join(root, "project");
const projectName = "rebase-smoke";
const actorId = process.env.USER || "local-user";

run("git", ["init", "--bare", remote], { cwd: root });
run("git", ["clone", remote, project], { cwd: root });
run("git", ["config", "user.name", "AgentGitOps Smoke"], { cwd: project });
run("git", ["config", "user.email", "agentgitops-smoke@example.com"], { cwd: project });
writeFileSync(path.join(project, "file.txt"), "base\n");
run("git", ["add", "file.txt"], { cwd: project });
run("git", ["commit", "-m", "chore: initial smoke fixture"], { cwd: project });
run("git", ["branch", "-M", "main"], { cwd: project });
run("git", ["push", "-u", "origin", "main"], { cwd: project });

run("node", [agops, "init", "--name", projectName, "--force"], { cwd: project });

const success = createTask("Rebase success smoke", "Create a non-conflicting task branch");
run("node", [agops, "task", "start", success.taskId], { cwd: project });
writeFileSync(path.join(success.workspacePath, "success.txt"), "success\n");
run("git", ["add", "success.txt"], { cwd: success.workspacePath });
run("git", ["commit", "-m", "feat: success branch change"], { cwd: success.workspacePath });
run("node", [agops, "package", success.taskId], { cwd: project });
injectConflict(success.taskId, "conflict_success");

const failure = createTask("Rebase failure smoke", "Create a conflicting task branch");
run("node", [agops, "task", "start", failure.taskId], { cwd: project });
writeFileSync(path.join(failure.workspacePath, "file.txt"), "task branch\n");
run("git", ["add", "file.txt"], { cwd: failure.workspacePath });
run("git", ["commit", "-m", "feat: task branch conflict"], { cwd: failure.workspacePath });
run("node", [agops, "package", failure.taskId], { cwd: project });
injectConflict(failure.taskId, "conflict_failure");

writeFileSync(path.join(project, "file.txt"), "main branch\n");
run("git", ["add", "file.txt"], { cwd: project });
run("git", ["commit", "-m", "feat: main branch conflict"], { cwd: project });
run("git", ["push", "origin", "main"], { cwd: project });

const server = createAgentGitOpsServer({ projectPath: project });
const successResult = await postConflictAction(server, "conflict_success");
assertEqual(successResult.actionResult?.status, "completed", "success actionResult.status");
assertEqual(successResult.conflict.status, "resolved", "success conflict.status");
assertEqual(successResult.task?.status, "testing", "success task.status");

const failureResult = await postConflictAction(server, "conflict_failure");
assertEqual(failureResult.actionResult?.status, "failed", "failure actionResult.status");
assertEqual(failureResult.conflict.status, "open", "failure conflict.status");
assertEqual(failureResult.task?.status, "blocked", "failure task.status");

const failureGitStatus = run("git", ["status", "--short"], { cwd: failure.workspacePath });
assertEqual(failureGitStatus.stdout.trim(), "", "failure worktree clean after abort");

console.log(`✓ Web rebase smoke passed: project=${project}`);
console.log(`  success=${success.taskId} failure=${failure.taskId}`);

function createTask(title, objective) {
  const created = run(
    "node",
    [agops, "task", "create", title, "--agent", "generic", "--objective", objective],
    { cwd: project },
  );
  const taskId = /Task created: (?<taskId>\S+)/.exec(created.stdout)?.groups?.taskId;
  if (!taskId) throw new Error(`Could not parse task id from output: ${created.stdout}`);
  return {
    taskId,
    workspacePath: path.resolve(
      project,
      "..",
      ".agentgitops-worktrees",
      `${projectName}-${taskId}`,
    ),
  };
}

function injectConflict(taskId, conflictId) {
  const packagePath = path.join(project, ".agentgitops", "packages", `${taskId}.json`);
  const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
  pkg.conflicts = [
    {
      id: conflictId,
      type: "same_file",
      conflictingTaskId: "task-smoke-other",
      filePath: "file.txt",
      severity: "high",
      suggestion: "rebase",
      status: "open",
    },
  ];
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function postConflictAction(server, conflictId) {
  const payload = await dispatchJson(
    server,
    `/api/conflicts/${encodeURIComponent(conflictId)}/rebase`,
    { actorId },
  );
  if (payload.error) {
    throw new Error(JSON.stringify(payload));
  }
  return payload.data;
}

async function dispatchJson(server, url, body) {
  const requestBody = JSON.stringify(body);
  const req = Readable.from([requestBody]);
  req.method = "POST";
  req.url = url;
  req.headers = {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(requestBody),
  };

  return await new Promise((resolve, reject) => {
    const chunks = [];
    const res = {
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        try {
          const text = Buffer.concat(chunks).toString("utf-8");
          const payload = text ? JSON.parse(text) : {};
          if (this.statusCode && this.statusCode >= 400) {
            reject(new Error(JSON.stringify(payload)));
            return;
          }
          resolve(payload);
        } catch (error) {
          reject(error);
        }
      },
    };
    server.emit("request", req, res);
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function run(command, commandArgs, options) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit ${result.status}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
