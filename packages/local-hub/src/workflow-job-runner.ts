import { randomUUID } from "node:crypto";
import { LocalProjectRepository, type WorkflowJob } from "./local-project-repository.js";

export interface WorkflowJobRunInput {
  action: string;
  taskId?: string;
  actorId?: string;
  source: "cli" | "web" | "system";
  payload?: unknown;
  maxAttempts?: number;
}

export interface WorkflowJobRunResult<T> {
  job: WorkflowJob;
  result: T;
}

export class WorkflowJobExecutionError extends Error {
  constructor(
    message: string,
    readonly job: WorkflowJob,
    readonly originalError: unknown,
  ) {
    super(message);
    this.name = "WorkflowJobExecutionError";
  }
}

export class WorkflowJobRunner {
  private readonly repository: LocalProjectRepository;

  constructor(projectPath: string, repository = new LocalProjectRepository(projectPath)) {
    this.repository = repository;
  }

  async run<T>(
    input: WorkflowJobRunInput,
    handler: (job: WorkflowJob) => Promise<T>,
  ): Promise<WorkflowJobRunResult<T>> {
    const job = this.enqueue(input);
    return this.runQueued(job.id, handler);
  }

  enqueue(input: WorkflowJobRunInput & { retryOf?: string; attempt?: number }): WorkflowJob {
    return this.repository.createWorkflowJob({
      id: `job_${randomUUID()}`,
      action: input.action,
      taskId: input.taskId,
      actorId: input.actorId,
      source: input.source,
      payload: input.payload,
      retryOf: input.retryOf,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts ?? 2,
    });
  }

  async runQueued<T>(
    jobId: string,
    handler: (job: WorkflowJob) => Promise<T>,
  ): Promise<WorkflowJobRunResult<T>> {
    let job = this.repository.getWorkflowJob(jobId);
    if (!job) throw new Error(`Workflow job not found: ${jobId}`);
    if (job.status === "canceled") throw new Error(`Workflow job was canceled: ${jobId}`);
    if (job.status !== "queued")
      throw new Error(`Workflow job ${jobId} is not queued: ${job.status}`);

    job = this.repository.updateWorkflowJob({
      id: job.id,
      status: "running",
      startedAt: new Date().toISOString(),
    });

    try {
      const result = await handler(job);
      job = this.repository.updateWorkflowJob({
        id: job.id,
        status: "completed",
        result: summarizeJobResult(result),
        completedAt: new Date().toISOString(),
      });
      return { job, result };
    } catch (error) {
      job = this.repository.updateWorkflowJob({
        id: job.id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      });
      throw new WorkflowJobExecutionError(
        error instanceof Error ? error.message : String(error),
        job,
        error,
      );
    }
  }

  cancel(jobId: string): WorkflowJob {
    const job = this.repository.getWorkflowJob(jobId);
    if (!job) throw new Error(`Workflow job not found: ${jobId}`);
    if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
      return job;
    }
    return this.repository.updateWorkflowJob({
      id: job.id,
      status: "canceled",
      error: "Canceled by user",
      completedAt: new Date().toISOString(),
    });
  }

  async retry<T>(
    jobId: string,
    handler: (job: WorkflowJob) => Promise<T>,
  ): Promise<WorkflowJobRunResult<T>> {
    const job = this.repository.getWorkflowJob(jobId);
    if (!job) throw new Error(`Workflow job not found: ${jobId}`);
    if (job.status !== "failed" && job.status !== "canceled") {
      throw new Error(`Workflow job ${jobId} cannot be retried from status ${job.status}`);
    }
    if (job.attempt >= job.maxAttempts) {
      throw new Error(`Workflow job ${jobId} exhausted retry attempts`);
    }

    const retry = this.enqueue({
      action: job.action,
      taskId: job.taskId,
      actorId: job.actorId,
      source: job.source as WorkflowJobRunInput["source"],
      payload: job.payload,
      retryOf: job.id,
      attempt: job.attempt + 1,
      maxAttempts: job.maxAttempts,
    });
    return this.runQueued(retry.id, handler);
  }

  recoverStaleRunningJobs(timeoutMs: number): WorkflowJob[] {
    const olderThanIso = new Date(Date.now() - timeoutMs).toISOString();
    return this.repository.recoverStaleWorkflowJobs({
      olderThanIso,
      error: `Recovered stale running job after ${timeoutMs}ms`,
    });
  }
}

function summarizeJobResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const candidate = result as {
    message?: unknown;
    provider?: unknown;
    prUrl?: unknown;
    prNumber?: unknown;
    workspacePath?: unknown;
    task?: { id?: unknown; status?: unknown };
    changePackage?: { id?: unknown; risk?: { level?: unknown } };
    dryRun?: unknown;
  };

  return {
    message: candidate.message,
    task: candidate.task ? { id: candidate.task.id, status: candidate.task.status } : undefined,
    changePackage: candidate.changePackage
      ? {
          id: candidate.changePackage.id,
          risk: candidate.changePackage.risk?.level,
        }
      : undefined,
    provider: candidate.provider,
    prUrl: candidate.prUrl,
    prNumber: candidate.prNumber,
    workspacePath: candidate.workspacePath,
    dryRun: candidate.dryRun ? true : undefined,
  };
}
