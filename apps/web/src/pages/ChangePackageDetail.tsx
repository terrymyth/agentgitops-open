import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type {
  AgentNote,
  ChangePackage,
  Review,
  ReviewAction,
  ReviewContext,
} from "@agentgitops/core";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileCode,
  GitBranch,
  Shield,
  Package,
  RefreshCw,
  Send,
  ClipboardList,
} from "lucide-react";
import {
  getAgentNotes,
  getOptionalChangePackage,
  getReviewContext,
  getReviews,
  getTaskCloseout,
  runTaskWorkflowAction,
  submitAgentNote,
  submitReview,
  type CloseoutReport,
} from "../api.js";
import { useActor } from "../actor.js";
import { useI18n } from "../i18n.js";

const riskColors = {
  low: "bg-brand-green-50 text-brand-green-600",
  medium: "bg-brand-orange-50 text-brand-orange-600",
  high: "bg-brand-red-50 text-brand-red-600",
  critical: "bg-brand-red-100 text-brand-red-700",
};

export function ChangePackageDetail() {
  const { t } = useI18n();
  const { actorId } = useActor();
  const { taskId } = useParams();
  const [pkg, setPkg] = useState<ChangePackage | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [notes, setNotes] = useState<AgentNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewerId, setReviewerId] = useState("local-reviewer");
  const [comment, setComment] = useState("");
  const [noteSummary, setNoteSummary] = useState("");
  const [noteFiles, setNoteFiles] = useState("");
  const [noteVerification, setNoteVerification] = useState("");
  const [noteReviewFocus, setNoteReviewFocus] = useState("");
  const [noteRisks, setNoteRisks] = useState("");
  const [submitting, setSubmitting] = useState<ReviewAction | null>(null);
  const [submittingNote, setSubmittingNote] = useState(false);
  const [reviewContext, setReviewContext] = useState<ReviewContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [generatingPackage, setGeneratingPackage] = useState(false);
  const [packageMessage, setPackageMessage] = useState<string | null>(null);
  const [closeout, setCloseout] = useState<CloseoutReport | null>(null);
  const [closeoutLoading, setCloseoutLoading] = useState(false);

  useEffect(() => {
    let canceled = false;
    if (!taskId) {
      setError("Task id is required");
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([getOptionalChangePackage(taskId), getReviews(taskId), getAgentNotes(taskId)])
      .then(([data, reviewData, noteData]) => {
        if (!canceled) {
          setPkg(data);
          setReviews(reviewData);
          setNotes(noteData);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [taskId]);

  async function onGeneratePackage() {
    if (!taskId) return;
    setGeneratingPackage(true);
    setReviewError(null);
    setPackageMessage(null);
    try {
      const result = await runTaskWorkflowAction(taskId, "package", { actorId });
      setPkg(result.changePackage ?? (await getOptionalChangePackage(taskId)));
      setPackageMessage(result.message);
    } catch (err) {
      setPackageMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingPackage(false);
    }
  }

  async function loadCloseout() {
    if (!taskId) return;
    setCloseoutLoading(true);
    try {
      const report = await getTaskCloseout(taskId);
      setCloseout(report);
    } catch {
      setCloseout(null);
    } finally {
      setCloseoutLoading(false);
    }
  }

  async function onSubmitReview(action: ReviewAction) {
    if (!taskId) return;
    setSubmitting(action);
    setReviewError(null);
    try {
      const result = await submitReview(taskId, {
        reviewerId: reviewerId.trim() || actorId,
        action,
        comment: comment.trim() || undefined,
      });
      setReviews((current) => [...current, result.review]);
      setComment("");
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  }

  async function onSubmitNote() {
    if (!taskId || !noteSummary.trim()) return;
    setSubmittingNote(true);
    setReviewError(null);
    try {
      const note = await submitAgentNote(taskId, {
        actorId,
        agentId: actorId,
        summary: noteSummary.trim(),
        files: splitList(noteFiles),
        verification: splitList(noteVerification),
        reviewFocus: splitList(noteReviewFocus),
        risks: splitList(noteRisks),
        prUrl: pkg?.prUrl,
      });
      setNotes((current) => [note, ...current]);
      setNoteSummary("");
      setNoteFiles("");
      setNoteVerification("");
      setNoteReviewFocus("");
      setNoteRisks("");
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingNote(false);
    }
  }

  async function onGenerateReviewContext() {
    if (!taskId) return;
    setContextLoading(true);
    setReviewError(null);
    try {
      setReviewContext(await getReviewContext(taskId, { record: true, actorId }));
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        to="/tasks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("package.back")}
      </Link>

      {loading && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-card p-6">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </div>
        </div>
      )}

      {!loading && !error && !pkg && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <Package className="mx-auto mb-3 size-8 text-tertiary-foreground" />
          <h2 className="text-base font-semibold text-foreground">{t("package.noPackage")}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            {t("package.noPackageDescription")}
          </p>
          {reviewError && (
            <p className="mx-auto mt-3 max-w-xl text-sm text-destructive">{reviewError}</p>
          )}
          {packageMessage && (
            <p className="mx-auto mt-3 max-w-xl text-sm text-brand-green-600">{packageMessage}</p>
          )}
          <button
            type="button"
            disabled={generatingPackage}
            onClick={() => void onGeneratePackage()}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {generatingPackage ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <Package className="size-4" />
            )}
            {generatingPackage ? t("package.generating") : t("package.generate")}
          </button>
        </div>
      )}

      {pkg && (
        <>
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{pkg.objective}</h2>
                <p className="text-sm text-muted-foreground mt-1">{pkg.summary}</p>
                <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-tertiary-foreground">
                  <span className="flex items-center gap-1">
                    <Package className="size-3" />
                    {pkg.id}
                  </span>
                  <span className="flex items-center gap-1">
                    <GitBranch className="size-3" />
                    {pkg.taskId}
                  </span>
                  <span>Agent: {pkg.agent.name}</span>
                  {pkg.prUrl && (
                    <a className="text-primary hover:underline" href={pkg.prUrl}>
                      PR #{pkg.prNumber}
                    </a>
                  )}
                </div>
              </div>
              <span
                className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium ${riskColors[pkg.risk.level]}`}
              >
                {pkg.risk.level}
              </span>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2 space-y-4">
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-medium text-foreground mb-3">
                  {t("package.changedFiles", { count: pkg.changedFiles.length })}
                </h3>
                <div className="space-y-1">
                  {pkg.changedFiles.length === 0 && (
                    <p className="text-sm text-muted-foreground">{t("package.noChangedFiles")}</p>
                  )}
                  {pkg.changedFiles.map((file) => (
                    <div
                      key={file}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <FileCode className="size-4 text-muted-foreground" />
                      <span className="font-mono text-xs break-all">{file}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border text-xs text-tertiary-foreground">
                  <span className="text-brand-green-600">+{pkg.stats.insertions}</span>
                  <span className="text-brand-red-600">-{pkg.stats.deletions}</span>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-medium text-foreground mb-3">{t("package.checks")}</h3>
                <div className="space-y-2">
                  {pkg.checks.length === 0 && (
                    <p className="text-sm text-muted-foreground">{t("package.noChecks")}</p>
                  )}
                  {pkg.checks.map((check) => (
                    <div
                      key={check.id}
                      className="flex items-center justify-between gap-3 px-2 py-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {check.status === "passed" ? (
                          <CheckCircle2 className="size-4 shrink-0 text-brand-green-500" />
                        ) : (
                          <XCircle className="size-4 shrink-0 text-destructive" />
                        )}
                        <span className="text-sm text-foreground font-mono break-all">
                          {check.name}
                        </span>
                      </div>
                      <span className="text-xs text-tertiary-foreground shrink-0">
                        {check.durationMs ? `${check.durationMs}ms` : check.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                  <Shield className="size-4 text-primary" />
                  {t("package.riskAssessment")}
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("common.risk")}</span>
                    <span className="text-foreground font-medium capitalize">{pkg.risk.level}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("package.highRiskFiles")}</span>
                    <span
                      className={
                        pkg.risk.highRiskFilesTouched
                          ? "text-brand-orange-600"
                          : "text-brand-green-600"
                      }
                    >
                      {pkg.risk.highRiskFilesTouched ? t("package.yes") : t("package.no")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("package.forbiddenFiles")}</span>
                    <span
                      className={
                        pkg.risk.forbiddenFilesTouched ? "text-destructive" : "text-brand-green-600"
                      }
                    >
                      {pkg.risk.forbiddenFilesTouched ? t("package.yes") : t("package.no")}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                  <AlertTriangle className="size-4 text-brand-orange-500" />
                  {t("package.unverified")}
                </h3>
                {pkg.unverifiedItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("package.none")}</p>
                ) : (
                  <ul className="space-y-1">
                    {pkg.unverifiedItems.map((item) => (
                      <li key={item} className="text-sm text-muted-foreground">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-medium text-foreground mb-2">
                  {t("package.mergeRecommendation")}
                </h3>
                <p className="text-sm text-muted-foreground">{pkg.mergeRecommendation}</p>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <ClipboardList className="size-4 text-primary" />
                    {t("reviewContext.title")}
                  </h3>
                  <button
                    type="button"
                    disabled={contextLoading}
                    onClick={() => void onGenerateReviewContext()}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-60"
                  >
                    {contextLoading && <RefreshCw className="size-3 animate-spin" />}
                    {t("reviewContext.generate")}
                  </button>
                </div>
                <Link
                  to={`/review/${pkg.taskId}`}
                  className="mb-3 inline-flex text-xs font-medium text-primary hover:underline"
                >
                  {t("reviewContext.open")}
                </Link>
                {!reviewContext ? (
                  <p className="text-sm text-muted-foreground">{t("reviewContext.empty")}</p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <Metric
                        label={t("reviewContext.files")}
                        value={reviewContext.summary.changedFiles}
                      />
                      <Metric
                        label={t("reviewContext.conflicts")}
                        value={reviewContext.summary.openConflicts}
                      />
                      <Metric
                        label={t("reviewContext.approvals")}
                        value={reviewContext.summary.approvals}
                      />
                      <Metric
                        label={t("reviewContext.notes")}
                        value={reviewContext.agentNotes.length}
                      />
                    </div>
                    <div className="space-y-2">
                      {reviewContext.checklist.map((item) => (
                        <div
                          key={`${item.severity}:${item.title}`}
                          className="rounded-md bg-muted/40 p-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground">{item.title}</span>
                            <span className="text-tertiary-foreground">{item.severity}</span>
                          </div>
                          <p className="mt-1 text-muted-foreground">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <ClipboardList className="size-4 text-primary" />
                    Closeout Checklist
                  </h3>
                  <button
                    type="button"
                    disabled={closeoutLoading}
                    onClick={() => void loadCloseout()}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-60"
                  >
                    {closeoutLoading ? (
                      <RefreshCw className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    Check
                  </button>
                </div>
                {!closeout ? (
                  <p className="text-sm text-muted-foreground">
                    Click "Check" to run closeout diagnostics.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-3 text-xs">
                      <span className="text-brand-green-600">✓ {closeout.summary.ok} ok</span>
                      <span className="text-brand-orange-600">
                        ⚠ {closeout.summary.warning} warning
                      </span>
                      <span className="text-destructive">✗ {closeout.summary.error} error</span>
                    </div>
                    <div className="space-y-1">
                      {closeout.checks.map((check) => (
                        <div key={check.name} className="rounded-md bg-muted/40 p-2 text-xs">
                          <div className="flex items-center gap-2">
                            {check.status === "ok" ? (
                              <CheckCircle2 className="size-3 shrink-0 text-brand-green-500" />
                            ) : check.status === "warning" ? (
                              <AlertTriangle className="size-3 shrink-0 text-brand-orange-500" />
                            ) : (
                              <XCircle className="size-3 shrink-0 text-destructive" />
                            )}
                            <span className="font-medium text-foreground">{check.name}</span>
                          </div>
                          <p className="mt-1 pl-5 text-muted-foreground">{check.detail}</p>
                          {check.recovery && check.recovery.length > 0 && (
                            <p className="mt-1 pl-5 text-brand-orange-600">→ {check.recovery[0]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-medium text-foreground mb-3">{t("package.review")}</h3>
                <div className="space-y-3">
                  <input
                    value={reviewerId}
                    onChange={(event) => setReviewerId(event.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t("package.reviewer")}
                  />
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t("package.comment")}
                  />
                  {reviewError && <p className="text-sm text-destructive">{reviewError}</p>}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={submitting !== null}
                      onClick={() => void onSubmitReview("approve")}
                      className="inline-flex items-center justify-center gap-1 rounded-md bg-brand-green-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                    >
                      <CheckCircle2 className="size-3" />
                      {t("package.approve")}
                    </button>
                    <button
                      type="button"
                      disabled={submitting !== null}
                      onClick={() => void onSubmitReview("request_changes")}
                      className="inline-flex items-center justify-center gap-1 rounded-md bg-brand-orange-500 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                    >
                      <Send className="size-3" />
                      {t("package.changes")}
                    </button>
                    <button
                      type="button"
                      disabled={submitting !== null}
                      onClick={() => void onSubmitReview("reject")}
                      className="inline-flex items-center justify-center gap-1 rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground disabled:opacity-60"
                    >
                      <XCircle className="size-3" />
                      {t("package.reject")}
                    </button>
                  </div>
                </div>
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  {reviews.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("package.noReviews")}</p>
                  ) : (
                    reviews.map((review) => (
                      <div key={review.id} className="rounded-md bg-muted/40 p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{review.reviewerId}</span>
                          <span className="text-tertiary-foreground">{review.action}</span>
                        </div>
                        {review.comment && (
                          <p className="mt-1 text-muted-foreground">{review.comment}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">{t("notes.title")}</h3>
                <div className="space-y-3">
                  <textarea
                    value={noteSummary}
                    onChange={(event) => setNoteSummary(event.target.value)}
                    className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t("notes.summary")}
                  />
                  <input
                    value={noteFiles}
                    onChange={(event) => setNoteFiles(event.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t("notes.files")}
                  />
                  <input
                    value={noteVerification}
                    onChange={(event) => setNoteVerification(event.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t("notes.verification")}
                  />
                  <input
                    value={noteReviewFocus}
                    onChange={(event) => setNoteReviewFocus(event.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t("notes.reviewFocus")}
                  />
                  <input
                    value={noteRisks}
                    onChange={(event) => setNoteRisks(event.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                    placeholder={t("notes.risks")}
                  />
                  <button
                    type="button"
                    disabled={submittingNote || !noteSummary.trim()}
                    onClick={() => void onSubmitNote()}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
                  >
                    {t("notes.add")}
                  </button>
                </div>
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  {notes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("notes.empty")}</p>
                  ) : (
                    notes.map((note) => (
                      <div key={note.id} className="rounded-md bg-muted/40 p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{note.agentId}</span>
                          <span className="text-tertiary-foreground">{note.createdAt}</span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{note.summary}</p>
                        {note.reviewFocus.length > 0 && (
                          <p className="mt-2 text-muted-foreground">
                            {note.reviewFocus.join(" | ")}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <p className="text-tertiary-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
