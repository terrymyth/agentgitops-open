import { describe, expect, it } from "vitest";
import { matchSyncRoute } from "./sync-routes.js";

describe("sync routes", () => {
  it("matches planned sync endpoints", () => {
    expect(matchSyncRoute("/api/sync/push")).toEqual({ action: "push" });
    expect(matchSyncRoute("/api/sync/pull")).toEqual({ action: "pull" });
  });

  it("rejects unsupported sync routes", () => {
    expect(matchSyncRoute("/api/sync/status")).toBeNull();
  });
});
