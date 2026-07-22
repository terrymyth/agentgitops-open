import type { ChangePackage, TaskContract, TeamSyncPullRequestContext } from "@agentgitops/core";
import { ConflictGraphBuilder } from "./conflict-graph-builder.js";
import { ContextFeedBuilder } from "./context-feed-builder.js";
import { TeamSyncStore } from "./team-sync-store.js";

export class TeamSyncPullRequestContextBuilder {
  private readonly store: TeamSyncStore;

  constructor(private readonly projectPath: string) {
    this.store = new TeamSyncStore(projectPath);
  }

  close(): void {
    this.store.close();
  }

  async build(
    task: TaskContract,
    changePackage: ChangePackage,
  ): Promise<TeamSyncPullRequestContext> {
    const summary = this.store.getStatusSummary();
    if (!summary.team) {
      return {
        syncStatus: "local-only",
        controlPlane: "disabled",
        offlineChanges: true,
      };
    }

    const conflictEdges = buildConflictEdges(this.projectPath, summary.team.teamId);
    const relatedEdges = conflictEdges.filter(
      (edge) => edge.sourceTaskId === task.id || edge.targetTaskId === task.id,
    );
    const syncedTask = this.store.getSyncedTask(task.id);
    const relatedTasks = uniq([
      ...(syncedTask?.relatedTasks ?? []),
      ...relatedEdges
        .flatMap((edge) => [edge.sourceTaskId, edge.targetTaskId])
        .filter((taskId) => taskId !== task.id),
    ]);
    const relatedBranches = this.store
      .listSyncedTasks(summary.team.teamId)
      .filter((synced) => relatedTasks.includes(synced.taskId) || synced.taskId === task.id)
      .map((synced) => synced.targetBranch);
    const handoffs = this.store.listHandoffPackages(summary.team.teamId, task.id);
    const activeAdoption = this.store.getActiveBranchAdoption(summary.team.teamId, task.id);
    const contextFeed = await buildContextFeed(this.projectPath, task.id, task.agentId);
    const cursor = summary.lastPushCursor ?? summary.lastPullCursor;
    const pendingEvents = this.store.listPendingEvents(summary.team.teamId);

    return {
      teamProject: summary.team.name,
      relatedTasks,
      continuationOf: handoffs.find((handoff) => handoff.type === "continue")?.sourceTaskId,
      adoptedFrom:
        activeAdoption?.sourceBranch ??
        handoffs.find((handoff) => handoff.type === "adopt")?.sourceBranch,
      localHubInstance: summary.localHub?.hubId,
      relatedBranches,
      touchedDomains: changePackage.risk.domains,
      overlappingFiles: uniq([
        ...(changePackage.evidence?.comparison.overlappingFiles ?? []),
        ...relatedEdges.flatMap((edge) => edge.files),
      ]),
      conflictSignals: relatedEdges.map((edge) => `${edge.severity}:${edge.type}`),
      dependsOn: uniq(
        relatedEdges
          .filter((edge) => edge.severity === "high")
          .map((edge) => otherTaskId(edge.sourceTaskId, edge.targetTaskId, task.id)),
      ),
      contextFeedId: contextFeed?.feedId,
      contextFeedGeneratedAt: contextFeed?.generatedAt,
      sourceChangePackages: uniq([
        changePackage.id,
        ...this.store
          .listSyncedChangePackages(summary.team.teamId, task.id)
          .map((pkg) => pkg.packageId),
        ...handoffs.map((handoff) => handoff.handoffId),
      ]),
      usedByAgent: Boolean(contextFeed),
      humanConfirmationRequired: relatedEdges
        .filter((edge) => edge.severity === "high")
        .map((edge) => `${edge.type}:${edge.files.join(",")}`),
      syncStatus: pendingEvents.length > 0 ? "pending-local-events" : "local-cache-current",
      syncCursor: cursor?.cursor,
      controlPlane: summary.team.relayUrl ? "enabled" : "disabled",
      offlineChanges: pendingEvents.length > 0,
    };
  }
}

function otherTaskId(sourceTaskId: string, targetTaskId: string, currentTaskId: string): string {
  return sourceTaskId === currentTaskId ? targetTaskId : sourceTaskId;
}

function buildConflictEdges(projectPath: string, teamId: string) {
  const builder = new ConflictGraphBuilder(projectPath);
  try {
    return builder.build(teamId).edges;
  } catch {
    return [];
  } finally {
    builder.close();
  }
}

async function buildContextFeed(projectPath: string, taskId: string, agentType: string) {
  const builder = new ContextFeedBuilder(projectPath);
  try {
    return await builder.build({ taskId, agentType, compression: "standard" });
  } catch {
    return undefined;
  } finally {
    builder.close();
  }
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}
