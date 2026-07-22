#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const agops = path.join(repoRoot, "apps/cli/dist/index.js");
const projectPath = mkdtempSync(path.join(tmpdir(), "agops-pr-body-template-smoke-"));
const writerCommand = process.execPath;
const writerScript =
  "require('fs').writeFileSync('template-smoke.txt','team sync template smoke\\n')";

run("git", ["init"], { cwd: projectPath });
run("git", ["config", "user.name", "AgentGitOps Smoke"], { cwd: projectPath });
run("git", ["config", "user.email", "agentgitops-smoke@example.com"], { cwd: projectPath });
run("node", ["-e", "require('fs').writeFileSync('README.md','# smoke\\n')"], { cwd: projectPath });
run("git", ["add", "README.md"], { cwd: projectPath });
run("git", ["commit", "-m", "initial"], { cwd: projectPath });
run("git", ["branch", "-M", "main"], { cwd: projectPath });
run("git", ["remote", "add", "origin", "https://github.com/example/template-smoke.git"], {
  cwd: projectPath,
});

run("node", [agops, "init", "--name", "template-smoke", "--force"], { cwd: projectPath });
run("node", [agops, "team", "init", "--name", "Template Smoke Team"], { cwd: projectPath });
run(
  "node",
  [
    agops,
    "agent",
    "register",
    "template-writer",
    "--command",
    writerCommand,
    "--arg",
    "-e",
    "--arg",
    writerScript,
  ],
  { cwd: projectPath },
);

const created = run(
  "node",
  [
    agops,
    "task",
    "create",
    "PR body template smoke",
    "--agent",
    "template-writer",
    "--objective",
    "Create template-smoke.txt for PR body template validation",
  ],
  { cwd: projectPath },
);
const taskId = /Task created: (?<taskId>\S+)/.exec(created.stdout)?.groups?.taskId;
if (!taskId) throw new Error("Could not parse task id from task create output.");

run("node", [agops, "run", "--agent", "template-writer", "--task", taskId], { cwd: projectPath });
run("node", [agops, "package", taskId], { cwd: projectPath });

const ce = run("node", [agops, "pr", taskId, "--dry-run", "--body-template", "ce"], {
  cwd: projectPath,
}).stdout;
assertIncludes(ce, "## Agent Change Package");
assertIncludes(ce, "### Evidence");
assertExcludes(ce, "### Team Sync Context");
assertExcludes(ce, "<!-- agentgitops:team-sync -->");

const teamSync = run("node", [agops, "pr", taskId, "--dry-run", "--body-template", "team-sync"], {
  cwd: projectPath,
}).stdout;
assertIncludes(teamSync, "## Agent Change Package");
assertIncludes(teamSync, "### Team Sync Context");
assertIncludes(teamSync, "<!-- agentgitops:team-sync -->");
assertIncludes(teamSync, "### Collaboration Impact");
assertIncludes(teamSync, "### Agent Context Feed");
assertIncludes(teamSync, "### Sync State");
assertIncludes(teamSync, "Team Project: `Template Smoke Team`");
assertIncludes(teamSync, "Context Feed ID: `feed_");
assertIncludes(teamSync, "Source Change Packages: `pkg_");
assertIncludes(teamSync, "Used By Agent: `yes`");
assertIncludes(teamSync, "Sync Status: `pending-local-events`");
assertIncludes(teamSync, "Team Control Plane: `disabled`");

console.log(`✓ PR body template smoke passed: task=${taskId}`);
console.log(`  Project: ${projectPath}`);

function assertIncludes(value, expected) {
  if (!value.includes(expected)) throw new Error(`Expected output to include: ${expected}`);
}

function assertExcludes(value, unexpected) {
  if (value.includes(unexpected)) throw new Error(`Expected output not to include: ${unexpected}`);
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
