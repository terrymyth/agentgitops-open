import { useCallback, useEffect, useState } from "react";
import { GitMerge, AlertCircle, CheckCircle, Clock, Layers } from "lucide-react";
import {
  getTeamSyncTasks,
  getTeamSyncConflicts,
  type TeamSyncTask,
  type TeamSyncConflict,
} from "../api.js";
import { useI18n } from "../i18n.js";

export function SharedMergeQueue() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<TeamSyncTask[]>([]);
  const [conflicts, setConflicts] = useState<TeamSyncConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [tasksResult, conflictsResult] = await Promise.all([
        getTeamSyncTasks(),
        getTeamSyncConflicts(),
      ]);
      setTasks(tasksResult.tasks);
      setConflicts(conflictsResult.conflicts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && tasks.length === 0) {
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

  // 计算合并队列：只展示 reviewing/testing 状态的任务
  const queueTasks = tasks.filter((t) => t.status === "reviewing" || t.status === "testing");
  const mergeBatches = computeMergeBatches(queueTasks, conflicts);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">{t("sharedMergeQueue.title")}</h2>

      {/* 概览统计 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitMerge className="size-4" />
            <span>{t("sharedMergeQueue.queueSize")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">{queueTasks.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Layers className="size-4" />
            <span>{t("sharedMergeQueue.batches")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">{mergeBatches.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="size-4 text-yellow-500" />
            <span>{t("sharedMergeQueue.blocked")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">
            {mergeBatches.filter((b) => b.blocked).length}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="size-4 text-green-500" />
            <span>{t("sharedMergeQueue.ready")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">
            {mergeBatches.filter((b) => !b.blocked).length}
          </div>
        </div>
      </div>

      {/* 合并队列批次 */}
      {mergeBatches.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <GitMerge className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">{t("sharedMergeQueue.empty")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {mergeBatches.map((batch, index) => (
            <div
              key={index}
              className={`rounded-lg border p-4 ${batch.blocked ? "border-yellow-500/50 bg-yellow-500/5" : "border-border bg-card"}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {t("sharedMergeQueue.batch")} {index + 1}
                  </span>
                  {batch.canParallel && (
                    <span className="rounded-md bg-green-500/10 px-2 py-0.5 text-xs text-green-600">
                      {t("sharedMergeQueue.canParallel")}
                    </span>
                  )}
                  {batch.blocked && (
                    <span className="rounded-md bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-600">
                      {t("sharedMergeQueue.blockedLabel")}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {batch.tasks.length} {t("sharedMergeQueue.tasks")}
                </span>
              </div>

              <div className="mt-3 space-y-2">
                {batch.tasks.map((task) => (
                  <div
                    key={task.taskId}
                    className="flex items-center justify-between rounded-md border border-border p-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {task.title}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{task.taskId}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                        {task.status}
                      </span>
                      <span className="text-muted-foreground">{task.agentId}</span>
                    </div>
                  </div>
                ))}
              </div>

              {batch.blockedReason && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-yellow-500/10 p-2 text-xs text-yellow-700">
                  <AlertCircle className="size-3 mt-0.5 shrink-0" />
                  <span>{batch.blockedReason}</span>
                </div>
              )}

              {batch.suggestion && (
                <div className="mt-2 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-foreground">
                  <Clock className="size-3 mt-0.5 shrink-0" />
                  <span>{batch.suggestion}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 计算合并批次
 *
 * 将无冲突的任务分到同一批次（可并行合并），
 * 有冲突的任务分到不同批次（需串行合并）。
 * 有未解决冲突的批次标记为 blocked。
 */
function computeMergeBatches(
  tasks: TeamSyncTask[],
  conflicts: TeamSyncConflict[],
): Array<{
  tasks: TeamSyncTask[];
  canParallel: boolean;
  blocked: boolean;
  blockedReason?: string;
  suggestion?: string;
}> {
  if (tasks.length === 0) return [];

  // 构建冲突邻接图
  const conflictMap = new Map<string, Set<string>>();
  for (const c of conflicts) {
    if (!conflictMap.has(c.sourceTaskId)) conflictMap.set(c.sourceTaskId, new Set());
    if (!conflictMap.has(c.targetTaskId)) conflictMap.set(c.targetTaskId, new Set());
    conflictMap.get(c.sourceTaskId)!.add(c.targetTaskId);
    conflictMap.get(c.targetTaskId)!.add(c.sourceTaskId);
  }

  const batches: Array<{
    tasks: TeamSyncTask[];
    canParallel: boolean;
    blocked: boolean;
    blockedReason?: string;
    suggestion?: string;
  }> = [];
  const assigned = new Set<string>();

  for (const task of tasks) {
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
      const hasHighSeverity = conflicts.some(
        (c) =>
          (c.sourceTaskId === task.taskId || c.targetTaskId === task.taskId) &&
          c.severity === "high",
      );
      batches.push({
        tasks: [task],
        canParallel: false,
        blocked: hasHighSeverity,
        blockedReason: hasHighSeverity
          ? `Blocked by high-severity conflict with: ${conflictingWith.join(", ")}`
          : undefined,
        suggestion:
          conflictingWith.length > 0 ? `Merge after: ${conflictingWith.join(", ")}` : undefined,
      });
      assigned.add(task.taskId);
    }
  }

  // 更新可并行标记
  for (const batch of batches) {
    batch.canParallel = batch.tasks.length > 1 && !batch.blocked;
  }

  return batches;
}
