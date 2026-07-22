import type { AgentExecutionSummary, TaskContract } from "@agentgitops/core";
import {
  GenericCliAdapter,
  type AdapterRunParams,
  type AdapterRunResult,
} from "./generic-cli-adapter.js";

/**
 * CodexAdapter - OpenAI Codex 专用适配器
 *
 * Codex 启动方式：codex run --cwd <workspace> --task-file <file>
 * 特性：
 * - 自动构造 --cwd 和 --task-file 参数
 * - 生成 Codex 友好的 prompt（Markdown 结构）
 * - 解析 Codex/OpenAI 特有的输出格式（model、usage、finish_reason）
 */
export class CodexAdapter {
  private readonly generic = new GenericCliAdapter();

  /**
   * 运行 Codex
   *
   * @param baseParams 基础参数（command 应为 codex 可执行文件路径）
   */
  async run(
    baseParams: AdapterRunParams & { command?: string },
  ): Promise<AdapterRunResult & { codexStats?: CodexStats }> {
    const command = baseParams.command ?? "codex";
    const promptFileContent =
      baseParams.promptFileContent ?? this.buildPrompt(baseParams.taskContract);
    const args =
      baseParams.args.length > 0
        ? baseParams.args
        : ["run", "--cwd", baseParams.workspacePath, "--task-file", "{{task_prompt_file}}"];

    const result = await this.generic.run({
      ...baseParams,
      command,
      args,
      promptFileContent,
    });

    const codexStats = await this.parseStats(result.logDir);

    // 将 codexStats 合并到 executionSummary（Sprint B1）
    let executionSummary = result.executionSummary;
    if (executionSummary && codexStats) {
      executionSummary = {
        ...executionSummary,
        agentType: "codex",
        model: codexStats.model,
        tokenUsage:
          codexStats.totalTokens || codexStats.promptTokens || codexStats.completionTokens
            ? {
                input: codexStats.promptTokens,
                output: codexStats.completionTokens,
                total: codexStats.totalTokens,
              }
            : undefined,
      } satisfies AgentExecutionSummary;
    }

    return {
      ...result,
      executionSummary,
      codexStats,
    };
  }

  /**
   * 生成 Codex 友好的 prompt
   *
   * Codex 对 Markdown 结构化 prompt 响应较好，
   * 使用清晰的标题层级和明确的指令边界。
   */
  private buildPrompt(task: TaskContract): string {
    return `# Codex Task: ${task.title}

## Objective
${task.objective}

${task.background ? `## Background\n${task.background}\n` : ""}
## Working Directory
You are running in an isolated git worktree. Only modify files within the allowed paths.

## Allowed Paths
${task.allowedPaths.map((p) => `- \`${p}\``).join("\n") || "- (any path allowed)"}

## Forbidden Paths
${task.forbiddenPaths.map((p) => `- \`${p}\``).join("\n") || "- (none)"}

## Required Checks
${task.requiredChecks.map((c) => `- \`${c}\``).join("\n") || "- (none)"}

## Risk Assessment
- Risk level: **${task.riskLevel}**
${task.riskDomains ? `- Risk domains: ${task.riskDomains.join(", ")}` : ""}

## Instructions
1. Only modify files within the allowed paths listed above
2. After modifying business logic, add or update corresponding tests
3. If only partial tests pass, note this in your final report
4. Output a summary of changes with file list and rationale when done
5. Do not modify CI configuration or lock files unless explicitly required`;
  }

  /**
   * 解析 Codex/OpenAI 输出统计
   *
   * Codex 输出可能包含 OpenAI API 风格的 usage 统计：
   * {"usage":{"prompt_tokens":1234,"completion_tokens":567,"total_tokens":1801}}
   * 或文本格式：Model: gpt-4, Tokens: 1801
   */
  private async parseStats(logDir: string): Promise<CodexStats | undefined> {
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const stdout = await readFile(join(logDir, "stdout.log"), "utf-8").catch(() => "");
      const stderr = await readFile(join(logDir, "stderr.log"), "utf-8").catch(() => "");
      const combined = `${stdout}\n${stderr}`;

      // 尝试 JSON 格式解析
      const jsonUsageMatch = combined.match(
        /"usage"\s*:\s*\{[^}]*"prompt_tokens"\s*:\s*(?<prompt>\d+)[^}]*"completion_tokens"\s*:\s*(?<completion>\d+)[^}]*"total_tokens"\s*:\s*(?<total>\d+)/,
      );
      if (jsonUsageMatch?.groups) {
        const modelMatch = combined.match(/"model"\s*:\s*"(?<model>[^"]+)"/);
        return {
          model: modelMatch?.groups?.model,
          promptTokens: Number(jsonUsageMatch.groups.prompt),
          completionTokens: Number(jsonUsageMatch.groups.completion),
          totalTokens: Number(jsonUsageMatch.groups.total),
        };
      }

      // 尝试文本格式解析
      const textTokenMatch = combined.match(/Tokens?\s*:\s*(?<total>\d+)/i);
      const modelMatch = combined.match(/Model\s*:\s*(?<model>[^\s,]+)/i);
      if (textTokenMatch || modelMatch) {
        return {
          model: modelMatch?.groups?.model,
          totalTokens: textTokenMatch?.groups?.total
            ? Number(textTokenMatch.groups.total)
            : undefined,
        };
      }

      return undefined;
    } catch {
      return undefined;
    }
  }
}

export interface CodexStats {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}
