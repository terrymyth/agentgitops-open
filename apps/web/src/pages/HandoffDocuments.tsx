import { useCallback, useEffect, useState } from "react";
import { FileText, ArrowLeft } from "lucide-react";
import { fetchApi } from "../api.js";
import { useI18n } from "../i18n.js";

interface HandoffDoc {
  docId: string;
  taskId: string;
  agentId: string;
  agentType: string;
  title: string;
  markdown: string;
  createdAt: string;
}

export function HandoffDocuments() {
  const { t } = useI18n();
  const [docs, setDocs] = useState<HandoffDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<HandoffDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchApi<HandoffDoc[]>("/api/handoff-docs");
      setDocs(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && docs.length === 0) {
    return <div className="text-muted-foreground text-sm">{t("common.loading")}…</div>;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="text-destructive text-sm">{error}</div>
        <button onClick={load} className="rounded-md border border-border px-3 py-1.5 text-sm">
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (selectedDoc) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedDoc(null)}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("common.back")}
        </button>
        <div className="rounded-lg border border-border bg-card p-6">
          <pre className="whitespace-pre-wrap text-sm text-foreground font-mono">
            {selectedDoc.markdown}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">{t("handoffDocs.title")}</h2>

      {docs.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">{t("handoffDocs.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div
              key={doc.docId}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50 cursor-pointer"
              onClick={() => setSelectedDoc(doc)}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{doc.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Task: {doc.taskId} · Agent: {doc.agentId} ({doc.agentType})
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(doc.createdAt).toLocaleString()}
                </div>
              </div>
              <FileText className="size-4 text-muted-foreground" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
