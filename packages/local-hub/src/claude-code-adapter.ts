import type { AgentExecutionSummary, TaskContract } from "@agentgitops/core";
import {
  GenericCliAdapter,
  type AdapterRunParams,
  type AdapterRunResult,
} from "./generic-cli-adapter.js";

/**
 * ClaudeCodeAdapter - Claude Code 专用适配器
 *
 * Claude Code 启动方式：claude --project <workspace> --prompt-file <file>
 * 特性：
 * - 自动构造 --project 和 --prompt-file 参数
 * - 生成 Claude Code 友好的 prompt（含 XML 风格上下文标记）
 * - 解析 Claude Code 特有的输出格式（token 用量、工具调用统计）
 */
export class ClaudeCodeAdapter {
  private readonly generic = new GenericCliAdapter();

  /**
   * 运行 Claude Code
   *
   * @param baseParams 基础参数（command 应为 claude 可执行文件路径）
   */
  async run(
    baseParams: AdapterRunParams & { command?: string },
  ): Promise<AdapterRunResult & { claudeStats?: ClaudeCodeStats }> {
    const command = baseParams.command ?? "claude";
    const promptFileContent =
      baseParams.promptFileContent ?? this.buildPrompt(baseParams.taskContract);
    const args =
      baseParams.args.length > 0
        ? baseParams.args
        : ["--project", baseParams.workspacePath, "--prompt-file", "{{task_prompt_file}}"];

    const result = await this.generic.run({
      ...baseParams,
      command,
      args,
      promptFileContent,
    });

    const claudeStats = await this.parseStats(result.logDir);

    // 将 claudeStats 合并到 executionSummary（Sprint B1）
    let executionSummary = result.executionSummary;
    if (executionSummary && claudeStats) {
      executionSummary = {
        ...executionSummary,
        agentType: "claude-code",
        tokenUsage:
          claudeStats.inputTokens || claudeStats.outputTokens
            ? {
                input: claudeStats.inputTokens,
                output: claudeStats.outputTokens,
                total: (claudeStats.inputTokens ?? 0) + (claudeStats.outputTokens ?? 0),
              }
            : undefined,
        toolCalls: claudeStats.toolCalls,
      } satisfies AgentExecutionSummary;
    }

    return {
      ...result,
      executionSummary,
      claudeStats,
    };
  }

  /**
   * 生成 Claude Code 友好的 prompt
   *
   * Claude Code 对结构化 prompt 响应更好，
   * 使用 XML 风格标记分隔上下文区块。
   */
  private buildPrompt(task: TaskContract): string {
    return `<task>
<title>${task.title}</title>
<objective>${task.objective}</objective>
${task.background ? `<background>${task.background}</background>` : ""}
</task>

<scope>
<allowed_paths>
${task.allowedPaths.map((p) => `- ${p}`).join("\n") || "- (any)"}
</allowed_paths>
<forbidden_paths>
${task.forbiddenPaths.map((p) => `- ${p}`).join("\n") || "- (none)"}
</forbidden_paths>
</scope>

<constraints>
<risk_level>${task.riskLevel}</risk_level>
${task.riskDomains ? `<risk_domains>${task.riskDomains.join(", ")}</risk_domains>` : ""}
<required_checks>
${task.requiredChecks.map((c) => `- ${c}`).join("\n") || "- (none)"}
</required_checks>
</constraints>

<instructions>
- 只修改 <allowed_paths> 范围内的文件
- 修改业务逻辑后必须补充或更新测试
- 如果局部测试通过但完整测试未运行，请在最终报告中注明
- 完成后输出变更摘要，列出修改的文件和原因
</instructions>`;
  }

  /**
   * 解析 Claude Code 输出统计
   *
   * Claude Code 会在 stderr 输出 token 用量和工具调用统计，
   * 格式类似：Token usage: input=1234 output=567
   */
  private async parseStats(logDir: string): Promise<ClaudeCodeStats | undefined> {
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const stderr = await readFile(join(logDir, "stderr.log"), "utf-8").catch(() => "");
      const stdout = await readFile(join(logDir, "stdout.log"), "utf-8").catch(() => "");
      const combined = `${stdout}\n${stderr}`;

      const tokenMatch = combined.match(
        /Token usage:\s*input=(?<input>\d+)\s*output=(?<output>\d+)/i,
      );
      const toolMatch = combined.match(/Tools? used:\s*(?<count>\d+)/i);

      if (!tokenMatch && !toolMatch) return undefined;

      return {
        inputTokens: tokenMatch?.groups?.input ? Number(tokenMatch.groups.input) : undefined,
        outputTokens: tokenMatch?.groups?.output ? Number(tokenMatch.groups.output) : undefined,
        toolCalls: toolMatch?.groups?.count ? Number(toolMatch.groups.count) : undefined,
      };
    } catch {
      return undefined;
    }
  }
}

export interface ClaudeCodeStats {
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: number;
}
