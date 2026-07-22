import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { AgentNote, TaskContract, TaskStatus } from "@agentgitops/core";
import { CONFIG_DIR, DB_FILENAME } from "@agentgitops/core";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

/**
 * LocalDb - 本地 SQLite 存储（使用 Node 24 内置 node:sqlite）
 *
 * 存储 tasks、workspaces、agent_sessions、change_packages、audit_events
 */
export class LocalDb {
  private db: import("node:sqlite").DatabaseSync;

  constructor(projectPath: string) {
    const dbDir = path.join(projectPath, CONFIG_DIR);
    const dbPath = path.join(dbDir, DB_FILENAME);
    fs.mkdirSync(dbDir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.init();
  }

  /** 初始化表结构 */
  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL,
        title           TEXT NOT NULL,
        objective       TEXT NOT NULL,
        background      TEXT,
        base_branch     TEXT NOT NULL,
        target_branch   TEXT NOT NULL,
        agent_id        TEXT NOT NULL,
        allowed_paths   TEXT,
        forbidden_paths TEXT,
        required_checks TEXT,
        risk_level      TEXT NOT NULL,
        risk_domains    TEXT,
        approval_required INTEGER NOT NULL DEFAULT 1,
        approval_reviewers TEXT,
        merge_strategy  TEXT NOT NULL DEFAULT 'manual',
        merge_squash    INTEGER,
        status          TEXT NOT NULL DEFAULT 'created',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);

      CREATE TABLE IF NOT EXISTS workspaces (
        id          TEXT PRIMARY KEY,
        task_id     TEXT NOT NULL,
        project_id  TEXT NOT NULL,
        path        TEXT NOT NULL,
        branch      TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'created',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_task ON workspaces(task_id);

      CREATE TABLE IF NOT EXISTS agent_sessions (
        id           TEXT PRIMARY KEY,
        task_id      TEXT NOT NULL,
        agent_id     TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        command      TEXT NOT NULL,
        started_at   TEXT NOT NULL,
        ended_at     TEXT,
        exit_code    INTEGER,
        status       TEXT NOT NULL DEFAULT 'running',
        log_path     TEXT
      );

      CREATE TABLE IF NOT EXISTS change_packages (
        id          TEXT PRIMARY KEY,
        task_id     TEXT NOT NULL,
        project_id  TEXT NOT NULL,
        summary     TEXT,
        changed_files TEXT,
        insertions  INTEGER DEFAULT 0,
        deletions   INTEGER DEFAULT 0,
        risk_level  TEXT,
        pr_url      TEXT,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        task_id     TEXT,
        actor_type  TEXT NOT NULL,
        actor_id    TEXT NOT NULL,
        event_type  TEXT NOT NULL,
        payload     TEXT,
        created_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(event_type);

      CREATE TABLE IF NOT EXISTS agentops_snapshots (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        metrics     TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agentops_project ON agentops_snapshots(project_id, created_at);

      CREATE TABLE IF NOT EXISTS agent_notes (
        id            TEXT PRIMARY KEY,
        task_id       TEXT NOT NULL,
        agent_id      TEXT NOT NULL,
        summary       TEXT NOT NULL,
        files         TEXT,
        verification  TEXT,
        review_focus  TEXT,
        risks         TEXT,
        commit_sha    TEXT,
        pr_url        TEXT,
        created_at    TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_notes_task ON agent_notes(task_id, created_at);

      CREATE TABLE IF NOT EXISTS workflow_jobs (
        id            TEXT PRIMARY KEY,
        action        TEXT NOT NULL,
        task_id       TEXT,
        actor_id      TEXT,
        source        TEXT NOT NULL,
        status        TEXT NOT NULL,
        retry_of      TEXT,
        attempt       INTEGER NOT NULL DEFAULT 1,
        max_attempts  INTEGER NOT NULL DEFAULT 1,
        payload       TEXT,
        result        TEXT,
        error         TEXT,
        created_at    TEXT NOT NULL,
        started_at    TEXT,
        completed_at  TEXT,
        updated_at    TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_jobs_task ON workflow_jobs(task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_jobs_status ON workflow_jobs(status, created_at);
    `);
    this.ensureColumn("workflow_jobs", "retry_of", "TEXT");
    this.ensureColumn("workflow_jobs", "attempt", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("workflow_jobs", "max_attempts", "INTEGER NOT NULL DEFAULT 1");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
      name: string;
    }>;
    if (rows.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  // ===== Task CRUD =====

  insertTask(task: TaskContract): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, project_id, title, objective, background, base_branch,
        target_branch, agent_id, allowed_paths, forbidden_paths, required_checks,
        risk_level, risk_domains, approval_required, approval_reviewers,
        merge_strategy, merge_squash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id,
      task.projectId,
      task.title,
      task.objective,
      task.background ?? null,
      task.baseBranch,
      task.targetBranch,
      task.agentId,
      JSON.stringify(task.allowedPaths),
      JSON.stringify(task.forbiddenPaths),
      JSON.stringify(task.requiredChecks),
      task.riskLevel,
      task.riskDomains ? JSON.stringify(task.riskDomains) : null,
      task.approval.required ? 1 : 0,
      task.approval.reviewers ? JSON.stringify(task.approval.reviewers) : null,
      task.merge.strategy,
      task.merge.squash ? 1 : 0,
      task.status,
      task.createdAt,
      task.updatedAt,
    );
  }

  upsertTask(task: TaskContract): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, project_id, title, objective, background, base_branch,
        target_branch, agent_id, allowed_paths, forbidden_paths, required_checks,
        risk_level, risk_domains, approval_required, approval_reviewers,
        merge_strategy, merge_squash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        objective = excluded.objective,
        background = excluded.background,
        base_branch = excluded.base_branch,
        target_branch = excluded.target_branch,
        agent_id = excluded.agent_id,
        allowed_paths = excluded.allowed_paths,
        forbidden_paths = excluded.forbidden_paths,
        required_checks = excluded.required_checks,
        risk_level = excluded.risk_level,
        risk_domains = excluded.risk_domains,
        approval_required = excluded.approval_required,
        approval_reviewers = excluded.approval_reviewers,
        merge_strategy = excluded.merge_strategy,
        merge_squash = excluded.merge_squash,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      task.id,
      task.projectId,
      task.title,
      task.objective,
      task.background ?? null,
      task.baseBranch,
      task.targetBranch,
      task.agentId,
      JSON.stringify(task.allowedPaths),
      JSON.stringify(task.forbiddenPaths),
      JSON.stringify(task.requiredChecks),
      task.riskLevel,
      task.riskDomains ? JSON.stringify(task.riskDomains) : null,
      task.approval.required ? 1 : 0,
      task.approval.reviewers ? JSON.stringify(task.approval.reviewers) : null,
      task.merge.strategy,
      task.merge.squash ? 1 : 0,
      task.status,
      task.createdAt,
      task.updatedAt,
    );
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const stmt = this.db.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`);
    stmt.run(status, new Date().toISOString(), taskId);
  }

  getTask(taskId: string): TaskContract | null {
    const stmt = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`);
    const row = stmt.get(taskId) as unknown as TaskRow | undefined;
    if (!row) return null;
    return this.rowToTask(row);
  }

  listTasks(): TaskContract[] {
    const stmt = this.db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`);
    const rows = stmt.all() as unknown as TaskRow[];
    return rows.map((r) => this.rowToTask(r));
  }

  private rowToTask(row: TaskRow): TaskContract {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      objective: row.objective,
      background: row.background ?? undefined,
      baseBranch: row.base_branch,
      targetBranch: row.target_branch,
      agentId: row.agent_id,
      allowedPaths: JSON.parse(row.allowed_paths ?? "[]"),
      forbiddenPaths: JSON.parse(row.forbidden_paths ?? "[]"),
      requiredChecks: JSON.parse(row.required_checks ?? "[]"),
      riskLevel: row.risk_level as TaskContract["riskLevel"],
      riskDomains: row.risk_domains ? JSON.parse(row.risk_domains) : undefined,
      approval: {
        required: row.approval_required === 1,
        reviewers: row.approval_reviewers ? JSON.parse(row.approval_reviewers) : undefined,
      },
      merge: {
        strategy: row.merge_strategy as "auto" | "manual",
        squash: row.merge_squash === 1,
      },
      status: row.status as TaskStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ===== Audit =====

  insertAuditEvent(event: {
    id: string;
    projectId: string;
    taskId?: string;
    actorType: "human" | "agent" | "system";
    actorId: string;
    eventType: string;
    payload?: unknown;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_events (id, project_id, task_id, actor_type, actor_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.projectId,
      event.taskId ?? null,
      event.actorType,
      event.actorId,
      event.eventType,
      event.payload ? JSON.stringify(event.payload) : null,
      new Date().toISOString(),
    );
  }

  listAuditEvents(filters: AuditEventQuery | string = {}): AuditEventRow[] {
    const query =
      typeof filters === "string" ? { taskId: filters, order: "asc" as const } : filters;
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.taskId) {
      where.push("task_id = ?");
      params.push(query.taskId);
    }
    if (query.eventType) {
      where.push("event_type = ?");
      params.push(query.eventType);
    }
    if (query.actorId) {
      where.push("actor_id = ?");
      params.push(query.actorId);
    }
    if (query.actorType) {
      where.push("actor_type = ?");
      params.push(query.actorType);
    }
    if (query.createdFrom) {
      where.push("created_at >= ?");
      params.push(query.createdFrom);
    }
    if (query.createdTo) {
      where.push("created_at <= ?");
      params.push(query.createdTo);
    }
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const order = query.order === "asc" ? "ASC" : "DESC";
    const stmt = this.db.prepare(
      `SELECT * FROM audit_events${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at ${order} LIMIT ?`,
    );
    return stmt.all(...params, limit) as unknown as AuditEventRow[];
  }

  insertAgentOpsSnapshot(snapshot: { id: string; projectId: string; metrics: unknown }): void {
    const stmt = this.db.prepare(`
      INSERT INTO agentops_snapshots (id, project_id, metrics, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(
      snapshot.id,
      snapshot.projectId,
      JSON.stringify(snapshot.metrics),
      new Date().toISOString(),
    );
  }

  listAgentOpsSnapshots(limit = 20): AgentOpsSnapshotRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM agentops_snapshots ORDER BY created_at DESC LIMIT ?`,
    );
    return stmt.all(limit) as unknown as AgentOpsSnapshotRow[];
  }

  insertAgentNote(note: Omit<AgentNote, "createdAt">): AgentNote {
    const createdAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO agent_notes (
        id, task_id, agent_id, summary, files, verification, review_focus,
        risks, commit_sha, pr_url, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      note.id,
      note.taskId,
      note.agentId,
      note.summary,
      JSON.stringify(note.files),
      JSON.stringify(note.verification),
      JSON.stringify(note.reviewFocus),
      JSON.stringify(note.risks),
      note.commitSha ?? null,
      note.prUrl ?? null,
      createdAt,
    );
    return { ...note, createdAt };
  }

  listAgentNotes(taskId?: string): AgentNote[] {
    const rows = taskId
      ? this.db
          .prepare(`SELECT * FROM agent_notes WHERE task_id = ? ORDER BY created_at DESC`)
          .all(taskId)
      : this.db.prepare(`SELECT * FROM agent_notes ORDER BY created_at DESC LIMIT 100`).all();
    return (rows as unknown as AgentNoteRow[]).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      agentId: row.agent_id,
      summary: row.summary,
      files: JSON.parse(row.files ?? "[]"),
      verification: JSON.parse(row.verification ?? "[]"),
      reviewFocus: JSON.parse(row.review_focus ?? "[]"),
      risks: JSON.parse(row.risks ?? "[]"),
      commitSha: row.commit_sha ?? undefined,
      prUrl: row.pr_url ?? undefined,
      createdAt: row.created_at,
    }));
  }

  insertWorkflowJob(input: {
    id: string;
    action: string;
    taskId?: string;
    actorId?: string;
    source: string;
    payload?: unknown;
    retryOf?: string;
    attempt?: number;
    maxAttempts?: number;
  }): WorkflowJobRow {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO workflow_jobs (
        id, action, task_id, actor_id, source, status, retry_of, attempt, max_attempts, payload,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      input.id,
      input.action,
      input.taskId ?? null,
      input.actorId ?? null,
      input.source,
      "queued",
      input.retryOf ?? null,
      input.attempt ?? 1,
      input.maxAttempts ?? 1,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      now,
      now,
    );
    const job = this.getWorkflowJob(input.id);
    if (!job) throw new Error(`Workflow job was not created: ${input.id}`);
    return job;
  }

  updateWorkflowJob(input: {
    id: string;
    status: WorkflowJobStatus;
    result?: unknown;
    error?: string;
    startedAt?: string;
    completedAt?: string;
  }): WorkflowJobRow {
    const stmt = this.db.prepare(`
      UPDATE workflow_jobs
      SET status = ?,
          result = ?,
          error = ?,
          started_at = COALESCE(?, started_at),
          completed_at = COALESCE(?, completed_at),
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(
      input.status,
      input.result === undefined ? null : JSON.stringify(input.result),
      input.error ?? null,
      input.startedAt ?? null,
      input.completedAt ?? null,
      new Date().toISOString(),
      input.id,
    );
    const job = this.getWorkflowJob(input.id);
    if (!job) throw new Error(`Workflow job not found: ${input.id}`);
    return job;
  }

  getWorkflowJob(jobId: string): WorkflowJobRow | null {
    const stmt = this.db.prepare(`SELECT * FROM workflow_jobs WHERE id = ?`);
    return stmt.get(jobId) as unknown as WorkflowJobRow | null;
  }

  listWorkflowJobs(options: { taskId?: string; limit?: number } = {}): WorkflowJobRow[] {
    const limit = options.limit ?? 50;
    if (options.taskId) {
      const stmt = this.db.prepare(
        `SELECT * FROM workflow_jobs WHERE task_id = ? ORDER BY created_at DESC LIMIT ?`,
      );
      return stmt.all(options.taskId, limit) as unknown as WorkflowJobRow[];
    }
    const stmt = this.db.prepare(`SELECT * FROM workflow_jobs ORDER BY created_at DESC LIMIT ?`);
    return stmt.all(limit) as unknown as WorkflowJobRow[];
  }

  recoverRunningWorkflowJobs(input: { olderThanIso: string; error: string }): WorkflowJobRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM workflow_jobs WHERE status = 'running' AND updated_at < ?`)
      .all(input.olderThanIso) as unknown as WorkflowJobRow[];
    const stmt = this.db.prepare(`
      UPDATE workflow_jobs
      SET status = 'failed',
          error = ?,
          completed_at = ?,
          updated_at = ?
      WHERE id = ?
    `);
    const now = new Date().toISOString();
    for (const row of rows) stmt.run(input.error, now, now, row.id);
    return rows
      .map((row) => this.getWorkflowJob(row.id))
      .filter((row): row is WorkflowJobRow => row !== null);
  }

  close(): void {
    this.db.close();
  }
}

export type WorkflowJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface AuditEventQuery {
  taskId?: string;
  eventType?: string;
  actorId?: string;
  actorType?: "human" | "agent" | "system";
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  order?: "asc" | "desc";
}

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  objective: string;
  background: string | null;
  base_branch: string;
  target_branch: string;
  agent_id: string;
  allowed_paths: string | null;
  forbidden_paths: string | null;
  required_checks: string | null;
  risk_level: string;
  risk_domains: string | null;
  approval_required: number;
  approval_reviewers: string | null;
  merge_strategy: string;
  merge_squash: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface AuditEventRow {
  id: string;
  project_id: string;
  task_id: string | null;
  actor_type: string;
  actor_id: string;
  event_type: string;
  payload: string | null;
  created_at: string;
}

interface AgentOpsSnapshotRow {
  id: string;
  project_id: string;
  metrics: string;
  created_at: string;
}

interface AgentNoteRow {
  id: string;
  task_id: string;
  agent_id: string;
  summary: string;
  files: string | null;
  verification: string | null;
  review_focus: string | null;
  risks: string | null;
  commit_sha: string | null;
  pr_url: string | null;
  created_at: string;
}

export interface WorkflowJobRow {
  id: string;
  action: string;
  task_id: string | null;
  actor_id: string | null;
  source: string;
  status: WorkflowJobStatus;
  retry_of: string | null;
  attempt: number;
  max_attempts: number;
  payload: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}
