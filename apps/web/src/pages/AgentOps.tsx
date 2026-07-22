import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, RefreshCw } from "lucide-react";
import {
  getAgentOpsMetrics,
  type AgentOpsMetrics,
  type AgentOpsTrendPoint,
  type AgentRankingEntry,
} from "../api.js";
import { useEventStream } from "../events.js";
import { useI18n } from "../i18n.js";

export function AgentOps() {
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<AgentOpsMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    return getAgentOpsMetrics()
      .then((data) => {
        setMetrics(data);
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
    void getAgentOpsMetrics()
      .then(setMetrics)
      .catch(() => undefined);
  }, []);
  const stream = useEventStream(["data.changed", "dashboard.snapshot"], handleStreamEvent);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("agentops.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("agentops.subtitle")}</p>
          {metrics && (
            <p className="mt-1 text-xs text-tertiary-foreground">
              {t("agentops.generatedAt", { time: metrics.generatedAt })}
            </p>
          )}
          <p className="mt-1 text-xs text-tertiary-foreground">
            {t("events.status")}: {t(`events.${stream.status}`)}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <RefreshCw className="size-4" />
          {t("common.retry")}
        </button>
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

      {metrics && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title={t("agentops.mergeGate")}
              rows={{
                queued: metrics.mergeGate.queued,
                allowed: metrics.mergeGate.allowed,
                blocked: metrics.mergeGate.blocked,
                blockers: metrics.mergeGate.blockers,
                warnings: metrics.mergeGate.warnings,
              }}
            />
            <MetricCard
              title={t("agentops.logs")}
              rows={{
                directories: metrics.logs.taskDirectories,
                files: metrics.logs.files,
              }}
            />
            <MetricCard
              title={t("agentops.audit")}
              rows={{
                total: metrics.audit.total,
                recent: metrics.audit.recent.length,
              }}
            />
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <Activity className="size-4 text-primary" />
                {t("agentops.title")}
              </div>
              <p className="text-2xl font-semibold text-foreground">
                {Object.values(metrics.taskTotals).reduce((sum, count) => sum + count, 0)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("common.tasks", { count: Object.keys(metrics.taskTotals).length })}
              </p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <MetricCard title={t("agentops.tasksByStatus")} rows={metrics.taskTotals} />
            <MetricCard title={t("agentops.tasksByAgent")} rows={metrics.agentTotals} />
            <MetricCard title={t("agentops.risk")} rows={metrics.riskTotals} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <TrendCard
              title={t("agentops.trend.tasks")}
              points={metrics.trends.taskCount}
              getValue={(point) => point.taskTotal}
            />
            <TrendCard
              title={t("agentops.trend.mergeRate")}
              points={metrics.trends.mergeRate}
              getValue={(point) =>
                point.taskTotal > 0 ? Math.round((point.merged / point.taskTotal) * 100) : 0
              }
              suffix="%"
            />
            <TrendCard
              title={t("agentops.trend.conflictRate")}
              points={metrics.trends.conflictRate}
              getValue={(point) =>
                point.taskTotal > 0 ? Math.round((point.blocked / point.taskTotal) * 100) : 0
              }
              suffix="%"
            />
          </div>

          <AgentRankingTable
            title={t("agentops.ranking")}
            entries={metrics.agentRanking}
            labels={{
              agent: t("agentops.ranking.agent"),
              tasks: t("agentops.ranking.tasks"),
              merged: t("agentops.ranking.merged"),
              failed: t("agentops.ranking.failed"),
              merge: t("agentops.ranking.merge"),
              success: t("agentops.ranking.success"),
            }}
          />

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium text-foreground">{t("agentops.history")}</h3>
            {metrics.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">0</p>
            ) : (
              <div className="space-y-2">
                {metrics.history.map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="grid gap-3 rounded-md bg-muted/30 p-3 text-xs text-muted-foreground md:grid-cols-[1.4fr_1fr_1fr_1fr]"
                  >
                    <span className="font-mono">{snapshot.createdAt}</span>
                    <span>queued {snapshot.metrics.mergeGate.queued}</span>
                    <span>blocked {snapshot.metrics.mergeGate.blocked}</span>
                    <span>audit {snapshot.metrics.auditTotal}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TrendCard({
  title,
  points,
  getValue,
  suffix = "",
}: {
  title: string;
  points: AgentOpsTrendPoint[];
  getValue: (point: AgentOpsTrendPoint) => number;
  suffix?: string;
}) {
  const latestPoints = points.slice(-7);
  const values = latestPoints.map(getValue);
  const max = Math.max(...values, 1);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground">{title}</h3>
      {latestPoints.length === 0 ? (
        <p className="text-sm text-muted-foreground">0</p>
      ) : (
        <div className="space-y-2">
          {latestPoints.map((point) => {
            const value = getValue(point);
            return (
              <div
                key={point.timestamp}
                className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2 text-xs"
              >
                <span className="font-mono text-muted-foreground">
                  {point.timestamp.slice(5, 10)}
                </span>
                <div className="h-2 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="h-full rounded-sm bg-primary"
                    style={{ width: `${Math.max(4, Math.round((value / max) * 100))}%` }}
                  />
                </div>
                <span className="text-right font-medium text-foreground">
                  {value}
                  {suffix}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AgentRankingTable({
  title,
  entries,
  labels,
}: {
  title: string;
  entries: AgentRankingEntry[];
  labels: Record<"agent" | "tasks" | "merged" | "failed" | "merge" | "success", string>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">0</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-tertiary-foreground">
              <tr>
                <th className="py-2 font-medium">{labels.agent}</th>
                <th className="py-2 text-right font-medium">{labels.tasks}</th>
                <th className="py-2 text-right font-medium">{labels.merged}</th>
                <th className="py-2 text-right font-medium">{labels.failed}</th>
                <th className="py-2 text-right font-medium">{labels.merge}</th>
                <th className="py-2 text-right font-medium">{labels.success}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.agentId} className="border-t border-border/70">
                  <td className="py-2 font-medium text-foreground">{entry.agentId}</td>
                  <td className="py-2 text-right text-muted-foreground">{entry.totalTasks}</td>
                  <td className="py-2 text-right text-muted-foreground">{entry.merged}</td>
                  <td className="py-2 text-right text-muted-foreground">{entry.failed}</td>
                  <td className="py-2 text-right text-muted-foreground">{entry.mergeRate}%</td>
                  <td className="py-2 text-right text-muted-foreground">{entry.successRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, rows }: { title: string; rows: Record<string, number> }) {
  const entries = Object.entries(rows);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-foreground">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">0</p>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-muted-foreground">{key}</span>
              <span className="font-medium text-foreground">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
