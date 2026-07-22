import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { ConflictGraphEdge, SyncCursor, SyncEvent } from "@agentgitops/core";
import {
  ConflictGraphBuilder,
  TeamSyncEventApplier,
  TeamSyncStore,
  type TeamSyncStatusSummary,
} from "@agentgitops/local-hub";

/**
 * Team Sync 认证错误
 *
 * 携带 HTTP 状态码（401 或 403），让 Server 路由层能返回正确的状态码。
 */
export class TeamSyncAuthError extends Error {
  constructor(
    public readonly statusCode: 401 | 403,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TeamSyncAuthError";
  }
}

export interface TeamSyncPublicStatus {
  team?: {
    teamId: string;
    name: string;
    repoUrl: string;
    relayUrl?: string;
    syncMode: string;
    createdAt: string;
    updatedAt: string;
  };
  localHub?: {
    hubId: string;
    teamId: string;
    memberId: string;
    agentType?: string;
    agentgitopsVersion: string;
    registeredAt: string;
    lastSyncAt?: string;
    syncCursor?: string;
    status: string;
  };
  member?: TeamSyncStatusSummary["member"];
  members: number;
  pendingEvents: number;
  cachedTasks: number;
  cachedChangePackages: number;
  cachedReviewContexts: number;
  cachedAgentNotes: number;
  handoffPackages: number;
  activeAdoptions: number;
  conflictEdges: number;
  lastPushCursor?: SyncCursor;
  lastPullCursor?: SyncCursor;
}

export interface SyncPushRequest {
  teamId?: string;
  hubId?: string;
  cursor?: string;
  events?: SyncEvent[];
}

export interface SyncPushResult {
  teamId: string;
  hubId: string;
  accepted: number;
  duplicated: number;
  applied: number;
  cursor?: string;
  events: Array<{ eventId: string; status: "accepted" | "duplicate" }>;
}

export interface SyncPullResult {
  teamId: string;
  hubId: string;
  cursor?: string;
  events: SyncEvent[];
}

export class TeamSyncService {
  constructor(private readonly projectPath: string) {}

  getStatus(teamId?: string): TeamSyncPublicStatus {
    const store = new TeamSyncStore(this.projectPath);
    try {
      return publicTeamSyncSummary(store.getStatusSummary(teamId));
    } finally {
      store.close();
    }
  }

  listTasks(teamId?: string) {
    const store = new TeamSyncStore(this.projectPath);
    try {
      const summary = store.getStatusSummary(teamId);
      return {
        teamId: summary.team?.teamId,
        tasks: store.listSyncedTasks(summary.team?.teamId),
      };
    } finally {
      store.close();
    }
  }

  listConflicts(teamId?: string): { teamId?: string; conflicts: ConflictGraphEdge[] } {
    const store = new TeamSyncStore(this.projectPath);
    try {
      const summary = store.getStatusSummary(teamId);
      if (summary.team) {
        const builder = new ConflictGraphBuilder(this.projectPath);
        try {
          builder.build(summary.team.teamId);
        } finally {
          builder.close();
        }
      }
      return {
        teamId: summary.team?.teamId,
        conflicts: store.listConflictGraphEdges(summary.team?.teamId),
      };
    } finally {
      store.close();
    }
  }

  push(body: SyncPushRequest, headers: IncomingHttpHeaders): SyncPushResult {
    const store = new TeamSyncStore(this.projectPath);
    try {
      const teamId = requireString(body.teamId, "teamId");
      const hubId = requireString(body.hubId, "hubId");
      const team = store.getTeamProject(teamId);
      if (!team) throw new Error(`Team not found: ${teamId}`);
      const authResult = verifyTeamSignature({
        headers,
        teamSecretHash: team.teamSecretHash,
        teamId,
        hubId,
      });
      if (!authResult.ok) {
        throw new TeamSyncAuthError(authResult.statusCode, authResult.code, authResult.message);
      }

      const applier = new TeamSyncEventApplier(store);
      let accepted = 0;
      let duplicated = 0;
      let applied = 0;
      const events: SyncPushResult["events"] = [];
      let lastEvent: SyncEvent | undefined;

      for (const inputEvent of body.events ?? []) {
        const existing =
          store.getSyncEvent(inputEvent.eventId) ??
          store.getSyncEventByIdempotencyKey(inputEvent.idempotencyKey);
        if (existing) {
          duplicated += 1;
          events.push({ eventId: existing.eventId, status: "duplicate" });
          lastEvent = existing;
          continue;
        }
        const event = normalizeRelayEvent(inputEvent, teamId);
        store.enqueueSyncEvent(event);
        const result = applier.apply(event);
        if (result.applied) applied += 1;
        accepted += 1;
        events.push({ eventId: event.eventId, status: "accepted" });
        lastEvent = event;
      }

      return {
        teamId,
        hubId,
        accepted,
        duplicated,
        applied,
        cursor: lastEvent ? encodeCursor(lastEvent) : body.cursor,
        events,
      };
    } finally {
      store.close();
    }
  }

  pull(
    input: { teamId?: string; hubId?: string; cursor?: string; limit?: number },
    headers: IncomingHttpHeaders,
  ): SyncPullResult {
    const store = new TeamSyncStore(this.projectPath);
    try {
      const teamId = requireString(input.teamId, "teamId");
      const hubId = requireString(input.hubId, "hubId");
      const team = store.getTeamProject(teamId);
      if (!team) throw new Error(`Team not found: ${teamId}`);
      const authResult = verifyTeamSignature({
        headers,
        teamSecretHash: team.teamSecretHash,
        teamId,
        hubId,
      });
      if (!authResult.ok) {
        throw new TeamSyncAuthError(authResult.statusCode, authResult.code, authResult.message);
      }

      const decoded = decodeCursor(input.cursor);
      const events = store.listSyncEvents({
        teamId,
        excludeHubId: hubId,
        afterCreatedAt: decoded?.createdAt,
        afterEventId: decoded?.eventId,
        limit: input.limit,
      });
      const lastEvent = events.at(-1);
      return {
        teamId,
        hubId,
        cursor: lastEvent ? encodeCursor(lastEvent) : input.cursor,
        events,
      };
    } finally {
      store.close();
    }
  }
}

export function encodeCursor(event: Pick<SyncEvent, "createdAt" | "eventId">): string {
  return Buffer.from(
    JSON.stringify({ createdAt: event.createdAt, eventId: event.eventId }),
    "utf-8",
  ).toString("base64url");
}

export function decodeCursor(cursor?: string): { createdAt: string; eventId: string } | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as Record<
      string,
      unknown
    >;
    if (typeof value.createdAt === "string" && typeof value.eventId === "string") {
      return { createdAt: value.createdAt, eventId: value.eventId };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function signTeamSyncRequest(input: {
  teamSecretHash: string;
  teamId: string;
  hubId: string;
  timestamp: string;
}): string {
  return createHmac("sha256", input.teamSecretHash)
    .update(`${input.timestamp}\n${input.teamId}\n${input.hubId}`)
    .digest("hex");
}

export type TeamSyncAuthResult =
  { ok: true } | { ok: false; statusCode: 401 | 403; code: string; message: string };

/**
 * 验证 Team Sync 请求的认证
 *
 * 当 team 配置了 teamSecretHash 时，要求请求携带有效的 HMAC 签名。
 * - 无签名头 → 401 UNAUTHORIZED
 * - 签名不匹配 → 403 FORBIDDEN
 * - 未配置 teamSecretHash → 允许通过（向后兼容）
 */
function verifyTeamSignature(input: {
  headers: IncomingHttpHeaders;
  teamSecretHash?: string;
  teamId: string;
  hubId: string;
}): TeamSyncAuthResult {
  if (!input.teamSecretHash) return { ok: true };
  const timestamp = readHeader(input.headers, "x-agentgitops-timestamp");
  const signature = readHeader(input.headers, "x-agentgitops-signature");
  if (!timestamp || !signature) {
    return {
      ok: false,
      statusCode: 401,
      code: "TEAM_SYNC_UNAUTHORIZED",
      message: "Team Sync signature headers are required.",
    };
  }
  const expected = signTeamSyncRequest({
    teamSecretHash: input.teamSecretHash,
    teamId: input.teamId,
    hubId: input.hubId,
    timestamp,
  });
  if (!safeEqual(signature, expected)) {
    return {
      ok: false,
      statusCode: 403,
      code: "TEAM_SYNC_FORBIDDEN",
      message: "Invalid Team Sync signature.",
    };
  }
  return { ok: true };
}

function normalizeRelayEvent(event: SyncEvent, teamId: string): SyncEvent {
  return {
    ...event,
    teamId,
    payload: sanitizeRelayPayload(event.payload),
    status: "pushed",
    appliedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeRelayPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (isBlockedRelayKey(key)) continue;
    if (typeof raw === "string") {
      output[key] = raw.length > 2000 ? `${raw.slice(0, 2000)}...[truncated]` : raw;
    } else if (Array.isArray(raw)) {
      output[key] = raw
        .filter(
          (item) =>
            typeof item === "string" || typeof item === "number" || typeof item === "boolean",
        )
        .slice(0, 200);
    } else if (typeof raw === "number" || typeof raw === "boolean" || raw === null) {
      output[key] = raw;
    } else if (typeof raw === "object") {
      output[key] = sanitizeRelayPayload(raw);
    }
  }
  return output;
}

function isBlockedRelayKey(key: string): boolean {
  return /diff|patch|prompt|stdout|stderr|log|token|secret|password|private/i.test(key);
}

function publicTeamSyncSummary(summary: TeamSyncStatusSummary): TeamSyncPublicStatus {
  const team = summary.team
    ? {
        teamId: summary.team.teamId,
        name: summary.team.name,
        repoUrl: summary.team.repoUrl,
        relayUrl: summary.team.relayUrl,
        syncMode: summary.team.syncMode,
        createdAt: summary.team.createdAt,
        updatedAt: summary.team.updatedAt,
      }
    : undefined;
  const localHub = summary.localHub
    ? {
        hubId: summary.localHub.hubId,
        teamId: summary.localHub.teamId,
        memberId: summary.localHub.memberId,
        agentType: summary.localHub.agentType,
        agentgitopsVersion: summary.localHub.agentgitopsVersion,
        registeredAt: summary.localHub.registeredAt,
        lastSyncAt: summary.localHub.lastSyncAt,
        syncCursor: summary.localHub.syncCursor,
        status: summary.localHub.status,
      }
    : undefined;
  return {
    team,
    localHub,
    member: summary.member,
    members: summary.members,
    pendingEvents: summary.pendingEvents,
    cachedTasks: summary.cachedTasks,
    cachedChangePackages: summary.cachedChangePackages,
    cachedReviewContexts: summary.cachedReviewContexts,
    cachedAgentNotes: summary.cachedAgentNotes,
    handoffPackages: summary.handoffPackages,
    activeAdoptions: summary.activeAdoptions,
    conflictEdges: summary.conflictEdges,
    lastPushCursor: summary.lastPushCursor,
    lastPullCursor: summary.lastPullCursor,
  };
}

function readHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireString(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`${name} is required.`);
}
