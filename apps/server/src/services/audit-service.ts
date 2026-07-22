import { randomUUID } from "node:crypto";
import type { AuditEvent } from "@agentgitops/core";
import { LocalDb, type AgentgitopsConfig, type ExtensionRegistry } from "@agentgitops/local-hub";

interface LocalAuditEventRow {
  id: string;
  project_id: string;
  task_id: string | null;
  actor_type: string;
  actor_id: string;
  event_type: string;
  payload: string | null;
  created_at: string;
}

export interface AuditEventFilters {
  taskId?: string;
  eventType?: string;
  actorId?: string;
  actorType?: "human" | "agent" | "system";
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  order?: "asc" | "desc";
}

export class AuditService {
  constructor(
    private readonly projectPath: string,
    private readonly config: AgentgitopsConfig,
    private readonly extensions?: ExtensionRegistry,
  ) {}

  async record(
    eventType: string,
    payload: unknown,
    taskId?: string,
    actorId?: string,
  ): Promise<void> {
    const event: AuditEvent = {
      id: `audit_${randomUUID()}`,
      projectId: this.config.project.name,
      taskId,
      actorType: "human",
      actorId: actorId?.trim() || process.env.USER || "local-user",
      eventType: eventType as AuditEvent["eventType"],
      payload,
      createdAt: new Date().toISOString(),
    };

    const sink = this.extensions?.auditSink;
    if (sink) {
      await sink.append(event);
      return;
    }

    const db = new LocalDb(this.projectPath);
    try {
      db.insertAuditEvent({
        id: event.id,
        projectId: event.projectId,
        taskId: event.taskId,
        actorType: event.actorType,
        actorId: event.actorId,
        eventType,
        payload: event.payload,
      });
    } finally {
      db.close();
    }
  }

  async list(filters: AuditEventFilters = {}): Promise<AuditEvent[]> {
    const sink = this.extensions?.auditSink;
    if (sink) {
      return applyAuditFilters(await sink.list(filters), filters);
    }

    const db = new LocalDb(this.projectPath);
    try {
      const rows = db.listAuditEvents(filters) as unknown as LocalAuditEventRow[];
      return applyAuditFilters(rows.map(auditRowToEvent), filters);
    } finally {
      db.close();
    }
  }
}

export function auditRowToEvent(row: LocalAuditEventRow): AuditEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id ?? undefined,
    actorType: row.actor_type as AuditEvent["actorType"],
    actorId: row.actor_id,
    eventType: row.event_type as AuditEvent["eventType"],
    payload: row.payload ? parseAuditPayload(row.payload) : undefined,
    createdAt: row.created_at,
  };
}

function applyAuditFilters(events: AuditEvent[], filters: AuditEventFilters): AuditEvent[] {
  const filtered = events.filter(
    (event) =>
      (!filters.eventType || event.eventType === filters.eventType) &&
      (!filters.actorId || event.actorId === filters.actorId) &&
      (!filters.actorType || event.actorType === filters.actorType) &&
      (!filters.createdFrom || event.createdAt >= filters.createdFrom) &&
      (!filters.createdTo || event.createdAt <= filters.createdTo),
  );
  return filters.limit ? filtered.slice(0, filters.limit) : filtered;
}

function parseAuditPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
