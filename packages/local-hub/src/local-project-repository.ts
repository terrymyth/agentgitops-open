import type { TaskContract, TaskStatus, VerificationRun } from "@agentgitops/core";
import { LocalDb, type WorkflowJobRow, type WorkflowJobStatus } from "./local-db.js";
import { TaskManager } from "./task-manager.js";
import { VerificationStore } from "./verification-store.js";

export interface WorkflowJob {
  id: string;
  action: string;
  taskId?: string;
  actorId?: string;
  source: string;
  status: WorkflowJobStatus;
  retryOf?: string;
  attempt: number;
  maxAttempts: number;
  payload?: unknown;
  result?: unknown;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export class LocalProjectRepository {
  private readonly taskManager: TaskManager;
  private readonly verificationStore: VerificationStore;

  constructor(private readonly projectPath: string) {
    this.taskManager = new TaskManager(projectPath);
    this.verificationStore = new VerificationStore(projectPath);
  }

  loadTask(taskId: string): Promise<TaskContract> {
    return this.taskManager.load(taskId);
  }

  listTasks(): Promise<TaskContract[]> {
    return this.taskManager.list();
  }

  updateTaskStatus(taskId: string, status: TaskStatus): Promise<TaskContract> {
    return this.taskManager.updateStatus(taskId, status);
  }

  saveVerificationRuns(taskId: string, runs: VerificationRun[]): Promise<void> {
    return this.verificationStore.save(taskId, runs);
  }

  loadVerificationRuns(taskId: string): Promise<VerificationRun[]> {
    return this.verificationStore.load(taskId);
  }

  createWorkflowJob(input: {
    id: string;
    action: string;
    taskId?: string;
    actorId?: string;
    source: string;
    payload?: unknown;
    retryOf?: string;
    attempt?: number;
    maxAttempts?: number;
  }): WorkflowJob {
    const db = new LocalDb(this.projectPath);
    try {
      return workflowJobFromRow(db.insertWorkflowJob(input));
    } finally {
      db.close();
    }
  }

  recoverStaleWorkflowJobs(input: { olderThanIso: string; error: string }): WorkflowJob[] {
    const db = new LocalDb(this.projectPath);
    try {
      return db.recoverRunningWorkflowJobs(input).map(workflowJobFromRow);
    } finally {
      db.close();
    }
  }

  updateWorkflowJob(input: {
    id: string;
    status: WorkflowJobStatus;
    result?: unknown;
    error?: string;
    startedAt?: string;
    completedAt?: string;
  }): WorkflowJob {
    const db = new LocalDb(this.projectPath);
    try {
      return workflowJobFromRow(db.updateWorkflowJob(input));
    } finally {
      db.close();
    }
  }

  getWorkflowJob(jobId: string): WorkflowJob | null {
    const db = new LocalDb(this.projectPath);
    try {
      const row = db.getWorkflowJob(jobId);
      return row ? workflowJobFromRow(row) : null;
    } finally {
      db.close();
    }
  }

  listWorkflowJobs(options: { taskId?: string; limit?: number } = {}): WorkflowJob[] {
    const db = new LocalDb(this.projectPath);
    try {
      return db.listWorkflowJobs(options).map(workflowJobFromRow);
    } finally {
      db.close();
    }
  }
}

function workflowJobFromRow(row: WorkflowJobRow): WorkflowJob {
  return {
    id: row.id,
    action: row.action,
    taskId: row.task_id ?? undefined,
    actorId: row.actor_id ?? undefined,
    source: row.source,
    status: row.status,
    retryOf: row.retry_of ?? undefined,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    payload: parseJsonField(row.payload),
    result: parseJsonField(row.result),
    error: row.error ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

function parseJsonField(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
