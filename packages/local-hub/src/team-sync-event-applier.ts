import type {
  BranchAdoption,
  SyncEvent,
  SyncedAgentNote,
  SyncedChangePackage,
  SyncedReviewContext,
  SyncedTask,
} from "@agentgitops/core";
import { TeamSyncStore } from "./team-sync-store.js";

export interface TeamSyncEventApplyResult {
  applied: boolean;
  resourceType: string;
  resourceId: string;
}

export class TeamSyncEventApplier {
  constructor(private readonly store: TeamSyncStore) {}

  apply(event: SyncEvent): TeamSyncEventApplyResult {
    switch (event.action) {
      case "task.created":
      case "task.updated":
      case "task.completed":
        return this.applyTask(event);
      case "change_package.created":
        return this.applyChangePackage(event);
      case "review_context.updated":
        return this.applyReviewContext(event);
      case "agent_note.created":
        return this.applyAgentNote(event);
      case "agent.session.completed":
        return this.applyAgentSessionCompleted(event);
      case "task.adopted":
        return this.applyBranchAdoption(event);
      default:
        return { applied: false, resourceType: event.resourceType, resourceId: event.resourceId };
    }
  }

  private applyTask(event: SyncEvent): TeamSyncEventApplyResult {
    const payload = event.payload as Record<string, unknown>;
    const taskId = readString(payload.taskId) ?? event.resourceId;
    const existing = this.store.getSyncedTask(taskId);
    const synced: SyncedTask = {
      taskId,
      teamId: event.teamId,
      projectId: readString(payload.projectId) ?? existing?.projectId ?? "unknown",
      sourceHubId: event.hubId,
      ownerMemberId: event.actorId,
      title: readString(payload.title) ?? existing?.title ?? taskId,
      objective: readString(payload.objective) ?? existing?.objective ?? "",
      status: readString(payload.status) ?? existing?.status ?? "running",
      agentId: readString(payload.agentId) ?? existing?.agentId ?? "generic",
      baseBranch: readString(payload.baseBranch) ?? existing?.baseBranch ?? "main",
      targetBranch: readString(payload.targetBranch) ?? existing?.targetBranch ?? "",
      riskLevel: readString(payload.riskLevel) ?? existing?.riskLevel ?? "low",
      riskDomains: readStringArray(payload.riskDomains) ?? existing?.riskDomains ?? [],
      changedFiles: readStringArray(payload.changedFiles) ?? existing?.changedFiles ?? [],
      relatedTasks: readStringArray(payload.relatedTasks) ?? existing?.relatedTasks ?? [],
      createdAt: existing?.createdAt ?? event.createdAt,
      updatedAt: event.updatedAt,
    };
    this.store.upsertSyncedTask(synced);
    return { applied: true, resourceType: "task", resourceId: taskId };
  }

  private applyChangePackage(event: SyncEvent): TeamSyncEventApplyResult {
    const payload = event.payload as Record<string, unknown>;
    const packageId = readString(payload.packageId) ?? event.resourceId;
    const taskId = readString(payload.taskId);
    if (!taskId) return { applied: false, resourceType: "change_package", resourceId: packageId };

    const synced: SyncedChangePackage = {
      packageId,
      taskId,
      teamId: event.teamId,
      sourceHubId: event.hubId,
      summary: readString(payload.summary) ?? "",
      changedFiles: readStringArray(payload.changedFiles) ?? [],
      riskLevel: readString(payload.riskLevel) ?? "low",
      riskDomains: readStringArray(payload.riskDomains) ?? [],
      verificationSummary: readVerificationSummary(payload.verificationSummary),
      prUrl: readString(payload.prUrl),
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
    this.store.upsertSyncedChangePackage(synced);

    const task = this.store.getSyncedTask(taskId);
    if (task) {
      this.store.upsertSyncedTask({
        ...task,
        changedFiles: synced.changedFiles,
        riskLevel: synced.riskLevel,
        riskDomains: synced.riskDomains,
        updatedAt: event.updatedAt,
      });
    }
    return { applied: true, resourceType: "change_package", resourceId: packageId };
  }

  private applyReviewContext(event: SyncEvent): TeamSyncEventApplyResult {
    const payload = event.payload as Record<string, unknown>;
    const taskId = readString(payload.taskId);
    if (!taskId)
      return { applied: false, resourceType: "review_context", resourceId: event.resourceId };
    const context: SyncedReviewContext = {
      contextId: event.resourceId,
      taskId,
      teamId: event.teamId,
      sourceHubId: event.hubId,
      summary: readString(payload.summary) ?? "",
      verdict: readString(payload.verdict),
      keyFeedback: readStringArray(payload.keyFeedback) ?? [],
      updatedAt: event.updatedAt,
    };
    this.store.upsertSyncedReviewContext(context);
    return { applied: true, resourceType: "review_context", resourceId: context.contextId };
  }

  private applyAgentNote(event: SyncEvent): TeamSyncEventApplyResult {
    const payload = event.payload as Record<string, unknown>;
    const taskId = readString(payload.taskId);
    if (!taskId)
      return { applied: false, resourceType: "agent_note", resourceId: event.resourceId };
    const note: SyncedAgentNote = {
      noteId: event.resourceId,
      taskId,
      teamId: event.teamId,
      sourceHubId: event.hubId,
      authorId: event.actorId,
      noteType: readNoteType(payload.noteType),
      summary: readString(payload.summary) ?? "",
      files: readStringArray(payload.files) ?? [],
      createdAt: event.createdAt,
    };
    this.store.upsertSyncedAgentNote(note);
    return { applied: true, resourceType: "agent_note", resourceId: note.noteId };
  }

  private applyAgentSessionCompleted(event: SyncEvent): TeamSyncEventApplyResult {
    const payload = event.payload as Record<string, unknown>;
    const taskId = readString(payload.taskId);
    if (!taskId)
      return { applied: false, resourceType: "agent_session", resourceId: event.resourceId };
    const execution =
      payload.agentExecution && typeof payload.agentExecution === "object"
        ? (payload.agentExecution as Record<string, unknown>)
        : {};
    const status = readString(execution.status) ?? "completed";
    const strategy = readString(execution.strategy);
    const failureReason = readString(execution.failureReason);
    const stepsRemaining = readStringArray(execution.stepsRemaining) ?? [];
    const summary = [
      `Agent session ${status}`,
      strategy,
      failureReason ? `Failure: ${failureReason}` : undefined,
      stepsRemaining.length > 0 ? `Remaining: ${stepsRemaining.join("; ")}` : undefined,
    ]
      .filter(Boolean)
      .join(". ");
    const note: SyncedAgentNote = {
      noteId: event.resourceId,
      taskId,
      teamId: event.teamId,
      sourceHubId: event.hubId,
      authorId: readString(execution.agentId) ?? event.actorId,
      noteType: status === "failed" || status === "timeout" ? "blocker" : "progress",
      summary: summary || `Agent session ${status}.`,
      files: readStringArray(execution.filesRead) ?? [],
      createdAt: event.createdAt,
    };
    this.store.upsertSyncedAgentNote(note);
    return { applied: true, resourceType: "agent_session", resourceId: event.resourceId };
  }

  private applyBranchAdoption(event: SyncEvent): TeamSyncEventApplyResult {
    const payload = event.payload as Record<string, unknown>;
    const taskId = readString(payload.taskId);
    const sourceBranch = readString(payload.sourceBranch);
    if (!taskId || !sourceBranch)
      return { applied: false, resourceType: "branch_adoption", resourceId: event.resourceId };
    const adoption: BranchAdoption = {
      adoptionId: event.resourceId,
      teamId: event.teamId,
      taskId,
      sourceBranch,
      adoptedBy: event.actorId,
      previousOwner: readString(payload.previousOwner),
      status: "active",
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
    this.store.upsertBranchAdoption(adoption);
    return { applied: true, resourceType: "branch_adoption", resourceId: adoption.adoptionId };
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function readVerificationSummary(value: unknown): SyncedChangePackage["verificationSummary"] {
  if (!value || typeof value !== "object") return { passed: 0, failed: 0, skipped: 0 };
  const record = value as Record<string, unknown>;
  return {
    passed: readNumber(record.passed),
    failed: readNumber(record.failed),
    skipped: readNumber(record.skipped),
  };
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNoteType(value: unknown): SyncedAgentNote["noteType"] {
  return value === "blocker" || value === "handoff" || value === "warning" ? value : "progress";
}
