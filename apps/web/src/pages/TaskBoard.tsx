import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCode,
  GitPullRequest,
  Package,
  Play,
  Plus,
  RefreshCw,
  TestTube2,
} from "lucide-react";
import type { ChangePackage, RiskLevel, TaskContract, TaskStatus } from "@agentgitops/core";
import {
  createTask,
  getChangePackages,
  getProject,
  getTaskSnapshotDrift,
  getTasks,
  runTaskWorkflowAction,
  type TaskSnapshotDrift,
  type WorkflowActionResult,
} from "../api.js";
import { useActor } from "../actor.js";
import { useI18n } from "../i18n.js";

const columns: { status: TaskStatus; labelKey: string; color: string }[] = [
  { status: "created", labelKey: "tasks.stage.created", color: "text-muted-foreground" },
  { status: "running", labelKey: "tasks.stage.running", color: "text-primary" },
  { status: "testing", labelKey: "tasks.stage.testing", color: "text-brand-orange-500" },
  { status: "reviewing", labelKey: "tasks.stage.reviewing", color: "text-brand-purple-500" },
  { status: "merged", labelKey: "tasks.stage.merged", color: "text-brand-green-500" },
  { status: "failed", labelKey: "tasks.stage.failed", color: "text-destructive" },
];

const riskColors: Record<RiskLevel, string> = {
  low: "bg-brand-green-50 text-brand-green-600",
  medium: "bg-brand-orange-50 text-brand-orange-600",
  high: "bg-brand-red-50 text-brand-red-600",
  critical: "bg-brand-red-100 text-brand-red-700",
};

const workflowActions = [
  { action: "start", labelKey: "workflow.start", icon: Play },
  { action: "run", labelKey: "workflow.run", icon: Play },
  { action: "test", labelKey: "workflow.test", icon: TestTube2 },
  { action: "package", labelKey: "workflow.package", icon: Package },
] as const;

export function TaskBoard() {
  const { t } = useI18n();
  const { actorId } = useActor();
  const [tasks, setTasks] = useState<TaskContract[]>([]);
  const [packages, setPackages] = useState<ChangePackage[]>([]);
  const [snapshotDrift, setSnapshotDrift] = useState<TaskSnapshotDrift[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [result, setResult] = useState<WorkflowActionResult | null>(null);
  const [form, setForm] = useState({
    title: "",
    objective: "",
    agentId: "",
    template: "",
    riskLevel: "low" as RiskLevel,
    checks: "",
  });

  useEffect(() => {
    void reload();
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const drift = await getTaskSnapshotDrift().catch(() => []);
      const [taskData, packageData, project] = await Promise.all([
        getTasks(),
        getChangePackages(),
        getProject().catch(() => null),
      ]);
      setTasks(taskData);
      setPackages(packageData);
      setSnapshotDrift(drift);
      const projectAgents = project?.agents ?? [];
      setAgents(projectAgents);
      setTemplates(project?.taskTemplates ?? []);
      setForm((current) => ({
        ...current,
        agentId: current.agentId || projectAgents[0] || "generic",
      }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function onCreateTask() {
    if (!form.title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createTask({
        title: form.title.trim(),
        objective: form.objective.trim() || undefined,
        agentId: form.agentId.trim() || agents[0],
        template: form.template || undefined,
        riskLevel: form.riskLevel,
        requiredChecks: splitList(form.checks),
        actorId,
      });
      setTasks((current) => [created.task, ...current]);
      setResult({ task: created.task, message: created.message });
      setForm((current) => ({ ...current, title: "", objective: "", checks: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function onRunAction(
    task: TaskContract,
    action: "start" | "run" | "test" | "package" | "pr",
    dryRun = false,
  ) {
    if (action === "pr" && !dryRun && !window.confirm(t("workflow.prConfirm"))) return;
    setBusyTask(`${task.id}:${action}${dryRun ? ":dry" : ""}`);
    setError(null);
    try {
      const actionResult = await runTaskWorkflowAction(task.id, action, {
        actorId,
        dryRun,
        draft: true,
        reviewContextComment: true,
      });
      setResult(actionResult);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyTask(null);
    }
  }

  const packageByTaskId = useMemo(
    () => new Map(packages.map((pkg) => [pkg.taskId, pkg])),
    [packages],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("tasks.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? t("tasks.loading")
              : t("tasks.subtitle", { tasks: tasks.length, stages: columns.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50"
        >
          <RefreshCw className="size-4" />
          {t("common.retry")}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-3 lg:grid-cols-[1.2fr_1.6fr_0.8fr_0.8fr_0.8fr_auto]">
          <input
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            placeholder={t("tasks.form.title")}
          />
          <input
            value={form.objective}
            onChange={(event) =>
              setForm((current) => ({ ...current, objective: event.target.value }))
            }
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            placeholder={t("tasks.form.objective")}
          />
          <select
            value={form.template}
            onChange={(event) =>
              setForm((current) => ({ ...current, template: event.target.value }))
            }
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">{t("tasks.form.noTemplate")}</option>
            {templates.map((template) => (
              <option key={template} value={template}>
                {template}
              </option>
            ))}
          </select>
          <select
            value={form.agentId}
            onChange={(event) =>
              setForm((current) => ({ ...current, agentId: event.target.value }))
            }
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            {(agents.length ? agents : [form.agentId || "generic"]).map((agent) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </select>
          <select
            value={form.riskLevel}
            onChange={(event) =>
              setForm((current) => ({ ...current, riskLevel: event.target.value as RiskLevel }))
            }
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            {(["low", "medium", "high", "critical"] as RiskLevel[]).map((risk) => (
              <option key={risk} value={risk}>
                {risk}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={creating || !form.title.trim()}
            onClick={() => void onCreateTask()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {creating ? <RefreshCw className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t("tasks.newTask")}
          </button>
        </div>
        <input
          value={form.checks}
          onChange={(event) => setForm((current) => ({ ...current, checks: event.target.value }))}
          className="mt-3 h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
          placeholder={t("tasks.form.checks")}
        />
      </div>

      {result && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 text-brand-green-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{result.message}</p>
              <p className="mt-1 text-xs text-tertiary-foreground">{result.task.id}</p>
              {result.job && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("workflow.job", { id: result.job.id, status: result.job.status })}
                </p>
              )}
              {result.prUrl && (
                <a
                  href={result.prUrl}
                  className="mt-2 inline-flex text-sm text-primary hover:underline"
                >
                  PR/MR #{result.prNumber}
                </a>
              )}
              {result.comment && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("workflow.commentSynced", { action: result.comment.action })}
                </p>
              )}
              {result.recovery && result.recovery.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {result.recovery.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {result.dryRun && (
                <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-muted/50 p-3 text-xs text-foreground">
                  {result.dryRun.body}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          {error}
        </div>
      )}

      {snapshotDrift.length > 0 && (
        <div className="rounded-lg border border-brand-orange-200 bg-brand-orange-50 p-4 text-sm text-brand-orange-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {t("tasks.snapshotDrift.title", { count: snapshotDrift.length })}
              </p>
              <div className="mt-2 grid gap-1">
                {snapshotDrift.slice(0, 4).map((item) => (
                  <p key={`${item.taskId}:${item.reason}`} className="truncate text-xs">
                    {item.taskId}: {t(`tasks.snapshotDrift.${item.reason}`)} (
                    {item.sqliteStatus ?? "-"} -&gt; {item.snapshotStatus ?? "-"})
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {!loading && tasks.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <Clock className="mx-auto mb-2 size-6 text-tertiary-foreground" />
          <p className="text-sm text-muted-foreground">{t("tasks.empty")}</p>
        </div>
      )}

      <div className="grid min-h-[60vh] gap-3 md:grid-cols-3 xl:grid-cols-6">
        {columns.map((col) => {
          const colTasks = tasks.filter((task) => task.status === col.status);
          return (
            <div key={col.status} className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-2 py-2">
                <span className={`text-xs font-medium ${col.color}`}>{t(col.labelKey)}</span>
                <span className="text-xs text-tertiary-foreground">{colTasks.length}</span>
              </div>

              <div className="flex flex-1 flex-col gap-2">
                {colTasks.map((task) => {
                  const pkg = packageByTaskId.get(task.id);
                  const files = pkg?.stats.filesChanged ?? 0;
                  return (
                    <div
                      key={task.id}
                      className="rounded-lg border border-border bg-card p-3 transition-all hover:border-primary/50 hover:shadow-sm"
                    >
                      <Link to={`/packages/${task.id}`} className="block">
                        <p className="line-clamp-2 text-sm font-medium text-foreground">
                          {task.title}
                        </p>
                        <p className="mt-1 text-xs text-tertiary-foreground">{task.id}</p>
                      </Link>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{task.agentId}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-normal ${riskColors[task.riskLevel]}`}
                        >
                          {task.riskLevel}
                        </span>
                        <div className="flex items-center gap-2 text-xs text-tertiary-foreground">
                          {files > 0 && (
                            <span className="flex items-center gap-0.5">
                              <FileCode className="size-3" />
                              {files}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-1.5">
                        {workflowActions.map((item) => {
                          const key = `${task.id}:${item.action}`;
                          const Icon = item.icon;
                          return (
                            <button
                              key={item.action}
                              type="button"
                              disabled={busyTask !== null}
                              onClick={() => void onRunAction(task, item.action)}
                              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-60"
                            >
                              {busyTask === key ? (
                                <RefreshCw className="size-3 animate-spin" />
                              ) : (
                                <Icon className="size-3" />
                              )}
                              {t(item.labelKey)}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          disabled={busyTask !== null}
                          onClick={() => void onRunAction(task, "pr", true)}
                          className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-60"
                        >
                          {busyTask === `${task.id}:pr:dry` ? (
                            <RefreshCw className="size-3 animate-spin" />
                          ) : (
                            <GitPullRequest className="size-3" />
                          )}
                          {t("workflow.prDryRun")}
                        </button>
                        <button
                          type="button"
                          disabled={busyTask !== null}
                          onClick={() => void onRunAction(task, "pr")}
                          className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
                        >
                          {busyTask === `${task.id}:pr` ? (
                            <RefreshCw className="size-3 animate-spin" />
                          ) : (
                            <GitPullRequest className="size-3" />
                          )}
                          {t("workflow.pr")}
                        </button>
                      </div>
                      <Link
                        to={`/review/${task.id}`}
                        className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
                      >
                        {t("reviewContext.open")}
                      </Link>
                    </div>
                  );
                })}

                {colTasks.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border p-3 text-center">
                    <Clock className="mx-auto mb-1 size-4 text-tertiary-foreground" />
                    <p className="text-xs text-tertiary-foreground">{t("tasks.emptyColumn")}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
