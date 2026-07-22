import type { AgentExecutionSummary, ChangePackage, HandoffDocument } from "@agentgitops/core";
import { ContextFeedPrivacyFilter } from "./context-feed-privacy-filter.js";
import { generateHandoffDocId } from "./handoff-document-store.js";

/**
 * HandoffDocumentGenerator — 交接文档自动生成器（HD-002）
 *
 * 从 AgentExecutionSummary + ChangePackage + AgentNote 生成自由格式 Markdown 交接文档。
 *
 * 交接文档同时面向 AI 消费（通过 ContextFeed 注入）和人类审查（Web UI / CLI）。
 * 不依赖 Team Sync，单机场景可用。
 */
export class HandoffDocumentGenerator {
  private readonly privacyFilter = new ContextFeedPrivacyFilter();

  generate(input: {
    taskId: string;
    agentId: string;
    agentType: string;
    execution?: AgentExecutionSummary;
    changePackage?: ChangePackage;
    agentNotes?: Array<{ summary: string; noteType: string }>;
  }): HandoffDocument {
    const { taskId, agentId, agentType, execution, changePackage, agentNotes } = input;

    const whatIDid = this.buildWhatIDid(execution, changePackage);
    const why = this.buildWhy(execution, changePackage);
    const whatITried = this.buildWhatITried(execution, agentNotes);
    const whatIDidNotDo = this.buildWhatIDidNotDo(execution, changePackage);
    const nextSteps = this.buildNextSteps(execution, changePackage);

    const title = `Handoff: ${taskId} — ${agentId}`;
    const markdown = this.formatMarkdown(title, taskId, agentId, agentType, {
      whatIDid,
      why,
      whatITried,
      whatIDidNotDo,
      nextSteps,
    });

    return {
      docId: generateHandoffDocId(taskId),
      taskId,
      agentId,
      agentType,
      title,
      markdown,
      sections: { whatIDid, why, whatITried, whatIDidNotDo, nextSteps },
      executionSummary: execution,
      createdAt: new Date().toISOString(),
    };
  }

  private buildWhatIDid(execution?: AgentExecutionSummary, pkg?: ChangePackage): string {
    const lines: string[] = [];

    if (pkg && pkg.changedFiles.length > 0) {
      lines.push("Modified files:");
      for (const file of pkg.changedFiles) {
        const intent = pkg.changeIntents?.find((c) => c.file === file);
        lines.push(
          `- \`${file}\` (${intent?.changeType ?? "modify"}): ${intent?.intent ?? "Modified"}`,
        );
      }
    }

    if (execution?.stepsCompleted && execution.stepsCompleted.length > 0) {
      lines.push("", "Completed steps:");
      for (const step of execution.stepsCompleted) {
        lines.push(`- ${step}`);
      }
    }

    if (execution?.strategy) {
      lines.push("", `Strategy: ${execution.strategy}`);
    }

    if (lines.length === 0) {
      lines.push("No specific actions recorded.");
    }

    return this.privacyFilter.redact(lines.join("\n")).text;
  }

  private buildWhy(execution?: AgentExecutionSummary, pkg?: ChangePackage): string {
    const lines: string[] = [];

    if (pkg?.objective) {
      lines.push(`Task objective: ${pkg.objective}`);
    }

    if (pkg?.impactedAreas && pkg.impactedAreas.length > 0) {
      lines.push("", `Impacted areas: ${pkg.impactedAreas.join(", ")}`);
    }

    if (pkg?.breakingChanges) {
      lines.push("", "⚠️ Breaking changes detected.");
    }

    if (execution?.strategy) {
      lines.push("", `Approach: ${execution.strategy}`);
    }

    if (lines.length === 0) {
      lines.push("No specific rationale recorded.");
    }

    return this.privacyFilter.redact(lines.join("\n")).text;
  }

  private buildWhatITried(
    execution?: AgentExecutionSummary,
    agentNotes?: Array<{ summary: string; noteType: string }>,
  ): string {
    const lines: string[] = [];

    if (execution?.status === "completed") {
      lines.push("✅ Agent completed successfully.");
    } else if (execution?.status === "failed") {
      lines.push("❌ Agent execution failed.");
    } else if (execution?.status === "partial") {
      lines.push("⚠️ Agent partially completed.");
    } else if (execution?.status === "timeout") {
      lines.push("⏱️ Agent timed out.");
    }

    if (execution?.failureReason) {
      lines.push("", `Failure reason: ${this.privacyFilter.redact(execution.failureReason).text}`);
    }

    if (agentNotes) {
      const triedNotes = agentNotes.filter(
        (n) => n.noteType === "blocker" || n.noteType === "warning",
      );
      if (triedNotes.length > 0) {
        lines.push("", "Issues encountered:");
        for (const note of triedNotes) {
          lines.push(`- ${this.privacyFilter.redact(note.summary).text}`);
        }
      }
    }

    if (execution?.commandsExecuted && execution.commandsExecuted.length > 0) {
      lines.push("", "Commands executed:");
      for (const cmd of execution.commandsExecuted.slice(0, 10)) {
        lines.push(`- ${this.privacyFilter.redact(cmd).text}`);
      }
    }

    if (lines.length === 0) {
      lines.push("No specific attempts recorded.");
    }

    return lines.join("\n");
  }

  private buildWhatIDidNotDo(execution?: AgentExecutionSummary, pkg?: ChangePackage): string {
    const lines: string[] = [];

    if (execution?.stepsRemaining && execution.stepsRemaining.length > 0) {
      lines.push("Remaining steps:");
      for (const step of execution.stepsRemaining) {
        lines.push(`- ${step}`);
      }
    }

    if (pkg?.unverifiedItems && pkg.unverifiedItems.length > 0) {
      lines.push("", "Unverified items:");
      for (const item of pkg.unverifiedItems) {
        lines.push(`- ${item}`);
      }
    }

    if (pkg?.checks) {
      const failedChecks = pkg.checks.filter((c) => c.status === "failed");
      if (failedChecks.length > 0) {
        lines.push("", "Failed checks:");
        for (const check of failedChecks) {
          lines.push(`- ${check.name}`);
        }
      }

      const skippedChecks = pkg.checks.filter((c) => c.status === "skipped");
      if (skippedChecks.length > 0) {
        lines.push("", "Skipped checks:");
        for (const check of skippedChecks) {
          lines.push(`- ${check.name}`);
        }
      }
    }

    if (lines.length === 0) {
      lines.push("No incomplete items recorded.");
    }

    return this.privacyFilter.redact(lines.join("\n")).text;
  }

  private buildNextSteps(execution?: AgentExecutionSummary, pkg?: ChangePackage): string {
    const lines: string[] = [];

    if (execution?.stepsRemaining && execution.stepsRemaining.length > 0) {
      lines.push("Continue remaining steps:");
      for (const step of execution.stepsRemaining) {
        lines.push(`- ${step}`);
      }
    }

    if (pkg?.checks) {
      const failedChecks = pkg.checks.filter((c) => c.status === "failed");
      if (failedChecks.length > 0) {
        lines.push("", "Fix failing checks:");
        for (const check of failedChecks) {
          lines.push(`- ${check.name}`);
        }
      }
    }

    if (execution?.status === "failed" && execution.strategy) {
      lines.push(
        "",
        `Previous strategy "${execution.strategy}" failed; consider an alternative approach.`,
      );
    }

    if (pkg?.risk.level === "high" || pkg?.risk.level === "critical") {
      lines.push("", "⚠️ High risk change — manual review required before merge.");
    }

    if (lines.length === 0) {
      lines.push("Run verification and proceed to review.");
    }

    return this.privacyFilter.redact(lines.join("\n")).text;
  }

  private formatMarkdown(
    title: string,
    taskId: string,
    agentId: string,
    agentType: string,
    sections: HandoffDocument["sections"],
  ): string {
    return [
      `# ${title}`,
      "",
      `Task: ${taskId}`,
      `Agent: ${agentId} (${agentType})`,
      `Generated: ${new Date().toISOString()}`,
      "",
      "## What I Did",
      sections.whatIDid,
      "",
      "## Why",
      sections.why,
      "",
      "## What I Tried",
      sections.whatITried,
      "",
      "## What I Did Not Do",
      sections.whatIDidNotDo,
      "",
      "## Next Steps",
      sections.nextSteps,
    ].join("\n");
  }
}
