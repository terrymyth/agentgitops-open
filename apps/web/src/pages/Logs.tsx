import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentNote, AuditEvent } from "@agentgitops/core";
import { AlertTriangle, ClipboardList, FileText, RefreshCw, Search, Terminal } from "lucide-react";
import {
  getAllAgentNotes,
  getAuditEvents,
  getLog,
  getLogs,
  type LogDetail,
  type LogSummary,
} from "../api.js";
import { useEventStream } from "../events.js";
import { useI18n } from "../i18n.js";

export function Logs() {
  const { t } = useI18n();
  const [logs, setLogs] = useState<LogSummary[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [notes, setNotes] = useState<AgentNote[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const visibleLogs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return logs;
    return logs.filter(
      (log) =>
        log.taskId.toLowerCase().includes(needle) ||
        log.files.some((file) => file.toLowerCase().includes(needle)),
    );
  }, [logs, query]);

  const selectedAudit = useMemo(
    () => audit.filter((event) => !selectedTaskId || event.taskId === selectedTaskId).slice(0, 20),
    [audit, selectedTaskId],
  );

  const selectedNotes = useMemo(
    () => notes.filter((note) => !selectedTaskId || note.taskId === selectedTaskId).slice(0, 10),
    [notes, selectedTaskId],
  );

  const refreshLogs = useCallback(() => {
    setLoading(true);
    return Promise.all([getLogs(), getAuditEvents(), getAllAgentNotes()])
      .then(([logData, auditData, noteData]) => {
        setLogs(logData);
        setAudit(auditData);
        setNotes(noteData);
        setSelectedTaskId((current) => current ?? logData[0]?.taskId ?? null);
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
    void refreshLogs();
  }, [refreshLogs]);

  const handleStreamEvent = useCallback(() => {
    void refreshLogs();
    if (selectedTaskId)
      void getLog(selectedTaskId)
        .then(setDetail)
        .catch(() => undefined);
  }, [refreshLogs, selectedTaskId]);
  const stream = useEventStream(
    ["data.changed", "agent.note.added", "review.submitted"],
    handleStreamEvent,
  );

  useEffect(() => {
    let canceled = false;
    if (!selectedTaskId) {
      setDetail(null);
      return;
    }
    getLog(selectedTaskId)
      .then((data) => {
        if (!canceled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      canceled = true;
    };
  }, [selectedTaskId]);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t("logs.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {loading ? t("logs.loading") : t("logs.subtitle", { count: logs.length })}
            </p>
          </div>
          <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t("events.status")}:</span>{" "}
            {t(`events.${stream.status}`)}
            {stream.lastEvent && (
              <span className="ml-2 text-tertiary-foreground">{stream.lastEvent.name}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("logs.search")}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-tertiary-foreground"
        />
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

      {!loading && logs.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <FileText className="size-6 text-tertiary-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{t("logs.empty")}</p>
        </div>
      )}

      {logs.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
          <div className="rounded-lg border border-border bg-card p-2">
            {visibleLogs.map((log) => (
              <button
                key={log.taskId}
                type="button"
                onClick={() => setSelectedTaskId(log.taskId)}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selectedTaskId === log.taskId
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <span className="block font-mono text-xs break-all">{log.taskId}</span>
                <span className="mt-1 block text-xs text-tertiary-foreground">
                  {t("common.files", { count: log.files.length })}
                </span>
                {log.updatedAt && (
                  <span className="mt-1 block truncate text-xs text-tertiary-foreground">
                    {log.updatedAt}
                  </span>
                )}
              </button>
            ))}
            {visibleLogs.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("logs.noMatches")}
              </p>
            )}
          </div>

          <div className="space-y-4">
            {(detail?.fileDetails.length ?? 0) > 0 ? (
              detail?.fileDetails.map((file) => (
                <LogPanel
                  key={file.name}
                  title={file.name}
                  meta={t("logs.bytes", { bytes: file.bytes })}
                  content={file.content}
                />
              ))
            ) : (
              <>
                <LogPanel title="stdout" content={detail?.stdout ?? ""} />
                <LogPanel title="stderr" content={detail?.stderr ?? ""} />
              </>
            )}
          </div>

          <div className="space-y-4">
            <TimelinePanel
              title={t("notes.title")}
              icon={<FileText className="size-4 text-primary" />}
              empty={t("notes.empty")}
              items={selectedNotes.map((note) => ({
                id: note.id,
                title: `${note.agentId}: ${note.summary}`,
                meta: note.createdAt,
                detail: note.reviewFocus.concat(note.risks).join(" | "),
              }))}
            />
            <TimelinePanel
              title={t("audit.title")}
              icon={<ClipboardList className="size-4 text-primary" />}
              empty={t("audit.empty")}
              items={selectedAudit.map((event) => ({
                id: event.id,
                title: event.eventType,
                meta: `${event.actorType}:${event.actorId}`,
                detail: event.createdAt,
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LogPanel({ title, content, meta }: { title: string; content: string; meta?: string }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm font-medium text-foreground">
        <span className="flex min-w-0 items-center gap-2">
          <Terminal className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </span>
        {meta && <span className="shrink-0 text-xs text-tertiary-foreground">{meta}</span>}
      </div>
      <pre className="max-h-[360px] overflow-auto p-4 text-xs text-muted-foreground whitespace-pre-wrap">
        {content || t("logs.noOutput")}
      </pre>
    </div>
  );
}

function TimelinePanel({
  title,
  icon,
  empty,
  items,
}: {
  title: string;
  icon: ReactNode;
  empty: string;
  items: Array<{ id: string; title: string; meta: string; detail?: string }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium text-foreground">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((item) => (
            <div key={item.id} className="p-4 text-xs">
              <p className="break-words font-medium text-foreground">{item.title}</p>
              <p className="mt-1 break-words text-tertiary-foreground">{item.meta}</p>
              {item.detail && (
                <p className="mt-2 break-words text-muted-foreground">{item.detail}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
