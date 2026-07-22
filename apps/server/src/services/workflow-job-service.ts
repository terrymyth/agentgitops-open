import {
  WorkflowJobExecutionError,
  WorkflowJobRunner,
  type WorkflowJob,
  type WorkflowJobRunResult,
} from "@agentgitops/local-hub";
import type { TaskWorkflowAction } from "../routes/task-workflow-routes.js";

export class WorkflowJobService {
  private readonly runner: WorkflowJobRunner;

  constructor(projectPath: string, runner = new WorkflowJobRunner(projectPath)) {
    this.runner = runner;
  }

  runTaskWorkflow<T>(
    action: TaskWorkflowAction,
    taskId: string,
    actorId: string,
    payload: unknown,
    handler: (job: WorkflowJob) => Promise<T>,
  ): Promise<WorkflowJobRunResult<T>> {
    return this.runner.run(
      {
        action: `task.${action}`,
        taskId,
        actorId,
        source: "web",
        payload,
      },
      handler,
    );
  }

  cancel(jobId: string): WorkflowJob {
    return this.runner.cancel(jobId);
  }

  retry<T>(
    jobId: string,
    handler: (job: WorkflowJob) => Promise<T>,
  ): Promise<WorkflowJobRunResult<T>> {
    return this.runner.retry(jobId, handler);
  }

  recoverStaleRunningJobs(timeoutMs: number): WorkflowJob[] {
    return this.runner.recoverStaleRunningJobs(timeoutMs);
  }
}

export function getWorkflowJobErrorContext(error: unknown): {
  job?: WorkflowJob;
  cause: unknown;
} {
  if (error instanceof WorkflowJobExecutionError) {
    return { job: error.job, cause: error.originalError };
  }
  return { cause: error };
}
