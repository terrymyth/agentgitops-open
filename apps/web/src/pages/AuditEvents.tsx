import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEvent } from "@agentgitops/core";
import { AlertTriangle, ClipboardList, RefreshCw } from "lucide-react";
import { getAuditEvents, getTasks } from "../api.js";
import { useEventStream } from "../events.js";
import { useI18n } from "../i18n.js";

function eventStage(
  eventType: string,
): "task" | "workspace" | "agent" | "package" | "review" | "merge" | "audit" | "other" {
  if (eventType.startsWith("task.")) return "task";
  if (eventType.startsWith("workspace.")) return "workspace";
  if (eventType.startsWith("agent.")) return "agent";
  if (eventType.startsWith("change_package.") || eventType.startsWith("package.")) return "package";
  if (eventType.startsWith("review.")) return "review";
  if (eventType.startsWith("merge.")) return "merge";
  if (eventType.startsWith("audit.")) return "audit";
  return "other";
}

const STAGE_COLORS: Record<string, string> = {
  task: "bg-blue-500",
  workspace: "bg-cyan-500",
  agent: "bg-purple-500",
  package: "bg-amber-500",
  review: "bg-green-500",
  merge: "bg-emerald-600",
  audit: "bg-gray-500",
  other: "bg-gray-400",
};

const STAGE_LABELS: Record<string, string> = {
  task: "Task",
  workspace: "Workspace",
  agent: "Agent",
  package: "Package",
  review: "Review",
  merge: "Merge",
  audit: "Audit",
  other: "Other",
};

export function AuditEvents() {
  const { t } = useI18n();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [tasks, setTasks] = useState<Array<{ id: string; title: string }>>([]);
  const [taskId, setTaskId] = useState("");
  const [eventType, setEventType] = useState("");
  const [actorId, setActorId] = useState("");
  const [actorType, setActorType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState("100");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    let canceled = false;
    setLoading(true);
    Promise.all([
      getAuditEvents({
        taskId: taskId || undefined,
        eventType: eventType || undefined,
        actorId: actorId || undefined,
        actorType:
          actorType === "human" || actorType === "agent" || actorType === "system"
            ? actorType
            : undefined,
        from: from || undefined,
        to: to || undefined,
        limit: Number.parseInt(limit, 10) || undefined,
      }),
      getTasks(),
    ])
      .then(([data, taskData]) => {
        if (!canceled) {
          setEvents(data);
          setTasks(taskData.map((task) => ({ id: task.id, title: task.title })));
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
  }, [actorId, actorType, eventType, from, limit, taskId, to]);

  useEffect(() => refresh(), [refresh]);

  const handleStreamEvent = useCallback(() => {
    void getAuditEvents({
      taskId: taskId || undefined,
      eventType: eventType || undefined,
      actorId: actorId || undefined,
      actorType:
        actorType === "human" || actorType === "agent" || actorType === "system"
          ? actorType
          : undefined,
      from: from || undefined,
      to: to || undefined,
      limit: Number.parseInt(limit, 10) || undefined,
    })
      .then(setEvents)
      .catch(() => undefined);
  }, [actorId, actorType, eventType, from, limit, taskId, to]);
  const stream = useEventStream(
    ["data.changed", "agent.note.added", "review.submitted"],
    handleStreamEvent,
  );

  const timeline = useMemo(
    () => [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [events],
  );
  const eventTypes = [...new Set(events.map((event) => event.eventType))].sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("audit.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? t("common.loading") : t("audit.subtitle", { count: events.length })}
          </p>
        </div>
        <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{t("events.status")}:</span>{" "}
          {t(`events.${stream.status}`)}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_180px_180px_180px_120px]">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t("audit.task")}
          <select
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">{t("audit.allTasks")}</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.id} - {task.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t("audit.eventType")}
          <select
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">{t("audit.allEvents")}</option>
            {eventTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t("audit.actorType")}
          <select
            value={actorType}
            onChange={(event) => setActorType(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">{t("audit.allActors")}</option>
            <option value="human">human</option>
            <option value="agent">agent</option>
            <option value="system">system</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t("audit.actor")}
          <input
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            placeholder="owner"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t("audit.from")}
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t("audit.to")}
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t("audit.limit")}
          <input
            type="number"
            min="1"
            max="500"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
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

      {!loading && events.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <ClipboardList className="mx-auto mb-2 size-6 text-tertiary-foreground" />
          <p className="text-sm text-muted-foreground">{t("audit.empty")}</p>
        </div>
      )}

      {!loading && timeline.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-4 text-sm font-medium text-foreground">{t("audit.timeline")}</h3>
          <ol className="relative space-y-4 border-l border-border pl-6">
            {timeline.map((event) => {
              const stage = eventStage(event.eventType);
              return (
                <li key={event.id} className="relative">
                  <span
                    className={`absolute -left-[31px] top-1 size-3 rounded-full ring-4 ring-card ${STAGE_COLORS[stage]}`}
                  />
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${STAGE_COLORS[stage]}`}
                        >
                          {STAGE_LABELS[stage]}
                        </span>
                        <p className="text-sm font-medium text-foreground">{event.eventType}</p>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-tertiary-foreground">
                        <span className="font-mono">{event.id}</span>
                        {event.taskId && <span>{event.taskId}</span>}
                        <span>
                          {event.actorType}:{event.actorId}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{event.createdAt}</span>
                  </div>
                  {event.payload !== undefined && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        {t("audit.payload")}
                      </summary>
                      <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
