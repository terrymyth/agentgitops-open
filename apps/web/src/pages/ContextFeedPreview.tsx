import { useCallback, useEffect, useState } from "react";
import { Eye, FileText } from "lucide-react";
import { getContextFeedPreview, type ContextFeedPreviewResult } from "../api.js";
import { useI18n } from "../i18n.js";

export function ContextFeedPreview() {
  const { t } = useI18n();
  const [taskId, setTaskId] = useState("");
  const [agentType, setAgentType] = useState("generic");
  const [compression, setCompression] = useState("standard");
  const [format, setFormat] = useState("markdown");
  const [result, setResult] = useState<ContextFeedPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!taskId.trim()) return;
    try {
      setLoading(true);
      setError(null);
      setResult(await getContextFeedPreview({ taskId, agentType, compression, format }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId, agentType, compression, format]);

  useEffect(() => {
    if (taskId.trim()) void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">{t("contextFeed.title")}</h2>

      {/* 参数选择 */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground">{t("contextFeed.taskId")}</label>
            <input
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              placeholder="task-xxx"
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t("contextFeed.agentType")}</label>
            <select
              value={agentType}
              onChange={(e) => setAgentType(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="generic">Generic</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t("contextFeed.compression")}</label>
            <select
              value={compression}
              onChange={(e) => setCompression(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="minimal">Minimal</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t("contextFeed.format")}</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="markdown">Markdown</option>
              <option value="json">JSON</option>
              <option value="prompt">Prompt</option>
            </select>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading || !taskId.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Eye className="size-4" />
          {t("contextFeed.preview")}
        </button>
      </div>

      {error && <div className="text-destructive text-sm">{error}</div>}

      {result && (
        <>
          {/* Feed 概览 */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">{t("contextFeed.feedId")}</div>
              <div className="mt-1 text-sm font-mono text-foreground truncate">
                {result.feed.feedId}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">{t("contextFeed.items")}</div>
              <div className="mt-1 text-xl font-semibold text-foreground">
                {result.feed.items.length}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">{t("contextFeed.tokenEstimate")}</div>
              <div className="mt-1 text-xl font-semibold text-foreground">
                {result.feed.tokenEstimate}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">{t("contextFeed.redactions")}</div>
              <div className="mt-1 text-sm text-foreground">
                {result.feed.redactions.map((r) => `${r.kind}: ${r.count}`).join(", ") || "-"}
              </div>
            </div>
          </div>

          {/* Feed 条目列表 */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">
              {t("contextFeed.itemsTitle")}
            </h3>
            <div className="space-y-3">
              {result.feed.items.map((item) => (
                <div key={item.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">{item.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={`rounded-md px-2 py-0.5 ${
                          item.layer === "survival"
                            ? "bg-red-500/10 text-red-600"
                            : item.layer === "efficiency"
                              ? "bg-blue-500/10 text-blue-600"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {item.layer}
                      </span>
                      <span className="text-muted-foreground">{item.freshness}</span>
                      <span className="text-muted-foreground">{item.confidence}</span>
                    </div>
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground font-mono">
                    {item.content}
                  </pre>
                </div>
              ))}
            </div>
          </div>

          {/* 格式化输出 */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">
              {t("contextFeed.formattedOutput")}
            </h3>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-4 text-xs text-foreground font-mono">
              {result.formatted}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
