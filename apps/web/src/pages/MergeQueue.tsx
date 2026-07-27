import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, CheckCircle2, GitMerge, RefreshCw, ShieldAlert } from "lucide-react";
import {
  getMergeQueue,
  runMergeAction,
  type MergeActionResult,
  type MergeQueueItem,
} from "../api.js";
import { useActor } from "../actor.js";
import { useEventStream } from "../events.js";
import { useI18n } from "../i18n.js";

export function MergeQueue() {
  const { t } = useI18n();
  const { actorId } = useActor();
  const [items, setItems] = useState<MergeQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<MergeActionResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    return getMergeQueue()
      .then((data) => {
        setItems(data);
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
    let canceled = false;
    void refresh().finally(() => {
      if (canceled) return;
    });
    return () => {
      canceled = true;
    };
  }, [refresh]);

  const handleStreamEvent = useCallback(() => {
    void getMergeQueue()
      .then(setItems)
      .catch(() => undefined);
  }, []);
  const stream = useEventStream(
    ["data.changed", "task.updated", "review.submitted"],
    handleStreamEvent,
  );

  async function onAction(taskId: string, action: "evaluate" | "approve" | "block", input = {}) {
    const key = `${taskId}:${action}`;
    setBusyKey(key);
    setActionError(null);
    try {
      const result = await runMergeAction(taskId, action, {
        actorId,
        ...input,
      });
      setActionResult(result);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("merge.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("merge.subtitle", { count: items.length })}
          </p>
        </div>
        <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("events.status")}:</span>{" "}
          {t(`events.${stream.status}`)}
        </div>
      </div>

      {actionResult && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t("merge.result")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{actionResult.message}</p>
              {actionResult.sha && (
                <p className="mt-1 font-mono text-xs text-tertiary-foreground">
                  {actionResult.sha}
                </p>
              )}
            </div>
            <span
              className={`rounded px-2 py-1 text-xs font-medium ${actionResult.merged ? "bg-brand-green-50 text-brand-green-600" : "bg-muted text-muted-foreground"}`}
            >
              {actionResult.provider ?? "local"}
            </span>
          </div>
          {actionResult.recovery && actionResult.recovery.length > 0 && (
            <div className="mt-3 rounded-md bg-muted/50 p-3">
              <p className="mb-1 text-sm font-medium text-foreground">{t("merge.recovery")}</p>
              <ul className="space-y-1">
                {actionResult.recovery.map((hint) => (
                  <li key={hint} className="text-sm text-muted-foreground">
                    {hint}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {actionError}
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

      {!loading && !error && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <GitMerge className="mx-auto mb-2 size-6 text-tertiary-foreground" />
          <p className="text-sm text-muted-foreground">{t("merge.empty")}</p>
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const gate = item.gate;
          const allowed = gate?.allowed === true;
          return (
            <div key={item.task.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {allowed ? (
                      <CheckCircle2 className="size-4 text-brand-green-500" />
                    ) : (
                      <ShieldAlert className="size-4 text-brand-orange-500" />
                    )}
                    <Link
                      to={`/packages/${item.task.id}`}
                      className="text-sm font-medium text-foreground hover:underline"
                    >
                      {item.task.title}
                    </Link>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-tertiary-foreground">
                    <span className="font-mono">{item.task.id}</span>
                    <span>{item.task.status}</span>
                    <span>{item.task.riskLevel}</span>
                    {item.prUrl && (
                      <a className="text-primary hover:underline" href={item.prUrl}>
                        PR #{item.prNumber}
                      </a>
                    )}
                  </div>
                </div>
                <span
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    allowed
                      ? "bg-brand-green-50 text-brand-green-600"
                      : "bg-brand-orange-50 text-brand-orange-600"
                  }`}
                >
                  {allowed ? t("merge.gatePassed") : t("merge.blocked")}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void onAction(item.task.id, "evaluate", { dryRun: true })}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-60"
                >
                  {busyKey === `${item.task.id}:evaluate` && (
                    <RefreshCw className="size-3 animate-spin" />
                  )}
                  {t("merge.evaluate")}
                </button>
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void onAction(item.task.id, "approve", { localOnly: true })}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-60"
                >
                  {t("merge.localApprove")}
                </button>
                <button
                  type="button"
                  disabled={busyKey !== null || !item.prNumber}
                  onClick={() => void onAction(item.task.id, "approve")}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
                >
                  {t("merge.providerMerge")}
                </button>
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void onAction(item.task.id, "block")}
                  className="inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-60"
                >
                  {t("merge.block")}
                </button>
              </div>

              {gate && gate.blockers.length > 0 && (
                <div className="mt-4 rounded-md bg-destructive/10 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="size-4" />
                    {t("merge.blockers")}
                  </div>
                  <ul className="space-y-1">
                    {gate.blockers.map((blocker) => (
                      <li key={blocker} className="text-sm text-muted-foreground">
                        {blocker}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {gate && gate.warnings.length > 0 && (
                <div className="mt-3 rounded-md bg-muted/50 p-3">
                  <p className="mb-1 text-sm font-medium text-foreground">{t("merge.warnings")}</p>
                  <ul className="space-y-1">
                    {gate.warnings.map((warning) => (
                      <li key={warning} className="text-sm text-muted-foreground">
                        {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!item.changePackage && (
                <p className="mt-3 text-sm text-muted-foreground">{t("merge.noPackage")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
