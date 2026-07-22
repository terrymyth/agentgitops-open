import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, GitBranch, Network } from "lucide-react";
import {
  getTeamSyncConflicts,
  getTeamSyncTasks,
  type TeamSyncConflict,
  type TeamSyncTask,
} from "../api.js";
import { useI18n } from "../i18n.js";

export function ConflictGraphPage() {
  const { t } = useI18n();
  const [conflicts, setConflicts] = useState<TeamSyncConflict[]>([]);
  const [tasks, setTasks] = useState<TeamSyncTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [conflictsResult, tasksResult] = await Promise.all([
        getTeamSyncConflicts(),
        getTeamSyncTasks(),
      ]);
      setConflicts(conflictsResult.conflicts);
      setTasks(tasksResult.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && conflicts.length === 0) {
    return <div className="text-muted-foreground text-sm">{t("common.loading")}…</div>;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="text-destructive text-sm">{error}</div>
        <button onClick={load} className="rounded-md border border-border px-3 py-1.5 text-sm">
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const filteredConflicts =
    filterSeverity === "all" ? conflicts : conflicts.filter((c) => c.severity === filterSeverity);

  // 构建任务节点和邻接关系
  const taskIds = new Set<string>();
  conflicts.forEach((c) => {
    taskIds.add(c.sourceTaskId);
    taskIds.add(c.targetTaskId);
  });
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));

  // 计算合并建议（简单拓扑排序提示）
  const mergeSuggestions = computeMergeSuggestions(conflicts, tasks);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t("conflictGraph.title")}</h2>
        <div className="flex items-center gap-2">
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="all">{t("conflictGraph.allSeverities")}</option>
            <option value="high">{t("conflictGraph.high")}</option>
            <option value="medium">{t("conflictGraph.medium")}</option>
            <option value="low">{t("conflictGraph.low")}</option>
          </select>
        </div>
      </div>

      {/* 概览统计 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Network className="size-4" />
            <span>{t("conflictGraph.totalEdges")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">{conflicts.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="size-4 text-red-500" />
            <span>{t("conflictGraph.highSeverity")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">
            {conflicts.filter((c) => c.severity === "high").length}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitBranch className="size-4" />
            <span>{t("conflictGraph.involvedTasks")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">{taskIds.size}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowRight className="size-4" />
            <span>{t("conflictGraph.mergeBatches")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">
            {mergeSuggestions.length}
          </div>
        </div>
      </div>

      {/* 冲突图可视化（邻接列表形式） */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">
          {t("conflictGraph.graphTitle")}
        </h3>
        {filteredConflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("conflictGraph.noConflicts")}</p>
        ) : (
          <div className="space-y-2">
            {filteredConflicts.map((conflict) => {
              const sourceTask = taskMap.get(conflict.sourceTaskId);
              const targetTask = taskMap.get(conflict.targetTaskId);
              return (
                <div key={conflict.edgeId} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-foreground">
                        {sourceTask?.title ?? conflict.sourceTaskId}
                      </span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span className="font-medium text-foreground">
                        {targetTask?.title ?? conflict.targetTaskId}
                      </span>
                    </div>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs ${
                        conflict.severity === "high"
                          ? "bg-red-500/10 text-red-600"
                          : conflict.severity === "medium"
                            ? "bg-yellow-500/10 text-yellow-600"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {conflict.severity}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {t("conflictGraph.type")}: {conflict.type}
                    </span>
                    <span>·</span>
                    <span>
                      {t("conflictGraph.files")}: {conflict.files.join(", ") || "-"}
                    </span>
                  </div>
                  <div className="mt-1 rounded-md bg-muted/50 p-2 text-xs text-foreground">
                    💡 {conflict.suggestion}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 合并建议（批次排序） */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">
          {t("conflictGraph.mergeSuggestions")}
        </h3>
        {mergeSuggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("conflictGraph.noSuggestions")}</p>
        ) : (
          <div className="space-y-3">
            {mergeSuggestions.map((batch, index) => (
              <div key={index} className="rounded-md border border-border p-3">
                <div className="text-sm font-medium text-foreground">
                  {t("conflictGraph.batch")} {index + 1}
                  {batch.canParallel && (
                    <span className="ml-2 rounded-md bg-green-500/10 px-2 py-0.5 text-xs text-green-600">
                      {t("conflictGraph.canParallel")}
                    </span>
                  )}
                </div>
                <div className="mt-2 space-y-1">
                  {batch.tasks.map((task) => (
                    <div
                      key={task.taskId}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <GitBranch className="size-3" />
                      <span className="text-foreground">{task.title}</span>
                      <span className="font-mono">{task.taskId}</span>
                    </div>
                  ))}
                </div>
                {batch.reason && (
                  <div className="mt-2 text-xs text-muted-foreground">⚠ {batch.reason}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 计算合并建议（简单批次排序）
 *
 * 将无冲突的任务分到同一批次（可并行合并），
 * 有冲突的任务分到不同批次（需串行合并）。
 */
function computeMergeSuggestions(
  conflicts: TeamSyncConflict[],
  tasks: TeamSyncTask[],
): Array<{ tasks: TeamSyncTask[]; canParallel: boolean; reason?: string }> {
  if (tasks.length === 0) return [];

  // 构建冲突邻接图
  const conflictMap = new Map<string, Set<string>>();
  for (const c of conflicts) {
    if (!conflictMap.has(c.sourceTaskId)) conflictMap.set(c.sourceTaskId, new Set());
    if (!conflictMap.has(c.targetTaskId)) conflictMap.set(c.targetTaskId, new Set());
    conflictMap.get(c.sourceTaskId)!.add(c.targetTaskId);
    conflictMap.get(c.targetTaskId)!.add(c.sourceTaskId);
  }

  // 简单贪心着色：同色任务无冲突，可并行合并
  const batches: Array<{ tasks: TeamSyncTask[]; canParallel: boolean; reason?: string }> = [];
  const assigned = new Set<string>();
  const activeTasks = tasks.filter(
    (t) => t.status === "running" || t.status === "reviewing" || t.status === "testing",
  );

  for (const task of activeTasks) {
    if (assigned.has(task.taskId)) continue;

    // 尝试将当前任务加入现有批次
    let placed = false;
    for (const batch of batches) {
      const hasConflict = batch.tasks.some((bt) => conflictMap.get(bt.taskId)?.has(task.taskId));
      if (!hasConflict) {
        batch.tasks.push(task);
        assigned.add(task.taskId);
        placed = true;
        break;
      }
    }

    if (!placed) {
      const conflictingWith = [...(conflictMap.get(task.taskId) ?? [])];
      batches.push({
        tasks: [task],
        canParallel: false,
        reason:
          conflictingWith.length > 0
            ? `Has conflicts with: ${conflictingWith.join(", ")}`
            : undefined,
      });
      assigned.add(task.taskId);
    }
  }

  // 第一个批次标记为可并行（如果没有内部冲突）
  if (batches.length > 0) {
    batches[0].canParallel = batches[0].tasks.length > 1;
  }

  return batches;
}
