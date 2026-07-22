#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.repo) {
  console.log(
    [
      "Usage: node scripts/pr-smoke.mjs --repo https://github.com/<owner>/<repo>.git [--real]",
      "",
      "Defaults to dry-run mode: clone, initialize, create a task, run the agent, generate a Change Package, run pr preflight, and print the PR body.",
      "Use --real to push and create/update the PR twice for idempotency validation.",
      "",
      "Options:",
      "  --repo <url>       Target test repository URL",
      "  --dir <path>       Existing or new working directory parent",
      "  --real             Push branch and create/update PR/MR twice",
      "  --name <name>      AgentGitOps project name",
    ].join("\n"),
  );
  process.exit(args.help ? 0 : 1);
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const agops = path.join(repoRoot, "apps/cli/dist/index.js");
const parentDir = args.dir
  ? path.resolve(args.dir)
  : mkdtempSync(path.join(tmpdir(), "agops-pr-smoke-"));
const repoName =
  args.name ?? (path.basename(args.repo).replace(/\.git$/, "") || "agentgitops-smoke");
const cloneDir = path.join(parentDir, repoName);
const stamp = new Date()
  .toISOString()
  .replace(/[-:T.Z]/g, "")
  .slice(0, 12);
const smokeFile = `agentgitops-smoke-${stamp}.txt`;
// 跨平台写文件：用 node -e 避免依赖 /bin/sh（Windows 不存在）
const writerCommand = process.execPath;
const writerScript = `require('fs').writeFileSync('${smokeFile}','agentgitops pr smoke ${stamp}\\n')`;

const sourceRemote = resolveSourceRemote(args.repo);
run("git", ["clone", args.repo, cloneDir], { cwd: parentDir });
if (sourceRemote) {
  run("git", ["remote", "set-url", "origin", sourceRemote], { cwd: cloneDir });
}
run("git", ["config", "user.name", "AgentGitOps Smoke"], { cwd: cloneDir });
run("git", ["config", "user.email", "agentgitops-smoke@example.com"], { cwd: cloneDir });
run("node", [agops, "init", "--name", repoName, "--force"], { cwd: cloneDir });
run(
  "node",
  [
    agops,
    "agent",
    "register",
    "smoke-writer",
    "--command",
    writerCommand,
    "--arg",
    "-e",
    "--arg",
    writerScript,
  ],
  { cwd: cloneDir },
);

const created = run(
  "node",
  [
    agops,
    "task",
    "create",
    "AgentGitOps PR smoke",
    "--agent",
    "smoke-writer",
    "--objective",
    `Create ${smokeFile} for PR smoke validation`,
  ],
  { cwd: cloneDir },
);
const taskId = /Task created: (?<taskId>\S+)/.exec(created.stdout)?.groups?.taskId;
if (!taskId) throw new Error("Could not parse task id from task create output.");

run("node", [agops, "run", "--agent", "smoke-writer", "--task", taskId], { cwd: cloneDir });
run("node", [agops, "package", taskId], { cwd: cloneDir });
run("node", [agops, "pr", "preflight", taskId, ...(args.real ? ["--real"] : [])], {
  cwd: cloneDir,
});
run("node", [agops, "pr", taskId, "--dry-run"], { cwd: cloneDir });

if (args.real) {
  const first = run("node", [agops, "pr", taskId, "--no-draft"], { cwd: cloneDir });
  const second = run("node", [agops, "pr", taskId, "--no-draft"], { cwd: cloneDir });
  const firstPr = /Number: #(?<number>\d+)/.exec(first.stdout)?.groups?.number;
  const secondPr = /Number: #(?<number>\d+)/.exec(second.stdout)?.groups?.number;
  if (!firstPr || firstPr !== secondPr) {
    throw new Error(
      `Idempotency failed: first=${firstPr ?? "missing"} second=${secondPr ?? "missing"}`,
    );
  }
  console.log(`✓ Real PR smoke passed: task=${taskId} pr=#${firstPr}`);
} else {
  console.log(`✓ Dry-run PR smoke passed: task=${taskId}`);
  console.log("  Re-run with --real to push and create/update the PR twice.");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--") continue;
    else if (value === "--help" || value === "-h") parsed.help = true;
    else if (value === "--real") parsed.real = true;
    else if (value === "--repo") parsed.repo = values[++index];
    else if (value === "--dir") parsed.dir = values[++index];
    else if (value === "--name") parsed.name = values[++index];
    else throw new Error(`Unknown option: ${value}`);
  }
  return parsed;
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

function resolveSourceRemote(repository) {
  const result = spawnSync("git", ["-C", repository, "remote", "get-url", "origin"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return undefined;
  const remote = result.stdout.trim();
  return /^(?:https?:\/\/|ssh:\/\/|git@)/.test(remote) ? remote : undefined;
}
