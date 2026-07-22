import fs from "node:fs/promises";
import path from "node:path";
import type { SyncEvent } from "@agentgitops/core";
import { TeamSyncStore } from "./team-sync-store.js";
import { TeamSyncEventApplier } from "./team-sync-event-applier.js";

/**
 * AppliedRecord - 本机已应用事件记录（游标）
 *
 * 存储在 .agentgitops/sync/applied.json，不同步到 Git。
 * 用于幂等去重，避免重复应用同一事件。
 */
export interface AppliedRecord {
  appliedEventIds: string[];
  appliedIdempotencyKeys: string[];
  lastImportAt: string;
}

/**
 * GitNativeSyncImportResult - 导入结果
 */
export interface GitNativeSyncImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * GitNativeSyncImporter - Git-Native 事件导入器
 *
 * 读取 .agentgitops/sync/outbox/ 目录中的 JSON 事件文件，
 * 反序列化为 SyncEvent，通过 TeamSyncEventApplier 应用到本地 Store。
 *
 * 幂等机制：
 * 1. 检查 applied.json 中的 eventId 和 idempotencyKey
 * 2. 检查 TeamSyncStore 中是否已存在该事件
 * 3. 未应用则通过 TeamSyncEventApplier.apply() 应用
 * 4. 应用后记录到 applied.json
 */
export class GitNativeSyncImporter {
  private readonly outboxDir: string;
  private readonly eventsDir: string;
  private readonly appliedPath: string;

  constructor(private readonly projectPath: string) {
    this.outboxDir = path.join(projectPath, ".agentgitops", "sync", "outbox");
    this.eventsDir = path.join(this.outboxDir, "events");
    this.appliedPath = path.join(projectPath, ".agentgitops", "sync", "applied.json");
  }

  /**
   * 导入所有未应用的事件
   *
   * 流程：
   * 1. 读取 outbox/events/ 目录中的所有 JSON 文件
   * 2. 按 createdAt 排序（保证事件时序）
   * 3. 逐个检查幂等性并应用
   * 4. 更新 applied.json
   */
  async importNew(): Promise<GitNativeSyncImportResult> {
    const applied = await this.readAppliedRecord();
    const store = new TeamSyncStore(this.projectPath);
    const applier = new TeamSyncEventApplier(store);

    const errors: string[] = [];
    let imported = 0;
    let skipped = 0;

    try {
      const files = await this.listEventFiles();
      if (files.length === 0) {
        return { imported: 0, skipped: 0, errors: [] };
      }

      const events = await this.readAndSortEvents(files);

      for (const event of events) {
        try {
          if (this.isAlreadyApplied(event, applied, store)) {
            skipped++;
            continue;
          }

          // 入队到本地 Store（标记为 pushed，因为是远端来的）
          store.enqueueSyncEvent({ ...event, status: "pushed" });

          // 应用事件
          const result = applier.apply(event);
          if (result.applied) {
            imported++;
            this.recordApplied(event, applied);
          } else {
            skipped++;
          }
        } catch (err) {
          errors.push(
            `Event ${event.eventId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.writeAppliedRecord(applied);
      return { imported, skipped, errors };
    } finally {
      store.close();
    }
  }

  /**
   * 读取 outbox 中的事件数量（不应用）
   */
  async countPendingImports(): Promise<number> {
    try {
      const files = await this.listEventFiles();
      return files.length;
    } catch {
      return 0;
    }
  }

  // ===== Private =====

  private async listEventFiles(): Promise<string[]> {
    try {
      const files: string[] = [];
      // 递归读取 events 目录（支持 per-hub 子目录 DOG-P2-005 和扁平结构）
      await this.collectJsonFiles(this.eventsDir, files);
      return files;
    } catch {
      return [];
    }
  }

  private async collectJsonFiles(dir: string, result: string[]): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await this.collectJsonFiles(fullPath, result);
      } else if (entry.endsWith(".json")) {
        result.push(fullPath);
      }
    }
  }

  private async readAndSortEvents(files: string[]): Promise<SyncEvent[]> {
    const events: SyncEvent[] = [];
    for (const file of files) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const event = JSON.parse(content) as SyncEvent;
        events.push(event);
      } catch {
        // 跳过无法解析的文件
      }
    }
    // 按 createdAt + eventId 排序，保证事件时序
    events.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return a.eventId.localeCompare(b.eventId);
    });
    return events;
  }

  private isAlreadyApplied(
    event: SyncEvent,
    applied: AppliedRecord,
    store: TeamSyncStore,
  ): boolean {
    // 检查 applied.json
    if (applied.appliedEventIds.includes(event.eventId)) return true;
    if (applied.appliedIdempotencyKeys.includes(event.idempotencyKey)) return true;

    // 检查 Store 中是否已存在
    const existing =
      store.getSyncEvent(event.eventId) ?? store.getSyncEventByIdempotencyKey(event.idempotencyKey);
    if (existing) return true;

    return false;
  }

  private recordApplied(event: SyncEvent, applied: AppliedRecord): void {
    applied.appliedEventIds.push(event.eventId);
    applied.appliedIdempotencyKeys.push(event.idempotencyKey);
    applied.lastImportAt = new Date().toISOString();
  }

  private async readAppliedRecord(): Promise<AppliedRecord> {
    try {
      const content = await fs.readFile(this.appliedPath, "utf-8");
      return JSON.parse(content) as AppliedRecord;
    } catch {
      return {
        appliedEventIds: [],
        appliedIdempotencyKeys: [],
        lastImportAt: new Date().toISOString(),
      };
    }
  }

  private async writeAppliedRecord(record: AppliedRecord): Promise<void> {
    // 确保目录存在
    const dir = path.dirname(this.appliedPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.appliedPath, JSON.stringify(record, null, 2), "utf-8");
  }
}
