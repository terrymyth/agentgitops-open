import type {
  AgentNote,
  AuditEvent,
  ChangePackage,
  Review,
  ReviewAction,
  ReviewContext,
  TaskContract,
  Workspace,
} from "@agentgitops/core";

export interface ApiEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
  };
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export interface ProjectSummary {
  name: string;
  defaultBranch: string;
  gitProvider: string;
  remote: string;
  agents: string[];
  taskTemplates: string[];
  dashboard: {
    projectId: string;
    activeTaskCount: number;
    activeWorkspaceCount: number;
    pendingReviewCount: number;
    conflictRiskCount: number;
    mergeQueueCount: number;
    highRiskChangeCount: number;
    ciFailedCount: number;
    recentMerged: TaskContract[];
  };
}

export interface LogSummary {
  taskId: string;
  files: string[];
  updatedAt?: string;
}

export interface LogDetail extends LogSummary {
  stdout: string;
  stderr: string;
  fileDetails: Array<{
    name: string;
    content: string;
    bytes: number;
  }>;
}

export interface MergeQueueItem {
  task: TaskContract;
  changePackage: ChangePackage | null;
  gate: {
    allowed: boolean;
    blockers: string[];
    warnings: string[];
  } | null;
  prUrl?: string;
  prNumber?: number;
}

export interface ConflictSummary {
  id: string;
  taskId: string;
  conflictingTaskId: string;
  type: string;
  filePath?: string;
  severity: string;
  suggestion: string;
  status: string;
  packageId: string;
}

export interface ConflictActionResult {
  status: "completed" | "failed" | "not_applicable";
  command?: string;
  output?: string;
  error?: string;
  recovery?: string[];
}

export interface MergeActionResult {
  task: TaskContract;
  changePackage: ChangePackage | null;
  gate: MergeQueueItem["gate"];
  merged: boolean;
  provider?: string;
  message: string;
  sha?: string;
  recovery?: string[];
}

export interface WorkflowJob {
  id: string;
  action: string;
  taskId?: string;
  actorId?: string;
  source: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  retryOf?: string;
  attempt: number;
  maxAttempts: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface WorkflowActionResult {
  task: TaskContract;
  job?: WorkflowJob;
  changePackage?: ChangePackage | null;
  workspacePath?: string;
  message: string;
  recovery?: string[];
  provider?: string;
  prUrl?: string;
  prNumber?: number;
  comment?: {
    id: number;
    url?: string;
    action: "created" | "updated";
  };
  dryRun?: {
    repo: string;
    title: string;
    baseBranch: string;
    headBranch: string;
    bodyTemplate: "ce" | "team-sync";
    body: string;
  };
}

export interface AgentOpsMetrics {
  generatedAt: string;
  taskTotals: Record<string, number>;
  agentTotals: Record<string, number>;
  riskTotals: Record<string, number>;
  mergeGate: {
    queued: number;
    allowed: number;
    blocked: number;
    blockers: number;
    warnings: number;
  };
  logs: {
    taskDirectories: number;
    files: number;
  };
  audit: {
    total: number;
    recent: AuditEvent[];
  };
  trends: {
    taskCount: AgentOpsTrendPoint[];
    mergeRate: AgentOpsTrendPoint[];
    conflictRate: AgentOpsTrendPoint[];
  };
  agentRanking: AgentRankingEntry[];
  history: Array<{
    id: string;
    createdAt: string;
    metrics: {
      taskTotals: Record<string, number>;
      mergeGate: AgentOpsMetrics["mergeGate"];
      logs: AgentOpsMetrics["logs"];
      auditTotal: number;
    };
  }>;
}

export interface AgentOpsTrendPoint {
  timestamp: string;
  taskTotal: number;
  merged: number;
  failed: number;
  blocked: number;
}

export interface AgentRankingEntry {
  agentId: string;
  totalTasks: number;
  merged: number;
  failed: number;
  blocked: number;
  mergeRate: number;
  successRate: number;
}

export interface WebActor {
  id: string;
  role: "owner" | "reviewer" | "viewer";
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function fetchApi<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const payload = (await response.json()) as ApiEnvelope<T> | ApiErrorEnvelope;

  if (!response.ok || "error" in payload) {
    const message = "error" in payload ? payload.error.message : response.statusText;
    const code = "error" in payload ? payload.error.code : undefined;
    throw new ApiRequestError(message, response.status, code);
  }

  return payload.data;
}

export async function postApi<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiEnvelope<T> | ApiErrorEnvelope;

  if (!response.ok || "error" in payload) {
    const message = "error" in payload ? payload.error.message : response.statusText;
    const code = "error" in payload ? payload.error.code : undefined;
    throw new ApiRequestError(message, response.status, code);
  }

  return payload.data;
}

export async function putApi<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiEnvelope<T> | ApiErrorEnvelope;

  if (!response.ok || "error" in payload) {
    const message = "error" in payload ? payload.error.message : response.statusText;
    const code = "error" in payload ? payload.error.code : undefined;
    throw new ApiRequestError(message, response.status, code);
  }

  return payload.data;
}

export interface TeamSyncConfig {
  tasks?: boolean;
  changedFiles?: boolean;
  riskLevel?: boolean;
  verification?: boolean;
  conflicts?: boolean;
  agentExecution?: boolean;
  failureReason?: boolean;
  filesRead?: boolean;
  tokenUsage?: boolean;
  agentNotes?: boolean;
  reviewContext?: boolean;
  handoff?: boolean;
  mode?: "manual" | "auto";
  intervalSeconds?: number;
}

export interface TeamSyncConfigResponse {
  config: TeamSyncConfig;
  defaults: TeamSyncConfig;
}

export function getProject(): Promise<ProjectSummary> {
  return fetchApi<ProjectSummary>("/api/project");
}

export function initProject(input: { name: string; actorId: string; force?: boolean }): Promise<{
  configPath: string;
  project: { name: string; default_branch: string; worktree_root: string };
  actor: WebActor;
}> {
  return postApi("/api/project/init", input);
}

export function getActor(): Promise<WebActor> {
  return fetchApi<WebActor>("/api/actor");
}

export function getWorkflowJobs(taskId?: string): Promise<WorkflowJob[]> {
  const search = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
  return fetchApi<WorkflowJob[]>(`/api/workflow-jobs${search}`);
}

export function cancelWorkflowJob(
  jobId: string,
  actorId?: string,
): Promise<{ job: WorkflowJob; message: string }> {
  return postApi(`/api/workflow-jobs/${encodeURIComponent(jobId)}/cancel`, { actorId });
}

export function retryWorkflowJob(
  jobId: string,
  actorId?: string,
): Promise<WorkflowActionResult | { job: WorkflowJob; message: string; recovery?: string[] }> {
  return postApi(`/api/workflow-jobs/${encodeURIComponent(jobId)}/retry`, { actorId });
}

export function getTasks(): Promise<TaskContract[]> {
  return fetchApi<TaskContract[]>("/api/tasks");
}

export interface TaskSnapshotDrift {
  taskId: string;
  title: string;
  reason: "missing-sqlite" | "missing-snapshot" | "status-mismatch" | "updatedAt-mismatch";
  snapshotStatus?: TaskContract["status"];
  sqliteStatus?: TaskContract["status"];
  snapshotUpdatedAt?: string;
  sqliteUpdatedAt?: string;
}

export function getTaskSnapshotDrift(): Promise<TaskSnapshotDrift[]> {
  return fetchApi<TaskSnapshotDrift[]>("/api/tasks/snapshot-drift");
}

export function createTask(input: {
  title: string;
  objective?: string;
  agentId?: string;
  template?: string;
  baseBranch?: string;
  riskLevel?: TaskContract["riskLevel"];
  allowedPaths?: string[];
  forbiddenPaths?: string[];
  requiredChecks?: string[];
  reviewers?: string[];
  actorId?: string;
}): Promise<{ task: TaskContract; message: string }> {
  return postApi<{ task: TaskContract; message: string }>("/api/tasks", input);
}

export function runTaskWorkflowAction(
  taskId: string,
  action: "start" | "run" | "test" | "package" | "pr",
  input: {
    actorId?: string;
    dryRun?: boolean;
    draft?: boolean;
    commit?: boolean;
    reviewContextComment?: boolean;
  } = {},
): Promise<WorkflowActionResult> {
  return postApi<WorkflowActionResult>(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, input);
}

export function getWorkspaces(): Promise<Workspace[]> {
  return fetchApi<Workspace[]>("/api/workspaces");
}

export function getChangePackages(): Promise<ChangePackage[]> {
  return fetchApi<ChangePackage[]>("/api/change-packages");
}

export function getChangePackage(taskId: string): Promise<ChangePackage> {
  return fetchApi<ChangePackage>(`/api/change-packages/${encodeURIComponent(taskId)}`);
}

export async function getOptionalChangePackage(taskId: string): Promise<ChangePackage | null> {
  try {
    return await getChangePackage(taskId);
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      (error.status === 404 || error.code === "CHANGE_PACKAGE_NOT_FOUND")
    ) {
      return null;
    }
    throw error;
  }
}

export function getMergeQueue(): Promise<MergeQueueItem[]> {
  return fetchApi<MergeQueueItem[]>("/api/merge-queue");
}

export function getConflicts(): Promise<ConflictSummary[]> {
  return fetchApi<ConflictSummary[]>("/api/conflicts");
}

export function runMergeAction(
  taskId: string,
  action: "evaluate" | "approve" | "block",
  input: {
    actorId?: string;
    strategy?: string;
    squash?: boolean;
    localOnly?: boolean;
    dryRun?: boolean;
  } = {},
): Promise<MergeActionResult> {
  return postApi<MergeActionResult>(
    `/api/merge-queue/${encodeURIComponent(taskId)}/${action}`,
    input,
  );
}

export function runConflictAction(
  conflictId: string,
  action: "resolve" | "false-positive" | "rebase" | "human-takeover",
  input: { actorId?: string; note?: string } = {},
): Promise<{
  conflict: ConflictSummary;
  task: TaskContract | null;
  actionResult?: ConflictActionResult;
}> {
  return postApi<{
    conflict: ConflictSummary;
    task: TaskContract | null;
    actionResult?: ConflictActionResult;
  }>(`/api/conflicts/${encodeURIComponent(conflictId)}/${action}`, input);
}

export function getReviews(taskId: string): Promise<Review[]> {
  return fetchApi<Review[]>(`/api/change-packages/${encodeURIComponent(taskId)}/reviews`);
}

export function submitReview(
  taskId: string,
  input: { reviewerId: string; action: ReviewAction; comment?: string },
): Promise<{ review: Review; task: TaskContract }> {
  return postApi<{ review: Review; task: TaskContract }>(
    `/api/change-packages/${encodeURIComponent(taskId)}/reviews`,
    input,
  );
}

export function getAgentNotes(taskId: string): Promise<AgentNote[]> {
  return fetchApi<AgentNote[]>(`/api/tasks/${encodeURIComponent(taskId)}/notes`);
}

export interface CloseoutCheck {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
  recovery?: string[];
}

export interface CloseoutReport {
  taskId: string;
  mode: string;
  projectPath: string;
  generatedAt: string;
  summary: { ok: number; warning: number; error: number; readyForHandoff: boolean };
  task?: { status: string; baseBranch: string; targetBranch: string; workspacePath: string };
  checks: CloseoutCheck[];
}

export function getTaskCloseout(taskId: string): Promise<CloseoutReport> {
  return fetchApi<CloseoutReport>(`/api/tasks/${encodeURIComponent(taskId)}/closeout`);
}

export function getAllAgentNotes(): Promise<AgentNote[]> {
  return fetchApi<AgentNote[]>("/api/agent-notes");
}

export function getReviewContext(
  taskId: string,
  input: { record?: boolean; actorId?: string } = {},
): Promise<ReviewContext> {
  const params = new URLSearchParams();
  if (input.record) params.set("record", "1");
  if (input.actorId) params.set("actorId", input.actorId);
  const query = params.toString();
  return fetchApi<ReviewContext>(
    `/api/review-context/${encodeURIComponent(taskId)}${query ? `?${query}` : ""}`,
  );
}

export function submitAgentNote(
  taskId: string,
  input: {
    actorId: string;
    agentId: string;
    summary: string;
    files: string[];
    verification: string[];
    reviewFocus: string[];
    risks: string[];
    commitSha?: string;
    prUrl?: string;
  },
): Promise<AgentNote> {
  return postApi<AgentNote>(`/api/tasks/${encodeURIComponent(taskId)}/notes`, input);
}

export function getLogs(): Promise<LogSummary[]> {
  return fetchApi<LogSummary[]>("/api/logs");
}

export function getLog(taskId: string): Promise<LogDetail> {
  return fetchApi<LogDetail>(`/api/logs/${encodeURIComponent(taskId)}`);
}

export function getAuditEvents(
  input: {
    taskId?: string;
    eventType?: string;
    actorId?: string;
    actorType?: "human" | "agent" | "system";
    from?: string;
    to?: string;
    limit?: number;
  } = {},
): Promise<AuditEvent[]> {
  const params = new URLSearchParams();
  if (input.taskId) params.set("taskId", input.taskId);
  if (input.eventType) params.set("eventType", input.eventType);
  if (input.actorId) params.set("actorId", input.actorId);
  if (input.actorType) params.set("actorType", input.actorType);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return fetchApi<AuditEvent[]>(`/api/audit${query ? `?${query}` : ""}`);
}

export function getAuditEventsByTask(taskId: string): Promise<AuditEvent[]> {
  return fetchApi<AuditEvent[]>(`/api/audit?taskId=${encodeURIComponent(taskId)}`);
}

export function getAgentOpsMetrics(): Promise<AgentOpsMetrics> {
  return fetchApi<AgentOpsMetrics>("/api/agentops");
}

// ===== Team Sync =====

export interface TeamSyncStatus {
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
  members: number;
  pendingEvents: number;
  cachedTasks: number;
  cachedChangePackages: number;
  cachedReviewContexts: number;
  cachedAgentNotes: number;
  handoffPackages: number;
  activeAdoptions: number;
  conflictEdges: number;
}

export interface TeamSyncTask {
  taskId: string;
  title: string;
  status: string;
  agentId: string;
  baseBranch: string;
  targetBranch: string;
  changedFiles: string[];
  riskLevel: string;
  sourceHubId: string;
}

export interface TeamSyncConflict {
  edgeId: string;
  sourceTaskId: string;
  targetTaskId: string;
  type: string;
  severity: string;
  files: string[];
  suggestion: string;
  createdAt: string;
}

export interface AutoSyncStatus {
  running: boolean;
  mode: string;
  lastSyncAt?: string;
  lastSyncResult?: { pulled: number; pushed: number; error?: string };
  pendingEvents: number;
  relayUrl?: string;
}

export function getTeamSyncStatus(): Promise<TeamSyncStatus> {
  return fetchApi<TeamSyncStatus>("/api/team/status");
}

export function getTeamSyncTasks(): Promise<{ teamId?: string; tasks: TeamSyncTask[] }> {
  return fetchApi<{ teamId?: string; tasks: TeamSyncTask[] }>("/api/team/tasks");
}

export function getTeamSyncConflicts(): Promise<{
  teamId?: string;
  conflicts: TeamSyncConflict[];
}> {
  return fetchApi<{ teamId?: string; conflicts: TeamSyncConflict[] }>("/api/team/conflicts");
}

export function getAutoSyncStatus(): Promise<AutoSyncStatus> {
  return fetchApi<AutoSyncStatus>("/api/team/sync-status");
}

export function triggerSyncNow(): Promise<{ pulled: number; pushed: number; error?: string }> {
  return postApi<{ pulled: number; pushed: number; error?: string }>("/api/team/sync-now", {});
}

// ===== Multi-Project Management =====

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  gitRemote?: string;
  gitProvider?: string;
  defaultBranch?: string;
  serverPort?: number;
  runtimePort?: number;
  isCurrent?: boolean;
  isPortConflict?: boolean;
  openUrl?: string;
  status: string;
  createdAt: string;
}

export function getProjects(): Promise<{
  projects: ProjectEntry[];
  lastActiveProjectId?: string;
  currentProjectId?: string;
  currentPort?: number;
}> {
  return fetchApi<{
    projects: ProjectEntry[];
    lastActiveProjectId?: string;
    currentProjectId?: string;
    currentPort?: number;
  }>("/api/projects");
}

export function addProject(input: { path: string; name?: string; initialize?: boolean }): Promise<{
  project: ProjectEntry;
  initialized: boolean;
  message: string;
}> {
  return postApi<{ project: ProjectEntry; initialized: boolean; message: string }>(
    "/api/projects/add",
    input,
  );
}

// ===== Context Feed Preview =====

export interface ContextFeedItem {
  id: string;
  layer: "survival" | "efficiency" | "enhancement";
  title: string;
  content: string;
  source: { type: string; id: string; hubId?: string };
  freshness: string;
  confidence: string;
  createdAt: string;
}

export interface ContextFeed {
  feedId: string;
  taskId: string;
  teamId: string;
  agentType: string;
  compression: string;
  generatedAt: string;
  tokenEstimate: number;
  items: ContextFeedItem[];
  redactions: Array<{ kind: string; count: number }>;
}

export interface ContextFeedPreviewResult {
  feed: ContextFeed;
  formatted: string;
}

export function getContextFeedPreview(input: {
  taskId: string;
  agentType?: string;
  compression?: string;
  format?: string;
}): Promise<ContextFeedPreviewResult> {
  const params = new URLSearchParams({ taskId: input.taskId });
  if (input.agentType) params.set("agentType", input.agentType);
  if (input.compression) params.set("compression", input.compression);
  if (input.format) params.set("format", input.format);
  return fetchApi<ContextFeedPreviewResult>(`/api/context-feed?${params.toString()}`);
}

export function getTeamSyncConfig(): Promise<TeamSyncConfigResponse> {
  return fetchApi<TeamSyncConfigResponse>("/api/team/sync-config");
}

export function updateTeamSyncConfig(input: TeamSyncConfig): Promise<TeamSyncConfigResponse> {
  return putApi<TeamSyncConfigResponse>("/api/team/sync-config", input);
}
