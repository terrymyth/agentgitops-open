import fs from "node:fs/promises";
import path from "node:path";
import type { TaskContract, VerificationOutputSummary, VerificationRun } from "@agentgitops/core";
import { CONFIG_DIR, parseCommandLine, runCrossPlatformCommand } from "@agentgitops/core";
import { GitHubProvider, parseGitHubRepository, type GitHubCheckRun } from "@agentgitops/git";
import type { AgentgitopsConfig } from "./config-loader.js";
import { parseVerificationLog } from "./lint-log-parser.js";
import { PolicyEngine } from "./policy-engine.js";

export type RequiredCheck = CommandRequiredCheck | GitHubChecksRequiredCheck;

export interface CommandRequiredCheck {
  kind?: "command";
  name: string;
  command: string;
}

export interface GitHubChecksRequiredCheck {
  kind: "github_checks";
  name: string;
  repo: string;
  ref: string;
  token?: string;
  requireSuccess?: boolean;
}

export class VerificationGate {
  constructor(
    private readonly projectPath: string,
    private readonly policies: AgentgitopsConfig["policies"] = {},
  ) {}

  async run(
    task: TaskContract,
    workspacePath: string,
    checks: RequiredCheck[],
  ): Promise<VerificationRun[]> {
    const results: VerificationRun[] = [];
    for (const check of checks) {
      results.push(await this.runOne(task, workspacePath, check));
    }
    return results;
  }

  private async runOne(
    task: TaskContract,
    workspacePath: string,
    check: RequiredCheck,
  ): Promise<VerificationRun> {
    if (check.kind === "github_checks") {
      return await this.runGitHubChecks(task, check);
    }

    const startedAt = new Date().toISOString();
    const logDir = path.join(this.projectPath, CONFIG_DIR, "logs", task.id);
    await fs.mkdir(logDir, { recursive: true });
    const outputPath = path.join(logDir, `verify-${slugify(check.name)}.log`);
    const [command, ...args] = parseCommandLine(check.command);
    if (!command) {
      throw new Error(`Verification check command is empty: ${check.name}`);
    }

    const commandPolicy = new PolicyEngine(this.policies).evaluateCommand(command, args);
    if (!commandPolicy.allowed) {
      const output = commandPolicy.violations.map((violation) => violation.message).join("\n");
      await fs.writeFile(outputPath, output, "utf-8");
      return {
        id: `verify_${task.id}_${slugify(check.name)}`,
        taskId: task.id,
        name: check.name,
        command: check.command,
        status: "failed",
        exitCode: 126,
        durationMs: 0,
        outputPath,
        summary: parseVerificationLog(check.command, output),
        outputSummary: {
          ...summarizeVerificationOutput(output),
          errors: commandPolicy.violations.length,
        },
        startedAt,
        endedAt: new Date().toISOString(),
      };
    }

    const result = await runCrossPlatformCommand(command, args, {
      cwd: workspacePath,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    await fs.writeFile(outputPath, output, "utf-8");

    return {
      id: `verify_${task.id}_${slugify(check.name)}`,
      taskId: task.id,
      name: check.name,
      command: check.command,
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      outputPath,
      summary: parseVerificationLog(check.command, output),
      outputSummary: summarizeVerificationOutput(output),
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }

  private async runGitHubChecks(
    task: TaskContract,
    check: GitHubChecksRequiredCheck,
  ): Promise<VerificationRun> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    if (!check.token) {
      const output = "GitHub token missing for checks lookup.";
      return {
        id: `verify_${task.id}_${slugify(check.name)}`,
        taskId: task.id,
        name: check.name,
        command: `github checks ${check.repo}@${check.ref}`,
        status: check.requireSuccess === false ? "skipped" : "failed",
        exitCode: 1,
        durationMs: Date.now() - started,
        summary: parseVerificationLog(check.name, output),
        outputSummary: { errors: 1, warnings: 0 },
        startedAt,
        endedAt: new Date().toISOString(),
      };
    }

    const checkRuns = await new GitHubProvider({ token: check.token }).getCommitCheckRuns({
      repo: check.repo,
      ref: check.ref,
    });
    const failed = checkRuns.filter((run) => githubCheckStatus(run) === "failed");
    const pending = checkRuns.filter((run) => githubCheckStatus(run) === "pending");
    const status =
      failed.length > 0 || (check.requireSuccess !== false && pending.length > 0)
        ? "failed"
        : "passed";
    const noChecksStatus =
      checkRuns.length === 0 && check.requireSuccess !== false ? "failed" : status;
    const output = checkRuns
      .map((run) => `${run.name}: ${run.status}/${run.conclusion ?? "none"}`)
      .join("\n");

    return {
      id: `verify_${task.id}_${slugify(check.name)}`,
      taskId: task.id,
      name: check.name,
      command: `github checks ${check.repo}@${check.ref}`,
      status: checkRuns.length === 0 ? noChecksStatus : status,
      exitCode: failed.length > 0 || pending.length > 0 ? 1 : 0,
      durationMs: Date.now() - started,
      summary: parseVerificationLog(check.name, output),
      outputSummary: {
        errors: failed.length + (checkRuns.length === 0 && check.requireSuccess !== false ? 1 : 0),
        warnings: pending.length,
        testsPassed: checkRuns.filter((run) => githubCheckStatus(run) === "passed").length,
        testsFailed: failed.length,
        testsSkipped: pending.length,
      },
      externalUrl: checkRuns.find((run) => run.url)?.url,
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function collectRequiredChecks(
  config: AgentgitopsConfig,
  task: TaskContract,
  projectPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RequiredCheck[]> {
  const configured = config.policies?.checks?.required ?? [];
  const fromTask = task.requiredChecks.map((command) => ({ name: command, command }));
  const byCommand = new Map<string, CommandRequiredCheck>();
  for (const check of [...configured, ...fromTask]) {
    byCommand.set(check.command, { kind: "command", ...check });
  }
  const checks: RequiredCheck[] = [...byCommand.values()];

  if (config.git.provider === "github" && config.policies?.checks?.github?.enabled === true) {
    checks.push({
      kind: "github_checks",
      name: "github checks",
      repo: await resolveGitHubRepo(config, projectPath),
      ref:
        config.policies.checks.github.ref === "base_branch" ? task.baseBranch : task.targetBranch,
      token: env.GITHUB_TOKEN ?? env.GH_TOKEN,
      requireSuccess: config.policies.checks.github.require_success ?? true,
    });
  }

  return checks;
}

export function summarizeVerificationOutput(output: string): VerificationOutputSummary {
  const lower = output.toLowerCase();
  const errors =
    countRegex(lower, /\berrors?\b/g) +
    countRegex(lower, /\bfailed\b/g) +
    countRegex(lower, /\bfailures?\b/g);
  const warnings = countRegex(lower, /\bwarnings?\b/g);
  return {
    errors,
    warnings,
    testsPassed: firstNumber(lower, /(\d+)\s+passed/g),
    testsFailed: firstNumber(lower, /(\d+)\s+failed/g),
    testsSkipped: firstNumber(lower, /(\d+)\s+skipped/g),
  };
}

async function resolveGitHubRepo(config: AgentgitopsConfig, projectPath: string): Promise<string> {
  const remote = config.git.remote || "origin";
  const result = await runCrossPlatformCommand("git", ["remote", "get-url", remote], {
    cwd: projectPath,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to resolve GitHub remote '${remote}': ${result.stderr || result.stdout}`,
    );
  }
  return parseGitHubRepository(result.stdout.trim());
}

function githubCheckStatus(run: GitHubCheckRun): "passed" | "failed" | "pending" {
  if (run.status !== "completed") return "pending";
  if (
    run.conclusion === "success" ||
    run.conclusion === "neutral" ||
    run.conclusion === "skipped"
  ) {
    return "passed";
  }
  return "failed";
}

function countRegex(value: string, regex: RegExp): number {
  return [...value.matchAll(regex)].length;
}

function firstNumber(value: string, regex: RegExp): number | undefined {
  const match = regex.exec(value);
  return match?.[1] ? Number(match[1]) : undefined;
}
