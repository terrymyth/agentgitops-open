import { createHash, createHmac } from "node:crypto";
import type { SyncEvent } from "@agentgitops/core";

/**
 * RelayClient - Relay HTTP API 客户端
 *
 * 封装与 Team Sync Relay 服务器的 HTTP 通信，
 * 支持多机协同（N 个 Local Hub 通过 1 个 Relay 同步）。
 *
 * 核心能力：
 * - push：上传本地 pending events 到 Relay
 * - pull：从 Relay 拉取其他 Hub 的事件
 * - status：查询团队状态
 * - testConnection：测试 Relay 连通性
 */

export interface RelayClientOptions {
  /** Relay 服务器 URL（如 https://relay.example.com） */
  relayUrl: string;
  /** Team ID */
  teamId: string;
  /** Local Hub ID */
  hubId: string;
  /** Team Secret Hash（用于 HMAC 签名认证） */
  teamSecretHash?: string;
  /** Team Secret 明文，仅用于兼容旧调用；客户端会本地散列后签名，不会发送明文 */
  teamSecret?: string;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
}

export interface RelayPushResult {
  teamId: string;
  hubId: string;
  accepted: number;
  duplicated: number;
  applied: number;
  cursor?: string;
  events: Array<{ eventId: string; status: "accepted" | "duplicate" }>;
}

export interface RelayPullResult {
  teamId: string;
  hubId: string;
  cursor?: string;
  nextCursor?: string;
  events: SyncEvent[];
}

export interface RelayTeamStatus {
  team: { teamId: string; name: string; syncMode: string } | null;
  memberCount: number;
  localHub: { hubId: string; status: string } | null;
  syncState: {
    pendingEvents: number;
    cachedTasks: number;
    cachedChangePackages: number;
    conflictEdges: number;
    handoffPackages: number;
    activeAdoptions: number;
    lastPushCursor: string | null;
    lastPullCursor: string | null;
  };
}

export class RelayClient {
  private readonly baseUrl: string;
  private readonly teamId: string;
  private readonly hubId: string;
  private readonly teamSecretHash?: string;
  private readonly timeoutMs: number;

  constructor(options: RelayClientOptions) {
    this.baseUrl = options.relayUrl.replace(/\/$/, "");
    this.teamId = options.teamId;
    this.hubId = options.hubId;
    this.teamSecretHash = options.teamSecretHash ?? hashTeamSecret(options.teamSecret);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /**
   * 上传本地 pending events 到 Relay
   *
   * Relay 按 idempotencyKey 去重，返回 accepted/duplicated 计数。
   * 支持多机：N 个 Hub 都可 push 到同一 Relay。
   */
  async push(events: SyncEvent[]): Promise<RelayPushResult> {
    const response = await this.request("POST", "/api/sync/push", {
      teamId: this.teamId,
      hubId: this.hubId,
      events,
    });
    return response as RelayPushResult;
  }

  /**
   * 从 Relay 拉取其他 Hub 的事件
   *
   * 只返回非本 Hub 产生的、pending/pushed 状态的事件。
   * 支持游标分页，实现增量同步。
   */
  async pull(
    options: { cursor?: string; sinceCursor?: string; limit?: number } = {},
  ): Promise<RelayPullResult> {
    const params = new URLSearchParams({
      teamId: this.teamId,
      hubId: this.hubId,
    });
    const cursor = options.cursor ?? options.sinceCursor;
    if (cursor) params.set("cursor", cursor);
    if (options.limit) params.set("limit", String(options.limit));

    const response = (await this.request(
      "GET",
      `/api/sync/pull?${params.toString()}`,
    )) as RelayPullResult;
    return {
      ...response,
      nextCursor: response.nextCursor ?? response.cursor,
    };
  }

  /**
   * 查询团队状态
   */
  async getTeamStatus(): Promise<RelayTeamStatus> {
    const params = new URLSearchParams({ teamId: this.teamId });
    const response = await this.request("GET", `/api/team/status?${params.toString()}`);
    return response as RelayTeamStatus;
  }

  /**
   * 测试 Relay 连通性
   *
   * 用于配置页面的"测试同步连接"按钮。
   */
  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        return { ok: false, latencyMs, error: `HTTP ${response.status}` };
      }
      return { ok: true, latencyMs };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.buildHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errorBody = (await response.json()) as {
          message?: string;
          error?: string | { message?: string };
        };
        detail =
          errorBody.message ??
          (typeof errorBody.error === "string" ? errorBody.error : errorBody.error?.message) ??
          detail;
      } catch {
        // 非 JSON 错误响应
      }
      throw new Error(`Relay ${method} ${path} failed (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as
      { data?: unknown; error?: { message?: string } } | unknown;
    if (payload && typeof payload === "object" && "data" in payload) {
      return (payload as { data?: unknown }).data;
    }
    return payload;
  }

  private buildHeaders(): Record<string, string> {
    const timestamp = new Date().toISOString();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      "x-agentgitops-team-id": this.teamId,
      "x-agentgitops-hub-id": this.hubId,
      "x-agentgitops-timestamp": timestamp,
    };
    if (this.teamSecretHash) {
      headers["x-agentgitops-signature"] = createHmac("sha256", this.teamSecretHash)
        .update(`${timestamp}\n${this.teamId}\n${this.hubId}`)
        .digest("hex");
    }
    return headers;
  }
}

function hashTeamSecret(secret?: string): string | undefined {
  if (!secret) return undefined;
  return createHash("sha256").update(secret).digest("hex");
}
