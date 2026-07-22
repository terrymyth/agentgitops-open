import { describe, expect, it } from "vitest";
import { matchConflictRoute } from "./conflict-routes.js";

describe("conflict routes", () => {
  it("matches conflict actions", () => {
    expect(matchConflictRoute("/api/conflicts/conflict-1/false-positive")).toEqual({
      conflictId: "conflict-1",
      action: "false-positive",
    });
  });

  it("rejects unsupported conflict routes", () => {
    expect(matchConflictRoute("/api/conflicts/conflict-1/delete")).toBeNull();
  });
});
