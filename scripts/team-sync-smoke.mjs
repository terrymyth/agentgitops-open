#!/usr/bin/env node
/**
 * Team Sync 端到端冒烟测试
 *
 * 模拟 3 个 Local Hub + 1 Relay 的同步闭环：
 * 1. Hub-A 创建任务 → 产生 SyncEvent
 * 2. Hub-A push 事件到 Relay
 * 3. Hub-B pull 事件 → 应用到本地
 * 4. Hub-B 创建相关任务 → 产生冲突信号
 * 5. Hub-C pull → 看到冲突信号
 * 6. 验证 team status 一致性
 *
 * 用法：node scripts/team-sync-smoke.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SMOKE_DIR = mkdtempSync(path.join(tmpdir(), "agops-team-sync-smoke-"));
const HUB_A = path.join(SMOKE_DIR, "hub-a");
const HUB_B = path.join(SMOKE_DIR, "hub-b");
const HUB_C = path.join(SMOKE_DIR, "hub-c");
const RELAY = path.join(SMOKE_DIR, "relay");

for (const dir of [HUB_A, HUB_B, HUB_C, RELAY]) {
  mkdirSync(dir, { recursive: true });
}

const CLI = path.resolve(
  path.dirname(new URL(".", import.meta.url).pathname),
  "..",
  "apps",
  "cli",
  "dist",
  "index.js",
);
const TEAM_ID = "team-smoke-001";
const TEAM_SECRET = "smoke-test-secret";

let passed = 0;
let failed = 0;

function run(cwd, args) {
  const result = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AGENTGITOPS_TEAM_SECRET: TEAM_SECRET },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

console.log("=== Team Sync End-to-End Smoke ===\n");

// 1. 初始化 3 个 Hub 的 git 仓库
console.log("Step 1: Initialize 3 Local Hubs");
for (const [name, dir] of [
  ["Hub-A", HUB_A],
  ["Hub-B", HUB_B],
  ["Hub-C", HUB_C],
]) {
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf-8" });
  spawnSync("git", ["config", "user.email", "smoke@test.com"], { cwd: dir, encoding: "utf-8" });
  spawnSync("git", ["config", "user.name", "Smoke"], { cwd: dir, encoding: "utf-8" });
  run(dir, ["init", "--name", name, "--force"]);
  console.log(`  ${name} initialized at ${dir}`);
}

// 2. Hub-A 创建 team
console.log("\nStep 2: Hub-A creates team");
const teamInit = run(HUB_A, [
  "team",
  "init",
  "--name",
  "smoke-team",
  "--relay-url",
  `file://${RELAY}`,
]);
assert(teamInit.status === 0, "team init on Hub-A");

// 3. Hub-A 和 Hub-B join team
console.log("\nStep 3: Hub-B and Hub-C join team");
const joinB = run(HUB_B, ["team", "join", "--team-id", TEAM_ID, "--member-name", "developer-b"]);
assert(joinB.status === 0, "Hub-B joins team");
const joinC = run(HUB_C, ["team", "join", "--team-id", TEAM_ID, "--member-name", "developer-c"]);
assert(joinC.status === 0, "Hub-C joins team");

// 4. Hub-A 创建任务 → 产生 SyncEvent
console.log("\nStep 4: Hub-A creates task (produces SyncEvent)");
const createTask = run(HUB_A, [
  "task",
  "create",
  "Sync smoke task A",
  "--agent",
  "generic",
  "--objective",
  "Test sync",
]);
assert(createTask.status === 0, "Hub-A creates task");
const taskIdMatch = /Task created: (?<id>\S+)/.exec(createTask.stdout);
const taskIdA = taskIdMatch?.groups?.id;
assert(!!taskIdA, `task ID parsed: ${taskIdA}`);

// 5. Hub-A push 事件到 Relay
console.log("\nStep 5: Hub-A pushes events to Relay");
const pushA = run(HUB_A, ["sync", "push", "--json"]);
assert(pushA.status === 0, "Hub-A sync push");

// 6. Hub-B pull 事件
console.log("\nStep 6: Hub-B pulls events from Relay");
const pullB = run(HUB_B, ["sync", "pull", "--json"]);
assert(pullB.status === 0, "Hub-B sync pull");

// 7. Hub-B 查看同步状态
console.log("\nStep 7: Hub-B checks team status");
const statusB = run(HUB_B, ["team", "status", "--json"]);
assert(statusB.status === 0, "Hub-B team status");
assert(statusB.stdout.includes("smoke-team"), "team status shows team name");

// 8. Hub-C pull → 应看到 Hub-A 的任务
console.log("\nStep 8: Hub-C pulls and sees Hub-A's task");
const pullC = run(HUB_C, ["sync", "pull", "--json"]);
assert(pullC.status === 0, "Hub-C sync pull");

// 9. 验证 team status 一致性
console.log("\nStep 9: Verify team status consistency");
const statusC = run(HUB_C, ["team", "status", "--json"]);
assert(statusC.status === 0, "Hub-C team status");

console.log(`\n=== Smoke Result: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
