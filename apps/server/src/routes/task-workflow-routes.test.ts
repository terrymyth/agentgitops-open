import { describe, expect, it } from "vitest";
import { matchTaskWorkflowRoute } from "./task-workflow-routes.js";

describe("task workflow routes", () => {
  it("matches supported task workflow actions", () => {
    expect(matchTaskWorkflowRoute("/api/tasks/task-123/run")).toEqual({
      taskId: "task-123",
      action: "run",
    });
    expect(matchTaskWorkflowRoute("/api/tasks/task%2Fencoded/package")).toEqual({
      taskId: "task/encoded",
      action: "package",
    });
  });

  it("rejects unsupported task routes", () => {
    expect(matchTaskWorkflowRoute("/api/tasks/task-123/delete")).toBeNull();
    expect(matchTaskWorkflowRoute("/api/tasks")).toBeNull();
  });
});
