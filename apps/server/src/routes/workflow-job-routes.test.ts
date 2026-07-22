import { describe, expect, it } from "vitest";
import { matchWorkflowJobRoute } from "./workflow-job-routes.js";

describe("workflow job routes", () => {
  it("matches workflow job actions", () => {
    expect(matchWorkflowJobRoute("/api/workflow-jobs/job-123/retry")).toEqual({
      jobId: "job-123",
      action: "retry",
    });
  });

  it("rejects unsupported workflow job routes", () => {
    expect(matchWorkflowJobRoute("/api/workflow-jobs/job-123/run")).toBeNull();
  });
});
