#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAgentAdapter } from "../packages/local-hub/dist/index.js";

const root = mkdtempSync(path.join(tmpdir(), "agops-adapter-smoke-"));
const workspacePath = path.join(root, "workspace");
const logRoot = path.join(root, "logs");
mkdirSync(workspacePath, { recursive: true });
mkdirSync(logRoot, { recursive: true });

const candidates = [
  { type: "codex", command: findCommand("codex") },
  { type: "claude-code", command: findCommand("claude") },
];

let passed = 0;
for (const candidate of candidates) {
  if (!candidate.command) {
    console.log(`- ${candidate.type}: skipped, command not found`);
    continue;
  }
  const result = await createAgentAdapter(candidate.type).run({
    taskContract: {
      id: `task-smoke-${candidate.type}`,
      projectId: "adapter-smoke",
      title: `${candidate.type} adapter smoke`,
      objective: "Verify the real CLI binary can be executed through the dedicated adapter.",
      baseBranch: "main",
      targetBranch: `agent/task-smoke/${candidate.type}`,
      agentId: candidate.type,
      allowedPaths: [],
      forbiddenPaths: [],
      requiredChecks: [],
      riskLevel: "low",
      approval: { required: false },
      merge: { strategy: "manual", squash: true },
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    workspacePath,
    command: candidate.command,
    args: ["--version"],
    timeoutMs: 30_000,
    logRoot,
  });
  if (result.status !== "completed" || result.exitCode !== 0) {
    throw new Error(
      `${candidate.type} adapter smoke failed: status=${result.status} exit=${result.exitCode}`,
    );
  }
  passed += 1;
  console.log(`✓ ${candidate.type}: ${candidate.command}`);
}

if (passed === 0) {
  throw new Error(
    "No supported real agent CLI found. Install codex or claude to run adapter smoke.",
  );
}

console.log(`✓ Adapter smoke passed for ${passed} real CLI(s). Logs: ${logRoot}`);

function findCommand(command) {
  const pathValues = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of pathValues) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
