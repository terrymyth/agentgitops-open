import type { AgentExecutionSummary, ChangePackage, ReviewContext } from "@agentgitops/core";
import { ContextFeedPrivacyFilter } from "./context-feed-privacy-filter.js";

/**
 * AI Review 摘要生成器（L3-001）
 *
 * 在 Agent 执行完成后，自动生成可读的 Review 摘要，
 * 辅助人类 Reviewer 快速理解变更内容和风险。
 *
 * 摘要包含：
 * - 变更概述（一句话总结）
 * - 关键变更点（按文件分组）
 * - 风险评估（基于 Policy Engine 结果）
 * - 验证状态摘要
 * - Agent 自评和信心等级
 * - 建议审查重点
 */
export class AiReviewSummaryGenerator {
  private readonly privacyFilter = new ContextFeedPrivacyFilter();

  generate(input: {
    changePackage: ChangePackage;
    reviewContext?: ReviewContext;
    executionSummary?: AgentExecutionSummary;
  }): AiReviewSummary {
    const { changePackage: pkg, reviewContext, executionSummary: exec } = input;

    const summary = this.buildOneLineSummary(pkg);
    const keyChanges = this.extractKeyChanges(pkg);
    const riskAssessment = this.assessRisk(pkg);
    const verificationStatus = this.summarizeVerification(pkg);
    const agentSelfAssessment = this.extractAgentAssessment(exec);
    const reviewFocus = this.suggestReviewFocus(pkg, exec, reviewContext);

    return {
      summary,
      keyChanges,
      riskAssessment,
      verificationStatus,
      agentSelfAssessment,
      reviewFocus,
      generatedAt: new Date().toISOString(),
    };
  }

  formatMarkdown(summary: AiReviewSummary): string {
    const lines: string[] = [
      "<!-- agentgitops:ai-review-summary -->",
      "## 🤖 AI Review Summary",
      "",
      `**One-line summary:** ${summary.summary}`,
      "",
      "### Key Changes",
      ...summary.keyChanges.map((c) => `- **${c.file}** (${c.changeType}): ${c.description}`),
      "",
      "### Risk Assessment",
      `- Risk level: **${summary.riskAssessment.level}**`,
      ...(summary.riskAssessment.domains.length > 0
        ? [`- Risk domains: ${summary.riskAssessment.domains.join(", ")}`]
        : []),
      ...(summary.riskAssessment.breakingChanges ? ["- ⚠️ Breaking changes detected"] : []),
      "",
      "### Verification Status",
      summary.verificationStatus,
      "",
    ];

    if (summary.agentSelfAssessment) {
      lines.push("### Agent Self-Assessment");
      lines.push(summary.agentSelfAssessment);
      lines.push("");
    }

    if (summary.reviewFocus.length > 0) {
      lines.push("### 📋 Suggested Review Focus");
      lines.push(...summary.reviewFocus.map((f) => `- ${f}`));
      lines.push("");
    }

    lines.push(`*Generated: ${summary.generatedAt}*`);

    return lines.join("\n");
  }

  private buildOneLineSummary(pkg: ChangePackage): string {
    const fileCount = pkg.changedFiles.length;
    const insertions = pkg.stats.insertions;
    const deletions = pkg.stats.deletions;
    const objective =
      pkg.objective.length > 80 ? pkg.objective.slice(0, 77) + "..." : pkg.objective;
    return `${fileCount} files changed (+${insertions} -${deletions}): ${objective}`;
  }

  private extractKeyChanges(
    pkg: ChangePackage,
  ): Array<{ file: string; changeType: string; description: string }> {
    return pkg.changedFiles.slice(0, 10).map((file) => {
      const intent = pkg.changeIntents?.find((c) => c.file === file);
      return {
        file: this.privacyFilter.redact(file).text,
        changeType: intent?.changeType ?? "modify",
        description: intent?.intent ?? "Modified",
      };
    });
  }

  private assessRisk(pkg: ChangePackage): {
    level: string;
    domains: string[];
    breakingChanges: boolean;
  } {
    return {
      level: pkg.risk.level,
      domains: pkg.risk.domains,
      breakingChanges: pkg.breakingChanges ?? false,
    };
  }

  private summarizeVerification(pkg: ChangePackage): string {
    const checks = pkg.checks;
    const passed = checks.filter((c) => c.status === "passed").length;
    const failed = checks.filter((c) => c.status === "failed").length;
    const skipped = checks.filter((c) => c.status === "skipped").length;

    if (failed > 0) {
      return `❌ ${failed} check(s) failed, ${passed} passed, ${skipped} skipped`;
    }
    if (skipped > 0) {
      return `⚠️ ${passed} passed, ${skipped} skipped (review skipped checks)`;
    }
    return `✅ All ${passed} check(s) passed`;
  }

  private extractAgentAssessment(exec?: AgentExecutionSummary): string | undefined {
    if (!exec) return undefined;
    const parts: string[] = [];
    if (exec.selfAssessment) parts.push(exec.selfAssessment);
    if (exec.confidence) parts.push(`Confidence: ${exec.confidence}`);
    return parts.length > 0 ? parts.join(" | ") : undefined;
  }

  private suggestReviewFocus(
    pkg: ChangePackage,
    exec?: AgentExecutionSummary,
    _reviewContext?: ReviewContext,
  ): string[] {
    const focus: string[] = [];

    // 高风险文件
    if (pkg.risk.highRiskFilesTouched) {
      focus.push("High-risk files were modified — review carefully for security implications.");
    }

    // 破坏性变更
    if (pkg.breakingChanges) {
      focus.push("Breaking changes detected — verify backward compatibility.");
    }

    // 未验证项
    if (pkg.unverifiedItems.length > 0) {
      focus.push(`Unverified items: ${pkg.unverifiedItems.join(", ")}`);
    }

    // Agent 低信心
    if (exec?.confidence === "low") {
      focus.push("Agent reported low confidence — manual review strongly recommended.");
    }

    // Agent 失败
    if (exec?.status === "failed" || exec?.status === "partial") {
      focus.push(`Agent execution was ${exec.status} — verify changes are correct.`);
    }

    // Review Context 反馈（如果有的话，通过 summary 字段提取）
    // ReviewContext 的具体字段可能因版本而异，这里保守处理

    return focus;
  }
}

export interface AiReviewSummary {
  summary: string;
  keyChanges: Array<{ file: string; changeType: string; description: string }>;
  riskAssessment: { level: string; domains: string[]; breakingChanges: boolean };
  verificationStatus: string;
  agentSelfAssessment?: string;
  reviewFocus: string[];
  generatedAt: string;
}
