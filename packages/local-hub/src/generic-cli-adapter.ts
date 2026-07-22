import path from "node:path";
import fs from "node:fs/promises";
import {
  runCrossPlatformCommand,
  type AgentExecutionSummary,
  type TaskContract,
} from "@agentgitops/core";
import type { AgentgitopsConfig } from "./config-loader.js";
import { PolicyEngine } from "./policy-engine.js";
import { TraceCollector } from "./trace-collector.js";
import { ExecutionSummaryExtractor } from "./execution-summary-extractor.js";

export interface AdapterRunParams {
  taskContract: TaskContract;
  workspacePath: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  policies?: AgentgitopsConfig["policies"];
  timeoutMs?: number;
  logRoot?: string;
  promptFileContent?: string;
}

export interface AdapterRunResult {
  exitCode: number;
  status: "completed" | "failed" | "canceled" | "timeout";
  startedAt: string;
  endedAt: string;
  logDir: string;
  /** Agent 执行摘要（Sprint B1），让接续 Agent 知道前一个 Agent 的策略、步骤、失败原因 */
  executionSummary: AgentExecutionSummary;
}

const DEFAULT_AGENT_ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
]);

const BLOCKED_AGENT_ENV_NAMES = new Set([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITLAB_TOKEN",
  "GITEA_TOKEN",
  "AGENTGITOPS_TOKEN",
  "AGENTGITOPS_GITHUB_WEBHOOK_SECRET",
  "GITHUB_WEBHOOK_SECRET",
  "GITLAB_WEBHOOK_SECRET",
  "GITEA_WEBHOOK_SECRET",
]);

/**
 * GenericCliAdapter - 通过命令模板启动任意 CLI Agent
 */
export class GenericCliAdapter {
  /**
   * 渲染命令模板
   */
  private renderTemplate(template: string, params: AdapterRunParams): string {
    return template
      .replace(/{{workspace_path}}/g, params.workspacePath)
      .replace(/{{task_id}}/g, params.taskContract.id)
      .replace(/{{task_objective}}/g, params.taskContract.objective)
      .replace(/{{task_title}}/g, params.taskContract.title)
      .replace(/{{base_branch}}/g, params.taskContract.baseBranch)
      .replace(/{{target_branch}}/g, params.taskContract.targetBranch);
  }

  /**
   * 生成任务提示文件
   */
  private async generatePromptFile(params: AdapterRunParams, logDir: string): Promise<string> {
    const promptPath = path.join(logDir, "prompt.md");
    const content = params.promptFileContent ?? this.defaultPrompt(params.taskContract);
    await fs.writeFile(promptPath, content, "utf-8");
    return promptPath;
  }

  private defaultPrompt(task: TaskContract): string {
    return `# Task: ${task.title}

## Objective
${task.objective}

${task.background ? `## Background\n${task.background}\n` : ""}
## Scope
- Allowed paths: ${task.allowedPaths.join(", ") || "(any)"}
- Forbidden paths: ${task.forbiddenPaths.join(", ") || "(none)"}

## Required Checks
${task.requiredChecks.map((c) => `- ${c}`).join("\n") || "(none)"}

## Risk Level
${task.riskLevel}${task.riskDomains ? ` (domains: ${task.riskDomains.join(", ")})` : ""}

## Notes
- 修改业务逻辑后必须补充或更新测试
- 如果局部测试通过但完整测试未运行，请在最终报告中注明
`;
  }

  /**
   * 运行 Agent
   */
  async run(params: AdapterRunParams): Promise<AdapterRunResult> {
    const logDir = path.join(
      params.logRoot ?? path.join(path.dirname(params.workspacePath), "logs"),
      params.taskContract.id,
    );
    await fs.mkdir(logDir, { recursive: true });

    // 生成提示文件
    const promptPath = await this.generatePromptFile(params, logDir);

    // 渲染命令参数
    const renderedArgs = params.args.map((arg) => {
      const rendered = this.renderTemplate(arg, params);
      return rendered.replace(/{{task_prompt_file}}/g, promptPath);
    });

    const trace = new TraceCollector(logDir);
    const startedAt = new Date().toISOString();

    let exitCode: number;
    let status: AdapterRunResult["status"] = "completed";
    let failureReason: string | undefined;

    try {
      const commandPolicy = new PolicyEngine(params.policies).evaluateCommand(
        params.command,
        renderedArgs,
      );
      if (!commandPolicy.allowed) {
        throw new Error(commandPolicy.violations.map((violation) => violation.message).join("\n"));
      }

      const result = await runCrossPlatformCommand(params.command, renderedArgs, {
        cwd: params.workspacePath,
        env: buildAgentEnvironment(process.env, params.env),
        timeoutMs: params.timeoutMs,
        onStdout: (chunk) => trace.append("stdout", chunk),
        onStderr: (chunk) => trace.append("stderr", chunk),
      });
      exitCode = result.exitCode;

      if (result.timedOut) {
        status = "timeout";
        failureReason = "Agent command timed out.";
      } else if (exitCode !== 0) {
        status = "failed";
        failureReason = `Agent command exited with code ${exitCode}.`;
      }
    } catch (err) {
      exitCode = 1;
      status = "failed";
      failureReason = err instanceof Error ? err.message : String(err);
      trace.append("stderr", failureReason);
    }

    const endedAt = new Date().toISOString();
    await trace.flush();

    // 提取 Agent 执行摘要（Sprint B1）
    const extractor = new ExecutionSummaryExtractor();
    const executionSummary = extractor.extract({
      agentId: params.taskContract.agentId,
      agentType: "generic-cli",
      status,
      exitCode,
      startedAt,
      endedAt,
      entries: trace.getEntries(),
    });

    return { exitCode, status, startedAt, endedAt, logDir, executionSummary };
  }
}

export function buildAgentEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  configuredEnv: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (!DEFAULT_AGENT_ENV_ALLOWLIST.has(key)) continue;
    if (isBlockedAgentEnvName(key)) continue;
    env[key] = value;
  }

  for (const [key, value] of Object.entries(configuredEnv)) {
    if (isBlockedAgentEnvName(key)) continue;
    env[key] = value;
  }

  return env;
}

function isBlockedAgentEnvName(name: string): boolean {
  return BLOCKED_AGENT_ENV_NAMES.has(name.toUpperCase());
}
