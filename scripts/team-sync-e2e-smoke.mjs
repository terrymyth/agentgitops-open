#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const agops = path.join(repoRoot, "apps/cli/dist/index.js");
const serverEntry = pathToFileURL(path.join(repoRoot, "apps/server/dist/index.js")).href;
const root = mkdtempSync(path.join(tmpdir(), "agops-team-sync-e2e-"));
const relayPath = path.join(root, "relay");
const seedPath = path.join(root, "seed");
const remotePath = path.join(root, "remote.git");
const hubA = path.join(root, "hub-a");
const hubB = path.join(root, "hub-b");
const hubC = path.join(root, "hub-c");
const teamSecret = "team-sync-e2e-secret";

let relayProcess;

try {
  setupGitRepository();
  setupRelayProject();
  const relayUrl = await startRelayServer(relayPath);
  const teamId = parseTeamId(
    run("node", [agops, "sync", "status", "--json"], { cwd: relayPath }).stdout,
  );

  setupHub(hubA, "codex-a", "hub_a", relayUrl, teamId);
  setupHub(hubB, "claude-b", "hub_b", relayUrl, teamId);
  setupHub(hubC, "codex-c", "hub_c", relayUrl, teamId);

  const taskA = createRunPackageAndPush(hubA, "codex-a", "A", relayUrl);
  run("node", [agops, "sync", "pull", "--relay", relayUrl], { cwd: hubB });
  const taskB = createRunPackageAndPush(hubB, "claude-b", "B", relayUrl);

  run("node", [agops, "sync", "pull", "--relay", relayUrl], { cwd: hubA });
  run("node", [agops, "sync", "pull", "--relay", relayUrl], { cwd: hubC });

  const conflicts = JSON.parse(
    run("node", [agops, "team", "conflicts", "--json"], { cwd: hubC }).stdout,
  );
  if (
    !conflicts.edges.some(
      (edge) => edge.type === "same_file" && edge.sourceTaskId !== edge.targetTaskId,
    )
  ) {
    throw new Error("Expected C hub conflict graph to include a same_file edge.");
  }

  const feed = run(
    "node",
    [agops, "context", "feed", "--task", taskA, "--agent", "codex", "--format", "json"],
    { cwd: hubC },
  ).stdout;
  assertIncludes(feed, `File overlap with ${taskB}`);

  const prBody = run("node", [agops, "pr", taskA, "--dry-run", "--body-template", "team-sync"], {
    cwd: hubA,
  }).stdout;
  assertIncludes(prBody, "Team Project: `Team Sync E2E Team`");
  assertIncludes(prBody, "Potential Conflict Signals: `medium:same_file`");
  assertIncludes(prBody, "Sync Status: `local-cache-current`");
  assertIncludes(prBody, "Context Feed ID: `feed_");

  console.log(`✓ Team Sync E2E smoke passed: ${taskA}, ${taskB}`);
  console.log(`  Root: ${root}`);
  console.log(`  Relay: ${relayUrl}`);
} finally {
  if (relayProcess) relayProcess.kill("SIGTERM");
}

function setupGitRepository() {
  run("git", ["init", "--bare", remotePath], { cwd: root });
  run("git", ["init", seedPath], { cwd: root });
  run("git", ["config", "user.name", "AgentGitOps Smoke"], { cwd: seedPath });
  run("git", ["config", "user.email", "agentgitops-smoke@example.com"], { cwd: seedPath });
  run(
    "node",
    [
      "-e",
      "require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/shared.ts','export const base = true;\\n');require('fs').writeFileSync('README.md','# team sync e2e\\n')",
    ],
    { cwd: seedPath },
  );
  run("git", ["add", "."], { cwd: seedPath });
  run("git", ["commit", "-m", "initial"], { cwd: seedPath });
  run("git", ["branch", "-M", "main"], { cwd: seedPath });
  run("git", ["remote", "add", "origin", remotePath], { cwd: seedPath });
  run("git", ["push", "-u", "origin", "main"], { cwd: seedPath });
}

function setupRelayProject() {
  run("git", ["clone", remotePath, relayPath], { cwd: root });
  run("git", ["remote", "set-url", "origin", "https://github.com/example/team-sync-e2e.git"], {
    cwd: relayPath,
  });
  run("node", [agops, "init", "--name", "team-sync-relay", "--force"], { cwd: relayPath });
  run(
    "node",
    [
      agops,
      "team",
      "init",
      "--name",
      "Team Sync E2E Team",
      "--secret",
      teamSecret,
      "--sync-mode",
      "relay",
    ],
    { cwd: relayPath },
  );
}

function setupHub(hubPath, agentName, label, relayUrl, teamId) {
  run("git", ["clone", remotePath, hubPath], { cwd: root });
  run("git", ["config", "user.name", "AgentGitOps Smoke"], { cwd: hubPath });
  run("git", ["config", "user.email", "agentgitops-smoke@example.com"], { cwd: hubPath });
  run("git", ["remote", "set-url", "origin", "https://github.com/example/team-sync-e2e.git"], {
    cwd: hubPath,
  });
  run("node", [agops, "init", "--name", path.basename(hubPath), "--force"], { cwd: hubPath });
  run(
    "node",
    [
      agops,
      "team",
      "join",
      "--team-id",
      teamId,
      "--name",
      "Team Sync E2E Team",
      "--secret",
      teamSecret,
      "--relay",
      relayUrl,
      "--sync-mode",
      "relay",
    ],
    { cwd: hubPath },
  );
  run(
    "node",
    [
      agops,
      "agent",
      "register",
      agentName,
      "--command",
      process.execPath,
      "--arg",
      "-e",
      "--arg",
      `require('fs').appendFileSync('src/shared.ts', 'export const ${label} = true;\\n')`,
    ],
    { cwd: hubPath },
  );
}

function createRunPackageAndPush(hubPath, agentName, label, relayUrl) {
  const created = run(
    "node",
    [
      agops,
      "task",
      "create",
      `Team Sync ${label} shared file`,
      "--agent",
      agentName,
      "--objective",
      `Edit src/shared.ts from hub ${label}`,
    ],
    { cwd: hubPath },
  );
  const taskId = /Task created: (?<taskId>\S+)/.exec(created.stdout)?.groups?.taskId;
  if (!taskId) throw new Error(`Could not parse task id for hub ${label}.`);
  run("node", [agops, "run", "--agent", agentName, "--task", taskId], { cwd: hubPath });
  run("node", [agops, "package", taskId], { cwd: hubPath });
  run("node", [agops, "sync", "push", "--relay", relayUrl], { cwd: hubPath });
  return taskId;
}

async function startRelayServer(cwd) {
  const port = await freePort();
  const code = `
    import { startAgentGitOpsServer } from ${JSON.stringify(serverEntry)};
    const started = await startAgentGitOpsServer({ projectPath: process.cwd(), host: "127.0.0.1", port: Number(process.env.AGOPS_PORT) });
    console.log(started.url);
    process.stdin.resume();
  `;
  relayProcess = spawn(process.execPath, ["--input-type=module", "-e", code], {
    cwd,
    env: { ...process.env, AGOPS_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  relayProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const url = await waitForServerUrl(relayProcess);
  await waitForHealth(url);
  return url;
}

function waitForServerUrl(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for relay server URL.")),
      10_000,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Relay server exited before startup: ${code}`));
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/api/team/status", url));
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Relay server did not become healthy.");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("Could not allocate port.")),
      );
    });
  });
}

function parseTeamId(statusJson) {
  const parsed = JSON.parse(statusJson);
  const teamId = parsed.team?.teamId;
  if (!teamId) throw new Error("Could not parse relay team id.");
  return teamId;
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) throw new Error(`Expected output to include: ${expected}`);
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
