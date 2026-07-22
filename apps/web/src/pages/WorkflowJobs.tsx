import { useEffect, useState } from "react";
import { RefreshCw, RotateCcw, StopCircle } from "lucide-react";
import { cancelWorkflowJob, getWorkflowJobs, retryWorkflowJob, type WorkflowJob } from "../api.js";
import { useActor } from "../actor.js";
import { useI18n } from "../i18n.js";

export function WorkflowJobs() {
  const { t } = useI18n();
  const { actorId } = useActor();
  const [jobs, setJobs] = useState<WorkflowJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setJobs(await getWorkflowJobs());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function runJobAction(job: WorkflowJob, action: "cancel" | "retry") {
    setBusyJob(`${job.id}:${action}`);
    setError(null);
    setMessage(null);
    try {
      const result =
        action === "cancel"
          ? await cancelWorkflowJob(job.id, actorId)
          : await retryWorkflowJob(job.id, actorId);
      setMessage("message" in result ? result.message : t("jobs.actionComplete"));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyJob(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("jobs.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? t("jobs.loading") : t("jobs.subtitle", { count: jobs.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <RefreshCw className="size-4" />
          {t("common.refresh")}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-brand-green-500/30 bg-brand-green-500/10 p-3 text-sm text-brand-green-700">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-tertiary-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t("jobs.columns.job")}</th>
              <th className="px-4 py-3 font-medium">{t("jobs.columns.action")}</th>
              <th className="px-4 py-3 font-medium">{t("jobs.columns.task")}</th>
              <th className="px-4 py-3 font-medium">{t("jobs.columns.status")}</th>
              <th className="px-4 py-3 font-medium">{t("jobs.columns.time")}</th>
              <th className="px-4 py-3 font-medium">{t("jobs.columns.ops")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {jobs.map((job) => (
              <tr key={job.id}>
                <td className="px-4 py-3 font-mono text-xs text-foreground">{job.id}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  <div>{job.action}</div>
                  <div className="text-xs text-tertiary-foreground">
                    {job.source} · {job.attempt}/{job.maxAttempts}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {job.taskId ?? "-"}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                    {job.status}
                  </span>
                  {job.error && (
                    <p className="mt-1 max-w-xs truncate text-xs text-danger">{job.error}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-tertiary-foreground">
                  <div>{job.createdAt}</div>
                  {job.completedAt && <div>{job.completedAt}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {(job.status === "queued" || job.status === "running") && (
                      <button
                        type="button"
                        disabled={busyJob === `${job.id}:cancel`}
                        onClick={() => void runJobAction(job, "cancel")}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                      >
                        <StopCircle className="size-3.5" />
                        {t("jobs.cancel")}
                      </button>
                    )}
                    {(job.status === "failed" || job.status === "canceled") &&
                      job.attempt < job.maxAttempts && (
                        <button
                          type="button"
                          disabled={busyJob === `${job.id}:retry`}
                          onClick={() => void runJobAction(job, "retry")}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                        >
                          <RotateCcw className="size-3.5" />
                          {t("jobs.retry")}
                        </button>
                      )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {t("jobs.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
