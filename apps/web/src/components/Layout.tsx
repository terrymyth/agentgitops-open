import { Outlet, NavLink } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Eye,
  FileText,
  FolderGit2,
  GitBranch,
  GitMerge,
  Languages,
  LayoutDashboard,
  ListTodo,
  Network,
  RotateCcw,
  Shield,
  Users,
  Wifi,
} from "lucide-react";
import { useActor } from "../actor.js";
import { useI18n } from "../i18n.js";

const navItems = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/tasks", labelKey: "nav.tasks", icon: ListTodo },
  { to: "/workspaces", labelKey: "nav.workspaces", icon: FolderGit2 },
  { to: "/merge", labelKey: "nav.merge", icon: GitMerge },
  { to: "/conflicts", labelKey: "nav.conflicts", icon: AlertTriangle },
  { to: "/logs", labelKey: "nav.logs", icon: FileText },
  { to: "/audit", labelKey: "nav.audit", icon: ClipboardList },
  { to: "/jobs", labelKey: "nav.jobs", icon: RotateCcw },
  { to: "/agentops", labelKey: "nav.agentops", icon: Activity },
  { to: "/team", labelKey: "nav.team", icon: Users },
  { to: "/team-sync", labelKey: "nav.teamSync", icon: Wifi },
  { to: "/context-feed", labelKey: "nav.contextFeed", icon: Eye },
  { to: "/conflict-graph", labelKey: "nav.conflictGraph", icon: Network },
  { to: "/shared-merge", labelKey: "nav.sharedMerge", icon: GitMerge },
  { to: "/handoff-docs", labelKey: "nav.handoffDocs", icon: FileText },
];

export function Layout() {
  const { locale, setLocale, t } = useI18n();
  const { actorId, setActorId } = useActor();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-60 border-r border-border bg-card flex flex-col">
        <div className="h-14 flex items-center gap-2 px-4 border-b border-border">
          <GitBranch className="size-5 text-primary" />
          <span className="font-semibold text-sm text-foreground">agentgitops</span>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`
              }
            >
              <item.icon className="size-4" />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-border space-y-2">
          <a
            href="/projects"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <FolderGit2 className="size-3" />
            <span>{t("nav.switchProject")}</span>
          </a>
          <div className="flex items-center gap-2 text-xs text-tertiary-foreground">
            <Shield className="size-3" />
            <span>v0.1.0</span>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card px-6 flex items-center justify-between shrink-0">
          <h1 className="text-sm font-medium text-foreground">{t("app.title")}</h1>
          <div className="flex items-center gap-2">
            <label
              className="flex items-center gap-2 text-xs text-muted-foreground"
              title={t("actor.hint")}
            >
              <span>{t("actor.label")}</span>
              <input
                value={actorId}
                onChange={(event) => setActorId(event.target.value)}
                className="h-8 w-36 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              />
            </label>
            <button
              type="button"
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <Languages className="size-3.5" />
              {locale === "zh" ? t("language.en") : t("language.zh")}
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto [background:var(--gradient-hero)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
