import type { AgentNote, HandoffPackage } from "@agentgitops/core";

/**
 * PR Comment 同步格式化器（TS-P1-004）
 *
 * 将 Review Context / Handoff Note / Agent Notes 格式化为 PR comment，
 * 让 PR 审查者直接看到交接信息和 Agent 执行摘要。
 */

const HANDOFF_COMMENT_MARKER = "<!-- agentgitops:handoff-note -->";
const AGENT_NOTES_COMMENT_MARKER = "<!-- agentgitops:agent-notes -->";

/**
 * 格式化 Handoff Package 为 PR comment
 */
export function formatHandoffComment(handoff: HandoffPackage): string {
  const lines: string[] = [
    HANDOFF_COMMENT_MARKER,
    "## 🤝 AgentGitOps Handoff",
    "",
    `**Type:** ${handoff.type}`,
    `**Source task:** ${handoff.sourceTaskId}`,
    `**Source branch:** ${handoff.sourceBranch}`,
    handoff.targetBranch ? `**Target branch:** ${handoff.targetBranch}` : "",
    `**Created by:** ${handoff.createdBy}`,
    "",
    "### Summary",
    handoff.summary,
    "",
    "### Remaining Work",
    ...handoff.remainingWork.map((item) => `- ${item}`),
    "",
    "### Known Risks",
    ...handoff.knownRisks.map((item) => `- ${item}`),
  ];

  if (handoff.avoidRepeating && handoff.avoidRepeating.length > 0) {
    lines.push("", "### ⚠️ Avoid Repeating (Failed Approaches)");
    lines.push(...handoff.avoidRepeating.map((item) => `- ${item}`));
  }

  if (handoff.recommendedNextSteps && handoff.recommendedNextSteps.length > 0) {
    lines.push("", "### 📋 Recommended Next Steps");
    lines.push(...handoff.recommendedNextSteps.map((item) => `- ${item}`));
  }

  if (handoff.previousAgentExecution) {
    const exec = handoff.previousAgentExecution;
    lines.push("", "### 🤖 Previous Agent Execution");
    lines.push(`- **Agent:** ${exec.agentId} (${exec.agentType})`);
    lines.push(`- **Status:** ${exec.status} (exit code ${exec.exitCode})`);
    lines.push(`- **Duration:** ${exec.durationMs}ms`);
    if (exec.strategy) lines.push(`- **Strategy:** ${exec.strategy}`);
    if (exec.failureReason) lines.push(`- **Failure reason:** ${exec.failureReason}`);
  }

  return lines.filter(Boolean).join("\n");
}

/**
 * 格式化 Agent Notes 为 PR comment
 */
export function formatAgentNotesComment(notes: AgentNote[]): string {
  if (notes.length === 0) return "";

  const lines: string[] = [AGENT_NOTES_COMMENT_MARKER, "## 📝 AgentGitOps Agent Notes", ""];

  for (const note of notes.slice(0, 10)) {
    lines.push(`### ${note.agentId} — ${new Date(note.createdAt).toLocaleString()}`);
    lines.push(note.summary);
    if (note.files.length > 0) {
      lines.push("", `**Files:** ${note.files.join(", ")}`);
    }
    if (note.reviewFocus.length > 0) {
      lines.push(`**Review focus:** ${note.reviewFocus.join(" | ")}`);
    }
    if (note.risks.length > 0) {
      lines.push(`**Risks:** ${note.risks.join(" | ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 获取 Handoff comment 的 marker
 */
export function getHandoffCommentMarker(): string {
  return HANDOFF_COMMENT_MARKER;
}

/**
 * 获取 Agent Notes comment 的 marker
 */
export function getAgentNotesCommentMarker(): string {
  return AGENT_NOTES_COMMENT_MARKER;
}
