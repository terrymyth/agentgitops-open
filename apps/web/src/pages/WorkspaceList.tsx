import { useEffect, useState } from "react";
import type { Workspace } from "@agentgitops/core";
import { AlertTriangle, FolderGit2, RefreshCw } from "lucide-react";
import { getWorkspaces } from "../api.js";
import { useI18n } from "../i18n.js";

const statusColors: Record<Workspace["status"], string> = {
  created: "bg-brand-green-50 text-brand-green-600",
  dirty: "bg-brand-orange-50 text-brand-orange-600",
  clean: "bg-brand-green-50 text-brand-green-600",
  archived: "bg-muted text-muted-foreground",
  removed: "bg-brand-red-50 text-brand-red-600",
};

export function WorkspaceList() {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    getWorkspaces()
      .then((data) => {
        if (!canceled) {
          setWorkspaces(data);
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
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t("workspaces.title")}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {loading
            ? t("workspaces.loading")
            : t("workspaces.subtitle", { count: workspaces.length })}
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {!loading && workspaces.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <FolderGit2 className="size-6 text-tertiary-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{t("workspaces.empty")}</p>
        </div>
      )}

      {workspaces.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="grid grid-cols-[1.2fr_1.3fr_1fr_0.7fr] gap-3 border-b border-border px-4 py-3 text-xs font-medium text-muted-foreground">
            <span>{t("common.task")}</span>
            <span>{t("common.path")}</span>
            <span>{t("common.branch")}</span>
            <span>{t("common.status")}</span>
          </div>
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className="grid grid-cols-[1.2fr_1.3fr_1fr_0.7fr] gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0"
            >
              <span className="font-mono text-xs text-foreground break-all">
                {workspace.taskId}
              </span>
              <span className="font-mono text-xs text-muted-foreground break-all">
                {workspace.path}
              </span>
              <span className="font-mono text-xs text-muted-foreground break-all">
                {workspace.branch}
              </span>
              <span>
                <span
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${statusColors[workspace.status]}`}
                >
                  {workspace.status}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
