import type { AgentExecutionSummary } from "@agentgitops/core";
import type { TraceEntry } from "./trace-collector.js";
import { ContextFeedPrivacyFilter } from "./context-feed-privacy-filter.js";

/**
 * ExecutionSummaryExtractor - 从 Agent 执行日志中提取执行摘要
 *
 * 解析 stdout/stderr 日志，提取 strategy、steps、filesRead、failureReason 等信息，
 * 让接续 Agent 能"知情接力"而非"盲目接力"。
 *
 * 提取策略：
 * - filesRead：匹配 "Reading file: X"、"Read: X"、"cat X" 等模式
 * - commandsExecuted：匹配 "Running: X"、"Execute: X"、"$ X" 等模式
 * - failureReason：从 stderr 末尾提取错误信息
 * - strategy/steps：匹配 "Strategy:"、"Plan:"、"Step X:" 等结构化标记
 * - selfAssessment/confidence：匹配 "Summary:"、"Assessment:"、"Confidence:" 等标记
 *
 * 所有提取结果经 ContextFeedPrivacyFilter 脱敏。
 */
export class ExecutionSummaryExtractor {
  private readonly privacyFilter = new ContextFeedPrivacyFilter();

  /**
   * 从日志条目中提取执行摘要
   */
  extract(input: {
    agentId: string;
    agentType: string;
    status: AgentExecutionSummary["status"];
    exitCode: number;
    startedAt: string;
    endedAt: string;
    entries: TraceEntry[];
    agentVersion?: string;
    model?: string;
    tokenUsage?: { input?: number; output?: number; total?: number };
    toolCalls?: number;
  }): AgentExecutionSummary {
    const startedMs = new Date(input.startedAt).getTime();
    const endedMs = new Date(input.endedAt).getTime();
    const durationMs = Number.isFinite(endedMs - startedMs) ? endedMs - startedMs : 0;

    const stdoutText = input.entries
      .filter((e) => e.stream === "stdout")
      .map((e) => e.data)
      .join("\n");
    const stderrText = input.entries
      .filter((e) => e.stream === "stderr")
      .map((e) => e.data)
      .join("\n");
    const combined = `${stdoutText}\n${stderrText}`;

    const filesRead = this.extractFilesRead(combined);
    const commandsExecuted = this.extractCommandsExecuted(combined);
    const strategy = this.extractStrategy(combined);
    const stepsCompleted = this.extractStepsCompleted(combined);
    const stepsRemaining = this.extractStepsRemaining(combined);
    const failureReason =
      input.status !== "completed"
        ? this.extractFailureReason(stderrText, stdoutText, input.exitCode)
        : undefined;
    const selfAssessment = this.extractSelfAssessment(combined);
    const confidence = this.extractConfidence(combined);

    return {
      agentId: input.agentId,
      agentType: input.agentType,
      agentVersion: input.agentVersion,
      model: input.model,
      status: input.status,
      exitCode: input.exitCode,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationMs,
      strategy: strategy ?? undefined,
      stepsCompleted: stepsCompleted ?? undefined,
      stepsRemaining: stepsRemaining ?? undefined,
      filesRead: filesRead ?? undefined,
      commandsExecuted: commandsExecuted ?? undefined,
      failureReason: failureReason ?? undefined,
      tokenUsage: input.tokenUsage,
      toolCalls: input.toolCalls,
      selfAssessment: selfAssessment ?? undefined,
      confidence: confidence ?? undefined,
    };
  }

  /**
   * 提取读取过的文件列表
   *
   * 匹配模式：
   * - "Reading file: src/foo.ts"
   * - "Read: src/foo.ts"
   * - "Reading: src/foo.ts"
   * - "cat src/foo.ts"
   * - "open src/foo.ts"
   */
  private extractFilesRead(text: string): string[] | undefined {
    const patterns = [
      /(?:Reading|Read|reading|read)\s*(?:file)?:\s*(?<file>[^\s\n]+)/g,
      /(?:cat|open|view)\s+(?<file>[\w./-]+\.\w+)/g,
    ];
    const files = new Set<string>();
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const file = match.groups?.file;
        if (file && this.looksLikeFilePath(file)) {
          files.add(this.privacyFilter.redact(file).text);
        }
      }
    }
    return files.size > 0 ? [...files] : undefined;
  }

  /**
   * 提取执行过的命令
   *
   * 匹配模式：
   * - "Running: npm test"
   * - "Execute: git status"
   * - "$ npm test"
   * - "▶ npm test"
   */
  private extractCommandsExecuted(text: string): string[] | undefined {
    const patterns = [
      /(?:Running|Execute|Executing|running|execute)\s*:?\s*(?<cmd>[^\n]+)/g,
      /(?:\$|▶|→)\s+(?<cmd>[^\n]+)/g,
    ];
    const commands = new Set<string>();
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const cmd = match.groups?.cmd?.trim();
        if (cmd && cmd.length > 2 && cmd.length < 200) {
          commands.add(this.privacyFilter.redact(cmd).text);
        }
      }
    }
    return commands.size > 0 ? [...commands].slice(0, 20) : undefined;
  }

  /**
   * 提取策略描述
   *
   * 匹配模式：
   * - "Strategy: ..."
   * - "Plan: ..."
   * - "Approach: ..."
   */
  private extractStrategy(text: string): string | undefined {
    const match = text.match(/(?:Strategy|Plan|Approach)\s*:?\s*(?<strategy>[^\n]+)/i);
    if (match?.groups?.strategy) {
      return this.privacyFilter.redact(match.groups.strategy.trim()).text;
    }
    return undefined;
  }

  /**
   * 提取已完成的步骤
   *
   * 匹配模式：
   * - "✓ Step 1: ..."
   * - "[x] Step 1: ..."
   * - "Completed: ..."
   * - "Done: ..."
   */
  private extractStepsCompleted(text: string): string[] | undefined {
    const patterns = [/(?:✓|\[x\]|✅|Completed|Done|Finished)\s*:?\s*(?<step>[^\n]+)/gi];
    const steps = new Set<string>();
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const step = match.groups?.step?.trim();
        if (step && step.length > 2 && step.length < 200) {
          steps.add(this.privacyFilter.redact(step).text);
        }
      }
    }
    return steps.size > 0 ? [...steps].slice(0, 15) : undefined;
  }

  /**
   * 提取未完成的步骤
   *
   * 匹配模式：
   * - "☐ Step 2: ..."
   * - "[ ] Step 2: ..."
   * - "TODO: ..."
   * - "Remaining: ..."
   * - "Pending: ..."
   */
  private extractStepsRemaining(text: string): string[] | undefined {
    const patterns = [/(?:☐|\[ \]|⬜|TODO|Remaining|Pending|Skipped)\s*:?\s*(?<step>[^\n]+)/gi];
    const steps = new Set<string>();
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const step = match.groups?.step?.trim();
        if (step && step.length > 2 && step.length < 200) {
          steps.add(this.privacyFilter.redact(step).text);
        }
      }
    }
    return steps.size > 0 ? [...steps].slice(0, 15) : undefined;
  }

  /**
   * 提取失败原因
   *
   * 从 stderr 末尾提取错误信息，或匹配 "Error:"、"Failed:" 等模式。
   */
  private extractFailureReason(
    stderrText: string,
    stdoutText: string,
    exitCode: number,
  ): string | undefined {
    // 优先从 stderr 提取
    const errorPatterns = [
      /(?:Error|ERROR|Failed|FAILED|Failure|Exception)\s*:?\s*(?<reason>[^\n]+)/g,
    ];

    for (const pattern of errorPatterns) {
      const matches: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(stderrText)) !== null) {
        const reason = match.groups?.reason?.trim();
        if (reason && reason.length > 2) {
          matches.push(reason);
        }
      }
      if (matches.length > 0) {
        // 取最后一条错误（通常是最具体的）
        return this.privacyFilter.redact(matches[matches.length - 1]).text;
      }
    }

    // stderr 无匹配时，从 stdout 提取
    for (const pattern of errorPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(stdoutText)) !== null) {
        const reason = match.groups?.reason?.trim();
        if (reason && reason.length > 2) {
          return this.privacyFilter.redact(reason).text;
        }
      }
    }

    // 仍无匹配时，从 stderr 末尾提取最后几行
    const stderrLines = stderrText
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0);
    if (stderrLines.length > 0) {
      const lastLines = stderrLines.slice(-3).join("; ");
      return this.privacyFilter.redact(`Exit code ${exitCode}: ${lastLines}`).text;
    }

    return exitCode !== 0 ? `Agent exited with code ${exitCode}` : undefined;
  }

  /**
   * 提取 Agent 自评
   *
   * 匹配模式：
   * - "Summary: ..."
   * - "Assessment: ..."
   * - "Result: ..."
   */
  private extractSelfAssessment(text: string): string | undefined {
    const match = text.match(/(?:Summary|Assessment|Result|Conclusion)\s*:?\s*(?<text>[^\n]+)/i);
    if (match?.groups?.text) {
      const assessment = match.groups.text.trim();
      if (assessment.length > 2 && assessment.length < 500) {
        return this.privacyFilter.redact(assessment).text;
      }
    }
    return undefined;
  }

  /**
   * 提取信心等级
   *
   * 匹配模式：
   * - "Confidence: high"
   * - "Confidence level: medium"
   * - "Confidence: low"
   */
  private extractConfidence(text: string): "high" | "medium" | "low" | undefined {
    const match = text.match(/Confidence\s*(?:level)?\s*:?\s*(?<level>high|medium|low)/i);
    if (match?.groups?.level) {
      return match.groups.level.toLowerCase() as "high" | "medium" | "low";
    }
    return undefined;
  }

  /**
   * 判断字符串是否像文件路径
   */
  private looksLikeFilePath(value: string): boolean {
    // 包含扩展名或路径分隔符
    return /\.\w{1,10}$/.test(value) || /[\\/]/.test(value);
  }
}
