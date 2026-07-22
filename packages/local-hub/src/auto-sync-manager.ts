import type { AgentgitopsConfig } from "./config-loader.js";
import {
  ConfigLoader,
  RelayClient,
  TeamSyncStore,
  TeamSyncEventApplier,
  GitNativeSyncImporter,
  GitNativeSyncExporter,
  defaultTeamSyncConfig,
} from "./index.js";

/**
 * AutoSyncManager - 自动定时同步管理器
 *
 * 在 Server 启动时根据 team.sync.mode 配置注册定时任务：
 * - 定时 sync pull：从 Relay 拉取其他 Hub 的事件
 * - 有 pending events 时自动 sync push：上传本地事件到 Relay
 *
 * 通过 SSE 广播 sync 状态变化。
 *
 * 安全要求：
 * - 自动同步遵守 syncConfig 过滤
 * - 失败不崩溃 Server
 * - 可通过 syncIntervalSeconds: 0 关闭
 */
export class AutoSyncManager {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private lastSyncAt?: string;
  private lastSyncResult?: { pulled: number; pushed: number; error?: string };

  constructor(
    private readonly projectPath: string,
    private readonly onSyncStateChange?: (state: AutoSyncState) => void,
  ) {}

  /**
   * 启动自动同步
   *
   * 读取配置，如果 team.sync.mode === "auto" 且 intervalSeconds > 0，则注册定时任务。
   */
  start(): void {
    void this.startAsync();
  }

  private async startAsync(): Promise<void> {
    const config = await this.loadConfig();
    const syncConfig = config.team?.sync ?? defaultTeamSyncConfig();

    if (syncConfig.mode !== "auto") return;
    const intervalMs = (syncConfig.intervalSeconds ?? 60) * 1000;
    if (intervalMs <= 0) return;

    // 立即执行一次，然后定时执行
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  /**
   * 停止自动同步
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * 手动触发一次同步（不受 mode 限制）
   */
  async syncNow(): Promise<{ pulled: number; pushed: number; error?: string }> {
    return this.doSync();
  }

  /**
   * 获取当前同步状态
   */
  getState(): AutoSyncState {
    const store = new TeamSyncStore(this.projectPath);
    try {
      const summary = store.getStatusSummary();
      return {
        running: this.running,
        mode: summary.team?.syncMode ?? "manual",
        lastSyncAt: this.lastSyncAt,
        lastSyncResult: this.lastSyncResult,
        pendingEvents: summary.team ? store.listPendingEvents(summary.team.teamId).length : 0,
        relayUrl: summary.team?.relayUrl,
      };
    } finally {
      store.close();
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return; // 防止重叠执行
    try {
      await this.doSync();
    } catch {
      // 错误已在 doSync 中处理
    }
  }

  private async doSync(): Promise<{ pulled: number; pushed: number; error?: string }> {
    this.running = true;
    this.notifyStateChange();

    try {
      const store = new TeamSyncStore(this.projectPath);

      let pulled = 0;
      let pushed = 0;
      let error: string | undefined;

      try {
        const summary = store.getStatusSummary();
        if (!summary.team || !summary.localHub) {
          return { pulled: 0, pushed: 0 };
        }

        const relayUrl = summary.team.relayUrl;

        // git-native 模式：通过 outbox 文件同步，不依赖 Relay
        if (summary.team.syncMode === "git-native") {
          // 1. 导入 outbox 中的新事件（来自其他 Hub，通过 git pull 获取）
          try {
            const importer = new GitNativeSyncImporter(this.projectPath);
            const importResult = await importer.importNew();
            pulled = importResult.imported;
          } catch (err) {
            error = `Git-native import failed: ${err instanceof Error ? err.message : String(err)}`;
          }

          // 2. 导出本地 pending events 到 outbox
          const pendingEvents = store.listPendingEvents(summary.team.teamId);
          if (pendingEvents.length > 0) {
            try {
              const config = await this.loadConfig();
              const syncConfig = config.team?.sync ?? defaultTeamSyncConfig();
              const exporter = new GitNativeSyncExporter(this.projectPath, syncConfig);
              const exportResult = await exporter.exportPending();
              pushed = exportResult.exported;
            } catch (err) {
              error =
                (error ? error + "; " : "") +
                `Git-native export failed: ${err instanceof Error ? err.message : String(err)}`;
            }
          }

          this.lastSyncAt = new Date().toISOString();
          this.lastSyncResult = { pulled, pushed, error };
          this.notifyStateChange();
          return { pulled, pushed, error };
        }

        if (!relayUrl) {
          return { pulled: 0, pushed: 0 };
        }

        const client = new RelayClient({
          relayUrl,
          teamId: summary.team.teamId,
          hubId: summary.localHub.hubId,
          teamSecret: undefined, // team_secret 从配置获取，这里简化处理
        });

        // 1. Pull：从 Relay 拉取其他 Hub 的事件
        try {
          const pullResult = await client.pull({
            sinceCursor: summary.lastPullCursor?.cursor,
            limit: 100,
          });
          const applier = new TeamSyncEventApplier(store);
          for (const event of pullResult.events) {
            const existing =
              store.getSyncEvent(event.eventId) ??
              store.getSyncEventByIdempotencyKey(event.idempotencyKey);
            if (!existing)
              store.enqueueSyncEvent({
                ...event,
                status: "pushed",
                appliedAt: new Date().toISOString(),
              });
            const appliedResult = applier.apply(event);
            if (appliedResult.applied) pulled += 1;
          }
          if (pullResult.nextCursor) {
            store.setSyncCursor({
              cursor: pullResult.nextCursor,
              teamId: summary.team.teamId,
              hubId: summary.localHub.hubId,
              direction: "pull",
              eventId: pullResult.events.at(-1)?.eventId,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          error = `Pull failed: ${err instanceof Error ? err.message : String(err)}`;
        }

        // 2. Push：有 pending events 时上传到 Relay
        const pendingEvents = store.listPendingEvents(summary.team.teamId);
        if (pendingEvents.length > 0) {
          try {
            const pushResult = await client.push(pendingEvents);
            const syncedEventIds = pendingEvents.map((e) => e.eventId);
            store.markEventsPushed(
              syncedEventIds,
              pushResult.cursor
                ? {
                    cursor: pushResult.cursor,
                    teamId: summary.team.teamId,
                    hubId: summary.localHub.hubId,
                    direction: "push",
                    eventId: syncedEventIds.at(-1),
                    updatedAt: new Date().toISOString(),
                  }
                : undefined,
            );
            pushed = pushResult.accepted ?? 0;
          } catch (err) {
            error =
              (error ? error + "; " : "") +
              `Push failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      } finally {
        store.close();
      }

      this.lastSyncAt = new Date().toISOString();
      this.lastSyncResult = { pulled, pushed, error };
      this.notifyStateChange();
      return { pulled, pushed, error };
    } catch (err) {
      this.lastSyncAt = new Date().toISOString();
      this.lastSyncResult = {
        pulled: 0,
        pushed: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      this.notifyStateChange();
      return this.lastSyncResult;
    } finally {
      this.running = false;
    }
  }

  private async loadConfig(): Promise<AgentgitopsConfig> {
    try {
      return await ConfigLoader.load(this.projectPath);
    } catch {
      return {
        version: 1,
        project: { name: "", default_branch: "main", worktree_root: ".agentgitops/worktrees" },
        git: { provider: "github", remote: "" },
        agents: {},
      };
    }
  }

  private notifyStateChange(): void {
    if (this.onSyncStateChange) {
      this.onSyncStateChange(this.getState());
    }
  }
}

export interface AutoSyncState {
  running: boolean;
  mode: string;
  lastSyncAt?: string;
  lastSyncResult?: { pulled: number; pushed: number; error?: string };
  pendingEvents: number;
  relayUrl?: string;
}
