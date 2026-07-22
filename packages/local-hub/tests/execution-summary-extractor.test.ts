import { describe, expect, it } from "vitest";
import { ExecutionSummaryExtractor } from "../src/execution-summary-extractor.js";
import type { TraceEntry } from "../src/trace-collector.js";

describe("ExecutionSummaryExtractor", () => {
  const extractor = new ExecutionSummaryExtractor();

  function makeEntries(stdout: string, stderr: string): TraceEntry[] {
    return [
      { timestamp: "2026-07-11T00:00:00.000Z", stream: "stdout", data: stdout },
      { timestamp: "2026-07-11T00:00:01.000Z", stream: "stderr", data: stderr },
    ];
  }

  it("extracts basic execution info", () => {
    const summary = extractor.extract({
      agentId: "claude-code",
      agentType: "claude-code",
      status: "completed",
      exitCode: 0,
      startedAt: "2026-07-11T00:00:00.000Z",
      endedAt: "2026-07-11T00:01:00.000Z",
      entries: makeEntries("done", ""),
    });

    expect(summary.agentId).toBe("claude-code");
    expect(summary.agentType).toBe("claude-code");
    expect(summary.status).toBe("completed");
    expect(summary.exitCode).toBe(0);
    expect(summary.durationMs).toBe(60_000);
  });

  it("extracts filesRead from log output", () => {
    const summary = extractor.extract({
      agentId: "generic",
      agentType: "generic-cli",
      status: "completed",
      exitCode: 0,
      startedAt: "2026-07-11T00:00:00.000Z",
      endedAt: "2026-07-11T00:00:01.000Z",
      entries: makeEntries("Reading file: src/index.ts\nRead: src/utils.ts\ncat package.json", ""),
    });

    expect(summary.filesRead).toBeDefined();
    expect(summary.filesRead).toContain("src/index.ts");
    expect(summary.filesRead).toContain("src/utils.ts");
    expect(summary.filesRead).toContain("package.json");
  });

  it("extracts commandsExecuted from log output", () => {
    const summary = extractor.extract({
      agentId: "generic",
      agentType: "generic-cli",
      status: "completed",
      exitCode: 0,
      startedAt: "2026-07-11T00:00:00.000Z",
      endedAt: "2026-07-11T00:00:01.000Z",
      entries: makeEntries("Running: npm test\n$ git status\nExecute: pnpm build", ""),
    });

    expect(summary.commandsExecuted).toBeDefined();
    expect(summary.commandsExecuted!.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts strategy from log output", () => {
    const summary = extractor.extract({
      agentId: "generic",
      agentType: "generic-cli",
      status: "completed",
      exitCode: 0,
      startedAt: "2026-07-11T00:00:00.000Z",
      endedAt: "2026-07-11T00:00:01.000Z",
      entries: makeEntries("Strategy: read tests first, then modify implementation", ""),
    });

    expect(summary.strategy).toBe("read tests first, then modify implementation");
  });

  it("extracts stepsCompleted and stepsRemaining", () => {
    const summary = extractor.extract({
      agentId: "generic",
      agentType: "generic-cli",
      status: "partial",
      exitCode: 0,
      startedAt: "2026-07-11T00:00:00.000Z",
      endedAt: "2026-07-11T00:00:01.000Z",
      entries: makeEntries(
        "✓ Step 1: read existing code\n[x] Step 2: write tests\n☐ Step 3: update implementation\nTODO: run full test suite",
        "",
      ),
    });

    expect(summary.stepsCompleted).toBeDefined();
    expect(summary.stepsCompleted!.length).toBeGreaterThanOrEqual(1);
    expect(summary.stepsRemaining).toBeDefined();
    expect(summary.stepsRemaining!.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts failureReason from stderr on failure", () => {
    const summary = extractor.extract({
      agentId: "generic",
      agentType: "generic-cli",
      status: "failed",
      exitCode: 1,
      startedAt: "2026-07-11T00:00:00.000Z",
      endedAt: "2026-07-11T00:00:01.000Z",
      entries: makeEntries(
        "",
        "Error: test suite failed with 3 failures\n  at test/foo.test.ts:42",
      ),
    });

    expect(summary.failureReason).toBeDefined();
    expect(summary.failureReason).toContain("test suite failed");
  });

  it("extracts selfAssessment and confidence", () => {
    const summary = extractor.extract({
      agentId: "generic",
      agentType: "generic-cli",
      status: "completed",
      exitCode: 0,
      startedAt: "2026-07-11T00:00:00.000Z",
      endedAt: "2026-07-11T00:00:01.000Z",
      entries: makeEntries(
        "Summary: all tests passed but edge cases not covered\nConfidence: medium",
        "",
      ),
    });

    expect(summary.selfAssessment).toContain("all tests passed");
    expect(summary.confidence).toBe("medium");
  });

  it("redacts sensitive information in extracted fields", () => {
    const summary = extractor.extract({
      agentId: "generic",
      agentType: "generic-cli",
      status: "failed",
      exitCode: 1,
      startedAt: "2026-07-11T00:00:00.000Z",
      endedAt: "2026-07-11T00:00:01.000Z",
      entries: makeEntries(
        "Reading file: src/config.ts",
        "Error: token=ghp_secrettoken123 not valid",
      ),
    });

    expect(summary.failureReason).toBeDefined();
    expect(summary.failureReason).not.toContain("ghp_secrettoken123");
  });

  it("returns undefined for optional fields when not present", () => {
    const summary = extractor.extract({
      agentId: "generic",
      agentType: "generic-cli",
      status: "completed",
      exitCode: 0,
      startedAt: "2026-07-11T00:00:00.000Z",
      endedAt: "2026-07-11T00:00:01.000Z",
      entries: makeEntries("agent finished", ""),
    });

    expect(summary.strategy).toBeUndefined();
    expect(summary.filesRead).toBeUndefined();
    expect(summary.failureReason).toBeUndefined();
    expect(summary.confidence).toBeUndefined();
  });
});
