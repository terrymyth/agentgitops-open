import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentContextFeed,
  AgentExecutionSummary,
  HandoffPackage,
  HandoffPackageType,
} from "@agentgitops/core";
import { CONFIG_DIR } from "@agentgitops/core";
import { ContextFeedBuilder, formatAgentContextFeed } from "./context-feed-builder.js";
import { ContextFeedPrivacyFilter } from "./context-feed-privacy-filter.js";
import { TeamSyncStore } from "./team-sync-store.js";

export interface HandoffBuildInput {
  type: HandoffPackageType;
  sourceTaskId: string;
  targetTaskId?: string;
  targetBranch?: string;
  createdBy: string;
  remainingWork?: string[];
  knownRisks?: string[];
}

export interface BuiltHandoffPackage {
  handoff: HandoffPackage;
  contextFeed: AgentContextFeed;
  markdown: string;
  json: string;
}

export interface WrittenHandoffPackage extends BuiltHandoffPackage {
  jsonPath: string;
  markdownPath: string;
}

export class HandoffPackageBuilder {
  private readonly store: TeamSyncStore;
  private readonly privacyFilter = new ContextFeedPrivacyFilter();

  constructor(private readonly projectPath: string) {
    this.store = new TeamSyncStore(projectPath);
  }

  close(): void {
    this.store.close();
  }

  async build(input: HandoffBuildInput): Promise<BuiltHandoffPackage> {
    const summary = this.store.getStatusSummary();
    if (!summary.team) {
      throw new Error(
        "Team Sync is not initialized. Run 'agentgitops team init' or 'agentgitops team join'.",
      );
    }
    const task = this.store.getSyncedTask(input.sourceTaskId);
    if (!task) {
      throw new Error(`Synced task not found for handoff: ${input.sourceTaskId}`);
    }

    const feedBuilder = new ContextFeedBuilder(this.projectPath);
    let contextFeed: AgentContextFeed;
    try {
      contextFeed = await feedBuilder.build({
        taskId: input.sourceTaskId,
        agentType: "generic",
        compression: "detailed",
      });
    } finally {
      feedBuilder.close();
    }

    const changePackages = this.store.listSyncedChangePackages(
      summary.team.teamId,
      input.sourceTaskId,
    );
    const reviewContexts = this.store.listSyncedReviewContexts(
      summary.team.teamId,
      input.sourceTaskId,
    );
    const notes = this.store.listSyncedAgentNotes(summary.team.teamId, input.sourceTaskId);

    const inferredRemainingWork = inferRemainingWork(changePackages, reviewContexts, notes);
    const inferredRisks = inferKnownRisks(task.riskLevel, task.riskDomains, notes);

    // 提取前一个 Agent 的执行摘要（Sprint B4）
    const previousAgentExecution = this.findPreviousAgentExecution(
      summary.team.teamId,
      input.sourceTaskId,
    );

    // 推断避免重复的失败方案（Sprint B4，跨机协同核心）
    const inferredAvoidRepeating = inferAvoidRepeating(
      notes,
      changePackages,
      previousAgentExecution,
    );

    // 推断推荐的下一步（Sprint B4）
    const inferredRecommendedNextSteps = inferRecommendedNextSteps(
      inferredRemainingWork,
      previousAgentExecution,
    );
    const summaryText = this.privacyFilter.redact(
      [
        `${input.type === "adopt" ? "Adopt" : "Continue"} ${task.taskId}: ${task.title}`,
        `Source branch: ${task.targetBranch}`,
        input.targetBranch ? `Target branch: ${input.targetBranch}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    const handoff: HandoffPackage = {
      handoffId: `handoff_${task.taskId}_${randomUUID()}`,
      type: input.type,
      teamId: summary.team.teamId,
      sourceTaskId: task.taskId,
      targetTaskId: input.targetTaskId,
      sourceBranch: task.targetBranch,
      targetBranch: input.targetBranch,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      summary: summaryText.text,
      remainingWork: sanitizeList(input.remainingWork ?? inferredRemainingWork),
      knownRisks: sanitizeList(input.knownRisks ?? inferredRisks),
      contextFeedId: contextFeed.feedId,
      avoidRepeating: sanitizeList(inferredAvoidRepeating),
      recommendedNextSteps: sanitizeList(inferredRecommendedNextSteps),
      previousAgentExecution,
    };

    const markdown = formatHandoffMarkdown(handoff, contextFeed);
    const json = JSON.stringify({ handoff, contextFeed }, null, 2);
    return { handoff, contextFeed, markdown, json };
  }

  async write(built: BuiltHandoffPackage): Promise<WrittenHandoffPackage> {
    const dir = path.join(this.projectPath, CONFIG_DIR, "handoffs");
    await fs.mkdir(dir, { recursive: true });
    const jsonPath = path.join(dir, `${built.handoff.handoffId}.json`);
    const markdownPath = path.join(dir, `${built.handoff.handoffId}.md`);
    await fs.writeFile(jsonPath, built.json, "utf-8");
    await fs.writeFile(markdownPath, built.markdown, "utf-8");
    this.store.upsertHandoffPackage(built.handoff);
    return { ...built, jsonPath, markdownPath };
  }

  /**
   * 查找前一个 Agent 的执行摘要（Sprint B4）
   *
   * 从 sync_events 中查找最新的 agent.session.completed 事件，
   * 提取其 payload 中的 AgentExecutionSummary。
   */
  private findPreviousAgentExecution(
    teamId: string,
    taskId: string,
  ): AgentExecutionSummary | undefined {
    const events = this.store.listSyncEvents({ teamId, limit: 500 });
    const sessionEvents = events.filter(
      (event) =>
        event.action === "agent.session.completed" &&
        (event.payload as { taskId?: string })?.taskId === taskId,
    );
    if (sessionEvents.length === 0) return undefined;

    // 取最新的一条
    const latest = sessionEvents[sessionEvents.length - 1];
    const payload = latest.payload as { agentExecution?: AgentExecutionSummary };
    return payload?.agentExecution;
  }
}

export function formatHandoffMarkdown(
  handoff: HandoffPackage,
  contextFeed: AgentContextFeed,
): string {
  const sections: string[] = [
    `# Handoff ${handoff.handoffId}`,
    "",
    `Type: ${handoff.type}`,
    `Source task: ${handoff.sourceTaskId}`,
    `Target task: ${handoff.targetTaskId ?? "-"}`,
    `Source branch: ${handoff.sourceBranch}`,
    `Target branch: ${handoff.targetBranch ?? "-"}`,
    `Created by: ${handoff.createdBy}`,
    `Created at: ${handoff.createdAt}`,
    `Context feed: ${handoff.contextFeedId ?? "-"}`,
    "",
    "## Summary",
    handoff.summary,
    "",
    "## Remaining Work",
    ...handoff.remainingWork.map((item) => `- ${item}`),
    "",
    "## Known Risks",
    ...handoff.knownRisks.map((item) => `- ${item}`),
  ];

  // Sprint B4: 避免重复的失败方案
  if (handoff.avoidRepeating && handoff.avoidRepeating.length > 0) {
    sections.push(
      "",
      "## Avoid Repeating (Failed Approaches)",
      ...handoff.avoidRepeating.map((item) => `- ${item}`),
    );
  }

  // Sprint B4: 推荐的下一步
  if (handoff.recommendedNextSteps && handoff.recommendedNextSteps.length > 0) {
    sections.push(
      "",
      "## Recommended Next Steps",
      ...handoff.recommendedNextSteps.map((item) => `- ${item}`),
    );
  }

  // Sprint B4: 前一个 Agent 的执行摘要
  if (handoff.previousAgentExecution) {
    const exec = handoff.previousAgentExecution;
    const execLines: string[] = [
      "",
      "## Previous Agent Execution",
      `- Agent: ${exec.agentId} (${exec.agentType})`,
      `- Status: ${exec.status} (exit code ${exec.exitCode})`,
      `- Duration: ${exec.durationMs}ms`,
    ];
    if (exec.strategy) execLines.push(`- Strategy: ${exec.strategy}`);
    if (exec.failureReason) execLines.push(`- Failure reason: ${exec.failureReason}`);
    if (exec.stepsRemaining && exec.stepsRemaining.length > 0) {
      execLines.push(`- Steps remaining: ${exec.stepsRemaining.join("; ")}`);
    }
    sections.push(...execLines);
  }

  sections.push("", "## Agent Context Feed", formatAgentContextFeed(contextFeed, "markdown"));
  return sections.join("\n");
}

function inferRemainingWork(
  packages: ReturnType<TeamSyncStore["listSyncedChangePackages"]>,
  reviewContexts: ReturnType<TeamSyncStore["listSyncedReviewContexts"]>,
  notes: ReturnType<TeamSyncStore["listSyncedAgentNotes"]>,
): string[] {
  const items: string[] = [];
  const latestPackage = packages[0];
  if (latestPackage) {
    if (latestPackage.verificationSummary.failed > 0)
      items.push("Resolve failing verification checks.");
    if (latestPackage.verificationSummary.skipped > 0)
      items.push("Review skipped verification checks before merge.");
  }
  const latestReview = reviewContexts[0];
  if (latestReview?.keyFeedback.length) items.push(...latestReview.keyFeedback.slice(0, 3));
  const handoffNote = notes.find(
    (note) => note.noteType === "handoff" || note.noteType === "blocker",
  );
  if (handoffNote) items.push(handoffNote.summary);
  return items.length > 0
    ? items
    : ["No explicit remaining work recorded. Re-run verification before merge."];
}

function inferKnownRisks(
  riskLevel: string,
  riskDomains: string[],
  notes: ReturnType<TeamSyncStore["listSyncedAgentNotes"]>,
): string[] {
  const items = [
    `Risk level: ${riskLevel}`,
    ...riskDomains.map((domain) => `Risk domain: ${domain}`),
    ...notes
      .filter((note) => note.noteType === "warning" || note.noteType === "blocker")
      .map((note) => note.summary),
  ];
  return items.length > 0 ? items : ["No known risks recorded."];
}

function sanitizeList(items: string[]): string[] {
  const filter = new ContextFeedPrivacyFilter();
  return uniqueNonEmpty(items.map((item) => filter.redact(item).text));
}

function uniqueNonEmpty(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

/**
 * 推断避免重复的失败方案（Sprint B4，跨机协同核心）
 *
 * 综合多源信息推断前一个 Agent 试过但失败的方案：
 * 1. Agent Notes 中 noteType=blocker/warning 的记录
 * 2. AgentExecutionSummary.failureReason
 * 3. 失败的 verification checks
 */
function inferAvoidRepeating(
  notes: ReturnType<TeamSyncStore["listSyncedAgentNotes"]>,
  packages: ReturnType<TeamSyncStore["listSyncedChangePackages"]>,
  previousExecution?: AgentExecutionSummary,
): string[] {
  const items: string[] = [];

  // 1. 从 Agent Notes 提取 blocker 和 warning
  for (const note of notes) {
    if (note.noteType === "blocker" || note.noteType === "warning") {
      items.push(note.summary);
    }
  }

  // 2. 从前一个 Agent 的执行摘要提取失败原因
  if (previousExecution?.failureReason) {
    items.push(`Previous agent failed: ${previousExecution.failureReason}`);
  }

  // 3. 从失败的 verification checks 提取
  const latestPackage = packages[0];
  if (latestPackage && latestPackage.verificationSummary.failed > 0) {
    items.push(
      `Avoid re-running failing checks without fixing root cause (${latestPackage.verificationSummary.failed} checks failed).`,
    );
  }

  // 去重
  return [...new Set(items)];
}

/**
 * 推断推荐的下一步（Sprint B4）
 *
 * 综合多源信息推断接续 Agent 应该做什么：
 * 1. remainingWork 中的项
 * 2. AgentExecutionSummary.stepsRemaining
 * 3. 失败的 verification checks 需要修复
 */
function inferRecommendedNextSteps(
  remainingWork: string[],
  previousExecution?: AgentExecutionSummary,
): string[] {
  const items: string[] = [];

  // 1. 从 remainingWork 提取
  items.push(...remainingWork.slice(0, 5));

  // 2. 从前一个 Agent 的未完成步骤提取
  if (previousExecution?.stepsRemaining && previousExecution.stepsRemaining.length > 0) {
    items.push(...previousExecution.stepsRemaining.map((step) => `Continue: ${step}`));
  }

  // 3. 如果前一个 Agent 失败了，建议换策略
  if (previousExecution?.status === "failed" && previousExecution.strategy) {
    items.push(
      `Previous strategy "${previousExecution.strategy}" failed; consider an alternative approach.`,
    );
  }

  // 去重
  return [...new Set(items)];
}
