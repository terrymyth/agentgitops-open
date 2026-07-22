import { useCallback, useEffect, useState } from "react";
import { Users, GitBranch, AlertTriangle, FileText } from "lucide-react";
import {
  getTeamSyncStatus,
  getTeamSyncTasks,
  getTeamSyncConflicts,
  type TeamSyncStatus,
  type TeamSyncTask,
  type TeamSyncConflict,
} from "../api.js";
import { useI18n } from "../i18n.js";

export function TeamBoard() {
  const { t } = useI18n();
  const [status, setStatus] = useState<TeamSyncStatus | null>(null);
  const [tasks, setTasks] = useState<TeamSyncTask[]>([]);
  const [conflicts, setConflicts] = useState<TeamSyncConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [statusResult, tasksResult, conflictsResult] = await Promise.all([
        getTeamSyncStatus(),
        getTeamSyncTasks(),
        getTeamSyncConflicts(),
      ]);
      setStatus(statusResult);
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

  if (loading && !status) {
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

  if (!status?.team) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <Users className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">{t("teamBoard.notInitialized")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">{t("teamBoard.title")}</h2>

      {/* 团队概览 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="size-4" />
            <span>{t("teamBoard.members")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">{status.members}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="size-4" />
            <span>{t("teamBoard.cachedTasks")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">{status.cachedTasks}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="size-4" />
            <span>{t("teamBoard.conflicts")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">{status.conflictEdges}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitBranch className="size-4" />
            <span>{t("teamBoard.pendingEvents")}</span>
          </div>
          <div className="mt-2 text-xl font-semibold text-foreground">{status.pendingEvents}</div>
        </div>
      </div>

      {/* 团队信息 */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">{t("teamBoard.teamInfo")}</h3>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">{t("teamBoard.teamName")}</dt>
          <dd className="text-foreground">{status.team.name}</dd>
          <dt className="text-muted-foreground">{t("teamBoard.teamId")}</dt>
          <dd className="text-foreground font-mono text-xs">{status.team.teamId}</dd>
          <dt className="text-muted-foreground">{t("teamBoard.syncMode")}</dt>
          <dd className="text-foreground">{status.team.syncMode}</dd>
          <dt className="text-muted-foreground">{t("teamBoard.relay")}</dt>
          <dd className="text-foreground">{status.team.relayUrl ?? "-"}</dd>
        </dl>
      </div>

      {/* 团队任务列表 */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">{t("teamBoard.tasksTitle")}</h3>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("common.empty")}</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.taskId}
                className="flex items-center justify-between rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{task.title}</div>
                  <div className="text-xs text-muted-foreground font-mono">{task.taskId}</div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                    {task.status}
                  </span>
                  <span className="text-muted-foreground">{task.agentId}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 冲突信号 */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">
          {t("teamBoard.conflictsTitle")}
        </h3>
        {conflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("teamBoard.noConflicts")}</p>
        ) : (
          <div className="space-y-2">
            {conflicts.map((conflict) => (
              <div key={conflict.edgeId} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {conflict.sourceTaskId} → {conflict.targetTaskId}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs ${
                      conflict.severity === "high"
                        ? "bg-destructive/10 text-destructive"
                        : conflict.severity === "medium"
                          ? "bg-yellow-500/10 text-yellow-600"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {conflict.severity}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("teamBoard.conflictType")}: {conflict.type} · {t("teamBoard.files")}:{" "}
                  {conflict.files.join(", ") || "-"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{conflict.suggestion}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
