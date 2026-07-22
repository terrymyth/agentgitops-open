import fs from "node:fs/promises";
import path from "node:path";
import type { SyncEvent } from "@agentgitops/core";
import { TeamSyncStore } from "./team-sync-store.js";
import { ContextFeedPrivacyFilter } from "./context-feed-privacy-filter.js";
import type { TeamSyncConfig } from "./config-loader.js";
import { defaultGitNativeSyncConfig } from "./config-loader.js";

/**
 * SyncManifest - 导出清单元数据
 *
 * 记录本机最后一次导出的信息，便于对方机器判断新鲜度和增量。
 */
export interface SyncManifest {
  hubId: string;
  exportedAt: string;
  eventCount: number;
  lastEventId: string | null;
  schemaVersion: number;
}

/**
 * GitNativeSyncExporter - Git-Native 事件导出器
 *
 * 将 TeamSyncStore 中的 pending SyncEvents 序列化为 JSON 文件，
 * 写入 .agentgitops/sync/outbox/ 目录，通过 git add -f + commit + push
 * 实现跨机器同步。
 *
 * 安全要求：
 * - 导出前对 payload 中的文本字段执行隐私过滤（token、密钥等）
 * - 遵守 TeamSyncConfig 隐私配置（敏感内容默认不导出）
 * - 不导出源码、diff、完整日志
 */
export class GitNativeSyncExporter {
  private readonly outboxDir: string;
  private readonly eventsDir: string;
  private readonly manifestPath: string;
  private readonly privacyFilter = new ContextFeedPrivacyFilter();

  constructor(
    private readonly projectPath: string,
    private readonly syncConfig?: TeamSyncConfig,
  ) {
    this.outboxDir = path.join(projectPath, ".agentgitops", "sync", "outbox");
    this.eventsDir = path.join(this.outboxDir, "events");
    this.manifestPath = path.join(this.outboxDir, "manifest.json");
  }

  /**
   * 导出所有 pending events 到 outbox
   *
   * 流程：
   * 1. 从 TeamSyncStore 读取 pending events
   * 2. 按隐私配置过滤 payload
   * 3. 每个事件写入独立 JSON 文件
   * 4. 更新 manifest.json
   * 5. 在 Store 中标记为 pushed
   */
  async exportPending(): Promise<{ exported: number; manifest: SyncManifest | null }> {
    const store = new TeamSyncStore(this.projectPath);
    try {
      const summary = store.getStatusSummary();
      if (!summary.team) {
        return { exported: 0, manifest: null };
      }

      const events = store.listPendingEvents(summary.team.teamId);
      if (events.length === 0) {
        return { exported: 0, manifest: null };
      }

      await this.ensureDirs();
      const hubId = summary.localHub?.hubId ?? "unknown";
      const exportedEvents = await this.exportEvents(events, hubId);

      const manifest: SyncManifest = {
        hubId,
        exportedAt: new Date().toISOString(),
        eventCount: exportedEvents.length,
        lastEventId: exportedEvents.at(-1)?.eventId ?? null,
        schemaVersion: 1,
      };
      await fs.writeFile(this.manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

      // 标记为 pushed（与 relay 模式语义一致：已离开本机 pending 队列）
      store.markEventsPushed(exportedEvents.map((e) => e.eventId));

      return { exported: exportedEvents.length, manifest };
    } finally {
      store.close();
    }
  }

  /**
   * 导出指定事件列表
   *
   * 每个事件写入 {hubId}/{eventId}.json，按 hubId 分子目录避免 Git 合并冲突。
   */
  async exportEvents(events: SyncEvent[], hubId?: string): Promise<SyncEvent[]> {
    const hubDir = hubId ? path.join(this.eventsDir, this.sanitizeFilename(hubId)) : this.eventsDir;
    await fs.mkdir(hubDir, { recursive: true });
    const exported: SyncEvent[] = [];
    for (const event of events) {
      const filtered = this.applyPrivacyFilter(event);
      const jsonContent = JSON.stringify(filtered, null, 2);
      // DOG-P2-007: 写入前隐私扫描
      const scanResult = this.scanForSecrets(jsonContent);
      if (scanResult.found > 0) {
        // 发现敏感信息，跳过导出并记录
        continue;
      }
      const filePath = path.join(hubDir, `${this.sanitizeFilename(event.eventId)}.json`);
      await fs.writeFile(filePath, jsonContent, "utf-8");
      exported.push(filtered);
    }
    return exported;
  }

  /**
   * 清理已导出的 outbox 事件文件
   *
   * 在确认对方已接收后调用，防止 outbox 无限膨胀。
   */
  async cleanupExported(): Promise<{ removed: number }> {
    let removed = 0;
    try {
      const files = await fs.readdir(this.eventsDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          await fs.unlink(path.join(this.eventsDir, file));
          removed++;
        }
      }
    } catch {
      // 目录不存在，无需清理
    }
    return { removed };
  }

  /**
   * DOG-P2-003: 导出 handoff 文件到 outbox
   *
   * 将 .agentgitops/handoffs/ 中的文件复制到 .agentgitops/sync/outbox/handoffs/，
   * 通过 git push 同步到对方机器。
   */
  async exportHandoffs(): Promise<{ exported: number }> {
    const sourceDir = path.join(this.projectPath, ".agentgitops", "handoffs");
    const targetDir = path.join(this.outboxDir, "handoffs");
    let exported = 0;
    try {
      const entries = await fs.readdir(sourceDir);
      await fs.mkdir(targetDir, { recursive: true });
      for (const entry of entries) {
        if (entry.endsWith(".json") || entry.endsWith(".md")) {
          const content = await fs.readFile(path.join(sourceDir, entry), "utf-8");
          await fs.writeFile(path.join(targetDir, entry), content, "utf-8");
          exported++;
        }
      }
    } catch {
      // handoffs 目录不存在，跳过
    }
    return { exported };
  }

  /**
   * DOG-P2-004: 导出冲突信号到 outbox
   *
   * 将本地 ConflictGraphBuilder 生成的冲突边导出为 JSON 文件到 outbox/conflicts/，
   * 通过 git push 同步到对方机器。
   */
  async exportConflictSignals(conflicts: unknown[]): Promise<{ exported: number }> {
    const targetDir = path.join(this.outboxDir, "conflicts");
    if (conflicts.length === 0) return { exported: 0 };
    await fs.mkdir(targetDir, { recursive: true });
    const filePath = path.join(
      targetDir,
      `conflicts-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    await fs.writeFile(filePath, JSON.stringify(conflicts, null, 2), "utf-8");
    return { exported: 1 };
  }

  /**
   * DOG-P2-007: 隐私扫描
   *
   * 在写入 outbox 前扫描 JSON 内容是否包含敏感模式（token、密钥等）。
   * 返回发现的敏感模式数量。
   */
  scanForSecrets(content: string): { found: number; patterns: string[] } {
    const patterns: string[] = [];
    const secretPatterns = [
      { name: "github_token", regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g },
      { name: "github_pat", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
      { name: "aws_access_key", regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
      { name: "private_key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
      { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
    ];
    for (const { name, regex } of secretPatterns) {
      if (regex.test(content)) {
        patterns.push(name);
      }
      regex.lastIndex = 0;
    }
    return { found: patterns.length, patterns };
  }

  /**
   * 读取当前 manifest（如果存在）
   */
  async readManifest(): Promise<SyncManifest | null> {
    try {
      const content = await fs.readFile(this.manifestPath, "utf-8");
      return JSON.parse(content) as SyncManifest;
    } catch {
      return null;
    }
  }

  // ===== Private =====

  private async ensureDirs(): Promise<void> {
    await fs.mkdir(this.eventsDir, { recursive: true });
  }

  /**
   * 根据隐私配置过滤事件 payload
   *
   * 敏感字段（agentExecution、failureReason、filesRead、tokenUsage）
   * 在配置为 false 时从 payload 中移除。
   * 所有文本值再经过正则脱敏（token、密钥等）。
   */
  private applyPrivacyFilter(event: SyncEvent): SyncEvent {
    const config = this.syncConfig;
    const payload = { ...event.payload } as Record<string, unknown>;

    if (config) {
      if (config.agentExecution === false) {
        delete payload.strategy;
        delete payload.steps;
        delete payload.filesRead;
      }
      if (config.failureReason === false) {
        delete payload.failureReason;
        delete payload.error;
      }
      if (config.filesRead === false) {
        delete payload.filesRead;
      }
      if (config.tokenUsage === false) {
        delete payload.tokenUsage;
        delete payload.tokenEstimate;
        delete payload.cost;
      }
    }

    // 对所有字符串值执行正则脱敏
    const redactedPayload = this.redactStringValues(payload);

    return {
      ...event,
      payload: redactedPayload,
    };
  }

  private redactStringValues(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        result[key] = this.privacyFilter.redact(value).text;
      } else if (Array.isArray(value)) {
        result[key] = value.map((v) =>
          typeof v === "string" ? this.privacyFilter.redact(v).text : v,
        );
      } else if (value !== null && typeof value === "object") {
        result[key] = this.redactStringValues(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_");
  }
}

/**
 * 读取 git-native 配置的有效值（带默认值）
 */
export function resolveGitNativeConfig(syncConfig?: TeamSyncConfig) {
  const defaults = defaultGitNativeSyncConfig();
  const configured = syncConfig?.gitNative ?? {};
  return {
    autoExport: configured.autoExport ?? defaults.autoExport!,
    autoImportOnPull: configured.autoImportOnPull ?? defaults.autoImportOnPull!,
    cleanupExported: configured.cleanupExported ?? defaults.cleanupExported!,
  };
}
