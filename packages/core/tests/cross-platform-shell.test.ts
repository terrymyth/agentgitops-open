import { describe, expect, it } from "vitest";
import { parseCommandLine, runCrossPlatformCommand } from "../src/index.js";

describe("cross-platform shell helpers", () => {
  it("parses quoted command lines without requiring a platform shell", () => {
    expect(parseCommandLine("node -e \"console.log('hello world')\"")).toEqual([
      "node",
      "-e",
      "console.log('hello world')",
    ]);
  });

  it("runs a command and captures stdout/stderr", async () => {
    const result = await runCrossPlatformCommand("node", [
      "-e",
      "console.log('ok'); console.error('warn')",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ok");
    expect(result.stderr).toContain("warn");
    expect(result.timedOut).toBe(false);
  });
});
