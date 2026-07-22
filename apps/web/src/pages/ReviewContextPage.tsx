import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Clipboard,
  ClipboardList,
  FileCode,
  RefreshCw,
} from "lucide-react";
import type { ReviewContext } from "@agentgitops/core";
import { getReviewContext } from "../api.js";
import { useActor } from "../actor.js";
import { useI18n } from "../i18n.js";

export function ReviewContextPage() {
  const { taskId } = useParams();
  const { actorId } = useActor();
  const { t } = useI18n();
  const [context, setContext] = useState<ReviewContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void reload();
  }, [taskId, actorId]);

  async function reload() {
    if (!taskId) {
      setError("Task id is required");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setContext(await getReviewContext(taskId, { record: true, actorId }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function onCopyJson() {
    if (!context) return;
    await navigator.clipboard.writeText(JSON.stringify(context, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const blockers = useMemo(
    () => context?.checklist.filter((item) => item.severity === "blocker") ?? [],
    [context],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={taskId ? `/packages/${taskId}` : "/tasks"}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("package.back")}
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <RefreshCw className="size-4" />
            {t("common.retry")}
          </button>
          <button
            type="button"
            disabled={!context}
            onClick={() => void onCopyJson()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <Clipboard className="size-4" />
            {copied ? t("reviewContext.copied") : t("reviewContext.copyJson")}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          {error}
        </div>
      )}

      {!loading && !error && !context && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <ClipboardList className="mx-auto mb-2 size-6 text-tertiary-foreground" />
          <p className="text-sm text-muted-foreground">{t("reviewContext.empty")}</p>
        </div>
      )}

      {context && (
        <>
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground">{context.task.title}</h2>
                <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
                  {context.task.objective}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-tertiary-foreground">
                  <span>{context.task.id}</span>
                  <span>{context.task.agentId}</span>
                  <span>
                    {context.task.baseBranch} {"->"} {context.task.targetBranch}
                  </span>
                  {context.summary.prUrl && (
                    <a className="text-primary hover:underline" href={context.summary.prUrl}>
                      PR/MR
                    </a>
                  )}
                </div>
              </div>
              <span className="rounded bg-muted px-2 py-1 text-xs font-medium text-foreground">
                {context.summary.riskLevel}
              </span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Metric label={t("reviewContext.files")} value={context.summary.changedFiles} />
            <Metric label={t("reviewContext.conflicts")} value={context.summary.openConflicts} />
            <Metric label={t("reviewContext.approvals")} value={context.summary.approvals} />
            <Metric label={t("reviewContext.requested")} value={context.summary.requestedChanges} />
            <Metric label={t("reviewContext.checksPassed")} value={context.summary.checksPassed} />
            <Metric label={t("reviewContext.checksFailed")} value={context.summary.checksFailed} />
            <Metric label={t("reviewContext.notes")} value={context.agentNotes.length} />
            <Metric label={t("reviewContext.blockers")} value={blockers.length} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <ClipboardList className="size-4 text-primary" />
                  {t("reviewContext.checklist")}
                </h3>
                <div className="space-y-2">
                  {context.checklist.map((item) => (
                    <div
                      key={`${item.severity}:${item.title}`}
                      className="rounded-md bg-muted/40 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-foreground">{item.title}</span>
                        <span className="text-xs text-tertiary-foreground">{item.severity}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <FileCode className="size-4 text-primary" />
                  {t("package.changedFiles", {
                    count: context.changePackage?.changedFiles.length ?? 0,
                  })}
                </h3>
                <div className="space-y-1">
                  {(context.changePackage?.changedFiles ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">{t("package.noChangedFiles")}</p>
                  )}
                  {(context.changePackage?.changedFiles ?? []).map((file) => (
                    <div
                      key={file}
                      className="rounded px-2 py-1.5 font-mono text-xs text-foreground hover:bg-muted/50"
                    >
                      {file}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="space-y-4">
              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">{t("notes.title")}</h3>
                <div className="space-y-2">
                  {context.agentNotes.length === 0 && (
                    <p className="text-sm text-muted-foreground">{t("notes.empty")}</p>
                  )}
                  {context.agentNotes.map((note) => (
                    <div key={note.id} className="rounded-md bg-muted/40 p-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-foreground">{note.agentId}</span>
                        <span className="text-tertiary-foreground">{note.createdAt}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{note.summary}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">{t("package.review")}</h3>
                <div className="space-y-2">
                  {context.reviews.length === 0 && (
                    <p className="text-sm text-muted-foreground">{t("package.noReviews")}</p>
                  )}
                  {context.reviews.map((review) => (
                    <div key={review.id} className="rounded-md bg-muted/40 p-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-foreground">{review.reviewerId}</span>
                        <span className="text-tertiary-foreground">{review.action}</span>
                      </div>
                      {review.comment && (
                        <p className="mt-1 text-sm text-muted-foreground">{review.comment}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">{t("audit.title")}</h3>
                <div className="space-y-2">
                  {context.audit.length === 0 && (
                    <p className="text-sm text-muted-foreground">{t("audit.empty")}</p>
                  )}
                  {context.audit
                    .slice(-8)
                    .reverse()
                    .map((event) => (
                      <div key={event.id} className="rounded-md bg-muted/40 p-3">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-foreground">{event.eventType}</span>
                          <span className="text-tertiary-foreground">{event.createdAt}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{event.actorId}</p>
                      </div>
                    ))}
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-tertiary-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
