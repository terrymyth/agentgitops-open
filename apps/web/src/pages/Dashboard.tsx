import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, CheckCircle2, AlertTriangle, GitPullRequest, RefreshCw } from "lucide-react";
import { initProject, getProject, type ProjectSummary } from "../api.js";
import { useActor } from "../actor.js";
import { useI18n } from "../i18n.js";

export function Dashboard() {
  const { t } = useI18n();
  const { actorId } = useActor();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("agentgitops");
  const [initializing, setInitializing] = useState(false);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    getProject()
      .then((data) => {
        if (!canceled) {
          setProject(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!canceled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  async function onInitProject() {
    setInitializing(true);
    try {
      await initProject({ name: projectName, actorId });
      const nextProject = await getProject();
      setProject(nextProject);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInitializing(false);
    }
  }

  useEffect(() => {
    const events = new EventSource("/api/events/stream");
    events.addEventListener("dashboard.snapshot", (event) => {
      const dashboard = JSON.parse((event as MessageEvent).data) as ProjectSummary["dashboard"];
      setProject((current) => (current ? { ...current, dashboard } : current));
    });
    events.addEventListener("data.changed", () => {
      void getProject()
        .then(setProject)
        .catch(() => undefined);
    });
    events.addEventListener("error", () => {
      events.close();
    });
    return () => {
      events.close();
    };
  }, []);

  const stats = [
    {
      label: "Active Tasks",
      labelKey: "dashboard.activeTasks",
      value: project?.dashboard.activeTaskCount ?? 0,
      icon: Activity,
      color: "text-primary",
    },
    {
      label: "Pending Review",
      labelKey: "dashboard.pendingReview",
      value: project?.dashboard.pendingReviewCount ?? 0,
      icon: GitPullRequest,
      color: "text-brand-orange-500",
    },
    {
      label: "Merged Today",
      labelKey: "dashboard.mergedToday",
      value: project?.dashboard.recentMerged.length ?? 0,
      icon: CheckCircle2,
      color: "text-brand-green-500",
    },
    {
      label: "Conflicts",
      labelKey: "dashboard.conflicts",
      value: project?.dashboard.conflictRiskCount ?? 0,
      icon: AlertTriangle,
      color: "text-destructive",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          {project?.name ?? t("dashboard.fallbackTitle")}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {project
            ? t("dashboard.subtitle", {
                provider: project.gitProvider,
                branch: project.defaultBranch,
                agents: project.agents.length,
              })
            : t("dashboard.fallbackSubtitle")}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {error?.includes(".agentgitops.yml") && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-sm font-medium text-foreground">{t("setup.title")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t("setup.body")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              className="h-9 w-64 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              placeholder={t("setup.projectName")}
            />
            <button
              type="button"
              disabled={initializing}
              onClick={() => void onInitProject()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
            >
              {initializing && <RefreshCw className="size-4 animate-spin" />}
              {t("setup.action")}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t(stat.labelKey)}</span>
              <stat.icon className={`size-4 ${stat.color}`} />
            </div>
            <p className="text-2xl font-semibold text-foreground mt-2">
              {loading ? (
                <RefreshCw className="size-5 animate-spin text-muted-foreground" />
              ) : (
                stat.value
              )}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">{t("dashboard.quickActions")}</h3>
        <div className="flex gap-3">
          <Link
            to="/tasks"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            {t("dashboard.viewTasks")}
          </Link>
        </div>
      </div>
    </div>
  );
}
