import { useCallback, useEffect, useState } from "react";
import { FolderGit2, Plus, ArrowRight } from "lucide-react";
import { getProjects, addProject, type ProjectEntry } from "../api.js";
import { useI18n } from "../i18n.js";

export function ProjectSelector() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [lastActiveId, setLastActiveId] = useState<string | undefined>();
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newName, setNewName] = useState("");
  const [initializeProject, setInitializeProject] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getProjects();
      setProjects(result.projects);
      setLastActiveId(result.lastActiveProjectId);
      setCurrentProjectId(result.currentProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    if (!newPath.trim()) return;
    try {
      setAdding(true);
      setError(null);
      await addProject({
        path: newPath,
        name: newName || undefined,
        initialize: initializeProject,
      });
      setNewPath("");
      setNewName("");
      setInitializeProject(true);
      setShowAddForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground text-sm">{t("common.loading")}…</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <FolderGit2 className="mx-auto size-12 text-primary" />
          <h1 className="mt-4 text-2xl font-bold text-foreground">agentgitops</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("projectSelector.subtitle")}</p>
        </div>

        {error && <div className="text-destructive text-sm text-center">{error}</div>}

        {/* 项目列表 */}
        {projects.length > 0 ? (
          <div className="space-y-2">
            {projects.map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{project.name}</span>
                    {project.id === lastActiveId && (
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {t("projectSelector.lastActive")}
                      </span>
                    )}
                    {project.id === currentProjectId && (
                      <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                        {t("projectSelector.current")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground font-mono truncate">
                    {project.path}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    {project.gitProvider && <span>{project.gitProvider}</span>}
                    {project.defaultBranch && <span>· {project.defaultBranch}</span>}
                    {project.runtimePort && <span>· :{project.runtimePort}</span>}
                  </div>
                  {project.isPortConflict && (
                    <div className="mt-2 max-w-xl text-xs text-amber-700 dark:text-amber-300">
                      {t("projectSelector.portConflict")}{" "}
                      <code className="rounded bg-muted px-1 py-0.5">
                        agentgitops web --project {project.id} --port{" "}
                        {nextSuggestedPort(project.runtimePort)}
                      </code>
                    </div>
                  )}
                </div>
                {project.openUrl ? (
                  <a
                    href={project.openUrl}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                  >
                    {project.id === currentProjectId
                      ? t("projectSelector.openCurrent")
                      : t("projectSelector.open")}
                    <ArrowRight className="size-3" />
                  </a>
                ) : (
                  <button
                    disabled
                    title={t("projectSelector.unavailable")}
                    className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-70"
                  >
                    {t("projectSelector.unavailable")}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("projectSelector.noProjects")}</p>
          </div>
        )}

        {/* 添加项目表单 */}
        {showAddForm ? (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-medium text-foreground">{t("projectSelector.addTitle")}</h3>
            <div>
              <label className="text-xs text-muted-foreground">{t("projectSelector.path")}</label>
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="D:/path/to/git/repo"
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("projectSelector.name")}</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="(optional)"
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={initializeProject}
                onChange={(event) => setInitializeProject(event.target.checked)}
                className="mt-0.5 size-4 shrink-0"
              />
              <span>{t("projectSelector.initialize")}</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAdd}
                disabled={adding || !newPath.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {adding ? t("common.loading") : t("projectSelector.add")}
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground"
              >
                {t("projectSelector.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <Plus className="size-4" />
            {t("projectSelector.addButton")}
          </button>
        )}
      </div>
    </div>
  );
}

function nextSuggestedPort(port: number | undefined): number {
  if (!port || port >= 65535) return 4790;
  return port + 1;
}
