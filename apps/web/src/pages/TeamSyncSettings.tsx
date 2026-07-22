import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Clock, RefreshCw, RotateCcw, Save, Wifi, WifiOff } from "lucide-react";
import {
  getAutoSyncStatus,
  getTeamSyncConfig,
  triggerSyncNow,
  updateTeamSyncConfig,
  type AutoSyncStatus,
  type TeamSyncConfig,
} from "../api.js";
import { useI18n } from "../i18n.js";

const coreKeys = ["tasks", "changedFiles", "riskLevel", "verification", "conflicts"] as const;
const sensitiveKeys = ["agentExecution", "failureReason", "filesRead", "tokenUsage"] as const;
const optionalKeys = ["agentNotes", "reviewContext", "handoff"] as const;
type BooleanKey =
  (typeof coreKeys)[number] | (typeof sensitiveKeys)[number] | (typeof optionalKeys)[number];

export function TeamSyncSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState<AutoSyncStatus | null>(null);
  const [config, setConfig] = useState<TeamSyncConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<TeamSyncConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = useMemo(() => {
    if (!config || !savedConfig) return false;
    return JSON.stringify(config) !== JSON.stringify(savedConfig);
  }, [config, savedConfig]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [nextStatus, syncConfig] = await Promise.all([
        getAutoSyncStatus(),
        getTeamSyncConfig(),
      ]);
      setStatus(nextStatus);
      setConfig(syncConfig.config);
      setSavedConfig(syncConfig.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void getAutoSyncStatus()
        .then(setStatus)
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  function patch(next: Partial<TeamSyncConfig>) {
    setConfig((current) => ({ ...(current ?? {}), ...next }));
    setMessage(null);
  }

  function toggle(key: BooleanKey) {
    patch({ [key]: !config?.[key] });
  }

  async function save() {
    if (!config) return;
    try {
      setSaving(true);
      setError(null);
      const result = await updateTeamSyncConfig(config);
      setConfig(result.config);
      setSavedConfig(result.config);
      setMessage(t("teamSyncSettings.saved"));
      const nextStatus = await getAutoSyncStatus();
      setStatus(nextStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncNow() {
    try {
      setSyncing(true);
      setError(null);
      await triggerSyncNow();
      const nextStatus = await getAutoSyncStatus();
      setStatus(nextStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  if (loading && !status && !config) {
    return <div className="text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const current = config ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("teamSync.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("teamSyncSettings.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <RefreshCw className="size-4" />
            {t("common.refresh")}
          </button>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
            {t("teamSync.syncNow")}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-brand-green-500/30 bg-brand-green-500/10 p-3 text-sm text-brand-green-700">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatusCard
          icon={
            status?.running ? (
              <Wifi className="size-4 text-primary" />
            ) : (
              <WifiOff className="size-4 text-muted-foreground" />
            )
          }
          label={t("teamSync.syncState")}
          value={status?.running ? t("teamSync.syncing") : t("teamSync.idle")}
          detail={`${t("teamSync.mode")}: ${status?.mode ?? current.mode ?? "manual"}`}
        />
        <StatusCard
          icon={<Clock className="size-4" />}
          label={t("teamSync.lastSync")}
          value={status?.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "-"}
          detail={
            status?.lastSyncResult
              ? `${t("teamSync.pulled")}: ${status.lastSyncResult.pulled}, ${t("teamSync.pushed")}: ${status.lastSyncResult.pushed}`
              : "-"
          }
        />
        <StatusCard
          icon={<AlertCircle className="size-4" />}
          label={t("teamSync.pendingEvents")}
          value={String(status?.pendingEvents ?? 0)}
          detail={
            status?.mode === "git-native"
              ? `${t("teamSync.mode")}: git-native (via Git repo)`
              : `${t("teamSync.relay")}: ${status?.relayUrl ?? "-"}`
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground">
            {t("teamSyncSettings.runtime")}
          </div>
          <div className="mt-4 space-y-4">
            <label className="block text-sm">
              <span className="text-muted-foreground">{t("teamSyncSettings.mode")}</span>
              <select
                value={current.mode ?? "manual"}
                onChange={(event) => patch({ mode: event.target.value as TeamSyncConfig["mode"] })}
                className="mt-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
              >
                <option value="manual">{t("teamSyncSettings.mode.manual")}</option>
                <option value="auto">{t("teamSyncSettings.mode.auto")}</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">{t("teamSyncSettings.interval")}</span>
              <input
                type="number"
                min={5}
                value={current.intervalSeconds ?? 60}
                onChange={(event) =>
                  patch({ intervalSeconds: Number.parseInt(event.target.value, 10) || 60 })
                }
                className="mt-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => setConfig(savedConfig)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className="size-4" />
                {t("teamSyncSettings.reset")}
              </button>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void save()}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Save className="size-4" />
                {saving ? t("teamSyncSettings.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <ToggleGroup
              title={t("teamSyncSettings.core")}
              keys={coreKeys}
              config={current}
              toggle={toggle}
              t={t}
            />
            <ToggleGroup
              title={t("teamSyncSettings.sensitive")}
              keys={sensitiveKeys}
              config={current}
              toggle={toggle}
              t={t}
            />
            <ToggleGroup
              title={t("teamSyncSettings.optional")}
              keys={optionalKeys}
              config={current}
              toggle={toggle}
              t={t}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function ToggleGroup({
  title,
  keys,
  config,
  toggle,
  t,
}: {
  title: string;
  keys: readonly BooleanKey[];
  config: TeamSyncConfig;
  toggle: (key: BooleanKey) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3 space-y-2">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            className="flex h-10 w-full items-center justify-between rounded-md border border-border px-3 text-left text-sm transition-colors hover:bg-muted/50"
          >
            <span className="text-muted-foreground">{t(`teamSyncSettings.key.${key}`)}</span>
            <span
              className={`h-5 w-9 rounded-full p-0.5 transition-colors ${config[key] ? "bg-primary" : "bg-muted"}`}
            >
              <span
                className={`block size-4 rounded-full bg-background transition-transform ${config[key] ? "translate-x-4" : ""}`}
              />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
