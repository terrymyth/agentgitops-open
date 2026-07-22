export type TeamSyncControlPlaneState = "enabled" | "disabled" | "unknown";
export type TeamSyncMode = "local" | "git-native" | "relay" | "hybrid";
export type TeamMemberRole = "owner" | "member" | "viewer";
export type TeamMemberStatus = "active" | "offline" | "removed";
export type LocalHubSyncStatus = "connected" | "syncing" | "offline" | "stale";
export type SyncEventStatus = "pending" | "pushed" | "applied" | "failed";
export type SyncEventAction =
  | "team.initialized"
  | "team.joined"
  | "task.created"
  | "task.updated"
  | "task.completed"
  | "change_package.created"
  | "review.submitted"
  | "review_context.updated"
  | "agent_note.created"
  | "task.adopted"
  | "task.continued"
  | "agent.session.completed";

export type ContextFeedCompression = "minimal" | "standard" | "detailed";
export type ContextFeedFreshness = "current" | "stale" | "unknown";
export type ContextFeedConfidence = "verified" | "unverified" | "inferred";
export type ContextFeedLayer = "survival" | "efficiency" | "enhancement";
export type HandoffPackageType = "adopt" | "continue";
export type BranchAdoptionStatus = "requested" | "active" | "superseded" | "released";
export type ConflictGraphSeverity = "low" | "medium" | "high";

export interface TeamProject {
  teamId: string;
  name: string;
  repoUrl: string;
  relayUrl?: string;
  syncMode: TeamSyncMode;
  teamSecretHash?: string;
  createdAt: string;
  updatedAt: string;
  settings: {
    syncIntervalSeconds: number;
    contextFeedCompression: ContextFeedCompression;
    conflictDetectionLevel: "file" | "function" | "line";
    autoSyncOnTaskChange: boolean;
  };
}

export interface TeamMember {
  memberId: string;
  teamId: string;
  displayName: string;
  hubId: string;
  role: TeamMemberRole;
  joinedAt: string;
  lastSeenAt: string;
  status: TeamMemberStatus;
}

export interface LocalHubRegistration {
  hubId: string;
  teamId: string;
  memberId: string;
  machineFingerprint?: string;
  agentType?: string;
  agentgitopsVersion: string;
  registeredAt: string;
  lastSyncAt?: string;
  syncCursor?: string;
  status: LocalHubSyncStatus;
}

export interface SyncCursor {
  cursor: string;
  teamId: string;
  hubId: string;
  direction: "push" | "pull";
  eventId?: string;
  updatedAt: string;
}

export interface SyncEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string;
  teamId: string;
  hubId: string;
  actorId: string;
  action: SyncEventAction;
  resourceType: string;
  resourceId: string;
  idempotencyKey: string;
  payload: TPayload;
  status: SyncEventStatus;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  error?: string;
}

export interface SyncedTask {
  taskId: string;
  teamId: string;
  projectId: string;
  sourceHubId: string;
  ownerMemberId?: string;
  title: string;
  objective: string;
  status: string;
  agentId: string;
  baseBranch: string;
  targetBranch: string;
  riskLevel: string;
  riskDomains: string[];
  changedFiles: string[];
  relatedTasks: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SyncedChangePackage {
  packageId: string;
  taskId: string;
  teamId: string;
  sourceHubId: string;
  summary: string;
  changedFiles: string[];
  riskLevel: string;
  riskDomains: string[];
  verificationSummary: {
    passed: number;
    failed: number;
    skipped: number;
  };
  prUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncedReviewContext {
  contextId: string;
  taskId: string;
  teamId: string;
  sourceHubId: string;
  summary: string;
  verdict?: string;
  keyFeedback: string[];
  updatedAt: string;
}

export interface SyncedAgentNote {
  noteId: string;
  taskId: string;
  teamId: string;
  sourceHubId: string;
  authorId: string;
  noteType: "progress" | "blocker" | "handoff" | "warning";
  summary: string;
  files: string[];
  createdAt: string;
}

export interface AgentContextFeed {
  feedId: string;
  taskId: string;
  teamId: string;
  agentType: string;
  compression: ContextFeedCompression;
  generatedAt: string;
  tokenEstimate: number;
  items: AgentContextFeedItem[];
  redactions: AgentContextFeedRedaction[];
}

export interface AgentContextFeedItem {
  id: string;
  layer: ContextFeedLayer;
  title: string;
  content: string;
  source: {
    type:
      | "task"
      | "change_package"
      | "review"
      | "agent_note"
      | "conflict"
      | "sync"
      | "agent_session"
      | "handoff_document";
    id: string;
    hubId?: string;
  };
  freshness: ContextFeedFreshness;
  confidence: ContextFeedConfidence;
  createdAt: string;
}

export interface AgentContextFeedRedaction {
  kind: string;
  count: number;
}

export interface HandoffPackage {
  handoffId: string;
  type: HandoffPackageType;
  teamId: string;
  sourceTaskId: string;
  targetTaskId?: string;
  sourceBranch: string;
  targetBranch?: string;
  createdBy: string;
  createdAt: string;
  summary: string;
  remainingWork: string[];
  knownRisks: string[];
  contextFeedId?: string;
  /** 避免重复的失败方案（Sprint B4，跨机协同核心） */
  avoidRepeating?: string[];
  /** 推荐的下一步（Sprint B4） */
  recommendedNextSteps?: string[];
  /** 前一个 Agent 的执行摘要引用（Sprint B4） */
  previousAgentExecution?: AgentExecutionSummary;
}

/**
 * Agent 交接文档（HD-001）
 *
 * 自由格式 Markdown 交接文档，Agent 执行后自动生成。
 * 同时面向 AI 消费（通过 ContextFeed 注入）和人类审查（Web UI / CLI）。
 *
 * 不依赖 Team Sync，单机场景可用。
 */
export interface HandoffDocument {
  docId: string;
  taskId: string;
  agentId: string;
  agentType: string;
  title: string;
  /** 自由格式 Markdown 内容 */
  markdown: string;
  /** 结构化 section（便于 AI 解析） */
  sections: {
    whatIDid: string;
    why: string;
    whatITried: string;
    whatIDidNotDo: string;
    nextSteps: string;
  };
  /** 关联的 Agent 执行摘要 */
  executionSummary?: AgentExecutionSummary;
  createdAt: string;
}

export interface BranchAdoption {
  adoptionId: string;
  teamId: string;
  taskId: string;
  sourceBranch: string;
  adoptedBy: string;
  previousOwner?: string;
  status: BranchAdoptionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ConflictGraphEdge {
  edgeId: string;
  teamId: string;
  sourceTaskId: string;
  targetTaskId: string;
  type: "same_file" | "same_directory" | "risk_domain" | "config" | "migration" | "lockfile";
  severity: ConflictGraphSeverity;
  files: string[];
  suggestion: string;
  createdAt: string;
}

export interface TeamSyncPullRequestContext {
  teamProject?: string;
  relatedTasks?: string[];
  continuationOf?: string;
  adoptedFrom?: string;
  localHubInstance?: string;
  relatedBranches?: string[];
  relatedPullRequests?: string[];
  touchedDomains?: string[];
  overlappingFiles?: string[];
  conflictSignals?: string[];
  dependsOn?: string[];
  blocks?: string[];
  contextFeedId?: string;
  contextFeedGeneratedAt?: string;
  sourceChangePackages?: string[];
  usedByAgent?: boolean;
  humanConfirmationRequired?: string[];
  syncStatus?: string;
  syncCursor?: string;
  controlPlane?: TeamSyncControlPlaneState;
  offlineChanges?: boolean;
}

// ===== AI Coding 事件摘要（Sprint B）=====

/**
 * Agent 执行摘要
 *
 * 跨机 Agent 协同的核心：让接续 Agent 知道前一个 Agent 试过什么、为什么失败、改到哪一步。
 */
export interface AgentExecutionSummary {
  agentId: string;
  agentType: string;
  agentVersion?: string;
  model?: string;
  status: "completed" | "failed" | "timeout" | "canceled" | "partial";
  exitCode: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  strategy?: string;
  stepsCompleted?: string[];
  stepsRemaining?: string[];
  filesRead?: string[];
  commandsExecuted?: string[];
  failureReason?: string;
  blockedBy?: string;
  tokenUsage?: { input?: number; output?: number; total?: number };
  toolCalls?: number;
  selfAssessment?: string;
  confidence?: "high" | "medium" | "low";
}

/**
 * 变更意图摘要
 *
 * 每个文件的修改意图，让接续 Agent 理解改动逻辑。
 */
export interface ChangeIntentEntry {
  file: string;
  intent: string;
  changeType: "add" | "modify" | "delete" | "rename";
}

export interface ChangeIntentSummary {
  changeIntents?: ChangeIntentEntry[];
  impactedAreas?: string[];
  breakingChanges?: boolean;
  migrationNeeded?: boolean;
}

/**
 * 交接上下文摘要
 *
 * avoidRepeating 是跨机协同核心：避免接续 Agent 重复前一个 Agent 的失败尝试。
 */
export interface HandoffContextSummary {
  handoffType: "adopt" | "continue" | "review";
  recommendedNextSteps?: string[];
  warnings?: string[];
  avoidRepeating?: string[];
  contextFeedId?: string;
  previousAgentNotes?: string[];
}
