import { describe, it, expect } from "vitest";
import { DEFAULT_PORT, CONFIG_VERSION, CHANGE_PACKAGE_VERSION } from "../src/constants/index.js";

describe("@agentgitops/core constants", () => {
  it("should export DEFAULT_PORT as 4789", () => {
    expect(DEFAULT_PORT).toBe(4789);
  });

  it("should export CONFIG_VERSION as 1", () => {
    expect(CONFIG_VERSION).toBe(1);
  });

  it("should export CHANGE_PACKAGE_VERSION as 1.0", () => {
    expect(CHANGE_PACKAGE_VERSION).toBe("1.0");
  });
});
