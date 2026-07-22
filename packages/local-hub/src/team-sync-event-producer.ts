import { randomUUID } from "node:crypto";
import type {
  AgentExecutionSummary,
  AgentNote,
  BranchAdoption,
  ChangePackage,
  HandoffPackage,
  Review,
  ReviewContext,
  SyncEvent,
  SyncEventAction,
  SyncedAgentNote,
  SyncedChangePackage,
  SyncedReviewContext,
  SyncedTask,
  TaskContract,
} from "@agentgitops/core";
import { ContextFeedPrivacyFilter } from "./context-feed-privacy-filter.js";
import { TeamSyncStore } from "./team-sync-store.js";

export class TeamSyncEventProducer {
  private readonly store: TeamSyncStore;
  private readonly privacyFilter = new ContextFeedPrivacyFilter();

  constructor(projectPath: string) {
    this.store = new TeamSyncStore(projectPath);
  }

  close(): void {
    this.store.close();
  }

  recordTaskCreated(task: TaskContract): SyncEvent | null {
    return this.recordTask(task, "task.created");
  }

  recordTaskUpdated(task: TaskContract): SyncEvent | null {
    return this.recordTask(task, task.status === "merged" ? "task.completed" : "task.updated");
  }

  recordChangePackageCreated(task: TaskContract, pkg: ChangePackage): SyncEvent | null {
    const context = this.getContext();
    if (!context) return null;

    const summary = this.privacyFilter.redact(pkg.summary);
    const synced: SyncedChangePackage = {
      packageId: pkg.id,
      taskId: task.id,
      teamId: context.teamId,
      sourceHubId: context.hubId,
      summary: summary.text,
      changedFiles: pkg.changedFiles,
      riskLevel: pkg.risk.level,
      riskDomains: pkg.risk.domains,
      verificationSummary: {
        passed: pkg.checks.filter((check) => check.status === "passed").length,
        failed: pkg.checks.filter((check) => check.status === "failed").length,
        skipped: pkg.checks.filter((check) => check.status === "skipped").length,
      },
      prUrl: pkg.prUrl,
      createdAt: pkg.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.store.upsertSyncedChangePackage(synced);
    return this.enqueue({
      action: "change_package.created",
      teamId: context.teamId,
      hubId: context.hubId,
      actorId: context.memberId,
      resourceType: "change_package",
      resourceId: pkg.id,
      idempotencyKey: `change_package.created:${pkg.id}:${pkg.createdAt}`,
      payload: {
        taskId: task.id,
        packageId: pkg.id,
        summary: synced.summary,
        changedFiles: synced.changedFiles,
        riskLevel: synced.riskLevel,
        riskDomains: synced.riskDomains,
        verificationSummary: synced.verificationSummary,
        prUrl: synced.prUrl,
        redactions: summary.redactions,
      },
    });
  }

  recordReviewSubmitted(task: TaskContract, review: Review): SyncEvent | null {
    const context = this.getContext();
    if (!context) return null;

    const comment = this.privacyFilter.redact(review.comment ?? "");
    return this.enqueue({
      action: "review.submitted",
      teamId: context.teamId,
      hubId: context.hubId,
      actorId: review.reviewerId,
      resourceType: "review",
      resourceId: review.id,
      idempotencyKey: `review.submitted:${review.id}`,
      payload: {
        taskId: task.id,
        changePackageId: review.changePackageId,
        action: review.action,
        comment: comment.text || undefined,
        redactions: comment.redactions,
      },
    });
  }

  recordReviewContextUpdated(contextData: ReviewContext): SyncEvent | null {
    const context = this.getContext();
    if (!context) return null;

    const summary = this.privacyFilter.redact(formatReviewContextSummary(contextData));
    const keyFeedback = contextData.checklist.map((item) => `${item.severity}: ${item.title}`);
    const synced: SyncedReviewContext = {
      contextId: `review_context_${contextData.task.id}`,
      taskId: contextData.task.id,
      teamId: context.teamId,
      sourceHubId: context.hubId,
      summary: summary.text,
      verdict:
        contextData.summary.requestedChanges > 0 || contextData.summary.checksFailed > 0
          ? "needs_attention"
          : "ready",
      keyFeedback,
      updatedAt: new Date().toISOString(),
    };
    this.store.upsertSyncedReviewContext(synced);
    return this.enqueue({
      action: "review_context.updated",
      teamId: context.teamId,
      hubId: context.hubId,
      actorId: context.memberId,
      resourceType: "review_context",
      resourceId: synced.contextId,
      idempotencyKey: `review_context.updated:${synced.contextId}:${synced.updatedAt}`,
      payload: {
        taskId: synced.taskId,
        summary: synced.summary,
        verdict: synced.verdict,
        keyFeedback: synced.keyFeedback,
        redactions: summary.redactions,
      },
    });
  }

  /**
   * 记录 Agent 执行完成事件
   *
   * 携带 AgentExecutionSummary，让接续 Agent 知道前一个 Agent 的策略、步骤、失败原因。
   * 按同步配置过滤敏感字段（agentExecution/failureReason/filesRead）。
   */
  recordAgentSessionCompleted(
    taskId: string,
    execution: AgentExecutionSummary,
    syncConfig?: { agentExecution?: boolean; failureReason?: boolean; filesRead?: boolean },
  ): SyncEvent | null {
    const context = this.getContext();
    if (!context) return null;

    // 按同步配置过滤敏感字段
    const filtered: AgentExecutionSummary = {
      ...execution,
      strategy: syncConfig?.agentExecution === false ? undefined : execution.strategy,
      stepsCompleted: syncConfig?.agentExecution === false ? undefined : execution.stepsCompleted,
      stepsRemaining: syncConfig?.agentExecution === false ? undefined : execution.stepsRemaining,
      filesRead: syncConfig?.filesRead === false ? undefined : execution.filesRead,
      commandsExecuted:
        syncConfig?.agentExecution === false ? undefined : execution.commandsExecuted,
      failureReason: syncConfig?.failureReason === false ? undefined : execution.failureReason,
      selfAssessment: syncConfig?.agentExecution === false ? undefined : execution.selfAssessment,
      tokenUsage: syncConfig?.agentExecution === false ? undefined : execution.tokenUsage,
    };

    return this.enqueue({
      action: "agent.session.completed",
      teamId: context.teamId,
      hubId: context.hubId,
      actorId: context.memberId,
      resourceType: "agent_session",
      resourceId: `${taskId}:${execution.agentId}`,
      idempotencyKey: `agent.session.completed:${taskId}:${execution.agentId}:${execution.startedAt}`,
      payload: {
        taskId,
        agentExecution: filtered,
      },
    });
  }

  recordAgentNoteCreated(note: AgentNote): SyncEvent | null {
    const context = this.getContext();
    if (!context) return null;

    const summary = this.privacyFilter.redact(note.summary);
    const synced: SyncedAgentNote = {
      noteId: note.id,
      taskId: note.taskId,
      teamId: context.teamId,
      sourceHubId: context.hubId,
      authorId: note.agentId,
      noteType: inferNoteType(note),
      summary: summary.text,
      files: note.files,
      createdAt: note.createdAt,
    };
    this.store.upsertSyncedAgentNote(synced);
    return this.enqueue({
      action: "agent_note.created",
      teamId: context.teamId,
      hubId: context.hubId,
      actorId: note.agentId,
      resourceType: "agent_note",
      resourceId: note.id,
      idempotencyKey: `agent_note.created:${note.id}`,
      payload: {
        taskId: note.taskId,
        noteType: synced.noteType,
        summary: synced.summary,
        files: synced.files,
        redactions: summary.redactions,
      },
    });
  }

  recordTaskAdopted(adoption: BranchAdoption, handoff: HandoffPackage): SyncEvent | null {
    const context = this.getContext();
    if (!context) return null;
    this.store.upsertBranchAdoption(adoption);
    this.store.upsertHandoffPackage(handoff);
    return this.enqueue({
      action: "task.adopted",
      teamId: context.teamId,
      hubId: context.hubId,
      actorId: adoption.adoptedBy,
      resourceType: "branch_adoption",
      resourceId: adoption.adoptionId,
      idempotencyKey: `task.adopted:${adoption.adoptionId}`,
      payload: {
        taskId: adoption.taskId,
        sourceBranch: adoption.sourceBranch,
        handoffId: handoff.handoffId,
        contextFeedId: handoff.contextFeedId,
      },
    });
  }

  recordTaskContinued(
    sourceTask: TaskContract,
    targetTask: TaskContract,
    handoff: HandoffPackage,
  ): SyncEvent | null {
    const context = this.getContext();
    if (!context) return null;
    this.store.upsertHandoffPackage(handoff);
    return this.enqueue({
      action: "task.continued",
      teamId: context.teamId,
      hubId: context.hubId,
      actorId: context.memberId,
      resourceType: "handoff",
      resourceId: handoff.handoffId,
      idempotencyKey: `task.continued:${sourceTask.id}:${targetTask.id}`,
      payload: {
        sourceTaskId: sourceTask.id,
        targetTaskId: targetTask.id,
        sourceBranch: sourceTask.targetBranch,
        targetBranch: targetTask.targetBranch,
        contextFeedId: handoff.contextFeedId,
      },
    });
  }

  private recordTask(
    task: TaskContract,
    action: Extract<SyncEventAction, "task.created" | "task.updated" | "task.completed">,
  ): SyncEvent | null {
    const context = this.getContext();
    if (!context) return null;

    const synced: SyncedTask = {
      taskId: task.id,
      teamId: context.teamId,
      projectId: task.projectId,
      sourceHubId: context.hubId,
      ownerMemberId: context.memberId,
      title: task.title,
      objective: this.privacyFilter.redact(task.objective).text,
      status: task.status,
      agentId: task.agentId,
      baseBranch: task.baseBranch,
      targetBranch: task.targetBranch,
      riskLevel: task.riskLevel,
      riskDomains: task.riskDomains ?? [],
      changedFiles: [],
      relatedTasks: [],
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
    this.store.upsertSyncedTask(synced);
    return this.enqueue({
      action,
      teamId: context.teamId,
      hubId: context.hubId,
      actorId: context.memberId,
      resourceType: "task",
      resourceId: task.id,
      idempotencyKey: `${action}:${task.id}:${task.updatedAt}`,
      payload: {
        taskId: task.id,
        projectId: task.projectId,
        title: task.title,
        objective: synced.objective,
        status: task.status,
        agentId: task.agentId,
        baseBranch: task.baseBranch,
        targetBranch: task.targetBranch,
        riskLevel: task.riskLevel,
        riskDomains: task.riskDomains ?? [],
      },
    });
  }

  private enqueue(
    input: Omit<SyncEvent, "eventId" | "status" | "createdAt" | "updatedAt">,
  ): SyncEvent {
    const now = new Date().toISOString();
    return this.store.enqueueSyncEvent({
      ...input,
      eventId: `sync_${randomUUID()}`,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  }

  private getContext(): { teamId: string; hubId: string; memberId: string } | null {
    const summary = this.store.getStatusSummary();
    if (!summary.team || !summary.localHub) return null;
    return {
      teamId: summary.team.teamId,
      hubId: summary.localHub.hubId,
      memberId: summary.localHub.memberId,
    };
  }
}

function formatReviewContextSummary(context: ReviewContext): string {
  return [
    `Task ${context.task.id}: ${context.task.title}`,
    `Risk ${context.summary.riskLevel}`,
    `${context.summary.changedFiles} changed files`,
    `${context.summary.checksPassed} checks passed`,
    `${context.summary.checksFailed} checks failed`,
    `${context.summary.openConflicts} open conflicts`,
    `${context.summary.approvals} approvals`,
    `${context.summary.requestedChanges} requested changes`,
  ].join("; ");
}

function inferNoteType(note: AgentNote): SyncedAgentNote["noteType"] {
  const text = `${note.summary} ${note.risks.join(" ")}`.toLowerCase();
  if (text.includes("block") || text.includes("stuck")) return "blocker";
  if (text.includes("handoff") || text.includes("continue")) return "handoff";
  if (note.risks.length > 0) return "warning";
  return "progress";
}
