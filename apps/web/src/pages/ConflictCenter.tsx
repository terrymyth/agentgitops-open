import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, GitPullRequestDraft, RefreshCw } from "lucide-react";
import { getConflicts, runConflictAction, type ConflictSummary } from "../api.js";
import { useActor } from "../actor.js";
import { useEventStream } from "../events.js";
import { useI18n } from "../i18n.js";

const severityClass: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-brand-orange-50 text-brand-orange-600",
  high: "bg-brand-red-50 text-brand-red-600",
};

export function ConflictCenter() {
  const { t } = useI18n();
  const { actorId } = useActor();
  const [conflicts, setConflicts] = useState<ConflictSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const openConflicts = useMemo(
    () => conflicts.filter((conflict) => conflict.status === "open"),
    [conflicts],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    return getConflicts()
      .then((data) => {
        setConflicts(data);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleStreamEvent = useCallback(() => {
    void getConflicts()
      .then(setConflicts)
      .catch(() => undefined);
  }, []);
  const stream = useEventStream(
    ["data.changed", "conflict.updated", "task.updated"],
    handleStreamEvent,
  );

  async function onAction(
    conflictId: string,
    action: "resolve" | "false-positive" | "rebase" | "human-takeover",
  ) {
    const key = `${conflictId}:${action}`;
    setBusyKey(key);
    setActionMessage(null);
    try {
      const result = await runConflictAction(conflictId, action, { actorId });
      const actionStatus = result.actionResult?.status;
      const actionError = result.actionResult?.error;
      setActionMessage(
        [
          `${result.conflict.id}: ${result.conflict.status} / ${result.conflict.suggestion}`,
          actionStatus ? `action ${actionStatus}` : undefined,
          actionError,
        ]
          .filter(Boolean)
          .join(" - "),
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("conflicts.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("conflicts.subtitle", { count: openConflicts.length })}
          </p>
        </div>
        <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("events.status")}:</span>{" "}
          {t(`events.${stream.status}`)}
        </div>
      </div>

      {actionMessage && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {actionMessage}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && conflicts.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <GitPullRequestDraft className="mx-auto mb-2 size-6 text-tertiary-foreground" />
          <p className="text-sm text-muted-foreground">{t("conflicts.empty")}</p>
        </div>
      )}

      <div className="space-y-3">
        {conflicts.map((conflict) => (
          <div key={conflict.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-brand-orange-500" />
                  <Link
                    to={`/packages/${conflict.taskId}`}
                    className="text-sm font-medium text-foreground hover:underline"
                  >
                    {conflict.type}
                  </Link>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-tertiary-foreground">
                  <span>task {conflict.taskId}</span>
                  <span>{t("conflicts.with", { taskId: conflict.conflictingTaskId })}</span>
                  <span>{conflict.suggestion}</span>
                </div>
                {conflict.filePath && (
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    {conflict.filePath}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <span
                  className={`rounded px-2 py-1 text-xs font-medium ${severityClass[conflict.severity] ?? severityClass.medium}`}
                >
                  {conflict.severity}
                </span>
                <span className="rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                  {conflict.status}
                </span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busyKey !== null || conflict.status === "resolved"}
                onClick={() => void onAction(conflict.id, "resolve")}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-60"
              >
                {t("conflicts.resolve")}
              </button>
              <button
                type="button"
                disabled={busyKey !== null || conflict.status === "resolved"}
                onClick={() => void onAction(conflict.id, "false-positive")}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-60"
              >
                {t("conflicts.falsePositive")}
              </button>
              <button
                type="button"
                disabled={busyKey !== null || conflict.status === "resolved"}
                onClick={() => void onAction(conflict.id, "rebase")}
                className="rounded-md bg-brand-orange-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {t("conflicts.rebase")}
              </button>
              <button
                type="button"
                disabled={busyKey !== null || conflict.status === "resolved"}
                onClick={() => void onAction(conflict.id, "human-takeover")}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-60"
              >
                {t("conflicts.human")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
