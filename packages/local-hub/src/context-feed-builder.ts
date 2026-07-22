import { randomUUID } from "node:crypto";
import type {
  AgentContextFeed,
  AgentContextFeedItem,
  AgentExecutionSummary,
  ContextFeedCompression,
  ContextFeedLayer,
  SyncedTask,
} from "@agentgitops/core";
import { ContextFeedPrivacyFilter } from "./context-feed-privacy-filter.js";
import { TeamSyncStore } from "./team-sync-store.js";
import { HandoffDocumentStore } from "./handoff-document-store.js";

export interface ContextFeedBuildInput {
  taskId: string;
  agentType: string;
  compression?: ContextFeedCompression;
  tokenBudget?: number;
}

export type ContextFeedFormat = "json" | "markdown" | "prompt";

export class ContextFeedBuilder {
  private readonly store: TeamSyncStore;
  private readonly privacyFilter = new ContextFeedPrivacyFilter();
  private readonly projectPath: string;
  private latestHandoffDoc: import("@agentgitops/core").HandoffDocument | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.store = new TeamSyncStore(projectPath);
  }

  close(): void {
    this.store.close();
  }

  async build(input: ContextFeedBuildInput): Promise<AgentContextFeed> {
    const summary = this.store.getStatusSummary();
    if (!summary.team) {
      throw new Error(
        "Team Sync is not initialized. Run 'agentgitops team init' or 'agentgitops team join'.",
      );
    }

    // HD-003: 预加载交接文档
    try {
      const docStore = new HandoffDocumentStore(this.projectPath);
      this.latestHandoffDoc = await docStore.getLatestByTask(input.taskId);
    } catch {
      // 交接文档加载失败不影响 ContextFeed
    }

    const compression = input.compression ?? summary.team.settings.contextFeedCompression;
    const items = this.compressItems(
      this.buildItems(summary.team.teamId, input.taskId),
      compression,
    );
    const redactions = new Map<string, number>();
    const redactedItems = items.map((item) => {
      const redacted = this.privacyFilter.redact(item.content);
      for (const event of redacted.redactions) {
        redactions.set(event.kind, (redactions.get(event.kind) ?? 0) + event.count);
      }
      return { ...item, content: redacted.text };
    });
    const tokenBudget = input.tokenBudget ?? defaultTokenBudget(compression);
    const trimmedItems = trimToTokenBudget(redactedItems, tokenBudget);

    return {
      feedId: `feed_${input.taskId}_${randomUUID()}`,
      taskId: input.taskId,
      teamId: summary.team.teamId,
      agentType: input.agentType,
      compression,
      generatedAt: new Date().toISOString(),
      tokenEstimate: estimateTokens(
        trimmedItems.map((item) => `${item.title}\n${item.content}`).join("\n\n"),
      ),
      items: trimmedItems,
      redactions: Array.from(redactions.entries()).map(([kind, count]) => ({ kind, count })),
    };
  }

  private buildItems(teamId: string, taskId: string): AgentContextFeedItem[] {
    const now = new Date().toISOString();
    const items: AgentContextFeedItem[] = [];
    const task = this.store.getSyncedTask(taskId);
    const packages = this.store.listSyncedChangePackages(teamId, taskId);
    const reviewContexts = this.store.listSyncedReviewContexts(teamId, taskId);
    const notes = this.store.listSyncedAgentNotes(teamId, taskId);
    const pendingEvents = this.store.listPendingEvents(teamId);

    if (task) {
      items.push({
        id: `feed_item_${randomUUID()}`,
        layer: "survival",
        title: "Current Task",
        content: [
          `Title: ${task.title}`,
          `Status: ${task.status}`,
          `Agent: ${task.agentId}`,
          `Branch: ${task.baseBranch} -> ${task.targetBranch}`,
          `Risk: ${task.riskLevel}${task.riskDomains.length > 0 ? ` (${task.riskDomains.join(", ")})` : ""}`,
          `Objective: ${task.objective}`,
        ].join("\n"),
        source: { type: "task", id: task.taskId, hubId: task.sourceHubId },
        freshness: "current",
        confidence: "verified",
        createdAt: task.updatedAt,
      });
      for (const item of buildOverlapItems(task, this.store.listSyncedTasks(teamId), now))
        items.push(item);
    }

    for (const pkg of packages) {
      items.push({
        id: `feed_item_${randomUUID()}`,
        layer: "efficiency",
        title: `Change Package ${pkg.packageId}`,
        content: [
          pkg.summary,
          `Files: ${pkg.changedFiles.join(", ") || "-"}`,
          `Risk: ${pkg.riskLevel}${pkg.riskDomains.length > 0 ? ` (${pkg.riskDomains.join(", ")})` : ""}`,
          `Verification: ${pkg.verificationSummary.passed} passed, ${pkg.verificationSummary.failed} failed, ${pkg.verificationSummary.skipped} skipped`,
        ].join("\n"),
        source: { type: "change_package", id: pkg.packageId, hubId: pkg.sourceHubId },
        freshness: "current",
        confidence: "verified",
        createdAt: pkg.updatedAt,
      });
    }

    for (const context of reviewContexts) {
      items.push({
        id: `feed_item_${randomUUID()}`,
        layer: "efficiency",
        title: `Review Context ${context.contextId}`,
        content: [
          context.summary,
          `Verdict: ${context.verdict ?? "unknown"}`,
          `Feedback: ${context.keyFeedback.join(" | ") || "-"}`,
        ].join("\n"),
        source: { type: "review", id: context.contextId, hubId: context.sourceHubId },
        freshness: "current",
        confidence: "verified",
        createdAt: context.updatedAt,
      });
    }

    for (const note of notes) {
      items.push({
        id: `feed_item_${randomUUID()}`,
        layer:
          note.noteType === "blocker" || note.noteType === "handoff" ? "survival" : "efficiency",
        title: `Agent Note ${note.noteId}`,
        content: [
          `Type: ${note.noteType}`,
          note.summary,
          `Files: ${note.files.join(", ") || "-"}`,
        ].join("\n"),
        source: { type: "agent_note", id: note.noteId, hubId: note.sourceHubId },
        freshness: "current",
        confidence: "verified",
        createdAt: note.createdAt,
      });
    }

    // Sprint B4: 将前一个 Agent 的执行摘要纳入 Layer 1（efficiency）
    const previousExecution = this.findPreviousAgentExecution(teamId, taskId);

    // HD-003: 按需加载交接文档（同步方式，从文件系统预加载）
    // 交接文档在 build() 方法中预加载，通过 this.latestHandoffDoc 传入
    if (this.latestHandoffDoc) {
      items.push({
        id: `feed_item_${randomUUID()}`,
        layer: "efficiency",
        title: "Handoff Document",
        content: this.latestHandoffDoc.markdown,
        source: { type: "handoff_document", id: this.latestHandoffDoc.docId, hubId: "" },
        freshness: "current",
        confidence: "verified",
        createdAt: this.latestHandoffDoc.createdAt,
      });
    }

    if (previousExecution) {
      const execLines = [
        `Agent: ${previousExecution.agentId} (${previousExecution.agentType})`,
        `Status: ${previousExecution.status} (exit code ${previousExecution.exitCode})`,
        `Duration: ${previousExecution.durationMs}ms`,
      ];
      if (previousExecution.strategy) execLines.push(`Strategy: ${previousExecution.strategy}`);
      if (previousExecution.stepsCompleted && previousExecution.stepsCompleted.length > 0) {
        execLines.push(`Steps completed: ${previousExecution.stepsCompleted.join("; ")}`);
      }
      if (previousExecution.stepsRemaining && previousExecution.stepsRemaining.length > 0) {
        execLines.push(`Steps remaining: ${previousExecution.stepsRemaining.join("; ")}`);
      }
      if (previousExecution.failureReason) {
        execLines.push(`Failure reason: ${previousExecution.failureReason}`);
      }
      if (previousExecution.selfAssessment) {
        execLines.push(`Self-assessment: ${previousExecution.selfAssessment}`);
      }
      if (previousExecution.confidence) {
        execLines.push(`Confidence: ${previousExecution.confidence}`);
      }

      items.push({
        id: `feed_item_${randomUUID()}`,
        layer: "efficiency",
        title: "Previous Agent Execution",
        content: execLines.join("\n"),
        source: { type: "agent_session", id: `${taskId}:${previousExecution.agentId}`, hubId: "" },
        freshness: previousExecution.status === "failed" ? "current" : "stale",
        confidence: previousExecution.status === "completed" ? "verified" : "unverified",
        createdAt: previousExecution.endedAt,
      });

      // 如果有失败原因，额外添加一个 survival 层的 "Avoid Repeating" 项
      if (previousExecution.failureReason) {
        items.push({
          id: `feed_item_${randomUUID()}`,
          layer: "survival",
          title: "Avoid Repeating (Failed Approach)",
          content: `Previous agent failed with: ${previousExecution.failureReason}\nDo not repeat the same approach without modification.`,
          source: {
            type: "agent_session",
            id: `${taskId}:${previousExecution.agentId}`,
            hubId: "",
          },
          freshness: "current",
          confidence: "verified",
          createdAt: previousExecution.endedAt,
        });
      }
    }

    items.push({
      id: `feed_item_${randomUUID()}`,
      layer: "enhancement",
      title: "Sync State",
      content: `Pending events: ${pendingEvents.length}`,
      source: { type: "sync", id: teamId },
      freshness: pendingEvents.length > 0 ? "stale" : "current",
      confidence: "verified",
      createdAt: now,
    });

    return items;
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

  private compressItems(
    items: AgentContextFeedItem[],
    compression: ContextFeedCompression,
  ): AgentContextFeedItem[] {
    if (compression === "detailed") return items;
    if (compression === "minimal")
      return items.filter((item) => item.layer === "survival").slice(0, 8);
    return items.filter((item) => item.layer !== "enhancement").slice(0, 16);
  }
}

export function formatAgentContextFeed(
  feed: AgentContextFeed,
  format: ContextFeedFormat = "markdown",
): string {
  if (format === "json") return JSON.stringify(feed, null, 2);
  const header =
    feed.agentType === "claude"
      ? "Team Sync Context for Claude Code"
      : feed.agentType === "codex"
        ? "Team Sync Context for Codex"
        : "Team Sync Context";
  const sections = feed.items.map((item) =>
    [
      `## ${item.title}`,
      `Layer: ${item.layer}`,
      `Source: ${item.source.type}:${item.source.id}`,
      `Freshness: ${item.freshness}`,
      `Confidence: ${item.confidence}`,
      "",
      item.content,
    ].join("\n"),
  );
  const body = [
    `# ${header}`,
    `Feed: ${feed.feedId}`,
    `Generated: ${feed.generatedAt}`,
    `Token estimate: ${feed.tokenEstimate}`,
    "",
    ...sections,
  ].join("\n\n");
  if (format === "prompt") {
    return [
      "Use this Team Sync context as supplemental coordination data.",
      "Prefer verified/current items. Treat stale or inferred items as hints, not facts.",
      "",
      body,
    ].join("\n");
  }
  return body;
}

function buildOverlapItems(
  task: SyncedTask,
  tasks: SyncedTask[],
  now: string,
): AgentContextFeedItem[] {
  const currentFiles = new Set(task.changedFiles);
  if (currentFiles.size === 0) return [];
  return tasks
    .filter((candidate) => candidate.taskId !== task.taskId)
    .map((candidate) => ({
      task: candidate,
      files: candidate.changedFiles.filter((file) => currentFiles.has(file)),
    }))
    .filter((candidate) => candidate.files.length > 0)
    .map((candidate) => ({
      id: `feed_item_${randomUUID()}`,
      layer: "survival" as ContextFeedLayer,
      title: `File overlap with ${candidate.task.taskId}`,
      content: `Overlapping files: ${candidate.files.join(", ")}\nOther branch: ${candidate.task.targetBranch}\nSuggestion: coordinate before rebase or merge.`,
      source: {
        type: "conflict" as const,
        id: candidate.task.taskId,
        hubId: candidate.task.sourceHubId,
      },
      freshness: "current" as const,
      confidence: "verified" as const,
      createdAt: now,
    }));
}

function trimToTokenBudget(
  items: AgentContextFeedItem[],
  tokenBudget: number,
): AgentContextFeedItem[] {
  const selected: AgentContextFeedItem[] = [];
  let tokens = 0;
  for (const item of items) {
    const itemTokens = estimateTokens(`${item.title}\n${item.content}`);
    if (selected.length > 0 && tokens + itemTokens > tokenBudget) continue;
    selected.push(item);
    tokens += itemTokens;
  }
  return selected;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function defaultTokenBudget(compression: ContextFeedCompression): number {
  if (compression === "minimal") return 1200;
  if (compression === "detailed") return 6000;
  return 3000;
}
