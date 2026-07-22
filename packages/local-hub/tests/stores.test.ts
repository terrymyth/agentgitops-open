import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewStore, VerificationStore } from "../src/index.js";

describe("local stores", () => {
  it("persists review records", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "agops-review-"));
    const store = new ReviewStore(projectPath);
    const review = await store.submit({
      changePackageId: "pkg_task-1",
      reviewerId: "user:alice",
      action: "approve",
      comment: "looks good",
    });

    expect(review.id).toMatch(/^review_/);
    expect(await store.list("pkg_task-1")).toMatchObject([
      {
        reviewerId: "user:alice",
        action: "approve",
        comment: "looks good",
      },
    ]);
  });

  it("persists verification runs", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "agops-verify-"));
    const store = new VerificationStore(projectPath);
    await store.save("task-1", [
      {
        id: "verify_task-1_typecheck",
        taskId: "task-1",
        name: "typecheck",
        command: "pnpm typecheck",
        status: "passed",
        startedAt: "2026-07-04T00:00:00.000Z",
      },
    ]);

    expect(await store.load("task-1")).toHaveLength(1);
    expect(await store.load("missing")).toEqual([]);
  });
});
