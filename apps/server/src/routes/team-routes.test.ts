import { describe, expect, it } from "vitest";
import { matchTeamRoute } from "./team-routes.js";

describe("team routes", () => {
  it("matches planned team endpoints", () => {
    expect(matchTeamRoute("/api/team/status")).toEqual({ action: "status" });
    expect(matchTeamRoute("/api/team/tasks")).toEqual({ action: "tasks" });
    expect(matchTeamRoute("/api/team/conflicts")).toEqual({ action: "conflicts" });
    expect(matchTeamRoute("/api/team/sync-config")).toEqual({ action: "sync-config" });
  });

  it("rejects unsupported team routes", () => {
    expect(matchTeamRoute("/api/team/delete")).toBeNull();
  });
});
