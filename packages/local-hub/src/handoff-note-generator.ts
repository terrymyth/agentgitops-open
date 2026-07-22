import { randomUUID } from "node:crypto";
import type { AgentExecutionSummary, AgentNote } from "@agentgitops/core";
import { ContextFeedPrivacyFilter } from "./context-feed-privacy-filter.js";

/**
 * HandoffNoteGenerator - Agent 执行后自动生成可审查交接备注
 *
 * 从 AgentExecutionSummary 自动生成结构化的 AgentNote，包含：
 * - summary：执行状态和策略摘要
 * - files：Agent 读取过的文件
 * - verification：执行过的命令
 * - reviewFocus：需要人类审查的重点
 * - risks：失败原因和已知风险
 *
 * 生成的备注经隐私过滤，可直接落盘和同步。
 */
export class HandoffNoteGenerator {
  private readonly privacyFilter = new ContextFeedPrivacyFilter();

  /**
   * 从执行摘要生成交接备注
   */
  generate(input: {
    taskId: string;
    agentId: string;
    execution: AgentExecutionSummary;
    commitSha?: string;
    prUrl?: string;
  }): AgentNote {
    const { taskId, agentId, execution, commitSha, prUrl } = input;

    const summary = this.buildSummary(execution);
    const files = this.extractFiles(execution);
    const verification = this.extractVerification(execution);
    const reviewFocus = this.extractReviewFocus(execution);
    const risks = this.extractRisks(execution);

    return {
      id: `note_${randomUUID()}`,
      taskId,
      agentId,
      summary: this.privacyFilter.redact(summary).text,
      files,
      verification,
      reviewFocus,
      risks,
      commitSha,
      prUrl,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * 构建执行摘要文本
   */
  private buildSummary(execution: AgentExecutionSummary): string {
    const parts: string[] = [
      `Agent ${execution.agentId} (${execution.agentType}) ${execution.status} with exit code ${execution.exitCode}.`,
    ];

    if (execution.strategy) {
      parts.push(`Strategy: ${execution.strategy}`);
    }

    if (execution.stepsCompleted && execution.stepsCompleted.length > 0) {
      parts.push(`Completed steps: ${execution.stepsCompleted.join("; ")}`);
    }

    if (execution.stepsRemaining && execution.stepsRemaining.length > 0) {
      parts.push(`Remaining steps: ${execution.stepsRemaining.join("; ")}`);
    }

    if (execution.selfAssessment) {
      parts.push(`Self-assessment: ${execution.selfAssessment}`);
    }

    if (execution.confidence) {
      parts.push(`Confidence: ${execution.confidence}`);
    }

    return parts.join("\n");
  }

  /**
   * 提取文件列表
   */
  private extractFiles(execution: AgentExecutionSummary): string[] {
    if (!execution.filesRead || execution.filesRead.length === 0) return [];
    return execution.filesRead.map((f) => this.privacyFilter.redact(f).text);
  }

  /**
   * 提取验证信息
   */
  private extractVerification(execution: AgentExecutionSummary): string[] {
    const items: string[] = [];
    if (execution.commandsExecuted && execution.commandsExecuted.length > 0) {
      items.push(...execution.commandsExecuted.map((cmd) => this.privacyFilter.redact(cmd).text));
    }
    if (execution.toolCalls !== undefined) {
      items.push(`Tool calls: ${execution.toolCalls}`);
    }
    return items;
  }

  /**
   * 提取审查重点
   */
  private extractReviewFocus(execution: AgentExecutionSummary): string[] {
    const items: string[] = [];

    // 失败时需要审查失败原因
    if (execution.failureReason) {
      items.push(`Failure reason: ${this.privacyFilter.redact(execution.failureReason).text}`);
    }

    // 低信心时需要审查
    if (execution.confidence === "low") {
      items.push("Low confidence: manual review recommended.");
    }

    // partial 状态需要审查未完成项
    if (execution.status === "partial" && execution.stepsRemaining) {
      items.push(`Partial completion: ${execution.stepsRemaining.length} steps remaining.`);
    }

    return items;
  }

  /**
   * 提取风险
   */
  private extractRisks(execution: AgentExecutionSummary): string[] {
    const items: string[] = [];

    if (execution.failureReason) {
      items.push(`Failed: ${this.privacyFilter.redact(execution.failureReason).text}`);
    }

    if (execution.blockedBy) {
      items.push(`Blocked by: ${this.privacyFilter.redact(execution.blockedBy).text}`);
    }

    if (execution.status === "timeout") {
      items.push("Agent timed out; results may be incomplete.");
    }

    if (execution.status === "failed") {
      items.push("Agent execution failed; do not assume changes are correct.");
    }

    return items;
  }
}
