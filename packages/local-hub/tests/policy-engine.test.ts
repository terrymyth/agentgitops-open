import { describe, expect, it } from "vitest";
import { PolicyEngine, matchGlob } from "../src/index.js";

describe("PolicyEngine", () => {
  it("matches glob patterns used by path policies", () => {
    expect(matchGlob("src/**/*.ts", "src/server/index.ts")).toBe(true);
    expect(matchGlob("src/*.ts", "src/server/index.ts")).toBe(false);
  });

  it("blocks forbidden paths and escalates high risk paths", () => {
    const engine = new PolicyEngine({
      paths: {
        forbidden: [".env", "secrets/**"],
        high_risk: ["migrations/**"],
      },
      approval: {
        high_risk_paths_require_review: true,
        required_reviewers: {
          "migrations/**": ["@db-owner"],
        },
      },
    });

    const forbidden = engine.evaluate({
      changedFiles: ["secrets/prod.yml"],
      targetBranch: "agent/task-1/generic",
      insertions: 1,
      deletions: 0,
      checksPassed: true,
      unverifiedItems: [],
      hasConflict: false,
    });
    expect(forbidden.allowed).toBe(false);
    expect(forbidden.riskLevel).toBe("critical");
    expect(forbidden.forbiddenFilesTouched).toBe(true);

    const highRisk = engine.evaluate({
      changedFiles: ["migrations/001-init.sql"],
      targetBranch: "agent/task-1/generic",
      insertions: 1,
      deletions: 0,
      checksPassed: true,
      unverifiedItems: [],
      hasConflict: false,
    });
    expect(highRisk.allowed).toBe(true);
    expect(highRisk.riskLevel).toBe("high");
    expect(highRisk.requiresApproval).toBe(true);
    expect(highRisk.requiredReviewers).toEqual(["@db-owner"]);
  });

  it("blocks files outside task allowed paths", () => {
    const engine = new PolicyEngine();

    const result = engine.evaluate({
      changedFiles: ["src/auth/token.ts", "docs/readme.md"],
      allowedPaths: ["src/auth/**"],
      targetBranch: "agent/task-1/generic",
      insertions: 2,
      deletions: 0,
      checksPassed: true,
      unverifiedItems: [],
      hasConflict: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.violations).toContainEqual({
      rule: "task.allowed_paths",
      file: "docs/readme.md",
      message: "Changed file is outside task allowed paths: docs/readme.md",
      severity: "error",
    });
  });

  it("blocks forbidden commands and supports allowlists", () => {
    const engine = new PolicyEngine({
      commands: {
        allowed: ["pnpm", "node"],
        forbidden: ["git reset --hard", "sudo"],
      },
    });

    expect(engine.evaluateCommand("pnpm", ["test"]).allowed).toBe(true);

    const forbidden = engine.evaluateCommand("git", ["reset", "--hard"]);
    expect(forbidden.allowed).toBe(false);
    expect(forbidden.violations[0]?.rule).toBe("commands.forbidden");

    const notAllowed = engine.evaluateCommand("curl", ["https://example.com/install.sh"]);
    expect(notAllowed.allowed).toBe(false);
    expect(notAllowed.violations[0]?.rule).toBe("commands.allowed");
  });
});
