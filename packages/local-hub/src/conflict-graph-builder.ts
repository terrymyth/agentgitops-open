import { createHash } from "node:crypto";
import type { ConflictGraphEdge, SyncedTask } from "@agentgitops/core";
import { TeamSyncStore } from "./team-sync-store.js";

export interface ConflictGraphBuildResult {
  teamId: string;
  edges: ConflictGraphEdge[];
}

export class ConflictGraphBuilder {
  private readonly store: TeamSyncStore;

  constructor(projectPath: string) {
    this.store = new TeamSyncStore(projectPath);
  }

  close(): void {
    this.store.close();
  }

  build(teamId?: string): ConflictGraphBuildResult {
    const summary = this.store.getStatusSummary(teamId);
    if (!summary.team) {
      throw new Error(
        "Team Sync is not initialized. Run 'agentgitops team init' or 'agentgitops team join'.",
      );
    }

    const tasks = this.store.listSyncedTasks(summary.team.teamId).map((task) => ({
      ...task,
      changedFiles: collectChangedFiles(this.store, summary.team!.teamId, task),
    }));
    const edges: ConflictGraphEdge[] = [];
    const now = new Date().toISOString();

    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const edge = buildEdge(summary.team.teamId, tasks[i], tasks[j], now);
        if (edge) edges.push(edge);
      }
    }

    const unique = dedupeEdges(edges);
    this.store.replaceConflictGraphEdges(summary.team.teamId, unique);
    return { teamId: summary.team.teamId, edges: unique };
  }
}

function buildEdge(
  teamId: string,
  source: SyncedTask,
  target: SyncedTask,
  now: string,
): ConflictGraphEdge | null {
  const sameFiles = intersect(source.changedFiles, target.changedFiles);
  if (sameFiles.length > 0) {
    const special = classifySpecialFiles(sameFiles);
    const type = special.type ?? "same_file";
    const severity = special.severity ?? "medium";
    return makeEdge(
      teamId,
      source.taskId,
      target.taskId,
      type,
      severity,
      sameFiles,
      suggestionFor(type, severity),
      now,
    );
  }

  const sameDirectories = intersect(
    source.changedFiles.map(dirname).filter(Boolean),
    target.changedFiles.map(dirname).filter(Boolean),
  );
  if (sameDirectories.length > 0) {
    return makeEdge(
      teamId,
      source.taskId,
      target.taskId,
      "same_directory",
      "low",
      sameDirectories,
      "Review directory-level coupling before merge.",
      now,
    );
  }

  const riskOverlap = intersect(source.riskDomains, target.riskDomains);
  if (riskOverlap.length > 0) {
    return makeEdge(
      teamId,
      source.taskId,
      target.taskId,
      "risk_domain",
      "low",
      riskOverlap,
      "Coordinate risk-domain ownership before parallel merge.",
      now,
    );
  }

  return null;
}

function collectChangedFiles(store: TeamSyncStore, teamId: string, task: SyncedTask): string[] {
  const files = new Set(task.changedFiles);
  for (const pkg of store.listSyncedChangePackages(teamId, task.taskId)) {
    for (const file of pkg.changedFiles) files.add(file);
  }
  return [...files].sort();
}

function makeEdge(
  teamId: string,
  sourceTaskId: string,
  targetTaskId: string,
  type: ConflictGraphEdge["type"],
  severity: ConflictGraphEdge["severity"],
  files: string[],
  suggestion: string,
  createdAt: string,
): ConflictGraphEdge {
  const orderedTasks = [sourceTaskId, targetTaskId].sort();
  const edgeKey = `${teamId}:${orderedTasks.join(":")}:${type}:${files.sort().join("|")}`;
  return {
    edgeId: `conflict_${createHash("sha256").update(edgeKey).digest("hex").slice(0, 24)}`,
    teamId,
    sourceTaskId: orderedTasks[0],
    targetTaskId: orderedTasks[1],
    type,
    severity,
    files,
    suggestion,
    createdAt,
  };
}

function classifySpecialFiles(files: string[]): {
  type?: ConflictGraphEdge["type"];
  severity?: ConflictGraphEdge["severity"];
} {
  if (
    files.some((file) =>
      /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum)$/.test(file),
    )
  ) {
    return { type: "lockfile", severity: "high" };
  }
  if (files.some((file) => /(^|\/)(migrations?|schema)\//i.test(file) || /migration/i.test(file))) {
    return { type: "migration", severity: "high" };
  }
  if (
    files.some(
      (file) =>
        /(^|\/)(\.github|\.gitlab|infra|deploy|config)\//i.test(file) ||
        /\.(ya?ml|toml|ini|env)$/i.test(file),
    )
  ) {
    return { type: "config", severity: "medium" };
  }
  return {};
}

function suggestionFor(
  type: ConflictGraphEdge["type"],
  severity: ConflictGraphEdge["severity"],
): string {
  if (type === "lockfile") return "Regenerate lockfile after ordering dependent changes.";
  if (type === "migration")
    return "Serialize migrations and confirm schema order with a human reviewer.";
  if (type === "config") return "Review config ownership and run full verification before merge.";
  if (severity === "high") return "Merge serially and rebase the later task.";
  return "Coordinate changes and rebase before PR/MR creation.";
}

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((item) => rightSet.has(item)))].sort();
}

function dirname(file: string): string {
  const parts = file.split("/");
  parts.pop();
  return parts.join("/");
}

function dedupeEdges(edges: ConflictGraphEdge[]): ConflictGraphEdge[] {
  const byId = new Map<string, ConflictGraphEdge>();
  for (const edge of edges) byId.set(edge.edgeId, edge);
  return [...byId.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(severity: ConflictGraphEdge["severity"]): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}
