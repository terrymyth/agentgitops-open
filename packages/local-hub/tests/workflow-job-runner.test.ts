import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LocalProjectRepository,
  WorkflowJobExecutionError,
  WorkflowJobRunner,
} from "../src/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-jobs-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("WorkflowJobRunner", () => {
  it("persists queued, running, and completed job state", async () => {
    const runner = new WorkflowJobRunner(tmpDir);
    const { job, result } = await runner.run(
      {
        action: "task.test",
        taskId: "task-1",
        actorId: "tester",
        source: "cli",
        payload: { command: "test" },
      },
      async () => ({ message: "done", task: { id: "task-1", status: "packaging" } }),
    );

    expect(result.message).toBe("done");
    expect(job.status).toBe("completed");
    expect(job.taskId).toBe("task-1");
    expect(job.result).toMatchObject({
      message: "done",
      task: { id: "task-1", status: "packaging" },
    });

    const stored = new LocalProjectRepository(tmpDir).getWorkflowJob(job.id);
    expect(stored?.status).toBe("completed");
    expect(stored?.startedAt).toBeTruthy();
    expect(stored?.completedAt).toBeTruthy();
  });

  it("persists failed job state before rethrowing", async () => {
    const runner = new WorkflowJobRunner(tmpDir);

    await expect(
      runner.run(
        {
          action: "task.run",
          taskId: "task-2",
          actorId: "tester",
          source: "web",
        },
        async () => {
          throw new Error("agent failed");
        },
      ),
    ).rejects.toBeInstanceOf(WorkflowJobExecutionError);

    const jobs = new LocalProjectRepository(tmpDir).listWorkflowJobs({ taskId: "task-2" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      action: "task.run",
      status: "failed",
      error: "agent failed",
    });
  });

  it("can cancel queued jobs", () => {
    const runner = new WorkflowJobRunner(tmpDir);
    const queued = runner.enqueue({
      action: "task.package",
      taskId: "task-3",
      actorId: "tester",
      source: "web",
    });

    const canceled = runner.cancel(queued.id);
    expect(canceled.status).toBe("canceled");
    expect(canceled.error).toBe("Canceled by user");
  });

  it("can retry failed jobs with retry linkage", async () => {
    const runner = new WorkflowJobRunner(tmpDir);
    let failedJobId = "";
    try {
      await runner.run(
        {
          action: "task.package",
          taskId: "task-4",
          actorId: "tester",
          source: "web",
          maxAttempts: 2,
        },
        async () => {
          throw new Error("package failed");
        },
      );
    } catch (error) {
      if (error instanceof WorkflowJobExecutionError) failedJobId = error.job.id;
    }

    const retried = await runner.retry(failedJobId, async () => ({ message: "retry ok" }));
    expect(retried.job.status).toBe("completed");
    expect(retried.job.retryOf).toBe(failedJobId);
    expect(retried.job.attempt).toBe(2);
  });

  it("recovers stale running jobs", () => {
    const repository = new LocalProjectRepository(tmpDir);
    const runner = new WorkflowJobRunner(tmpDir, repository);
    const queued = runner.enqueue({
      action: "task.run",
      taskId: "task-5",
      actorId: "tester",
      source: "system",
    });
    repository.updateWorkflowJob({
      id: queued.id,
      status: "running",
      startedAt: "2026-07-05T00:00:00.000Z",
    });

    const recovered = runner.recoverStaleRunningJobs(-1);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].status).toBe("failed");
    expect(recovered[0].error).toContain("Recovered stale running job");
  });
});
