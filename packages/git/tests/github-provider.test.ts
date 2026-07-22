import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangePackage, TaskContract } from "@agentgitops/core";
import {
  formatChangePackagePullRequestBody,
  formatReviewContextComment,
  GitHubProvider,
  parseGitHubRepository,
} from "../src/github-provider.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GitHubProvider helpers", () => {
  it("parses GitHub HTTPS and SSH remotes", () => {
    expect(parseGitHubRepository("https://github.com/acme/demo.git")).toBe("acme/demo");
    expect(parseGitHubRepository("git@github.com:acme/demo.git")).toBe("acme/demo");
    expect(parseGitHubRepository("https://token@github.com/acme/demo")).toBe("acme/demo");
  });

  it("formats a change package PR body with review evidence", () => {
    const task: TaskContract = {
      id: "task-20260703-001",
      projectId: "demo",
      title: "Fix auth error",
      objective: "Return 401 when token is expired",
      baseBranch: "main",
      targetBranch: "agent/task-20260703-001/codex",
      agentId: "codex",
      allowedPaths: [],
      forbiddenPaths: [],
      requiredChecks: ["pnpm test"],
      riskLevel: "medium",
      approval: { required: false },
      merge: { strategy: "manual", squash: true },
      status: "reviewing",
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
    };

    const changePackage: ChangePackage = {
      id: "pkg_task-20260703-001",
      taskId: task.id,
      projectId: task.projectId,
      version: "1.0",
      agent: { name: "codex", adapter: "generic-cli" },
      baseBranch: task.baseBranch,
      targetBranch: task.targetBranch,
      objective: task.objective,
      summary: "1 files changed (+2 -1)",
      changedFiles: ["src/auth.ts"],
      stats: { filesChanged: 1, insertions: 2, deletions: 1 },
      checks: [
        {
          id: "verify_1",
          taskId: task.id,
          name: "pnpm test",
          command: "pnpm test",
          status: "passed",
          startedAt: "2026-07-03T00:00:00.000Z",
        },
      ],
      risk: {
        level: "medium",
        domains: ["auth"],
        highRiskFilesTouched: false,
        forbiddenFilesTouched: false,
        violations: [],
      },
      evidence: {
        securityScan: {
          status: "not_configured",
          findings: 0,
          summary: "No security scanner configured for this project.",
        },
        comparison: {
          comparedPackages: 1,
          overlappingFiles: ["src/auth.ts"],
          insertionDelta: 2,
          deletionDelta: 1,
        },
      },
      unverifiedItems: ["E2E login flow"],
      conflicts: [],
      mergeRecommendation: "Requires owner review",
      createdAt: "2026-07-03T00:00:00.000Z",
    };

    const body = formatChangePackagePullRequestBody(task, changePackage);

    expect(body).toContain("## Agent Change Package");
    expect(body).toContain("Return 401 when token is expired");
    expect(body).toContain("`src/auth.ts`");
    expect(body).toContain("PASSED pnpm test");
    expect(body).toContain("### Evidence");
    expect(body).toContain("Security scan: not_configured");
    expect(body).toContain("E2E login flow");
  });

  it("injects review context into the PR body", () => {
    const task = createTask();
    const changePackage = createChangePackage(task);
    const body = formatChangePackagePullRequestBody(task, changePackage, {
      task,
      changePackage,
      reviews: [],
      agentNotes: [
        {
          id: "note_1",
          taskId: task.id,
          agentId: "codex",
          summary: "Added token recovery handling",
          files: ["src/auth.ts"],
          verification: ["pnpm test"],
          reviewFocus: ["provider errors"],
          risks: [],
          createdAt: "2026-07-03T00:00:00.000Z",
        },
      ],
      audit: [],
      checklist: [
        {
          severity: "warning",
          title: "Approval missing",
          detail: "No approve review has been recorded yet.",
        },
      ],
      summary: {
        riskLevel: "medium",
        changedFiles: 1,
        checksFailed: 0,
        checksPassed: 1,
        openConflicts: 0,
        approvals: 0,
        requestedChanges: 0,
        latestNoteAt: "2026-07-03T00:00:00.000Z",
      },
    });

    expect(body).toContain("### Review Context Summary");
    expect(body).toContain("<!-- agentgitops:review-context -->");
    expect(body).toContain("Added token recovery handling");
  });

  it("adds team sync sections when the team-sync PR body template is selected", () => {
    const task = createTask();
    const changePackage = createChangePackage(task);
    changePackage.evidence = {
      securityScan: {
        status: "not_configured",
        findings: 0,
        summary: "No security scanner configured for this project.",
      },
      comparison: {
        comparedPackages: 1,
        overlappingFiles: ["src/auth.ts"],
        insertionDelta: 2,
        deletionDelta: 1,
      },
    };
    changePackage.conflicts = [
      {
        id: "conflict_1",
        conflictingTaskId: "task-20260703-002",
        type: "same_file",
        filePath: "src/auth.ts",
        severity: "medium",
        suggestion: "rebase",
        status: "open",
      },
    ];

    const body = formatChangePackagePullRequestBody(task, changePackage, undefined, {
      template: "team-sync",
      teamSync: {
        relatedPullRequests: ["#12"],
        contextFeedId: "ctx_task-20260703-001",
        syncStatus: "pushed",
        controlPlane: "enabled",
        usedByAgent: true,
      },
    });

    expect(body).toContain("### Team Sync Context");
    expect(body).toContain("<!-- agentgitops:team-sync -->");
    expect(body).toContain("Parent / Related Tasks: `task-20260703-002`");
    expect(body).toContain("Related PRs: `#12`");
    expect(body).toContain("Overlapping Files: `src/auth.ts`");
    expect(body).toContain("Potential Conflict Signals: `same_file`");
    expect(body).toContain("Context Feed ID: `ctx_task-20260703-001`");
    expect(body).toContain("Sync Status: `pushed`");
    expect(body).toContain("Team Control Plane: `enabled`");
  });

  it("merges a pull request through the GitHub API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          merged: true,
          sha: "abc123",
          message: "Pull Request successfully merged",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const result = await new GitHubProvider({ token: "token" }).mergePullRequest({
      repo: "acme/demo",
      number: 42,
      method: "squash",
    });

    expect(result).toEqual({
      merged: true,
      sha: "abc123",
      message: "Pull Request successfully merged",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/demo/pulls/42/merge",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          merge_method: "squash",
        }),
      }),
    );
  });

  it("updates an existing review context comment when the marker exists", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: 7, body: "<!-- agentgitops:review-context -->\nold" }]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 7, html_url: "https://github.com/acme/demo/pull/1#issuecomment-7" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const result = await new GitHubProvider({ token: "token" }).upsertPullRequestComment({
      repo: "acme/demo",
      number: 1,
      body: formatReviewContextComment({
        task: createTask(),
        changePackage: null,
        reviews: [],
        agentNotes: [],
        audit: [],
        checklist: [],
        summary: {
          riskLevel: "low",
          changedFiles: 0,
          checksFailed: 0,
          checksPassed: 0,
          openConflicts: 0,
          approvals: 0,
          requestedChanges: 0,
        },
      }),
    });

    expect(result.action).toBe("updated");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/acme/demo/issues/comments/7",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("creates a review context comment when no marker exists", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 8, html_url: "https://github.com/acme/demo/pull/1#issuecomment-8" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const result = await new GitHubProvider({ token: "token" }).upsertPullRequestComment({
      repo: "acme/demo",
      number: 1,
      body: "<!-- agentgitops:review-context -->\nnew",
    });

    expect(result.action).toBe("created");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/acme/demo/issues/1/comments",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("loads commit check runs from the GitHub Checks API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          total_count: 1,
          check_runs: [
            {
              id: 101,
              name: "CI",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.com/acme/demo/actions/runs/1",
              started_at: "2026-07-06T00:00:00Z",
              completed_at: "2026-07-06T00:01:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const checks = await new GitHubProvider({ token: "token" }).getCommitCheckRuns({
      repo: "acme/demo",
      ref: "agent/task-1/codex",
    });

    expect(checks).toEqual([
      {
        id: 101,
        name: "CI",
        status: "completed",
        conclusion: "success",
        url: "https://github.com/acme/demo/actions/runs/1",
        startedAt: "2026-07-06T00:00:00Z",
        completedAt: "2026-07-06T00:01:00Z",
      },
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/acme/demo/commits/agent%2Ftask-1%2Fcodex/check-runs?per_page=100",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

function createTask(): TaskContract {
  return {
    id: "task-20260703-001",
    projectId: "demo",
    title: "Fix auth error",
    objective: "Return 401 when token is expired",
    baseBranch: "main",
    targetBranch: "agent/task-20260703-001/codex",
    agentId: "codex",
    allowedPaths: [],
    forbiddenPaths: [],
    requiredChecks: ["pnpm test"],
    riskLevel: "medium",
    approval: { required: false },
    merge: { strategy: "manual", squash: true },
    status: "reviewing",
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
  };
}

function createChangePackage(task: TaskContract): ChangePackage {
  return {
    id: "pkg_task-20260703-001",
    taskId: task.id,
    projectId: task.projectId,
    version: "1.0",
    agent: { name: "codex", adapter: "generic-cli" },
    baseBranch: task.baseBranch,
    targetBranch: task.targetBranch,
    objective: task.objective,
    summary: "1 files changed (+2 -1)",
    changedFiles: ["src/auth.ts"],
    stats: { filesChanged: 1, insertions: 2, deletions: 1 },
    checks: [
      {
        id: "verify_1",
        taskId: task.id,
        name: "pnpm test",
        command: "pnpm test",
        status: "passed",
        startedAt: "2026-07-03T00:00:00.000Z",
      },
    ],
    risk: {
      level: "medium",
      domains: ["auth"],
      highRiskFilesTouched: false,
      forbiddenFilesTouched: false,
      violations: [],
    },
    unverifiedItems: ["E2E login flow"],
    conflicts: [],
    mergeRecommendation: "Requires owner review",
    createdAt: "2026-07-03T00:00:00.000Z",
  };
}
