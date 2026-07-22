import type {
  AuditExportFormat,
  AuditExportOptions,
  ImmutableAuditEntry,
  ImmutableAuditSink,
} from "@agentgitops/core";
import { createHash } from "node:crypto";

/**
 * SiemAuditSink — EE SIEM 集成不可篡改审计 Sink（P1-005）
 *
 * 实现 ImmutableAuditSink 端口，提供：
 * 1. 哈希链不可篡改审计（appendImmutable + verifyChain）
 * 2. SIEM webhook 导出（Splunk/Datadog/Elastic/Chronicle）
 * 3. 多格式导出（json/csv/siem-json）
 * 4. 过滤导出（actor/type/time/project）
 *
 * 使用方式：
 *   const sink = new SiemAuditSink({ storageAdapter });
 *   sink.setSiemWebhook("https://http-inputs.splunkcloud.com/services/collector");
 *   await sink.appendImmutable(event);
 *   const report = await sink.export({ format: "siem-json", limit: 100 });
 */
export interface SiemConfig {
  /** 存储适配器（PostgreSQL 或 SQLite） */
  storageAdapter?: {
    query: (text: string, params?: unknown[]) => Promise<unknown[]> | unknown[];
  };
  /** SIEM webhook URL */
  siemWebhookUrl?: string;
  /** SIEM 类型（影响 payload 格式） */
  siemType?: "splunk" | "datadog" | "elastic" | "chronicle" | "generic";
  /** SIEM 认证 token */
  siemToken?: string;
  /** 批量发送大小 */
  batchSize?: number;
  /** 是否在 append 时自动推送到 SIEM */
  autoPush?: boolean;
}

export class SiemAuditSink implements ImmutableAuditSink {
  private config: SiemConfig;
  private entries: ImmutableAuditEntry[] = [];
  private lastHash = "";
  private siemWebhookUrl: string | null = null;

  constructor(config: SiemConfig = {}) {
    this.config = config;
    if (config.siemWebhookUrl) {
      this.siemWebhookUrl = config.siemWebhookUrl;
    }
  }

  /**
   * 追加不可篡改审计事件（自动计算哈希链）
   *
   * 哈希链算法：
   *   previousHash = 上一个事件的 currentHash（首个事件为 ""）
   *   currentHash = sha256(eventId + previousHash + eventType + actorId + timestamp + payload)
   */
  appendImmutable(
    event: Omit<ImmutableAuditEntry, "previousHash" | "currentHash">,
  ): ImmutableAuditEntry {
    const previousHash = this.lastHash;
    const currentHash = this.computeHash(event, previousHash);

    const entry: ImmutableAuditEntry = {
      ...event,
      previousHash,
      currentHash,
    };

    this.entries.push(entry);
    this.lastHash = currentHash;

    // 持久化到存储（如果配置）
    if (this.config.storageAdapter) {
      this.persistEntry(entry).catch(() => {
        // 持久化失败不影响内存中的哈希链
      });
    }

    // 自动推送到 SIEM（如果配置）
    if (this.config.autoPush && this.siemWebhookUrl) {
      this.pushToSiem([entry]).catch(() => {
        // SIEM 推送失败不影响审计写入
      });
    }

    return entry;
  }

  /**
   * 计算哈希
   */
  private computeHash(
    event: Omit<ImmutableAuditEntry, "previousHash" | "currentHash">,
    previousHash: string,
  ): string {
    const data = [
      event.eventId,
      previousHash,
      event.eventType,
      event.actorId,
      event.timestamp,
      JSON.stringify(event.payload),
    ].join("|");
    return createHash("sha256").update(data, "utf8").digest("hex");
  }

  /**
   * 验证审计链完整性
   *
   * 逐个检查 previousHash 是否与上一个 currentHash 一致，
   * 以及 currentHash 是否可重新计算验证。
   */
  verifyChain(): { valid: boolean; brokenAt?: string; error?: string } {
    let expectedPrevious = "";

    for (const entry of this.entries) {
      // 检查 previousHash 链接
      if (entry.previousHash !== expectedPrevious) {
        return {
          valid: false,
          brokenAt: entry.eventId,
          error: `Hash chain broken at event ${entry.eventId}: previousHash mismatch`,
        };
      }

      // 重新计算 currentHash 验证
      const recomputedHash = this.computeHash(
        {
          eventId: entry.eventId,
          eventType: entry.eventType,
          actorId: entry.actorId,
          actorType: entry.actorType,
          projectId: entry.projectId,
          taskId: entry.taskId,
          payload: entry.payload,
          timestamp: entry.timestamp,
          signature: entry.signature,
        },
        entry.previousHash,
      );

      if (recomputedHash !== entry.currentHash) {
        return {
          valid: false,
          brokenAt: entry.eventId,
          error: `Hash verification failed at event ${entry.eventId}: currentHash mismatch (possible tampering)`,
        };
      }

      expectedPrevious = entry.currentHash;
    }

    return { valid: true };
  }

  /**
   * 导出审计事件
   *
   * 支持格式：
   * - json：标准 JSON 数组
   * - csv：CSV 格式（适合 Excel 导入）
   * - siem-json：SIEM 友好的 JSON（每行一个事件，适合 Splunk HEC）
   */
  async export(options: AuditExportOptions): Promise<string> {
    let entries = [...this.entries];

    // 过滤
    if (options.actorId) {
      entries = entries.filter((e) => e.actorId === options.actorId);
    }
    if (options.eventType) {
      entries = entries.filter((e) => e.eventType === options.eventType);
    }
    if (options.projectId) {
      entries = entries.filter((e) => e.projectId === options.projectId);
    }
    if (options.startTime) {
      entries = entries.filter((e) => e.timestamp >= options.startTime!);
    }
    if (options.endTime) {
      entries = entries.filter((e) => e.timestamp <= options.endTime!);
    }
    if (options.limit) {
      entries = entries.slice(-options.limit);
    }

    return this.formatExport(entries, options.format);
  }

  /**
   * 格式化导出
   */
  private formatExport(entries: ImmutableAuditEntry[], format: AuditExportFormat): string {
    switch (format) {
      case "json":
        return JSON.stringify(entries, null, 2);

      case "csv": {
        const headers = [
          "eventId",
          "timestamp",
          "eventType",
          "actorId",
          "actorType",
          "projectId",
          "taskId",
          "previousHash",
          "currentHash",
          "payload",
        ];
        const rows = entries.map((e) => [
          e.eventId,
          e.timestamp,
          e.eventType,
          e.actorId,
          e.actorType,
          e.projectId,
          e.taskId ?? "",
          e.previousHash,
          e.currentHash,
          JSON.stringify(e.payload).replace(/"/g, '""'),
        ]);
        return [headers, ...rows].map((row) => row.join(",")).join("\n");
      }

      case "siem-json":
        // Splunk HEC 友好格式：每行一个 JSON 事件
        return entries
          .map((e) =>
            JSON.stringify({
              time: new Date(e.timestamp).getTime() / 1000,
              host: e.projectId,
              source: `agentgitops:${e.eventType}`,
              sourcetype: "_json",
              event: {
                eventId: e.eventId,
                eventType: e.eventType,
                actorId: e.actorId,
                actorType: e.actorType,
                projectId: e.projectId,
                taskId: e.taskId,
                payload: e.payload,
                hash: e.currentHash,
                previousHash: e.previousHash,
              },
            }),
          )
          .join("\n");

      default:
        return JSON.stringify(entries, null, 2);
    }
  }

  /**
   * 设置 SIEM webhook URL
   */
  setSiemWebhook(url: string): void {
    this.siemWebhookUrl = url;
  }

  /**
   * 批量推送到 SIEM
   *
   * 根据 siemType 格式化 payload：
   * - splunk：HEC 格式（每行一个 JSON 事件）
   * - datadog：Logs API 格式
   * - elastic：Bulk API 格式
   * - chronicle：JSON 格式
   * - generic：JSON 数组
   */
  async pushToSiem(
    entries: ImmutableAuditEntry[],
  ): Promise<{ pushed: number; failed: boolean; error?: string }> {
    if (!this.siemWebhookUrl) {
      return { pushed: 0, failed: false, error: "SIEM webhook not configured" };
    }

    const batchSize = this.config.batchSize ?? 100;
    let pushed = 0;

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const payload = this.formatSiemPayload(batch);

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        // Splunk HEC 认证
        if (this.config.siemType === "splunk" && this.config.siemToken) {
          headers["Authorization"] = `Splunk ${this.config.siemToken}`;
        }
        // Datadog 认证
        if (this.config.siemType === "datadog" && this.config.siemToken) {
          headers["DD-API-KEY"] = this.config.siemToken;
        }

        const response = await fetch(this.siemWebhookUrl, {
          method: "POST",
          headers,
          body: payload,
        });

        if (!response.ok) {
          return {
            pushed,
            failed: true,
            error: `SIEM webhook returned ${response.status}: ${await response.text()}`,
          };
        }

        pushed += batch.length;
      } catch (err) {
        return {
          pushed,
          failed: true,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return { pushed, failed: false };
  }

  /**
   * 根据 SIEM 类型格式化 payload
   */
  private formatSiemPayload(entries: ImmutableAuditEntry[]): string {
    const type = this.config.siemType ?? "generic";

    switch (type) {
      case "splunk":
        // Splunk HEC：每行一个 JSON 事件
        return entries
          .map((e) =>
            JSON.stringify({
              time: new Date(e.timestamp).getTime() / 1000,
              host: e.projectId,
              source: `agentgitops:${e.eventType}`,
              event: {
                eventId: e.eventId,
                eventType: e.eventType,
                actorId: e.actorId,
                actorType: e.actorType,
                projectId: e.projectId,
                taskId: e.taskId,
                payload: e.payload,
              },
            }),
          )
          .join("\n");

      case "datadog":
        // Datadog Logs API：JSON 数组
        return JSON.stringify(
          entries.map((e) => ({
            timestamp: new Date(e.timestamp).getTime(),
            service: "agentgitops",
            status: this.eventTypeToDatadogStatus(e.eventType),
            message: `${e.eventType} by ${e.actorId}`,
            ddtags: [`event_type:${e.eventType}`, `project:${e.projectId}`, `actor:${e.actorId}`],
            eventId: e.eventId,
            payload: e.payload,
          })),
        );

      case "elastic":
        // Elastic Bulk API：每行一个 action + source
        return entries
          .map((e) => {
            const action = JSON.stringify({
              index: { _index: "agentgitops-audit", _id: e.eventId },
            });
            const source = JSON.stringify({
              timestamp: e.timestamp,
              eventType: e.eventType,
              actorId: e.actorId,
              actorType: e.actorType,
              projectId: e.projectId,
              taskId: e.taskId,
              payload: e.payload,
              hash: e.currentHash,
            });
            return `${action}\n${source}`;
          })
          .join("\n");

      case "chronicle":
        // Chronicle：JSON 格式
        return JSON.stringify({
          entries: entries.map((e) => ({
            timestamp: e.timestamp,
            event_type: e.eventType,
            actor: e.actorId,
            project: e.projectId,
            payload: e.payload,
          })),
        });

      case "generic":
      default:
        return JSON.stringify(entries);
    }
  }

  /**
   * 事件类型映射到 Datadog 日志级别
   */
  private eventTypeToDatadogStatus(eventType: string): string {
    if (eventType.includes("fail") || eventType.includes("error") || eventType.includes("block")) {
      return "error";
    }
    if (eventType.includes("reject") || eventType.includes("deny")) {
      return "warn";
    }
    if (
      eventType.includes("approve") ||
      eventType.includes("merge") ||
      eventType.includes("success")
    ) {
      return "info";
    }
    return "info";
  }

  /**
   * 持久化审计条目到存储
   */
  private async persistEntry(entry: ImmutableAuditEntry): Promise<void> {
    if (!this.config.storageAdapter) return;
    await this.config.storageAdapter.query(
      `INSERT INTO immutable_audit (event_id, previous_hash, current_hash, event_type, actor_id, actor_type, project_id, task_id, payload, timestamp, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        entry.eventId,
        entry.previousHash,
        entry.currentHash,
        entry.eventType,
        entry.actorId,
        entry.actorType,
        entry.projectId,
        entry.taskId,
        JSON.stringify(entry.payload),
        entry.timestamp,
        entry.signature ?? null,
      ],
    );
  }

  /**
   * 获取所有条目（内存中的）
   */
  getEntries(): ImmutableAuditEntry[] {
    return [...this.entries];
  }

  /**
   * 从存储加载条目（恢复哈希链）
   */
  async loadFromStorage(): Promise<void> {
    if (!this.config.storageAdapter) return;
    const rows = (await this.config.storageAdapter.query(
      "SELECT * FROM immutable_audit ORDER BY timestamp ASC",
    )) as Array<Record<string, unknown>>;

    this.entries = rows.map((row) => ({
      eventId: row.event_id as string,
      previousHash: row.previous_hash as string,
      currentHash: row.current_hash as string,
      eventType: row.event_type as string,
      actorId: row.actor_id as string,
      actorType: row.actor_type as string,
      projectId: row.project_id as string,
      taskId: row.task_id as string | undefined,
      payload: JSON.parse(row.payload as string) as Record<string, unknown>,
      timestamp: row.timestamp as string,
      signature: row.signature as string | undefined,
    }));

    this.lastHash =
      this.entries.length > 0 ? this.entries[this.entries.length - 1].currentHash : "";
  }
}
