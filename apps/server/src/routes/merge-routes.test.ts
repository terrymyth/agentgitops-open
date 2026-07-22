import { describe, expect, it } from "vitest";
import { matchMergeQueueRoute } from "./merge-routes.js";

describe("merge routes", () => {
  it("matches merge queue actions", () => {
    expect(matchMergeQueueRoute("/api/merge-queue/task-123/approve")).toEqual({
      taskId: "task-123",
      action: "approve",
    });
  });

  it("rejects unsupported merge routes", () => {
    expect(matchMergeQueueRoute("/api/merge-queue/task-123/delete")).toBeNull();
  });
});
