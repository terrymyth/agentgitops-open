import { describe, expect, it } from "vitest";
import type { ChangePackage, TaskContract } from "@agentgitops/core";
import { ConflictDetector, MergeGate } from "../src/index.js";

describe("ConflictDetector", () => {
  it("detects same-file conflicts between change packages", () => {
    const current = changePackage("task-1", ["src/auth.ts"], "medium");
    const other = changePackage("task-2", ["src/auth.ts"], "medium");

    const conflicts = new ConflictDetector().detect(current, [other]);

    expect(conflicts.map((conflict) => conflict.type)).toEqual(
      expect.arrayContaining(["same_file", "same_risk_domain"]),
    );
  });

  it("detects semantic path conflicts", () => {
    const current = changePackage(
      "task-1",
      ["migrations/001_add_users.sql", "package.json", "src/auth/policy.ts", "src/api/auth.ts"],
      "medium",
    );
    const other = changePackage(
      "task-2",
      [
        "migrations/002_add_roles.sql",
        "pnpm-lock.yaml",
        "src/permissions/users.ts",
        "src/api/users.ts",
      ],
      "medium",
    );

    const conflicts = new ConflictDetector().detect(current, [other]);
    const types = conflicts.map((conflict) => conflict.type);

    expect(types).toContain("migration");
    expect(types).toContain("dependency_version");
    expect(types).toContain("permission_logic");
    expect(types).toContain("api_contract");
  });
});

describe("MergeGate", () => {
  it("blocks failed checks and open conflicts", () => {
    const task = taskContract({ riskLevel: "low" });
    const pkg = changePackage(task.id, ["src/app.ts"], "low");
    pkg.checks = [
      {
        id: "verify_1",
        taskId: task.id,
        name: "test",
        command: "pnpm test",
        status: "failed",
        startedAt: "2026-07-04T00:00:00.000Z",
      },
    ];
    pkg.conflicts = [
      {
        id: "conflict_1",
        type: "same_file",
        conflictingTaskId: "task-2",
        filePath: "src/app.ts",
        severity: "high",
        suggestion: "serial_merge",
        status: "open",
      },
    ];

    const result = new MergeGate().evaluate({
      task,
      changePackage: pkg,
      reviews: [],
    });

    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain("Verification failed: test");
    expect(result.blockers).toContain("Open conflict with task-2: same_file");
  });

  it("requires approval for high-risk packages", () => {
    const task = taskContract({ riskLevel: "high", approvalRequired: true });
    const pkg = changePackage(task.id, ["src/auth.ts"], "high");
    const gate = new MergeGate();

    expect(gate.evaluate({ task, changePackage: pkg, reviews: [] }).allowed).toBe(false);
    expect(
      gate.evaluate({
        task,
        changePackage: pkg,
        reviews: [
          {
            id: "review_1",
            changePackageId: pkg.id,
            reviewerId: "user:alice",
            action: "approve",
            createdAt: "2026-07-04T00:00:00.000Z",
          },
        ],
      }).allowed,
    ).toBe(true);
  });

  it("requires approval from configured reviewers for high-risk packages", () => {
    const task = taskContract({ riskLevel: "high", approvalRequired: true });
    task.approval.reviewers = ["@auth-owner"];
    const pkg = changePackage(task.id, ["src/auth.ts"], "high");
    pkg.risk.requiredReviewers = ["@security"];
    const gate = new MergeGate();

    const genericApproval = gate.evaluate({
      task,
      changePackage: pkg,
      reviews: [
        {
          id: "review_1",
          changePackageId: pkg.id,
          reviewerId: "user:alice",
          action: "approve",
          createdAt: "2026-07-04T00:00:00.000Z",
        },
      ],
    });

    expect(genericApproval.allowed).toBe(false);
    expect(genericApproval.blockers).toContain(
      "Required reviewer approval missing: @auth-owner, @security",
    );

    const requiredApprovals = gate.evaluate({
      task,
      changePackage: pkg,
      reviews: [
        {
          id: "review_2",
          changePackageId: pkg.id,
          reviewerId: "@auth-owner",
          action: "approve",
          createdAt: "2026-07-04T00:00:00.000Z",
        },
        {
          id: "review_3",
          changePackageId: pkg.id,
          reviewerId: "@security",
          action: "approve",
          createdAt: "2026-07-04T00:00:00.000Z",
        },
      ],
    });

    expect(requiredApprovals.allowed).toBe(true);
  });
});

function taskContract(input: {
  riskLevel: TaskContract["riskLevel"];
  approvalRequired?: boolean;
}): TaskContract {
  return {
    id: "task-1",
    projectId: "demo",
    title: "Task",
    objective: "Task objective",
    baseBranch: "main",
    targetBranch: "agent/task-1/codex",
    agentId: "codex",
    allowedPaths: [],
    forbiddenPaths: [],
    requiredChecks: [],
    riskLevel: input.riskLevel,
    riskDomains: ["auth"],
    approval: { required: input.approvalRequired ?? false },
    merge: { strategy: "manual", squash: true },
    status: "reviewing",
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
  };
}

function changePackage(
  taskId: string,
  changedFiles: string[],
  riskLevel: ChangePackage["risk"]["level"],
): ChangePackage {
  return {
    id: `pkg_${taskId}`,
    taskId,
    projectId: "demo",
    version: "1.0",
    agent: { name: "codex", adapter: "generic-cli" },
    baseBranch: "main",
    targetBranch: `agent/${taskId}/codex`,
    objective: "Task objective",
    summary: `${changedFiles.length} files changed`,
    changedFiles,
    stats: { filesChanged: changedFiles.length, insertions: 1, deletions: 0 },
    checks: [],
    risk: {
      level: riskLevel,
      domains: ["auth"],
      highRiskFilesTouched: riskLevel === "high" || riskLevel === "critical",
      forbiddenFilesTouched: false,
      violations: [],
    },
    unverifiedItems: [],
    conflicts: [],
    mergeRecommendation: "ok",
    createdAt: "2026-07-04T00:00:00.000Z",
  };
}
