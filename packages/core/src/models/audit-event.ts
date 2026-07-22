/**
 * AuditEvent 数据模型
 */
export interface AuditEvent {
  id: string;
  projectId: string;
  taskId?: string;
  actorType: AuditActorType;
  actorId: string;
  eventType: AuditEventType;
  payload?: unknown;
  createdAt: string;
}

export type AuditActorType = "human" | "agent" | "system";

export type AuditEventType =
  | "project.created"
  | "project.updated"
  | "agent.registered"
  | "agent.updated"
  | "task.created"
  | "task.started"
  | "task.canceled"
  | "task.failed"
  | "workspace.created"
  | "workspace.removed"
  | "agent.session.started"
  | "agent.session.completed"
  | "agent.session.failed"
  | "verification.run.started"
  | "verification.run.completed"
  | "change_package.generated"
  | "policy.violation"
  | "conflict.detected"
  | "review.submitted"
  | "agent.note.added"
  | "review.context.generated"
  | "merge.queued"
  | "merge.completed"
  | "merge.reverted"
  | "pr.created"
  | "pr.updated"
  | "security.event";
