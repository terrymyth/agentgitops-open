import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
  AgentNote,
  AuditEvent,
  ChangePackage,
  ChangePackageConflict,
  EnterpriseUser,
  Review,
  ReviewAction,
  ReviewContext,
  TaskContract,
  TaskStatus,
  TeamSyncPullRequestContext,
  Workspace,
} from "@agentgitops/core";
import {
  CONFIG_DIR,
  CONFIG_FILENAME,
  DEFAULT_PORT,
  runCrossPlatformCommand,
} from "@agentgitops/core";
import {
  DiffService,
  GitHubProvider,
  GitLabProvider,
  GitService,
  formatChangePackagePullRequestBody,
  formatMergeRequestBody,
  formatReviewContextComment,
  parseGitHubRepository,
  parseGitLabRepository,
  type GitHubMergeMethod,
  type PullRequestBodyTemplate,
  type PullRequestCommentResult,
} from "@agentgitops/git";
import {
  AutoSyncManager,
  ChangePackageGenerator,
  ConfigLoader,
  ContextFeedBuilder,
  formatAgentContextFeed,
  HandoffDocumentStore,
  LocalDb,
  LocalProjectRepository,
  MergeGate,
  ProjectRegistry,
  ReviewStore,
  TaskCloseoutChecker,
  TaskManager,
  TeamSyncEventProducer,
  TeamSyncPullRequestContextBuilder,
  TeamSyncStore,
  VerificationGate,
  WorkspaceManager,
  buildWorkspaceEnvironment,
  collectRequiredChecks,
  createAgentAdapter,
  createRuntimeExtensionRegistry,
  defaultTeamSyncConfig,
  resolveTaskTemplate,
  type AgentgitopsConfig,
  type AutoSyncState,
  type ExtensionRegistry,
  type MergeGateResult,
  type ProjectEntry,
  type TeamSyncConfig,
} from "@agentgitops/local-hub";
import { sendError, sendJson, serveStaticFile } from "./http-utils.js";
import { matchConflictRoute } from "./routes/conflict-routes.js";
import { matchMergeQueueRoute } from "./routes/merge-routes.js";
import { matchSyncRoute } from "./routes/sync-routes.js";
import { matchTeamRoute } from "./routes/team-routes.js";
import { matchTaskWorkflowRoute } from "./routes/task-workflow-routes.js";
import { matchWorkflowJobRoute } from "./routes/workflow-job-routes.js";
import { AuditService } from "./services/audit-service.js";
import {
  TeamSyncService,
  TeamSyncAuthError,
  type SyncPushRequest,
} from "./services/team-sync-service.js";
import { getWorkflowJobErrorContext, WorkflowJobService } from "./services/workflow-job-service.js";

export interface AgentGitOpsServerOptions {
  projectPath?: string;
  staticDir?: string;
  host?: string;
  port?: number;
  extensionRegistry?: ExtensionRegistry;
  /** Server 运行模式：full（默认，完整本地治理）或 relay（只暴露 sync/team 路由） */
  mode?: "full" | "relay";
}

export interface StartedAgentGitOpsServer {
  server: http.Server;
  url: string;
  autoSyncManager?: AutoSyncManager;
  close: () => Promise<void>;
}

interface DashboardSummary {
  projectId: string;
  activeTaskCount: number;
  activeWorkspaceCount: number;
  pendingReviewCount: number;
  conflictRiskCount: number;
  mergeQueueCount: number;
  highRiskChangeCount: number;
  ciFailedCount: number;
  recentMerged: TaskContract[];
}

interface LogSummary {
  taskId: string;
  files: string[];
  updatedAt?: string;
}

interface LogDetail extends LogSummary {
  stdout: string;
  stderr: string;
  fileDetails: LogFileDetail[];
}

interface LogFileDetail {
  name: string;
  content: string;
  bytes: number;
}

interface MergeQueueItem {
  task: TaskContract;
  changePackage: ChangePackage | null;
  gate: MergeGateResult | null;
  prUrl?: string;
  prNumber?: number;
}

export interface RuntimeProjectEntry extends ProjectEntry {
  isCurrent: boolean;
  isPortConflict: boolean;
  runtimePort?: number;
  openUrl?: string;
}

export interface RuntimeProjectList {
  projects: RuntimeProjectEntry[];
  currentProjectId?: string;
  currentPort?: number;
}

interface ConflictSummary {
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

interface MergeActionResult {
  task: TaskContract;
  changePackage: ChangePackage | null;
  gate: MergeGateResult | null;
  merged: boolean;
  provider?: string;
  message: string;
  sha?: string;
  recovery?: string[];
}

interface WorkflowActionResult {
  task: TaskContract;
  changePackage?: ChangePackage | null;
  workspacePath?: string;
  message: string;
  recovery?: string[];
  provider?: string;
  prUrl?: string;
  prNumber?: number;
  comment?: PullRequestCommentResult;
  dryRun?: {
    repo: string;
    title: string;
    baseBranch: string;
    headBranch: string;
    bodyTemplate: PullRequestBodyTemplate;
    body: string;
  };
}

interface TaskWorkflowOptions {
  actorId: string;
  dryRun: boolean;
  draft: boolean;
  commit: boolean;
  reviewContextComment: boolean;
  bodyTemplate: PullRequestBodyTemplate;
}

interface AgentOpsMetrics {
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
  /** 趋势数据：基于历史快照计算 */
  trends: AgentOpsTrends;
  /** Agent 排行：按成功率/合并率/任务数排序 */
  agentRanking: AgentRankingEntry[];
  history: AgentOpsSnapshot[];
}

/** 趋势数据点 */
interface AgentOpsTrendPoint {
  timestamp: string;
  taskTotal: number;
  merged: number;
  failed: number;
  blocked: number;
}

interface AgentOpsTrends {
  /** 任务总数趋势 */
  taskCount: AgentOpsTrendPoint[];
  /** 合并率趋势（百分比） */
  mergeRate: AgentOpsTrendPoint[];
  /** 冲突率趋势（百分比） */
  conflictRate: AgentOpsTrendPoint[];
}

/** Agent 排行条目 */
interface AgentRankingEntry {
  agentId: string;
  totalTasks: number;
  merged: number;
  failed: number;
  blocked: number;
  /** 合并率（百分比） */
  mergeRate: number;
  /** 成功率（merged + 非 failed / total） */
  successRate: number;
}

interface AgentOpsSnapshot {
  id: string;
  createdAt: string;
  metrics: {
    taskTotals: Record<string, number>;
    mergeGate: AgentOpsMetrics["mergeGate"];
    logs: AgentOpsMetrics["logs"];
    auditTotal: number;
  };
}

interface WebActor {
  id: string;
  role: "owner" | "reviewer" | "developer" | "viewer";
}

interface SseEventRecord {
  id: number;
  event: string;
  data: unknown;
}

interface ConflictActionResult {
  status: "completed" | "failed" | "not_applicable";
  command?: string;
  output?: string;
  error?: string;
  recovery?: string[];
}

type ConflictAction = "resolve" | "false-positive" | "rebase" | "human-takeover";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);
const serverExtensionRegistries = new Map<string, ExtensionRegistry>();
const autoSyncStateCache = new Map<string, AutoSyncState>();
const enterpriseRequestUsers = new WeakMap<http.IncomingMessage, EnterpriseUser>();

class EventBroker {
  private readonly clients = new Set<http.ServerResponse>();
  private readonly backlog: SseEventRecord[] = [];
  private sequence = 0;
  private heartbeat?: NodeJS.Timeout;
  private watcher?: NodeJS.Timeout;
  private lastSignature?: string;

  constructor(private readonly projectPath: string) {}

  add(res: http.ServerResponse, lastEventId?: string): void {
    this.clients.add(res);
    this.startLoops();
    this.replay(res, lastEventId);
    res.on("close", () => {
      this.clients.delete(res);
      if (this.clients.size === 0) this.stopLoops();
    });
  }

  broadcast(event: string, data: unknown): void {
    const record = this.record(event, data);
    for (const client of this.clients) {
      writeSse(client, record.event, record.data, record.id);
    }
  }

  private record(event: string, data: unknown): SseEventRecord {
    const record = { id: ++this.sequence, event, data };
    this.backlog.push(record);
    if (this.backlog.length > 100) this.backlog.shift();
    return record;
  }

  private replay(res: http.ServerResponse, lastEventId?: string): void {
    const since = lastEventId ? Number.parseInt(lastEventId, 10) : Number.NaN;
    if (!Number.isFinite(since)) return;
    for (const record of this.backlog.filter((candidate) => candidate.id > since)) {
      writeSse(res, record.event, record.data, record.id);
    }
  }

  private startLoops(): void {
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        this.broadcast("heartbeat", { timestamp: new Date().toISOString() });
      }, 30_000);
    }
    if (!this.watcher) {
      void this.refreshSignature();
      this.watcher = setInterval(() => {
        void this.pollForExternalChanges();
      }, 5_000);
    }
  }

  private stopLoops(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    if (this.watcher) {
      clearInterval(this.watcher);
      this.watcher = undefined;
    }
  }

  private async refreshSignature(): Promise<void> {
    this.lastSignature = await collectStateSignature(this.projectPath);
  }

  private async pollForExternalChanges(): Promise<void> {
    const nextSignature = await collectStateSignature(this.projectPath);
    if (this.lastSignature === undefined) {
      this.lastSignature = nextSignature;
      return;
    }
    if (nextSignature === this.lastSignature) return;

    this.lastSignature = nextSignature;
    this.broadcast("data.changed", { source: "filesystem", timestamp: new Date().toISOString() });
    try {
      this.broadcast("dashboard.snapshot", await buildDashboardSnapshot(this.projectPath));
    } catch (error) {
      this.broadcast("error", { message: error instanceof Error ? error.message : String(error) });
    }
  }
}

export function createAgentGitOpsServer(options: AgentGitOpsServerOptions = {}): http.Server {
  const projectPath = path.resolve(options.projectPath ?? process.cwd());
  const staticDir = options.staticDir ?? path.resolve(__dirname, "../../web/dist");
  const events = new EventBroker(projectPath);
  const mode = options.mode ?? "full";
  if (options.extensionRegistry) {
    serverExtensionRegistries.set(projectPath, options.extensionRegistry);
  }

  return http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const requestUrl = new URL(req.url ?? "/", "http://localhost");

      if (requestUrl.pathname.startsWith("/api/")) {
        // relay 模式下只允许 sync/team/health 路由，其他本地治理路由返回 404
        if (mode === "relay" && !isRelayAllowedPath(requestUrl.pathname)) {
          sendError(res, 404, "NOT_FOUND", "Route not available in relay mode");
          return;
        }
        await handleApiRequest(projectPath, req, requestUrl, res, events);
        return;
      }

      // relay 模式下不提供静态文件服务（Web UI）
      if (mode === "relay") {
        sendError(res, 404, "NOT_FOUND", "Static files not available in relay mode");
        return;
      }

      if (method !== "GET" && method !== "HEAD") {
        sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
        return;
      }

      await serveStaticFile(staticDir, requestUrl.pathname, res);
    } catch (error) {
      sendError(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
    }
  });
}

/**
 * 判断路径是否在 relay 模式下允许访问
 *
 * relay 模式只暴露：
 * - /api/health（健康检查）
 * - /api/sync/*（同步推送/拉取）
 * - /api/team/*（团队状态查询）
 */
function isRelayAllowedPath(pathname: string): boolean {
  if (pathname === "/api/health") return true;
  if (pathname.startsWith("/api/sync/")) return true;
  if (pathname.startsWith("/api/team/")) return true;
  return false;
}

export async function startAgentGitOpsServer(
  options: AgentGitOpsServerOptions = {},
): Promise<StartedAgentGitOpsServer> {
  const projectPath = path.resolve(options.projectPath ?? process.cwd());
  const port = options.port ?? parsePort(process.env.AGENTGITOPS_PORT) ?? DEFAULT_PORT;
  const host = options.host ?? process.env.AGENTGITOPS_HOST ?? "localhost";
  const mode = options.mode ?? (process.env.AGENTGITOPS_MODE === "relay" ? "relay" : "full");

  // relay 模式下不需要恢复 workflow jobs（不处理本地治理任务）
  if (mode === "full") {
    new WorkflowJobService(projectPath).recoverStaleRunningJobs(30 * 60 * 1000);
  }
  const extensionRegistry =
    options.extensionRegistry ?? (await createServerRuntimeExtensionRegistry(projectPath));
  const server = createAgentGitOpsServer({ ...options, mode, projectPath, extensionRegistry });

  // 启动自动定时同步（Sprint C2），仅在 full 模式下启用
  let autoSyncManager: AutoSyncManager | undefined;
  if (mode === "full") {
    autoSyncManager = new AutoSyncManager(projectPath, (state) => {
      autoSyncStateCache.set(projectPath, state);
    });
    autoSyncManager.start();
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const resolvedProjectPath = path.resolve(projectPath);
  return {
    server,
    url: `http://${host}:${port}`,
    autoSyncManager,
    close: async () => {
      autoSyncManager?.stop();
      autoSyncStateCache.delete(resolvedProjectPath);
      await closeServerExtensionRegistry(resolvedProjectPath);
      serverExtensionRegistries.delete(resolvedProjectPath);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function handleApiRequest(
  projectPath: string,
  req: http.IncomingMessage,
  requestUrl: URL,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  const pathname = requestUrl.pathname;
  const method = req.method ?? "GET";

  if (!(await enforceEnterpriseRequestAccess(projectPath, req, pathname, method, res))) return;

  if (method === "GET" && pathname === "/api/events/stream") {
    await streamEvents(projectPath, req, res, events);
    return;
  }

  if (method === "POST" && pathname === "/api/webhooks/github") {
    await handleGitHubWebhook(projectPath, req, res, events);
    return;
  }

  if (method === "POST" && pathname === "/api/project/init") {
    await handleProjectInit(projectPath, req, res, events);
    return;
  }

  // HD-004: 交接文档 API
  if (pathname === "/api/handoff-docs" && method === "GET") {
    try {
      const store = new HandoffDocumentStore(projectPath);
      const docs = await store.list();
      sendJson(res, docs);
    } catch (error) {
      sendError(
        res,
        500,
        "HANDOFF_DOC_ERROR",
        error instanceof Error ? error.message : "Failed to list handoff docs.",
      );
    }
    return;
  }

  const handoffDocMatch = pathname.match(/^\/api\/handoff-docs\/([^/]+)$/);
  if (handoffDocMatch && method === "GET") {
    try {
      const store = new HandoffDocumentStore(projectPath);
      const doc = await store.getLatestByTask(decodeURIComponent(handoffDocMatch[1]));
      if (!doc) {
        sendError(res, 404, "NOT_FOUND", "Handoff document not found.");
        return;
      }
      sendJson(res, doc);
    } catch (error) {
      sendError(
        res,
        500,
        "HANDOFF_DOC_ERROR",
        error instanceof Error ? error.message : "Failed to get handoff doc.",
      );
    }
    return;
  }

  // MP-003/004: 多项目工作区管理 API
  if (pathname === "/api/projects" && method === "GET") {
    try {
      const registry = new ProjectRegistry();
      const projects = await registry.list();
      const lastActive = await registry.getLastActive();
      const runtime = buildRuntimeProjectList(projects, projectPath, req.headers.host);
      sendJson(res, { ...runtime, lastActiveProjectId: lastActive?.id });
    } catch (error) {
      sendError(
        res,
        500,
        "REGISTRY_ERROR",
        error instanceof Error ? error.message : "Failed to list projects.",
      );
    }
    return;
  }

  if (pathname === "/api/projects/add" && method === "POST") {
    try {
      const body = await readOptionalJsonBody<{
        path?: string;
        name?: string;
        initialize?: boolean;
      }>(req);
      if (!body.path) {
        sendError(res, 400, "MISSING_PARAM", "path is required");
        return;
      }
      const projectToAddPath = path.resolve(body.path);
      const registry = new ProjectRegistry();
      if (body.initialize) {
        const configPath = path.join(projectToAddPath, CONFIG_FILENAME);
        try {
          await fs.access(configPath);
        } catch {
          await ConfigLoader.init(
            projectToAddPath,
            body.name?.trim() || path.basename(projectToAddPath),
            { force: false },
          );
        }
      }
      const project = await registry.add({ path: projectToAddPath, name: body.name });
      sendJson(res, {
        project,
        initialized: Boolean(body.initialize),
        message: body.initialize
          ? `Project initialized and added: ${project.name}`
          : `Project added: ${project.name}`,
      });
    } catch (error) {
      sendError(
        res,
        400,
        "PROJECT_ADD_ERROR",
        error instanceof Error ? error.message : "Failed to add project.",
      );
    }
    return;
  }

  const syncRoute = matchSyncRoute(pathname);
  if (syncRoute) {
    const allowed = syncRoute.action === "push" ? method === "POST" : method === "GET";
    if (!allowed) {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
      return;
    }
    await handleSyncRoute(projectPath, syncRoute.action, req, requestUrl, res);
    return;
  }

  // Team Sync auto-sync status and trigger
  if (pathname === "/api/team/sync-status" && method === "GET") {
    const state = autoSyncStateCache.get(path.resolve(projectPath));
    sendJson(res, state ?? { running: false, mode: "manual", pendingEvents: 0 });
    return;
  }
  if (pathname === "/api/team/sync-now" && method === "POST") {
    try {
      const manager = new AutoSyncManager(projectPath);
      const result = await manager.syncNow();
      sendJson(res, result);
    } catch (error) {
      sendError(res, 500, "SYNC_ERROR", error instanceof Error ? error.message : "Sync failed.");
    }
    return;
  }

  const teamRoute = matchTeamRoute(pathname);
  if (teamRoute) {
    const allowed =
      teamRoute.action === "sync-config" ? method === "GET" || method === "PUT" : method === "GET";
    if (!allowed) {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
      return;
    }
    await handleTeamRoute(projectPath, teamRoute.action, req, requestUrl, res);
    return;
  }

  // Context Feed Preview（TS-P1-002）
  if (pathname === "/api/context-feed" && method === "GET") {
    await handleContextFeed(projectPath, requestUrl, res);
    return;
  }

  // Team Sync Watch SSE（TS-P1-006）
  if (pathname === "/api/team/sync-watch" && method === "GET") {
    handleTeamSyncWatch(projectPath, req, res);
    return;
  }

  if (pathname === "/api/tasks" && method === "POST") {
    await handleCreateTask(projectPath, req, res, events);
    return;
  }

  const taskWorkflowRoute = matchTaskWorkflowRoute(pathname);
  if (taskWorkflowRoute) {
    if (method !== "POST") {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
      return;
    }
    await handleTaskWorkflowAction(
      projectPath,
      taskWorkflowRoute.taskId,
      taskWorkflowRoute.action,
      req,
      res,
      events,
    );
    return;
  }

  const mergeActionRoute = matchMergeQueueRoute(pathname);
  if (mergeActionRoute) {
    if (method !== "POST") {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
      return;
    }
    await handleMergeAction(
      projectPath,
      mergeActionRoute.taskId,
      mergeActionRoute.action,
      req,
      res,
      events,
    );
    return;
  }

  const conflictActionRoute = matchConflictRoute(pathname);
  if (conflictActionRoute) {
    if (method !== "POST") {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
      return;
    }
    await handleConflictAction(
      projectPath,
      conflictActionRoute.conflictId,
      conflictActionRoute.action,
      req,
      res,
      events,
    );
    return;
  }

  const workflowJobRoute = matchWorkflowJobRoute(pathname);
  if (workflowJobRoute) {
    if (method !== "POST") {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
      return;
    }
    await handleWorkflowJobAction(
      projectPath,
      workflowJobRoute.jobId,
      workflowJobRoute.action,
      req,
      res,
      events,
    );
    return;
  }

  const reviewsMatch = /^\/api\/change-packages\/([^/]+)\/reviews$/.exec(pathname);
  if (reviewsMatch?.[1]) {
    const taskId = decodeURIComponent(reviewsMatch[1]);
    if (method === "GET") {
      sendJson(res, await new ReviewStore(projectPath).list(`pkg_${taskId}`));
      return;
    }
    if (method === "POST") {
      await handleSubmitReview(projectPath, taskId, req, res, events);
      return;
    }
  }

  const notesMatch = /^\/api\/tasks\/([^/]+)\/notes$/.exec(pathname);
  if (notesMatch?.[1]) {
    const taskId = decodeURIComponent(notesMatch[1]);
    if (method === "GET") {
      sendJson(res, listAgentNotes(projectPath, taskId));
      return;
    }
    if (method === "POST") {
      await handleSubmitAgentNote(projectPath, taskId, req, res, events);
      return;
    }
  }

  const reviewContextMatch = /^\/api\/review-context\/([^/]+)$/.exec(pathname);
  if (reviewContextMatch?.[1]) {
    if (method !== "GET") {
      sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
      return;
    }
    await sendReviewContext(projectPath, decodeURIComponent(reviewContextMatch[1]), req, res);
    return;
  }

  if (method !== "GET") {
    sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
    return;
  }

  if (pathname === "/api/health") {
    await handleHealth(projectPath, res);
    return;
  }

  if (pathname === "/api/actor") {
    const config = await loadConfig(projectPath);
    sendJson(res, resolveActor(config, req));
    return;
  }

  if (pathname === "/api/project") {
    const config = await loadConfig(projectPath);
    const tasks = await new TaskManager(projectPath).list();
    const packages = await listChangePackages(projectPath);
    const workspaces = await listWorkspaces(projectPath, config, tasks);
    sendJson(res, {
      name: config.project.name,
      defaultBranch: config.project.default_branch,
      gitProvider: config.git.provider,
      remote: config.git.remote,
      agents: Object.keys(config.agents),
      taskTemplates: Object.keys(config.task_templates ?? {}),
      dashboard: buildDashboard(config, tasks, packages, workspaces),
    });
    return;
  }

  if (pathname === "/api/tasks") {
    sendJson(res, await new TaskManager(projectPath).list());
    return;
  }

  if (pathname === "/api/tasks/snapshot-drift" && method === "GET") {
    sendJson(res, await new TaskManager(projectPath).inspectSnapshotDrift());
    return;
  }

  const taskMatch = /^\/api\/tasks\/([^/]+)$/.exec(pathname);
  if (taskMatch?.[1]) {
    await sendTask(projectPath, decodeURIComponent(taskMatch[1]), res);
    return;
  }

  // DOG-P1-008: Closeout checklist API
  const closeoutMatch = /^\/api\/tasks\/([^/]+)\/closeout$/.exec(pathname);
  if (closeoutMatch?.[1] && method === "GET") {
    try {
      const config = await loadConfig(projectPath);
      const checker = new TaskCloseoutChecker(projectPath, config);
      const report = await checker.check(decodeURIComponent(closeoutMatch[1]), {
        mode: "checkpoint",
      });
      sendJson(res, report);
    } catch (err) {
      sendError(
        res,
        500,
        "closeout_failed",
        `Closeout check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  if (pathname === "/api/workspaces") {
    const config = await loadConfig(projectPath);
    const tasks = await new TaskManager(projectPath).list();
    sendJson(res, await listWorkspaces(projectPath, config, tasks));
    return;
  }

  if (pathname === "/api/change-packages") {
    sendJson(res, await listChangePackages(projectPath));
    return;
  }

  if (pathname === "/api/merge-queue") {
    sendJson(res, await listMergeQueue(projectPath));
    return;
  }

  if (pathname === "/api/conflicts") {
    sendJson(res, await listConflicts(projectPath));
    return;
  }

  if (pathname === "/api/logs") {
    sendJson(res, await listLogs(projectPath));
    return;
  }

  if (pathname === "/api/audit") {
    sendJson(
      res,
      await listAuditEvents(projectPath, {
        taskId: requestUrl.searchParams.get("taskId") ?? undefined,
        eventType: requestUrl.searchParams.get("eventType") ?? undefined,
        actorId: requestUrl.searchParams.get("actorId") ?? undefined,
        actorType: parseAuditActorType(requestUrl.searchParams.get("actorType")),
        createdFrom: requestUrl.searchParams.get("from") ?? undefined,
        createdTo: requestUrl.searchParams.get("to") ?? undefined,
        limit: parsePositiveInt(requestUrl.searchParams.get("limit")),
      }),
    );
    return;
  }

  if (pathname === "/api/agent-notes") {
    sendJson(res, listAgentNotes(projectPath));
    return;
  }

  if (pathname === "/api/agentops") {
    sendJson(res, await buildAgentOpsMetrics(projectPath));
    return;
  }
  if (pathname === "/api/workflow-jobs") {
    sendJson(res, listWorkflowJobs(projectPath, requestUrl));
    return;
  }

  const logMatch = /^\/api\/logs\/([^/]+)$/.exec(pathname);
  if (logMatch?.[1]) {
    const log = await loadLogDetail(projectPath, decodeURIComponent(logMatch[1]));
    if (!log) {
      sendError(res, 404, "LOG_NOT_FOUND", `Logs for ${decodeURIComponent(logMatch[1])} not found`);
      return;
    }
    sendJson(res, log);
    return;
  }

  const packageMatch = /^\/api\/change-packages\/([^/]+)$/.exec(pathname);
  if (packageMatch?.[1]) {
    await sendChangePackage(projectPath, decodeURIComponent(packageMatch[1]), res);
    return;
  }

  sendError(res, 404, "NOT_FOUND", "Not found");
}

async function handleSyncRoute(
  projectPath: string,
  action: "push" | "pull",
  req: http.IncomingMessage,
  requestUrl: URL,
  res: http.ServerResponse,
): Promise<void> {
  const service = new TeamSyncService(projectPath);
  try {
    if (action === "push") {
      const body = await readOptionalJsonBody<SyncPushRequest>(req);
      sendJson(res, service.push(body, req.headers));
      return;
    }
    sendJson(
      res,
      service.pull(
        {
          teamId: requestUrl.searchParams.get("teamId") ?? undefined,
          hubId: requestUrl.searchParams.get("hubId") ?? undefined,
          cursor: requestUrl.searchParams.get("cursor") ?? undefined,
          limit: parsePositiveInt(requestUrl.searchParams.get("limit")),
        },
        req.headers,
      ),
    );
  } catch (error) {
    if (error instanceof TeamSyncAuthError) {
      sendError(res, error.statusCode, error.code, error.message);
      return;
    }
    sendError(
      res,
      400,
      "TEAM_SYNC_ERROR",
      error instanceof Error ? error.message : "Team Sync request failed.",
    );
  }
}

async function handleTeamRoute(
  projectPath: string,
  action: "status" | "tasks" | "conflicts" | "sync-config",
  req: http.IncomingMessage,
  requestUrl: URL,
  res: http.ServerResponse,
): Promise<void> {
  const service = new TeamSyncService(projectPath);
  try {
    const teamId = requestUrl.searchParams.get("teamId") ?? undefined;
    if (action === "status") {
      sendJson(res, service.getStatus(teamId));
      return;
    }
    if (action === "tasks") {
      sendJson(res, service.listTasks(teamId));
      return;
    }
    if (action === "sync-config") {
      if ((req.method ?? "GET") === "PUT") {
        const body = await readOptionalJsonBody<Partial<TeamSyncConfig>>(req);
        sendJson(res, await updateTeamSyncConfig(projectPath, body));
        return;
      }
      sendJson(res, await readTeamSyncConfig(projectPath));
      return;
    }
    sendJson(res, service.listConflicts(teamId));
  } catch (error) {
    if (error instanceof TeamSyncAuthError) {
      sendError(res, error.statusCode, error.code, error.message);
      return;
    }
    sendError(
      res,
      400,
      "TEAM_SYNC_ERROR",
      error instanceof Error ? error.message : "Team Sync request failed.",
    );
  }
}

/**
 * 处理 Context Feed Preview 请求（TS-P1-002）
 *
 * GET /api/context-feed?taskId=xxx&agentType=codex&compression=standard&format=markdown
 */
async function handleContextFeed(
  projectPath: string,
  requestUrl: URL,
  res: http.ServerResponse,
): Promise<void> {
  const taskId = requestUrl.searchParams.get("taskId");
  if (!taskId) {
    sendError(res, 400, "MISSING_PARAM", "taskId is required");
    return;
  }
  const agentType = requestUrl.searchParams.get("agentType") ?? "generic";
  const compression = requestUrl.searchParams.get("compression") ?? "standard";
  const format = requestUrl.searchParams.get("format") ?? "markdown";

  try {
    const builder = new ContextFeedBuilder(projectPath);
    try {
      const feed = await builder.build({
        taskId,
        agentType,
        compression: compression as "minimal" | "standard" | "detailed",
      });
      const output = formatAgentContextFeed(feed, format as "json" | "markdown" | "prompt");
      sendJson(res, { feed, formatted: output });
    } finally {
      builder.close();
    }
  } catch (error) {
    sendError(
      res,
      400,
      "CONTEXT_FEED_ERROR",
      error instanceof Error ? error.message : "Context feed build failed.",
    );
  }
}

/**
 * 处理 Team Sync Watch SSE 请求（TS-P1-006）
 *
 * GET /api/team/sync-watch
 *
 * 通过 SSE 推送团队同步状态变化，包括：
 * - pending events 数量变化
 * - 同步状态（syncing/idle）
 * - 上次同步结果
 */
function handleTeamSyncWatch(
  projectPath: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  let lastPendingCount = -1;
  let lastRunning: boolean | undefined;

  const sendState = () => {
    try {
      const state = autoSyncStateCache.get(path.resolve(projectPath));
      const store = new TeamSyncStore(projectPath);
      let pendingEvents = 0;
      try {
        const summary = store.getStatusSummary();
        pendingEvents = summary.team ? store.listPendingEvents(summary.team.teamId).length : 0;
      } finally {
        store.close();
      }

      const running = state?.running ?? false;
      // 只在状态变化时推送
      if (pendingEvents !== lastPendingCount || running !== lastRunning) {
        lastPendingCount = pendingEvents;
        lastRunning = running;
        writeSse(res, "sync.state", {
          running,
          mode: state?.mode ?? "manual",
          pendingEvents,
          lastSyncAt: state?.lastSyncAt,
          lastSyncResult: state?.lastSyncResult,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // 忽略读取错误
    }
  };

  // 初始推送
  sendState();

  // 每 5 秒检查一次状态变化
  const timer = setInterval(sendState, 5000);

  // 客户端断开时清理
  req.on("close", () => {
    clearInterval(timer);
  });
}

async function readTeamSyncConfig(
  projectPath: string,
): Promise<{ config: TeamSyncConfig; defaults: TeamSyncConfig }> {
  const config = await loadConfig(projectPath);
  const defaults = defaultTeamSyncConfig();
  return {
    config: { ...defaults, ...(config.team?.sync ?? {}) },
    defaults,
  };
}

async function updateTeamSyncConfig(
  projectPath: string,
  input: Partial<TeamSyncConfig>,
): Promise<{ config: TeamSyncConfig; defaults: TeamSyncConfig }> {
  const config = await loadConfig(projectPath);
  const defaults = defaultTeamSyncConfig();
  const current = { ...defaults, ...(config.team?.sync ?? {}) };
  const next = { ...current, ...sanitizeTeamSyncConfig(input) };
  config.team = { ...(config.team ?? {}), sync: next };
  await ConfigLoader.save(projectPath, config);
  return { config: next, defaults };
}

function sanitizeTeamSyncConfig(input: Partial<TeamSyncConfig>): Partial<TeamSyncConfig> {
  if (!input || typeof input !== "object") return {};
  const output: Partial<TeamSyncConfig> = {};
  const booleanKeys = [
    "tasks",
    "changedFiles",
    "riskLevel",
    "verification",
    "conflicts",
    "agentExecution",
    "failureReason",
    "filesRead",
    "tokenUsage",
    "agentNotes",
    "reviewContext",
    "handoff",
  ] as const;

  for (const key of booleanKeys) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw new Error(`${key} must be a boolean.`);
    output[key] = input[key];
  }
  if (input.mode !== undefined) {
    if (input.mode !== "manual" && input.mode !== "auto")
      throw new Error("mode must be manual or auto.");
    output.mode = input.mode;
  }
  if (input.intervalSeconds !== undefined) {
    if (
      typeof input.intervalSeconds !== "number" ||
      !Number.isFinite(input.intervalSeconds) ||
      input.intervalSeconds < 5
    ) {
      throw new Error("intervalSeconds must be a number greater than or equal to 5.");
    }
    output.intervalSeconds = Math.floor(input.intervalSeconds);
  }
  return output;
}

async function streamEvents(
  projectPath: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  writeSse(res, "connected", { timestamp: new Date().toISOString() });
  try {
    writeSse(res, "dashboard.snapshot", await buildDashboardSnapshot(projectPath));
  } catch (error) {
    writeSse(res, "error", { message: error instanceof Error ? error.message : String(error) });
  }
  events.add(res, headerValue(req.headers["last-event-id"]));
}

async function handleGitHubWebhook(
  projectPath: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  const body = await readRequestBody(req);
  const signature = headerValue(req.headers["x-hub-signature-256"]);
  const secret = process.env.AGENTGITOPS_GITHUB_WEBHOOK_SECRET ?? process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    sendError(res, 503, "WEBHOOK_SECRET_NOT_CONFIGURED", "GitHub webhook secret is not configured");
    return;
  }
  if (!signature || !verifyGitHubSignature(secret, body, signature)) {
    sendError(res, 403, "WEBHOOK_SIGNATURE_INVALID", "Invalid GitHub webhook signature");
    return;
  }

  const event = headerValue(req.headers["x-github-event"]) ?? "unknown";
  const payload = JSON.parse(body) as Record<string, unknown>;
  const updated = await applyGitHubWebhook(projectPath, event, payload);
  if (updated.taskId || updated.status) {
    events.broadcast("task.updated", updated);
    events.broadcast("dashboard.snapshot", await buildDashboardSnapshot(projectPath));
  }
  sendJson(res, { received: true, event, updated });
}

async function handleSubmitReview(
  projectPath: string,
  taskId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  const config = await loadConfig(projectPath);
  const pkg = await loadChangePackage(projectPath, taskId);
  if (!pkg) {
    sendError(res, 404, "CHANGE_PACKAGE_NOT_FOUND", `Change package for ${taskId} not found`);
    return;
  }

  const body = await readJsonBody<{ reviewerId?: string; action?: ReviewAction; comment?: string }>(
    req,
  );
  const actor = resolveActor(config, req, body.reviewerId);
  if (!authorizeRequest(req, actor, "review")) {
    sendError(res, 403, "FORBIDDEN", "Reviewer or owner role is required to submit reviews");
    return;
  }
  const reviewerId = enterpriseRequestUsers.has(req) ? actor.id : body.reviewerId;
  if (!reviewerId || !body.action) {
    sendError(res, 400, "INVALID_REVIEW", "reviewerId and action are required");
    return;
  }
  if (!isReviewAction(body.action)) {
    sendError(res, 400, "INVALID_REVIEW_ACTION", `Unsupported review action: ${body.action}`);
    return;
  }

  const review = await new ReviewStore(projectPath).submit({
    changePackageId: pkg.id,
    reviewerId,
    action: body.action,
    comment: body.comment,
  });
  const task = await new TaskManager(projectPath).updateStatus(
    taskId,
    statusAfterReview(body.action),
  );
  await recordAudit(
    projectPath,
    config,
    "review.submitted",
    {
      taskId,
      changePackageId: pkg.id,
      action: body.action,
      source: "web",
    },
    taskId,
    actor.id,
  );
  const payload = { review, task };
  events.broadcast("review.submitted", payload);
  events.broadcast("task.updated", { taskId, status: task.status });
  events.broadcast("dashboard.snapshot", await buildDashboardSnapshot(projectPath));
  sendJson(res, payload);
}

async function handleProjectInit(
  projectPath: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  const body = await readOptionalJsonBody<{ name?: string; actorId?: string; force?: boolean }>(
    req,
  );
  const projectName = body.name?.trim() || path.basename(projectPath);
  const configPath = await ConfigLoader.init(projectPath, projectName, { force: body.force });
  const actorId =
    body.actorId?.trim() ||
    headerValue(req.headers["x-agentgitops-actor"]) ||
    process.env.USER ||
    "local-user";
  const config = await loadConfig(projectPath);
  config.security ??= {};
  config.security.web ??= {};
  config.security.web.require_actor = true;
  config.security.web.owners = uniqueStrings([...(config.security.web.owners ?? []), actorId]);
  await ConfigLoader.save(projectPath, config);
  const actor: WebActor = { id: actorId, role: "owner" };
  await recordAudit(
    projectPath,
    config,
    "project.created",
    {
      projectName,
      configPath,
      source: "web",
    },
    undefined,
    actor.id,
  );
  events.broadcast("project.initialized", { projectName });
  await broadcastGovernanceChanged(projectPath, events);
  sendJson(res, { configPath, project: config.project, actor });
}

async function handleCreateTask(
  projectPath: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  const config = await loadConfig(projectPath);
  const body = await readJsonBody<{
    title?: string;
    objective?: string;
    background?: string;
    agentId?: string;
    template?: string;
    baseBranch?: string;
    allowedPaths?: string[];
    forbiddenPaths?: string[];
    requiredChecks?: string[];
    riskLevel?: TaskContract["riskLevel"];
    reviewers?: string[];
    actorId?: string;
  }>(req);
  const actor = resolveActor(config, req, body.actorId);
  if (!authorizeRequest(req, actor, "review")) {
    sendError(res, 403, "FORBIDDEN", "Current actor cannot create tasks");
    return;
  }

  const title = body.title?.trim();
  const template = resolveTaskTemplate(config, body.template?.trim() || undefined);
  const agentId =
    body.agentId?.trim() || template?.agent || Object.keys(config.agents)[0] || "generic";
  if (!title) {
    sendError(res, 400, "TASK_TITLE_REQUIRED", "Task title is required");
    return;
  }
  if (!config.agents[agentId]) {
    sendError(res, 400, "AGENT_NOT_FOUND", `Agent not found: ${agentId}`);
    return;
  }
  if (!["low", "medium", "high", "critical"].includes(body.riskLevel ?? "low")) {
    sendError(res, 400, "RISK_LEVEL_INVALID", "Risk level must be low, medium, high, or critical");
    return;
  }

  const task = await new TaskManager(projectPath).create({
    projectName: config.project.name,
    title,
    objective: body.objective?.trim() || template?.objective || title,
    background: body.background?.trim() || template?.background || undefined,
    agentName: agentId,
    baseBranch: body.baseBranch?.trim() || template?.base_branch || config.project.default_branch,
    allowedPaths: normalizeOptionalStringList(body.allowedPaths) ?? template?.allowed_paths,
    forbiddenPaths: normalizeOptionalStringList(body.forbiddenPaths) ?? template?.forbidden_paths,
    requiredChecks: normalizeOptionalStringList(body.requiredChecks) ?? template?.required_checks,
    riskLevel: body.riskLevel ?? template?.risk_level ?? "low",
    riskDomains: template?.risk_domains,
    reviewers: normalizeOptionalStringList(body.reviewers) ?? template?.reviewers,
  });
  await recordAudit(
    projectPath,
    config,
    "task.created",
    { taskId: task.id, source: "web" },
    task.id,
    actor.id,
  );
  await broadcastGovernanceChanged(projectPath, events);
  sendJson(res, { task, message: `Task created: ${task.id}` });
}

async function handleTaskWorkflowAction(
  projectPath: string,
  taskId: string,
  action: "start" | "run" | "test" | "package" | "pr",
  req: http.IncomingMessage,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  const config = await loadConfig(projectPath);
  const body = await readOptionalJsonBody<{
    actorId?: string;
    dryRun?: boolean;
    draft?: boolean;
    commit?: boolean;
    reviewContextComment?: boolean;
    bodyTemplate?: string;
  }>(req);
  const actor = resolveActor(config, req, body.actorId);
  const requiredPermission = action === "pr" ? (body.dryRun ? "view" : "admin") : "review";
  if (!authorizeRequest(req, actor, requiredPermission)) {
    sendError(res, 403, "FORBIDDEN", `Current actor cannot run task action: ${action}`);
    return;
  }

  const jobPayload = {
    dryRun: body.dryRun === true,
    draft: body.draft ?? true,
    commit: body.commit !== false,
    reviewContextComment: body.reviewContextComment === true,
    bodyTemplate: parsePullRequestBodyTemplate(body.bodyTemplate),
  };

  try {
    const { job, result } = await new WorkflowJobService(projectPath).runTaskWorkflow(
      action,
      taskId,
      actor.id,
      jobPayload,
      async () =>
        executeTaskWorkflowAction(projectPath, config, taskId, action, {
          actorId: actor.id,
          dryRun: body.dryRun === true,
          draft: body.draft ?? true,
          commit: body.commit !== false,
          reviewContextComment: body.reviewContextComment === true,
          bodyTemplate: parsePullRequestBodyTemplate(body.bodyTemplate),
        }),
    );
    await broadcastGovernanceChanged(projectPath, events);
    sendJson(res, { ...result, job });
  } catch (error) {
    const { job, cause } = getWorkflowJobErrorContext(error);
    const task = await tryLoadTask(projectPath, taskId);
    sendJson(res, {
      task,
      job,
      message: cause instanceof Error ? cause.message : String(cause),
      recovery: workflowRecoveryHints(action, cause, config.git.provider),
    });
  }
}

async function handleWorkflowJobAction(
  projectPath: string,
  jobId: string,
  action: "cancel" | "retry",
  req: http.IncomingMessage,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  const config = await loadConfig(projectPath);
  const body = await readOptionalJsonBody<{ actorId?: string }>(req);
  const actor = resolveActor(config, req, body.actorId);
  if (!authorizeRequest(req, actor, "review")) {
    sendError(res, 403, "FORBIDDEN", `Current actor cannot ${action} workflow jobs`);
    return;
  }

  const service = new WorkflowJobService(projectPath);
  try {
    if (action === "cancel") {
      const job = service.cancel(jobId);
      await recordAudit(
        projectPath,
        config,
        "workflow_job.canceled",
        { jobId },
        job.taskId,
        actor.id,
      );
      await broadcastGovernanceChanged(projectPath, events);
      sendJson(res, { job, message: `Workflow job canceled: ${job.id}` });
      return;
    }

    const original = new LocalProjectRepository(projectPath).getWorkflowJob(jobId);
    if (!original) {
      sendError(res, 404, "WORKFLOW_JOB_NOT_FOUND", `Workflow job ${jobId} not found`);
      return;
    }
    if (!original.action.startsWith("task.") || !original.taskId) {
      sendError(
        res,
        400,
        "WORKFLOW_JOB_UNSUPPORTED",
        `Workflow job ${jobId} cannot be retried from API`,
      );
      return;
    }
    const taskAction = original.action.slice("task.".length) as
      "start" | "run" | "test" | "package" | "pr";
    if (!["start", "run", "test", "package", "pr"].includes(taskAction)) {
      sendError(
        res,
        400,
        "WORKFLOW_JOB_UNSUPPORTED",
        `Unsupported task workflow action: ${taskAction}`,
      );
      return;
    }
    const payload = normalizeTaskWorkflowPayload(original.payload);
    if (taskAction === "pr" && !payload.dryRun && !authorizeRequest(req, actor, "admin")) {
      sendError(res, 403, "FORBIDDEN", "Owner role is required to retry real PR/MR workflow jobs");
      return;
    }

    const { job, result } = await service.retry(jobId, async () =>
      executeTaskWorkflowAction(projectPath, config, original.taskId!, taskAction, {
        actorId: actor.id,
        ...payload,
      }),
    );
    await recordAudit(
      projectPath,
      config,
      "workflow_job.retried",
      {
        jobId,
        retryJobId: job.id,
        action: original.action,
      },
      original.taskId,
      actor.id,
    );
    await broadcastGovernanceChanged(projectPath, events);
    sendJson(res, { ...result, job });
  } catch (error) {
    const { job, cause } = getWorkflowJobErrorContext(error);
    sendJson(res, {
      job,
      message: cause instanceof Error ? cause.message : String(cause),
      recovery: ["Inspect the workflow job details and retry after resolving the blocker."],
    });
  }
}

function normalizeTaskWorkflowPayload(payload: unknown): Omit<TaskWorkflowOptions, "actorId"> {
  const candidate =
    payload && typeof payload === "object"
      ? (payload as Partial<Omit<TaskWorkflowOptions, "actorId">>)
      : {};
  return {
    dryRun: candidate.dryRun === true,
    draft: candidate.draft ?? true,
    commit: candidate.commit !== false,
    reviewContextComment: candidate.reviewContextComment === true,
    bodyTemplate: parsePullRequestBodyTemplate(candidate.bodyTemplate),
  };
}

function parsePullRequestBodyTemplate(value?: string): PullRequestBodyTemplate {
  const template = value?.trim() || "ce";
  if (template === "ce" || template === "team-sync") return template;
  throw new Error(`Unsupported PR/MR body template: ${template}. Use ce or team-sync.`);
}

async function executeTaskWorkflowAction(
  projectPath: string,
  config: AgentgitopsConfig,
  taskId: string,
  action: "start" | "run" | "test" | "package" | "pr",
  options: TaskWorkflowOptions,
): Promise<WorkflowActionResult> {
  switch (action) {
    case "start":
      return runStartTask(projectPath, config, taskId, options.actorId);
    case "run":
      return runAgentTask(projectPath, config, taskId, options.actorId);
    case "test":
      return runTaskChecks(projectPath, config, taskId, options.actorId);
    case "package":
      return runPackageTask(projectPath, config, taskId, options.actorId);
    case "pr":
      return runPullRequestTask(projectPath, config, taskId, options);
    default:
      throw new Error(`Unsupported task workflow action: ${action}`);
  }
}

async function runStartTask(
  projectPath: string,
  config: AgentgitopsConfig,
  taskId: string,
  actorId: string,
): Promise<WorkflowActionResult> {
  const repository = new LocalProjectRepository(projectPath);
  const task = await repository.loadTask(taskId);
  if (task.status === "canceled" || task.status === "merged") {
    throw new Error(`Task ${task.id} cannot be started from status ${task.status}.`);
  }

  const workspacePath = workspacePathFor(projectPath, config, task);
  if (!(await pathExists(workspacePath))) {
    await new WorkspaceManager(
      projectPath,
      path.resolve(projectPath, config.project.worktree_root),
    ).create(task);
    await recordAudit(
      projectPath,
      config,
      "workspace.created",
      { taskId: task.id, path: workspacePath, source: "web" },
      task.id,
      actorId,
    );
  }

  const updated = await repository.updateTaskStatus(task.id, "workspace_created");
  await recordAudit(
    projectPath,
    config,
    "task.started",
    { taskId: task.id, workspacePath, source: "web" },
    task.id,
    actorId,
  );
  return {
    task: updated,
    workspacePath,
    message: `Task workspace ready: ${workspacePath}`,
  };
}

async function runAgentTask(
  projectPath: string,
  config: AgentgitopsConfig,
  taskId: string,
  actorId: string,
): Promise<WorkflowActionResult> {
  const repository = new LocalProjectRepository(projectPath);
  const task = await repository.loadTask(taskId);
  const agentConfig = config.agents[task.agentId];
  if (!agentConfig) throw new Error(`Agent not found: ${task.agentId}`);
  if (agentConfig.enabled === false) throw new Error(`Agent is disabled: ${task.agentId}`);

  const started = await runStartTask(projectPath, config, task.id, actorId);
  const workspacePath = started.workspacePath ?? workspacePathFor(projectPath, config, task);
  await repository.updateTaskStatus(task.id, "running");
  await recordAudit(
    projectPath,
    config,
    "agent.session.started",
    { taskId: task.id, agentId: task.agentId, source: "web" },
    task.id,
    actorId,
  );

  const result = await createAgentAdapter(agentConfig.type).run({
    taskContract: task,
    workspacePath,
    command: agentConfig.command,
    args: agentConfig.args ?? [],
    env: buildWorkspaceEnvironment(config.workspace?.env, agentConfig.env),
    policies: config.policies,
    logRoot: path.join(projectPath, CONFIG_DIR, "logs"),
  });
  const status = result.status === "completed" ? "testing" : "failed";
  const updated = await repository.updateTaskStatus(task.id, status);
  await recordAudit(
    projectPath,
    config,
    result.status === "completed" ? "agent.session.completed" : "agent.session.failed",
    {
      taskId: task.id,
      agentId: task.agentId,
      exitCode: result.exitCode,
      status: result.status,
      logDir: result.logDir,
      source: "web",
    },
    task.id,
    actorId,
  );
  recordTeamSync(projectPath, (producer) => {
    producer.recordTaskUpdated(updated);
    producer.recordAgentSessionCompleted(task.id, result.executionSummary, {
      ...defaultTeamSyncConfig(),
      ...(config.team?.sync ?? {}),
    });
  });

  return {
    task: updated,
    workspacePath,
    message: `Agent finished with status ${result.status}`,
  };
}

async function runTaskChecks(
  projectPath: string,
  config: AgentgitopsConfig,
  taskId: string,
  actorId: string,
): Promise<WorkflowActionResult> {
  const repository = new LocalProjectRepository(projectPath);
  const task = await repository.loadTask(taskId);
  const workspacePath = workspacePathFor(projectPath, config, task);
  if (!(await pathExists(workspacePath))) {
    throw new Error(`Workspace not found for ${task.id}: ${workspacePath}`);
  }

  const checks = await collectRequiredChecks(config, task, projectPath);
  if (checks.length === 0) {
    const skipped = {
      id: `verify_${task.id}_no-required-checks`,
      taskId: task.id,
      name: "no required checks",
      command: "",
      status: "skipped" as const,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
    await repository.saveVerificationRuns(task.id, [skipped]);
    const updated = await repository.updateTaskStatus(task.id, "packaging");
    await recordAudit(
      projectPath,
      config,
      "checks.skipped",
      { taskId: task.id, reason: "no required checks", source: "web" },
      task.id,
      actorId,
    );
    return { task: updated, workspacePath, message: "No required checks configured." };
  }

  await repository.updateTaskStatus(task.id, "testing");
  const runs = await new VerificationGate(projectPath, config.policies).run(
    task,
    workspacePath,
    checks,
  );
  await repository.saveVerificationRuns(task.id, runs);
  const failed = runs.filter((run) => run.status === "failed");
  const updated = await repository.updateTaskStatus(
    task.id,
    failed.length === 0 ? "packaging" : "failed",
  );
  await recordAudit(
    projectPath,
    config,
    failed.length === 0 ? "checks.passed" : "checks.failed",
    {
      taskId: task.id,
      checks: runs.map((run) => ({
        name: run.name,
        status: run.status,
        durationMs: run.durationMs,
      })),
      source: "web",
    },
    task.id,
    actorId,
  );
  return {
    task: updated,
    workspacePath,
    message: failed.length === 0 ? "All checks passed." : `${failed.length} check(s) failed.`,
  };
}

async function runPackageTask(
  projectPath: string,
  config: AgentgitopsConfig,
  taskId: string,
  actorId: string,
): Promise<WorkflowActionResult> {
  const repository = new LocalProjectRepository(projectPath);
  const task = await repository.loadTask(taskId);
  const workspacePath = await resolveDiffWorkspacePath(projectPath, config, task);

  const diffService = new DiffService(workspacePath);
  const checks = await repository.loadVerificationRuns(task.id);
  const pkg = await new ChangePackageGenerator(
    diffService,
    projectPath,
    getExtensionRegistry(projectPath),
  ).generate(task, checks);
  await repository.updateTaskStatus(task.id, "packaging");
  const updated = await repository.updateTaskStatus(task.id, "reviewing");
  await recordAudit(
    projectPath,
    config,
    "change_package.generated",
    {
      packageId: pkg.id,
      changedFiles: pkg.changedFiles.length,
      risk: pkg.risk.level,
      source: "web",
    },
    task.id,
    actorId,
  );
  return {
    task: updated,
    changePackage: pkg,
    workspacePath,
    message: `Change Package generated: ${pkg.id}`,
  };
}

async function runPullRequestTask(
  projectPath: string,
  config: AgentgitopsConfig,
  taskId: string,
  options: TaskWorkflowOptions,
): Promise<WorkflowActionResult> {
  const repository = new LocalProjectRepository(projectPath);
  const task = await repository.loadTask(taskId);
  const pkg = await loadChangePackage(projectPath, taskId);
  if (!pkg) throw new Error(`Change Package not found for ${taskId}. Run package first.`);
  const workspacePath = workspacePathFor(projectPath, config, task);
  if (!(await pathExists(workspacePath))) {
    throw new Error(`Workspace not found for ${task.id}: ${workspacePath}`);
  }
  if (pkg.changedFiles.length === 0 || pkg.stats.filesChanged === 0) {
    throw new Error("Change Package has zero changed files.");
  }
  if (config.git.provider !== "github" && config.git.provider !== "gitlab") {
    throw new Error(`Unsupported git provider for PR/MR: ${config.git.provider}`);
  }

  const remoteUrl = await new GitService(projectPath).getRemoteUrl(config.git.remote);
  const repo =
    config.git.provider === "github"
      ? parseGitHubRepository(remoteUrl)
      : parseGitLabRepository(remoteUrl);
  const reviewContext = await buildReviewContext(projectPath, taskId);
  const teamSync =
    options.bodyTemplate === "team-sync"
      ? await buildTeamSyncPullRequestContext(projectPath, task, pkg)
      : undefined;
  const bodyOptions = { template: options.bodyTemplate, teamSync };
  const body =
    config.git.provider === "github"
      ? formatChangePackagePullRequestBody(task, pkg, reviewContext, bodyOptions)
      : formatMergeRequestBody(task, pkg, reviewContext, bodyOptions);
  const title = `[agent:${task.agentId}] ${task.title}`;

  if (options.dryRun) {
    return {
      task,
      changePackage: pkg,
      workspacePath,
      provider: config.git.provider,
      message: "PR/MR dry-run completed.",
      dryRun: {
        repo,
        title,
        baseBranch: task.baseBranch,
        headBranch: task.targetBranch,
        bodyTemplate: options.bodyTemplate,
        body,
      },
      recovery: tokenRecoveryHints(config.git.provider),
    };
  }

  const token = await getProviderToken(config.git.provider);
  if (!token) throw new Error(missingTokenMessage(config.git.provider));

  const workspaceGit = new GitService(workspacePath);
  if (options.commit) {
    const status = await workspaceGit.status();
    if (status.trim()) {
      await workspaceGit.commit(`chore(agent): ${task.title} [${task.id}]`);
    }
  }
  await workspaceGit.push(config.git.remote, task.targetBranch);

  const provider =
    config.git.provider === "github"
      ? new GitHubProvider({ token })
      : new GitLabProvider({ token, host: process.env.GITLAB_HOST });
  const previousPrNumber = pkg.prNumber;
  const pr = await provider.createOrUpdatePullRequest({
    repo,
    title,
    body,
    headBranch: task.targetBranch,
    baseBranch: task.baseBranch,
    draft: options.draft,
  });
  const comment = options.reviewContextComment
    ? await provider.upsertPullRequestComment({
        repo,
        number: pr.number,
        body: formatReviewContextComment(reviewContext),
      })
    : undefined;

  pkg.prUrl = pr.url;
  pkg.prNumber = pr.number;
  await saveChangePackage(projectPath, taskId, pkg);
  const updated = await repository.updateTaskStatus(task.id, "reviewing");
  await recordAudit(
    projectPath,
    config,
    previousPrNumber ? "pr.updated" : "pr.created",
    {
      taskId: task.id,
      packageId: pkg.id,
      prUrl: pr.url,
      prNumber: pr.number,
      comment,
      source: "web",
    },
    task.id,
    options.actorId,
  );

  return {
    task: updated,
    changePackage: pkg,
    workspacePath,
    provider: config.git.provider,
    prUrl: pr.url,
    prNumber: pr.number,
    comment,
    message: `Pull request ready: ${pr.url}`,
  };
}

async function buildTeamSyncPullRequestContext(
  projectPath: string,
  task: TaskContract,
  pkg: ChangePackage,
): Promise<TeamSyncPullRequestContext> {
  const builder = new TeamSyncPullRequestContextBuilder(projectPath);
  try {
    return await builder.build(task, pkg);
  } finally {
    builder.close();
  }
}

async function handleMergeAction(
  projectPath: string,
  taskId: string,
  action: "evaluate" | "approve" | "block",
  req: http.IncomingMessage,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  const body = await readOptionalJsonBody<{
    actorId?: string;
    strategy?: string;
    squash?: boolean;
    localOnly?: boolean;
    dryRun?: boolean;
  }>(req);
  const config = await loadConfig(projectPath);
  const actor = resolveActor(config, req, body.actorId);
  const requiredPermission = mergeActionPermission(action, body);
  if (!authorizeRequest(req, actor, requiredPermission)) {
    sendError(
      res,
      403,
      "FORBIDDEN",
      `${requiredPermission} permission is required for merge ${action}`,
    );
    return;
  }
  const taskMgr = new TaskManager(projectPath);
  const task = await taskMgr.load(taskId);

  if (action === "block") {
    const blocked = await taskMgr.updateStatus(taskId, "blocked");
    await recordAudit(
      projectPath,
      config,
      "conflict.detected",
      {
        taskId,
        reason: "manual merge block",
        source: "web",
      },
      taskId,
      actor.id,
    );
    events.broadcast("task.updated", { taskId, status: blocked.status });
    await broadcastGovernanceChanged(projectPath, events);
    sendJson(res, {
      task: blocked,
      changePackage: await loadChangePackage(projectPath, taskId),
      gate: null,
      merged: false,
      message: "Task was blocked from merge.",
    } satisfies MergeActionResult);
    return;
  }

  const pkg = await loadChangePackage(projectPath, taskId);
  if (!pkg) {
    sendError(res, 404, "CHANGE_PACKAGE_NOT_FOUND", `Change package for ${taskId} not found`);
    return;
  }

  const reviews = await new ReviewStore(projectPath).list(pkg.id);
  const gate = new MergeGate().evaluate({ task, changePackage: pkg, reviews });

  if (action === "evaluate" || body.dryRun) {
    sendJson(res, {
      task,
      changePackage: pkg,
      gate,
      merged: false,
      message: gate.allowed ? "Merge gate passed." : "Merge gate is blocked.",
      recovery: gate.allowed ? [] : recoveryHintsForGate(gate, pkg),
    } satisfies MergeActionResult);
    return;
  }

  if (!gate.allowed) {
    sendJson(res, {
      task,
      changePackage: pkg,
      gate,
      merged: false,
      message: "Merge gate is blocked. Resolve blockers before provider merge.",
      recovery: recoveryHintsForGate(gate, pkg),
    } satisfies MergeActionResult);
    return;
  }

  if (body.localOnly) {
    await recordAudit(
      projectPath,
      config,
      "merge.queued",
      {
        taskId,
        prUrl: pkg.prUrl,
        source: "web",
      },
      taskId,
      actor.id,
    );
    await broadcastGovernanceChanged(projectPath, events);
    sendJson(res, {
      task,
      changePackage: pkg,
      gate,
      merged: false,
      provider: config.git.provider,
      message: "Merge approved locally. Provider merge was not executed.",
    } satisfies MergeActionResult);
    return;
  }

  if (!pkg.prNumber) {
    sendJson(res, {
      task,
      changePackage: pkg,
      gate,
      merged: false,
      provider: config.git.provider,
      message: "Change Package has no PR/MR number. Create or update the PR/MR first.",
      recovery: [
        "Run agentgitops pr <task-id>.",
        "Confirm the Change Package contains prUrl and prNumber.",
      ],
    } satisfies MergeActionResult);
    return;
  }

  if (config.git.provider !== "github" && config.git.provider !== "gitlab") {
    sendJson(res, {
      task,
      changePackage: pkg,
      gate,
      merged: false,
      provider: config.git.provider,
      message: `Provider merge is not supported for ${config.git.provider}.`,
      recovery: ["Use --local-only approval, or configure github/gitlab as the project provider."],
    } satisfies MergeActionResult);
    return;
  }

  const token = await getProviderToken(config.git.provider);
  if (!token) {
    sendJson(res, {
      task,
      changePackage: pkg,
      gate,
      merged: false,
      provider: config.git.provider,
      message: missingTokenMessage(config.git.provider),
      recovery: tokenRecoveryHints(config.git.provider),
    } satisfies MergeActionResult);
    return;
  }

  try {
    const repo = await getProviderRepository(projectPath, config);
    const result =
      config.git.provider === "github"
        ? await new GitHubProvider({ token }).mergePullRequest({
            repo,
            number: pkg.prNumber,
            method: normalizeGitHubMergeMethod(body.strategy, body.squash, task.merge.squash),
            commitTitle: `[agent:${task.agentId}] ${task.title}`,
          })
        : await new GitLabProvider({ token, host: process.env.GITLAB_HOST }).mergePullRequest({
            repo,
            number: pkg.prNumber,
            squash: body.squash ?? task.merge.squash ?? true,
          });

    if (!result.merged) {
      sendJson(res, {
        task,
        changePackage: pkg,
        gate,
        merged: false,
        provider: config.git.provider,
        message: result.message,
        recovery: providerRecoveryHints(config.git.provider),
      } satisfies MergeActionResult);
      return;
    }

    const mergedTask = await taskMgr.updateStatus(taskId, "merged");
    await recordAudit(
      projectPath,
      config,
      "merge.completed",
      {
        taskId,
        prUrl: pkg.prUrl,
        prNumber: pkg.prNumber,
        message: result.message,
        sha: result.sha,
        source: "web",
      },
      taskId,
      actor.id,
    );
    events.broadcast("task.updated", { taskId, status: mergedTask.status });
    await broadcastGovernanceChanged(projectPath, events);
    sendJson(res, {
      task: mergedTask,
      changePackage: pkg,
      gate,
      merged: true,
      provider: config.git.provider,
      message: result.message,
      sha: result.sha,
    } satisfies MergeActionResult);
  } catch (error) {
    sendJson(res, {
      task,
      changePackage: pkg,
      gate,
      merged: false,
      provider: config.git.provider,
      message: error instanceof Error ? error.message : String(error),
      recovery: providerRecoveryHints(config.git.provider),
    } satisfies MergeActionResult);
  }
}

async function handleConflictAction(
  projectPath: string,
  conflictId: string,
  action: ConflictAction,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  const body = await readOptionalJsonBody<{ actorId?: string; note?: string }>(req);
  const config = await loadConfig(projectPath);
  const actor = resolveActor(config, req, body.actorId);
  if (!authorizeRequest(req, actor, conflictActionPermission(action))) {
    sendError(res, 403, "FORBIDDEN", `Insufficient role for conflict action: ${action}`);
    return;
  }
  const packages = await listChangePackages(projectPath);
  const pkg = packages.find((candidate) =>
    candidate.conflicts.some((conflict) => conflict.id === conflictId),
  );
  const conflict = pkg?.conflicts.find((candidate) => candidate.id === conflictId);

  if (!pkg || !conflict) {
    sendError(res, 404, "CONFLICT_NOT_FOUND", `Conflict ${conflictId} not found`);
    return;
  }

  const taskManager = new TaskManager(projectPath);
  let actionResult: ConflictActionResult = { status: "not_applicable" };
  if (action === "rebase") {
    const task = await taskManager.load(pkg.taskId);
    actionResult = await executeConflictRebase(projectPath, config, task);
    applyConflictAction(conflict, action, actionResult.status === "completed");
  } else {
    applyConflictAction(conflict, action);
  }
  await saveChangePackage(projectPath, pkg.taskId, pkg);

  const task =
    action === "rebase"
      ? await taskManager.updateStatus(
          pkg.taskId,
          actionResult.status === "completed" ? "testing" : "blocked",
        )
      : action === "human-takeover"
        ? await taskManager.updateStatus(pkg.taskId, "blocked")
        : await tryLoadTask(projectPath, pkg.taskId);

  await recordAudit(
    projectPath,
    config,
    conflictAuditType(action),
    {
      conflictId,
      taskId: pkg.taskId,
      packageId: pkg.id,
      action,
      note: body.note,
      actionResult,
    },
    pkg.taskId,
    actor.id,
  );
  if (task) events.broadcast("task.updated", { taskId: task.id, status: task.status });
  events.broadcast("conflict.updated", { conflictId, action, taskId: pkg.taskId });
  await broadcastGovernanceChanged(projectPath, events);
  sendJson(res, {
    conflict: {
      id: conflict.id,
      taskId: pkg.taskId,
      conflictingTaskId: conflict.conflictingTaskId,
      type: conflict.type,
      filePath: conflict.filePath,
      severity: conflict.severity,
      suggestion: conflict.suggestion,
      status: conflict.status,
      packageId: pkg.id,
    },
    task,
    actionResult,
  });
}

async function handleSubmitAgentNote(
  projectPath: string,
  taskId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  events: EventBroker,
): Promise<void> {
  const config = await loadConfig(projectPath);
  const body = await readJsonBody<{
    agentId?: string;
    actorId?: string;
    summary?: string;
    files?: string[];
    verification?: string[];
    reviewFocus?: string[];
    risks?: string[];
    commitSha?: string;
    prUrl?: string;
  }>(req);
  const actor = resolveActor(config, req, body.actorId ?? body.agentId);
  if (!authorizeRequest(req, actor, "note")) {
    sendError(res, 403, "FORBIDDEN", "Reviewer or owner role is required to add agent notes");
    return;
  }
  if (!body.summary?.trim()) {
    sendError(res, 400, "INVALID_AGENT_NOTE", "summary is required");
    return;
  }

  const db = new LocalDb(projectPath);
  try {
    const note = db.insertAgentNote({
      id: `note_${randomUUID()}`,
      taskId,
      agentId: body.agentId?.trim() || actor.id,
      summary: body.summary.trim(),
      files: normalizeStringList(body.files),
      verification: normalizeStringList(body.verification),
      reviewFocus: normalizeStringList(body.reviewFocus),
      risks: normalizeStringList(body.risks),
      commitSha: body.commitSha?.trim() || undefined,
      prUrl: body.prUrl?.trim() || undefined,
    });
    db.insertAuditEvent({
      id: `audit_${randomUUID()}`,
      projectId: config.project.name,
      taskId,
      actorType: "agent",
      actorId: note.agentId,
      eventType: "agent.note.added",
      payload: {
        noteId: note.id,
        summary: note.summary,
        files: note.files,
        verification: note.verification,
        reviewFocus: note.reviewFocus,
        risks: note.risks,
        commitSha: note.commitSha,
        prUrl: note.prUrl,
      },
    });
    events.broadcast("agent.note.added", { taskId, noteId: note.id });
    await broadcastGovernanceChanged(projectPath, events);
    sendJson(res, note);
  } finally {
    db.close();
  }
}

async function handleHealth(projectPath: string, res: http.ServerResponse): Promise<void> {
  let configStatus: "ok" | "missing" = "ok";
  try {
    await ConfigLoader.load(projectPath);
  } catch {
    configStatus = "missing";
  }

  sendJson(res, {
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
    projectPath,
    config: configStatus,
  });
}

export function buildRuntimeProjectList(
  projects: ProjectEntry[],
  currentProjectPath: string,
  requestHost?: string,
): RuntimeProjectList {
  const currentPath = path.resolve(currentProjectPath);
  const currentProject = projects.find((project) => path.resolve(project.path) === currentPath);
  const currentPort = parseHostPort(requestHost);
  const currentOrigin = requestHost ? `http://${requestHost}` : undefined;

  return {
    currentProjectId: currentProject?.id,
    currentPort,
    projects: projects.map((project) => {
      const isCurrent = currentProject?.id === project.id;
      const isPortConflict =
        !isCurrent && currentPort !== undefined && project.serverPort === currentPort;
      const runtimePort = isCurrent ? (currentPort ?? project.serverPort) : project.serverPort;
      const openUrl = isCurrent
        ? (currentOrigin ??
          (project.serverPort ? `http://localhost:${project.serverPort}` : undefined))
        : project.serverPort && !isPortConflict
          ? `http://localhost:${project.serverPort}`
          : undefined;

      return {
        ...project,
        isCurrent,
        isPortConflict,
        runtimePort,
        openUrl,
      };
    }),
  };
}

function parseHostPort(host: string | undefined): number | undefined {
  if (!host) return undefined;
  const ipv6Match = /^\[[^\]]+\]:(\d+)$/.exec(host);
  const portText = ipv6Match?.[1] ?? /^[^:]+:(\d+)$/.exec(host)?.[1];
  if (!portText) return undefined;
  const port = Number(portText);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

async function sendTask(
  projectPath: string,
  taskId: string,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const task = await new TaskManager(projectPath).load(taskId);
    sendJson(res, task);
  } catch {
    sendError(res, 404, "TASK_NOT_FOUND", `Task ${taskId} not found`);
  }
}

async function tryLoadTask(projectPath: string, taskId: string): Promise<TaskContract | null> {
  try {
    return await new TaskManager(projectPath).load(taskId);
  } catch {
    return null;
  }
}

async function sendChangePackage(
  projectPath: string,
  taskId: string,
  res: http.ServerResponse,
): Promise<void> {
  const pkg = await loadChangePackage(projectPath, taskId);
  if (!pkg) {
    sendError(res, 404, "CHANGE_PACKAGE_NOT_FOUND", `Change package for ${taskId} not found`);
    return;
  }
  sendJson(res, pkg);
}

async function sendReviewContext(
  projectPath: string,
  taskId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const context = await buildReviewContext(projectPath, taskId);
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    if (requestUrl.searchParams.get("record") === "1") {
      const config = await loadConfig(projectPath);
      const actor = resolveActor(config, req, requestUrl.searchParams.get("actorId") ?? undefined);
      await recordAudit(
        projectPath,
        config,
        "review.context.generated",
        {
          taskId,
          packageId: context.changePackage?.id,
          checklist: context.checklist.map((item) => item.severity),
          source: "web",
        },
        taskId,
        actor.id,
      );
    }
    sendJson(res, context);
  } catch (error) {
    sendError(
      res,
      404,
      "REVIEW_CONTEXT_NOT_FOUND",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function applyGitHubWebhook(
  projectPath: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<{ taskId?: string; status?: TaskStatus; prUrl?: string; prNumber?: number }> {
  const tasks = await new TaskManager(projectPath).list();
  const pullRequest = payload.pull_request as
    | {
        head?: { ref?: string };
        html_url?: string;
        number?: number;
        merged?: boolean;
      }
    | undefined;
  const checkRun = payload.check_run as
    | {
        check_suite?: { head_branch?: string };
        conclusion?: string | null;
        status?: string;
      }
    | undefined;
  const checkSuite = payload.check_suite as
    | {
        head_branch?: string;
        conclusion?: string | null;
        status?: string;
      }
    | undefined;

  const branch =
    pullRequest?.head?.ref ?? checkRun?.check_suite?.head_branch ?? checkSuite?.head_branch;
  if (!branch) return {};

  const task = tasks.find((candidate) => candidate.targetBranch === branch);
  if (!task) return {};

  const nextStatus = nextStatusFromGitHubEvent(event, payload, checkRun, checkSuite);
  if (nextStatus) {
    await new TaskManager(projectPath).updateStatus(task.id, nextStatus);
    // 记录 CI 状态变更审计事件（双向同步可追溯）
    const config = await loadConfig(projectPath);
    const ciEvent =
      event === "check_run" ? "ci.check_run" : event === "check_suite" ? "ci.check_suite" : event;
    const ciDetail =
      checkRun?.conclusion ?? checkSuite?.conclusion ?? checkRun?.status ?? checkSuite?.status;
    await recordAudit(
      projectPath,
      config,
      ciEvent,
      {
        taskId: task.id,
        branch,
        status: nextStatus,
        conclusion: ciDetail,
        source: "github-webhook",
      },
      task.id,
      "github",
    );
  }

  if (pullRequest?.html_url && pullRequest.number) {
    const pkg = await loadChangePackage(projectPath, task.id);
    if (pkg) {
      pkg.prUrl = pullRequest.html_url;
      pkg.prNumber = pullRequest.number;
      await saveChangePackage(projectPath, task.id, pkg);
    }
  }

  return {
    taskId: task.id,
    status: nextStatus,
    prUrl: pullRequest?.html_url,
    prNumber: pullRequest?.number,
  };
}

function nextStatusFromGitHubEvent(
  event: string,
  payload: Record<string, unknown>,
  checkRun?: { conclusion?: string | null; status?: string },
  checkSuite?: { conclusion?: string | null; status?: string },
): TaskStatus | undefined {
  if (event === "pull_request") {
    const action = payload.action;
    const pullRequest = payload.pull_request as { merged?: boolean } | undefined;
    if (action === "closed") return pullRequest?.merged ? "merged" : "canceled";
    if (action === "opened" || action === "reopened" || action === "synchronize")
      return "reviewing";
  }

  if (event === "check_run" || event === "check_suite") {
    const check = event === "check_run" ? checkRun : checkSuite;
    if (check?.status && check.status !== "completed") return "testing";
    if (check?.conclusion === "success" || check?.conclusion === "neutral") return "reviewing";
    if (
      check?.conclusion === "failure" ||
      check?.conclusion === "timed_out" ||
      check?.conclusion === "cancelled"
    ) {
      return "failed";
    }
  }

  return undefined;
}

async function loadConfig(projectPath: string): Promise<AgentgitopsConfig> {
  const config = await ConfigLoader.load(projectPath);
  const resolvedPath = path.resolve(projectPath);
  if (!serverExtensionRegistries.has(resolvedPath)) {
    serverExtensionRegistries.set(resolvedPath, await createRuntimeExtensionRegistry(config));
  }
  return config;
}

async function createServerRuntimeExtensionRegistry(
  projectPath: string,
): Promise<ExtensionRegistry | undefined> {
  let config: AgentgitopsConfig;
  try {
    config = await ConfigLoader.load(projectPath);
  } catch {
    return undefined;
  }
  return createRuntimeExtensionRegistry(config);
}

async function closeServerExtensionRegistry(projectPath: string): Promise<void> {
  const registry = serverExtensionRegistries.get(path.resolve(projectPath));
  try {
    await registry?.storageAdapter?.close();
  } catch {
    // HTTP server shutdown must still release the port if an extension close hook fails.
  }
}

async function listWorkspaces(
  projectPath: string,
  config: AgentgitopsConfig,
  tasks: TaskContract[],
): Promise<Workspace[]> {
  const root = path.resolve(projectPath, config.project.worktree_root);
  return Promise.all(
    tasks.map(async (task) => {
      const workspacePath = path.join(root, `${config.project.name}-${task.id}`);
      const exists = await pathExists(workspacePath);
      return {
        id: `ws_${task.id}`,
        taskId: task.id,
        projectId: task.projectId,
        path: workspacePath,
        branch: task.targetBranch,
        baseBranch: task.baseBranch,
        status: exists ? workspaceStatusFromTask(task.status) : "removed",
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };
    }),
  );
}

async function listChangePackages(projectPath: string): Promise<ChangePackage[]> {
  const packagesDir = path.join(projectPath, CONFIG_DIR, "packages");
  let files: string[];
  try {
    files = await fs.readdir(packagesDir);
  } catch {
    return [];
  }

  const packages = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => loadChangePackage(projectPath, file.replace(/\.json$/, ""))),
  );

  return packages
    .filter((pkg): pkg is ChangePackage => pkg !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function loadChangePackage(
  projectPath: string,
  taskId: string,
): Promise<ChangePackage | null> {
  const pkgPath = path.join(projectPath, CONFIG_DIR, "packages", `${taskId}.json`);
  try {
    const content = await fs.readFile(pkgPath, "utf-8");
    return JSON.parse(content) as ChangePackage;
  } catch {
    return null;
  }
}

async function saveChangePackage(
  projectPath: string,
  taskId: string,
  pkg: ChangePackage,
): Promise<void> {
  const pkgPath = path.join(projectPath, CONFIG_DIR, "packages", `${taskId}.json`);
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
}

async function listMergeQueue(projectPath: string): Promise<MergeQueueItem[]> {
  const tasks = await new TaskManager(projectPath).list();
  const reviewStore = new ReviewStore(projectPath);
  const gate = new MergeGate();
  const reviewing = tasks.filter(
    (task) => task.status === "reviewing" || task.status === "blocked",
  );

  return Promise.all(
    reviewing.map(async (task) => {
      const pkg = await loadChangePackage(projectPath, task.id);
      if (!pkg) {
        return {
          task,
          changePackage: null,
          gate: null,
        };
      }
      const reviews = await reviewStore.list(pkg.id);
      const gateResult = gate.evaluate({ task, changePackage: pkg, reviews });
      return {
        task,
        changePackage: pkg,
        gate: gateResult,
        prUrl: pkg.prUrl,
        prNumber: pkg.prNumber,
      };
    }),
  );
}

async function listConflicts(projectPath: string): Promise<ConflictSummary[]> {
  const packages = await listChangePackages(projectPath);
  return packages.flatMap((pkg) =>
    pkg.conflicts.map((conflict) => ({
      id: conflict.id,
      taskId: pkg.taskId,
      conflictingTaskId: conflict.conflictingTaskId,
      type: conflict.type,
      filePath: conflict.filePath,
      severity: conflict.severity,
      suggestion: conflict.suggestion,
      status: conflict.status,
      packageId: pkg.id,
    })),
  );
}

async function listAuditEvents(
  projectPath: string,
  filters: {
    taskId?: string;
    eventType?: string;
    actorId?: string;
    actorType?: "human" | "agent" | "system";
    createdFrom?: string;
    createdTo?: string;
    limit?: number;
  } = {},
): Promise<AuditEvent[]> {
  const config = await loadConfig(projectPath);
  return new AuditService(projectPath, config, getExtensionRegistry(projectPath)).list(filters);
}

function listWorkflowJobs(projectPath: string, requestUrl: URL): unknown[] {
  const taskId = requestUrl.searchParams.get("taskId") ?? undefined;
  const limitParam = requestUrl.searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const limit = parsedLimit && Number.isFinite(parsedLimit) ? parsedLimit : undefined;
  return new LocalProjectRepository(projectPath).listWorkflowJobs({ taskId, limit });
}

export async function buildAgentOpsMetrics(projectPath: string): Promise<AgentOpsMetrics> {
  const config = await loadConfig(projectPath);
  const tasks = await new TaskManager(projectPath).list();
  const packages = await listChangePackages(projectPath);
  const logs = await listLogs(projectPath);
  const mergeQueue = await listMergeQueue(projectPath);
  const audit = await listAuditEvents(projectPath);
  const metrics: Omit<AgentOpsMetrics, "history"> = {
    generatedAt: new Date().toISOString(),
    taskTotals: countBy(tasks, (task) => task.status),
    agentTotals: countBy(tasks, (task) => task.agentId),
    riskTotals: countBy(packages, (pkg) => pkg.risk.level),
    mergeGate: {
      queued: mergeQueue.length,
      allowed: mergeQueue.filter((item) => item.gate?.allowed).length,
      blocked: mergeQueue.filter((item) => item.gate && !item.gate.allowed).length,
      blockers: mergeQueue.reduce((sum, item) => sum + (item.gate?.blockers.length ?? 0), 0),
      warnings: mergeQueue.reduce((sum, item) => sum + (item.gate?.warnings.length ?? 0), 0),
    },
    logs: {
      taskDirectories: logs.length,
      files: logs.reduce((sum, log) => sum + log.files.length, 0),
    },
    audit: {
      total: audit.length,
      recent: audit.slice(0, 10),
    },
    trends: computeAgentOpsTrends(tasks),
    agentRanking: computeAgentRanking(tasks),
  };
  await recordAgentOpsSnapshot(projectPath, config, metrics);
  return {
    ...metrics,
    history: listAgentOpsSnapshots(projectPath),
  };
}

async function recordAgentOpsSnapshot(
  projectPath: string,
  config: AgentgitopsConfig,
  metrics: Omit<AgentOpsMetrics, "history">,
): Promise<void> {
  const db = new LocalDb(projectPath);
  try {
    const snapshotMetrics = {
      taskTotals: metrics.taskTotals,
      mergeGate: metrics.mergeGate,
      logs: metrics.logs,
      auditTotal: metrics.audit.total,
    };
    const latest = db.listAgentOpsSnapshots(1)[0];
    if (latest) {
      const latestAgeMs = Date.now() - Date.parse(latest.created_at);
      if (latestAgeMs < 60_000 && latest.metrics === JSON.stringify(snapshotMetrics)) return;
    }
    const snapshot = {
      id: `agentops_${randomUUID()}`,
      projectId: config.project.name,
      metrics: snapshotMetrics,
      createdAt: new Date().toISOString(),
    };
    db.insertAgentOpsSnapshot(snapshot);
    await getExtensionRegistry(projectPath)?.metricsSink?.record(snapshot);
  } finally {
    db.close();
  }
}

function listAgentOpsSnapshots(projectPath: string): AgentOpsSnapshot[] {
  const db = new LocalDb(projectPath);
  try {
    return db.listAgentOpsSnapshots(20).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      metrics: JSON.parse(row.metrics) as AgentOpsSnapshot["metrics"],
    }));
  } finally {
    db.close();
  }
}

/**
 * 计算趋势数据：基于任务列表按创建时间分组
 *
 * 由于历史快照可能不足，这里基于当前任务列表的 createdAt
 * 按天聚合，生成任务总数、合并数、失败数、阻塞数趋势。
 */
function computeAgentOpsTrends(tasks: TaskContract[]): AgentOpsTrends {
  if (tasks.length === 0) {
    return { taskCount: [], mergeRate: [], conflictRate: [] };
  }

  // 按天分组
  const byDay = new Map<string, TaskContract[]>();
  for (const task of tasks) {
    const day = task.createdAt.slice(0, 10); // YYYY-MM-DD
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(task);
  }

  const sortedDays = [...byDay.keys()].sort();
  const taskCount: AgentOpsTrendPoint[] = [];
  const mergeRate: AgentOpsTrendPoint[] = [];
  const conflictRate: AgentOpsTrendPoint[] = [];

  let cumulativeTotal = 0;
  let cumulativeMerged = 0;
  let cumulativeFailed = 0;
  let cumulativeBlocked = 0;

  for (const day of sortedDays) {
    const dayTasks = byDay.get(day)!;
    cumulativeTotal += dayTasks.length;
    cumulativeMerged += dayTasks.filter((t) => t.status === "merged").length;
    cumulativeFailed += dayTasks.filter((t) => t.status === "failed").length;
    cumulativeBlocked += dayTasks.filter((t) => t.status === "blocked").length;

    const timestamp = `${day}T00:00:00Z`;
    taskCount.push({
      timestamp,
      taskTotal: cumulativeTotal,
      merged: cumulativeMerged,
      failed: cumulativeFailed,
      blocked: cumulativeBlocked,
    });
    mergeRate.push({
      timestamp,
      taskTotal: cumulativeTotal,
      merged: cumulativeMerged,
      failed: cumulativeFailed,
      blocked: cumulativeBlocked,
    });
    const conflictCount = dayTasks.filter((t) => t.status === "blocked").length;
    conflictRate.push({
      timestamp,
      taskTotal: cumulativeTotal,
      merged: cumulativeMerged,
      failed: cumulativeFailed,
      blocked: conflictCount,
    });
  }

  return { taskCount, mergeRate, conflictRate };
}

/**
 * 计算 Agent 排行：按合并率、成功率、任务数排序
 */
function computeAgentRanking(tasks: TaskContract[]): AgentRankingEntry[] {
  const byAgent = new Map<string, TaskContract[]>();
  for (const task of tasks) {
    if (!byAgent.has(task.agentId)) byAgent.set(task.agentId, []);
    byAgent.get(task.agentId)!.push(task);
  }

  const entries: AgentRankingEntry[] = [];
  for (const [agentId, agentTasks] of byAgent) {
    const total = agentTasks.length;
    const merged = agentTasks.filter((t) => t.status === "merged").length;
    const failed = agentTasks.filter((t) => t.status === "failed").length;
    const blocked = agentTasks.filter((t) => t.status === "blocked").length;
    const successCount =
      merged +
      agentTasks.filter((t) => t.status === "reviewing" || t.status === "packaging").length;
    entries.push({
      agentId,
      totalTasks: total,
      merged,
      failed,
      blocked,
      mergeRate: total > 0 ? Math.round((merged / total) * 100) : 0,
      successRate: total > 0 ? Math.round((successCount / total) * 100) : 0,
    });
  }

  // 按合并率降序，其次按任务数降序
  entries.sort((a, b) => b.mergeRate - a.mergeRate || b.totalTasks - a.totalTasks);
  return entries;
}

function listAgentNotes(projectPath: string, taskId?: string): AgentNote[] {
  const db = new LocalDb(projectPath);
  try {
    return db.listAgentNotes(taskId);
  } finally {
    db.close();
  }
}

export async function buildReviewContext(
  projectPath: string,
  taskId: string,
): Promise<ReviewContext> {
  const task = await new TaskManager(projectPath).load(taskId);
  const changePackage = await loadChangePackage(projectPath, taskId);
  const reviews = changePackage ? await new ReviewStore(projectPath).list(changePackage.id) : [];
  const agentNotes = listAgentNotes(projectPath, taskId);
  const audit = (await listAuditEvents(projectPath, { taskId })).slice(-50);
  const checklist = buildReviewChecklist(task, changePackage, reviews, agentNotes);
  const checks = changePackage?.checks ?? [];
  const requestedChanges = reviews.filter(
    (review) =>
      review.action === "request_changes" ||
      review.action === "ask_agent_to_fix" ||
      review.action === "reject",
  ).length;

  return {
    task,
    changePackage,
    reviews,
    agentNotes,
    audit,
    checklist,
    summary: {
      riskLevel: changePackage?.risk.level ?? task.riskLevel,
      changedFiles: changePackage?.changedFiles.length ?? 0,
      checksFailed: checks.filter((check) => check.status === "failed").length,
      checksPassed: checks.filter((check) => check.status === "passed").length,
      openConflicts:
        changePackage?.conflicts.filter((conflict) => conflict.status === "open").length ?? 0,
      approvals: reviews.filter((review) => review.action === "approve").length,
      requestedChanges,
      latestNoteAt: agentNotes[0]?.createdAt,
      prUrl: changePackage?.prUrl,
    },
  };
}

function buildReviewChecklist(
  task: TaskContract,
  changePackage: ChangePackage | null,
  reviews: Review[],
  agentNotes: AgentNote[],
): ReviewContext["checklist"] {
  const checklist: ReviewContext["checklist"] = [];

  if (!changePackage) {
    checklist.push({
      severity: "blocker",
      title: "Change Package missing",
      detail:
        "Run agentgitops package <task-id> before review so the diff, risk, and checks are available.",
    });
    return checklist;
  }

  if (agentNotes.length === 0) {
    checklist.push({
      severity: "warning",
      title: "Agent handoff note missing",
      detail:
        "Ask the implementation agent to record summary, verification, review focus, and risks.",
    });
  }

  const openConflicts = changePackage.conflicts.filter((conflict) => conflict.status === "open");
  if (openConflicts.length > 0) {
    checklist.push({
      severity: "blocker",
      title: "Open conflicts",
      detail: `${openConflicts.length} conflict(s) remain open in the Change Package.`,
    });
  }

  const failedChecks = changePackage.checks.filter((check) => check.status === "failed");
  if (failedChecks.length > 0) {
    checklist.push({
      severity: "blocker",
      title: "Failed checks",
      detail: failedChecks.map((check) => check.name).join(", "),
    });
  }

  if (changePackage.unverifiedItems.length > 0) {
    checklist.push({
      severity: "warning",
      title: "Unverified items",
      detail: changePackage.unverifiedItems.join(", "),
    });
  }

  if (changePackage.risk.level === "high" || changePackage.risk.level === "critical") {
    checklist.push({
      severity: "warning",
      title: "High risk change",
      detail: `Risk domains: ${changePackage.risk.domains.join(", ") || "none recorded"}.`,
    });
  }

  if (changePackage.risk.violations.some((violation) => violation.severity === "error")) {
    checklist.push({
      severity: "blocker",
      title: "Policy violations",
      detail: "Fix error-level policy violations before approval.",
    });
  }

  const hasApproval = reviews.some((review) => review.action === "approve");
  if (task.approval.required && !hasApproval) {
    checklist.push({
      severity: "warning",
      title: "Approval missing",
      detail: "No approve review has been recorded yet.",
    });
  }

  const requestedChanges = reviews.filter(
    (review) =>
      review.action === "reject" ||
      review.action === "request_changes" ||
      review.action === "ask_agent_to_fix",
  );
  if (requestedChanges.length > 0) {
    checklist.push({
      severity: "blocker",
      title: "Reviewer requested changes",
      detail: requestedChanges.map((review) => `${review.reviewerId}: ${review.action}`).join(", "),
    });
  }

  if (!changePackage.prUrl) {
    checklist.push({
      severity: "info",
      title: "PR/MR not linked",
      detail: "Run agentgitops pr <task-id> when the package is ready for provider review.",
    });
  }

  if (checklist.length === 0) {
    checklist.push({
      severity: "info",
      title: "Review context is ready",
      detail: "Review the diff, Agent Notes, checks, and policy details before approving.",
    });
  }

  return checklist;
}

async function listLogs(projectPath: string): Promise<LogSummary[]> {
  const logsDir = path.join(projectPath, CONFIG_DIR, "logs");
  let entries: string[];
  try {
    entries = await fs.readdir(logsDir);
  } catch {
    return [];
  }

  const summaries = await Promise.all(
    entries.map(async (taskId) => {
      const taskLogDir = path.join(logsDir, taskId);
      const stat = await safeStat(taskLogDir);
      if (!stat?.isDirectory()) return null;
      const files = await fs.readdir(taskLogDir);
      const summary: LogSummary = {
        taskId,
        files,
        updatedAt: stat.mtime.toISOString(),
      };
      return summary;
    }),
  );

  return summaries
    .filter(isLogSummary)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

async function loadLogDetail(projectPath: string, taskId: string): Promise<LogDetail | null> {
  const logs = await listLogs(projectPath);
  const summary = logs.find((candidate) => candidate.taskId === taskId);
  if (!summary) return null;
  const logDir = path.join(projectPath, CONFIG_DIR, "logs", taskId);
  const fileDetails = await Promise.all(
    summary.files
      .filter((file) => !file.startsWith("."))
      .sort()
      .map(async (file) => {
        const filePath = path.join(logDir, file);
        const stat = await safeStat(filePath);
        return {
          name: file,
          content: await readTextTail(filePath),
          bytes: stat?.isFile() ? stat.size : 0,
        };
      }),
  );
  return {
    ...summary,
    stdout: await readTextTail(path.join(logDir, "agent-stdout.log")),
    stderr: await readTextTail(path.join(logDir, "agent-stderr.log")),
    fileDetails,
  };
}

function buildDashboard(
  config: AgentgitopsConfig,
  tasks: TaskContract[],
  packages: ChangePackage[],
  workspaces: Workspace[],
): DashboardSummary {
  const activeStatuses: TaskStatus[] = [
    "created",
    "workspace_created",
    "running",
    "testing",
    "packaging",
    "reviewing",
    "blocked",
  ];
  const today = new Date().toISOString().slice(0, 10);

  return {
    projectId: config.project.name,
    activeTaskCount: tasks.filter((task) => activeStatuses.includes(task.status)).length,
    activeWorkspaceCount: workspaces.filter((workspace) => workspace.status !== "removed").length,
    pendingReviewCount: tasks.filter((task) => task.status === "reviewing").length,
    conflictRiskCount: packages.reduce((count, pkg) => count + pkg.conflicts.length, 0),
    mergeQueueCount: tasks.filter((task) => task.status === "reviewing").length,
    highRiskChangeCount: packages.filter(
      (pkg) => pkg.risk.level === "high" || pkg.risk.level === "critical",
    ).length,
    ciFailedCount: packages.filter((pkg) => pkg.checks.some((check) => check.status === "failed"))
      .length,
    recentMerged: tasks.filter(
      (task) => task.status === "merged" && task.updatedAt.startsWith(today),
    ),
  };
}

async function buildDashboardSnapshot(projectPath: string): Promise<DashboardSummary> {
  const config = await loadConfig(projectPath);
  const tasks = await new TaskManager(projectPath).list();
  const packages = await listChangePackages(projectPath);
  const workspaces = await listWorkspaces(projectPath, config, tasks);
  return buildDashboard(config, tasks, packages, workspaces);
}

function workspaceStatusFromTask(status: TaskStatus): Workspace["status"] {
  if (status === "merged" || status === "canceled") return "archived";
  if (status === "failed") return "dirty";
  return "created";
}

function workspacePathFor(
  projectPath: string,
  config: AgentgitopsConfig,
  task: TaskContract,
): string {
  return path.join(
    path.resolve(projectPath, config.project.worktree_root),
    `${config.project.name}-${task.id}`,
  );
}

async function resolveDiffWorkspacePath(
  projectPath: string,
  config: AgentgitopsConfig,
  task: TaskContract,
): Promise<string> {
  const workspacePath = workspacePathFor(projectPath, config, task);
  if (await pathExists(workspacePath)) return workspacePath;

  try {
    const currentBranch = await new GitService(projectPath).getCurrentBranch();
    if (currentBranch === task.targetBranch) return projectPath;
  } catch {
    // Fall through to the standard missing-workspace error.
  }

  throw new Error(
    `Workspace not found for ${task.id}: ${workspacePath}. Current repository can be used only when checked out to ${task.targetBranch}.`,
  );
}

function workflowRecoveryHints(
  action: "start" | "run" | "test" | "package" | "pr",
  error: unknown,
  provider: string,
): string[] {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("token") ||
    message.includes("GITHUB_TOKEN") ||
    message.includes("GITLAB_TOKEN")
  ) {
    return tokenRecoveryHints(provider);
  }
  if (message.includes("Workspace not found")) {
    return [
      "Run the Start workspace action first.",
      "Or switch this repository to the task branch before generating the Change Package.",
      "If the worktree was deleted manually, recreate it from the task board.",
    ];
  }
  if (message.includes("Change Package")) {
    return ["Run tests if required.", "Run the Package action to regenerate the Change Package."];
  }
  if (message.includes("Agent not found")) {
    return ["Register or enable the task agent with agentgitops agent register."];
  }
  if (action === "pr") {
    return providerRecoveryHints(provider);
  }
  return ["Check the task logs and audit events for the failed action."];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeStat(filePath: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function readTextTail(filePath: string, maxBytes = 200_000): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    const handle = await fs.open(filePath, "r");
    try {
      const length = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
      return buffer.toString("utf-8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

async function readRequestBody(req: http.IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const body = await readRequestBody(req);
  return JSON.parse(body) as T;
}

async function readOptionalJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const body = await readRequestBody(req);
  if (!body.trim()) return {} as T;
  return JSON.parse(body) as T;
}

async function recordAudit(
  projectPath: string,
  config: AgentgitopsConfig,
  eventType: string,
  payload: unknown,
  taskId?: string,
  actorId?: string,
): Promise<void> {
  await new AuditService(projectPath, config, getExtensionRegistry(projectPath)).record(
    eventType,
    payload,
    taskId,
    actorId,
  );
}

function recordTeamSync(
  projectPath: string,
  handler: (producer: TeamSyncEventProducer) => void,
): void {
  const producer = new TeamSyncEventProducer(projectPath);
  try {
    handler(producer);
  } finally {
    producer.close();
  }
}

function getExtensionRegistry(projectPath: string): ExtensionRegistry | undefined {
  return serverExtensionRegistries.get(path.resolve(projectPath));
}

async function broadcastGovernanceChanged(projectPath: string, events: EventBroker): Promise<void> {
  events.broadcast("data.changed", { source: "server", timestamp: new Date().toISOString() });
  events.broadcast("dashboard.snapshot", await buildDashboardSnapshot(projectPath));
}

function resolveActor(
  config: AgentgitopsConfig,
  req: http.IncomingMessage,
  actorId?: string,
): WebActor {
  const enterpriseUser = enterpriseRequestUsers.get(req);
  if (enterpriseUser) {
    const roles = new Set(enterpriseUser.roles);
    const role: WebActor["role"] =
      roles.has("admin") || roles.has("owner")
        ? "owner"
        : roles.has("reviewer")
          ? "reviewer"
          : roles.has("developer")
            ? "developer"
            : "viewer";
    return { id: enterpriseUser.userId, role };
  }
  const id =
    actorId?.trim() ||
    headerValue(req.headers["x-agentgitops-actor"]) ||
    process.env.USER ||
    "local-user";
  const webSecurity = config.security?.web;
  const owners = new Set([...(webSecurity?.owners ?? []), process.env.USER ?? "local-user"]);
  const reviewers = new Set([
    ...(webSecurity?.reviewers ?? []),
    ...Object.values(config.policies?.approval?.required_reviewers ?? {}).flat(),
  ]);
  if (owners.has(id)) return { id, role: "owner" };
  if (reviewers.has(id)) return { id, role: "reviewer" };
  return { id, role: webSecurity?.require_actor === false ? "reviewer" : "viewer" };
}

interface EnterpriseAuthorizationTarget {
  resource: string;
  action: string;
}

export function resolveEnterpriseAuthorizationTarget(
  pathname: string,
  method: string,
): EnterpriseAuthorizationTarget {
  if (pathname.startsWith("/api/merge-queue")) {
    const action = pathname.split("/").at(-1);
    return {
      resource: "merge",
      action: method === "GET" ? "read" : action === "evaluate" ? "read" : (action ?? "approve"),
    };
  }
  if (pathname.startsWith("/api/conflicts")) {
    const routeAction = pathname.split("/").at(-1);
    const action =
      routeAction === "false-positive" ? "mark_false_positive" : routeAction?.replaceAll("-", "_");
    return { resource: "conflict", action: method === "GET" ? "read" : (action ?? "resolve") };
  }
  if (pathname.includes("/reviews"))
    return { resource: "review", action: method === "GET" ? "read" : "submit" };
  if (pathname.includes("/notes"))
    return { resource: "task", action: method === "GET" ? "read" : "update" };
  if (pathname.startsWith("/api/tasks")) {
    const action = pathname.split("/").at(-1);
    if (method === "GET") return { resource: "task", action: "read" };
    if (pathname === "/api/tasks") return { resource: "task", action: "create" };
    return {
      resource: action === "package" || action === "pr" ? "change_package" : "task",
      action: action ?? "update",
    };
  }
  if (pathname.startsWith("/api/workflow-jobs"))
    return { resource: "task", action: method === "GET" ? "read" : "update" };
  if (pathname.startsWith("/api/audit")) return { resource: "audit", action: "read" };
  if (pathname.startsWith("/api/agentops")) return { resource: "agentops", action: "read" };
  if (pathname.startsWith("/api/team") || pathname.startsWith("/api/sync")) {
    return { resource: "team", action: method === "GET" ? "read" : "update" };
  }
  if (pathname.startsWith("/api/workspaces"))
    return { resource: "workspace", action: method === "GET" ? "read" : "update" };
  if (pathname.startsWith("/api/change-packages") || pathname.startsWith("/api/review-context")) {
    return { resource: "change_package", action: "read" };
  }
  return { resource: "project", action: method === "GET" ? "read" : "update" };
}

async function enforceEnterpriseRequestAccess(
  projectPath: string,
  req: http.IncomingMessage,
  pathname: string,
  method: string,
  res: http.ServerResponse,
): Promise<boolean> {
  if (
    pathname === "/api/health" ||
    pathname === "/api/webhooks/github" ||
    pathname.startsWith("/api/sync/")
  ) {
    return true;
  }

  const registry = serverExtensionRegistries.get(path.resolve(projectPath));
  const identityProvider = registry?.identityProvider;
  const authorizationProvider = registry?.authorizationProvider;
  if (!identityProvider || identityProvider.constructor.name.startsWith("Ce")) return true;

  const authorization = headerValue(req.headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!match?.[1]) {
    sendError(res, 401, "UNAUTHENTICATED", "A valid Bearer token is required");
    return false;
  }

  const user = await identityProvider.authenticate(match[1]);
  if (!user) {
    sendError(res, 401, "UNAUTHENTICATED", "Bearer token validation failed");
    return false;
  }
  enterpriseRequestUsers.set(req, user);

  if (!authorizationProvider) {
    sendError(
      res,
      503,
      "AUTHORIZATION_UNAVAILABLE",
      "Enterprise authorization provider is unavailable",
    );
    return false;
  }

  const config = await loadConfig(projectPath);
  const target = resolveEnterpriseAuthorizationTarget(pathname, method);
  const result = await authorizationProvider.checkPermission({
    user,
    resource: target.resource,
    action: target.action,
    projectId: config.project.name,
  });
  if (!result.allowed) {
    sendError(
      res,
      403,
      "FORBIDDEN",
      result.reason ?? `Permission denied: ${target.resource}.${target.action}`,
    );
    return false;
  }
  return true;
}

function parseAuditActorType(value: string | null): "human" | "agent" | "system" | undefined {
  if (value === "human" || value === "agent" || value === "system") return value;
  return undefined;
}

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function authorize(
  actor: WebActor,
  permission: "view" | "note" | "review" | "merge-local" | "admin",
): boolean {
  if (permission === "view") return true;
  if (actor.role === "owner") return true;
  if (actor.role === "reviewer")
    return permission === "note" || permission === "review" || permission === "merge-local";
  return false;
}

function authorizeRequest(
  req: http.IncomingMessage,
  actor: WebActor,
  permission: "view" | "note" | "review" | "merge-local" | "admin",
): boolean {
  // Enterprise requests already passed the route-specific RBAC check before
  // reaching a handler. Reapplying the coarser CE role model would either deny
  // legitimate developers or accidentally promote them to reviewers.
  return enterpriseRequestUsers.has(req) || authorize(actor, permission);
}

function mergeActionPermission(
  action: "evaluate" | "approve" | "block",
  body: { localOnly?: boolean; dryRun?: boolean },
): "view" | "merge-local" | "admin" {
  if (action === "evaluate" || body.dryRun) return "view";
  if (action === "approve" && body.localOnly) return "merge-local";
  return "admin";
}

function conflictActionPermission(action: ConflictAction): "review" | "admin" {
  if (action === "resolve" || action === "false-positive") return "review";
  return "admin";
}

export function applyConflictAction(
  conflict: ChangePackageConflict,
  action: ConflictAction,
  actionCompleted = true,
): void {
  switch (action) {
    case "resolve":
      conflict.status = "resolved";
      break;
    case "false-positive":
      conflict.status = "resolved";
      conflict.suggestion = "mark_false_positive";
      break;
    case "rebase":
      conflict.status = actionCompleted ? "resolved" : "open";
      conflict.suggestion = "rebase";
      break;
    case "human-takeover":
      conflict.status = "open";
      conflict.suggestion = "human_takeover";
      break;
  }
}

function conflictAuditType(action: ConflictAction): string {
  if (action === "resolve" || action === "false-positive") return "conflict.resolved";
  if (action === "rebase") return "conflict.rebase_requested";
  return "conflict.human_takeover_requested";
}

async function executeConflictRebase(
  projectPath: string,
  config: AgentgitopsConfig,
  task: TaskContract,
): Promise<ConflictActionResult> {
  const workspacePath = workspacePathFor(projectPath, config, task);
  if (!(await pathExists(workspacePath))) {
    return {
      status: "failed",
      command: "git rebase",
      error: `Workspace not found for ${task.id}: ${workspacePath}`,
      recovery: [
        "Run the Start workspace action before rebasing the task branch.",
        "If the worktree was deleted manually, recreate it from the task board.",
      ],
    };
  }

  const remote = config.git.remote || "origin";
  const fetch = await runCrossPlatformCommand("git", ["fetch", remote, task.baseBranch], {
    cwd: workspacePath,
    timeoutMs: 120_000,
  });
  if (fetch.exitCode !== 0) {
    return {
      status: "failed",
      command: `git fetch ${remote} ${task.baseBranch}`,
      output: truncateAuditOutput(fetch.stdout),
      error: truncateAuditOutput(fetch.stderr || `git fetch exited with ${fetch.exitCode}`),
      recovery: [
        "Confirm the configured remote and base branch are reachable.",
        "Check provider credentials and network access for the server process.",
      ],
    };
  }

  const baseRef = `${remote}/${task.baseBranch}`;
  const rebase = await runCrossPlatformCommand("git", ["rebase", baseRef], {
    cwd: workspacePath,
    timeoutMs: 120_000,
  });
  if (rebase.exitCode === 0) {
    return {
      status: "completed",
      command: `git rebase ${baseRef}`,
      output: truncateAuditOutput(rebase.stdout || rebase.stderr),
    };
  }

  const abort = await runCrossPlatformCommand("git", ["rebase", "--abort"], {
    cwd: workspacePath,
    timeoutMs: 30_000,
  }).catch((error: unknown) => ({
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
    exitCode: 1,
  }));
  const abortMessage =
    abort.exitCode === 0
      ? "Rebase was aborted after failure."
      : `Rebase failed and abort did not complete: ${truncateAuditOutput(abort.stderr)}`;
  return {
    status: "failed",
    command: `git rebase ${baseRef}`,
    output: truncateAuditOutput(rebase.stdout),
    error: truncateAuditOutput(
      `${rebase.stderr || `git rebase exited with ${rebase.exitCode}`}\n${abortMessage}`,
    ),
    recovery: [
      "Open the task workspace and resolve conflicts manually.",
      "Run checks again after a successful manual rebase.",
      "Use Human takeover if the agent branch requires manual ownership.",
    ],
  };
}

function truncateAuditOutput(value: string | undefined, limit = 4000): string | undefined {
  if (!value) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}\n...<truncated>` : value;
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function normalizeStringList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function normalizeOptionalStringList(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  return normalizeStringList(values);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function getProviderToken(provider: string): Promise<string | undefined> {
  if (provider === "github") {
    return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? (await getGitHubCliToken());
  }
  if (provider === "gitlab") return process.env.GITLAB_TOKEN;
  return undefined;
}

async function getGitHubCliToken(): Promise<string | undefined> {
  try {
    const result = await execFileAsync("gh", ["auth", "token"], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function missingTokenMessage(provider: string): string {
  if (provider === "github")
    return "Missing GitHub token. Set GITHUB_TOKEN/GH_TOKEN or run gh auth login.";
  if (provider === "gitlab") return "Missing GitLab token. Set GITLAB_TOKEN.";
  return `Missing token for provider: ${provider}`;
}

function tokenRecoveryHints(provider: string): string[] {
  if (provider === "github") {
    return [
      "Set GITHUB_TOKEN or GH_TOKEN for the server process.",
      "Alternatively run gh auth login so the server can resolve gh auth token at runtime.",
      "For fine-grained tokens, grant Metadata read, Contents read/write, and Pull requests read/write.",
    ];
  }
  if (provider === "gitlab")
    return [
      "Set GITLAB_TOKEN for the server process.",
      "Confirm GITLAB_HOST when using a self-hosted GitLab instance.",
    ];
  return ["Configure a supported provider before running provider merge."];
}

function providerRecoveryHints(provider: string): string[] {
  if (provider === "github") {
    return [
      "Confirm the PR is open and mergeable.",
      "Check branch protection, required checks, and token Pull requests/Contents permissions.",
      "Retry the same action; provider merge is idempotent once the PR is already merged.",
    ];
  }
  if (provider === "gitlab") {
    return [
      "Confirm the MR is open and mergeable.",
      "Check protected branches, required pipelines, and token API permissions.",
      "Retry after the provider reports the MR can be merged.",
    ];
  }
  return ["Use local-only approval or configure a supported provider."];
}

function recoveryHintsForGate(gate: MergeGateResult, pkg: ChangePackage): string[] {
  const hints = new Set<string>();
  if (gate.blockers.some((blocker) => blocker.includes("conflict"))) {
    hints.add("Open Conflict Center and resolve, rebase, or escalate open conflicts.");
  }
  if (gate.blockers.some((blocker) => blocker.includes("Verification"))) {
    hints.add("Rerun failed verification checks and regenerate the Change Package.");
  }
  if (gate.blockers.some((blocker) => blocker.includes("approval") || blocker.includes("review"))) {
    hints.add("Submit an approve review from Change Package detail or the CLI.");
  }
  if (pkg.risk.violations.some((violation) => violation.severity === "error")) {
    hints.add("Fix policy error violations before retrying merge.");
  }
  if (pkg.risk.forbiddenFilesTouched) {
    hints.add("Remove forbidden file changes or update policy explicitly.");
  }
  return [...hints];
}

async function getProviderRepository(
  projectPath: string,
  config: AgentgitopsConfig,
): Promise<string> {
  const remoteUrl = await new GitService(projectPath).getRemoteUrl(config.git.remote);
  if (config.git.provider === "github") return parseGitHubRepository(remoteUrl);
  if (config.git.provider === "gitlab") return parseGitLabRepository(remoteUrl);
  throw new Error(`Unsupported git provider: ${config.git.provider}`);
}

function normalizeGitHubMergeMethod(
  strategy: string | undefined,
  squashOption: boolean | undefined,
  taskSquash: boolean | undefined,
): GitHubMergeMethod {
  if (strategy) {
    if (strategy === "merge" || strategy === "squash" || strategy === "rebase") return strategy;
    throw new Error(`Unsupported GitHub merge strategy: ${strategy}`);
  }
  return (squashOption ?? taskSquash ?? true) ? "squash" : "merge";
}

async function collectStateSignature(projectPath: string): Promise<string> {
  const configDir = path.join(projectPath, CONFIG_DIR);
  const parts: string[] = [];
  await collectStateParts(configDir, parts, 0);
  return parts.sort().join("|");
}

async function collectStateParts(dir: string, parts: string[], depth: number): Promise<void> {
  if (depth > 5) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    parts.push(`${dir}:missing`);
    return;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const entryPath = path.join(dir, entry.name);
    const stat = await safeStat(entryPath);
    if (!stat) continue;
    parts.push(`${entryPath}:${stat.mtimeMs}:${stat.size}`);
    if (entry.isDirectory()) await collectStateParts(entryPath, parts, depth + 1);
  }
}

function isReviewAction(action: string): action is ReviewAction {
  return [
    "approve",
    "reject",
    "request_changes",
    "ask_agent_to_fix",
    "escalate",
    "mark_high_risk",
    "add_required_check",
  ].includes(action);
}

function statusAfterReview(action: ReviewAction): TaskStatus {
  switch (action) {
    case "approve":
      return "reviewing";
    case "request_changes":
    case "ask_agent_to_fix":
      return "running";
    case "reject":
      return "failed";
    case "escalate":
    case "mark_high_risk":
    case "add_required_check":
      return "blocked";
    default:
      return "reviewing";
  }
}

export function verifyGitHubSignature(secret: string, body: string, signature: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function writeSse(res: http.ServerResponse, event: string, data: unknown, id?: number): void {
  if (id !== undefined) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function isLogSummary(summary: LogSummary | null): summary is LogSummary {
  return summary !== null;
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

if (process.argv[1] === __filename) {
  const started = await startAgentGitOpsServer();
  console.log(`agentgitops server listening on ${started.url}`);
}
