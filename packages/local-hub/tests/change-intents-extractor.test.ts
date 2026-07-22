import { describe, expect, it } from "vitest";
import { ChangeIntentsExtractor } from "../src/change-intents-extractor.js";

describe("ChangeIntentsExtractor", () => {
  const extractor = new ChangeIntentsExtractor();

  const newFileDiff = `diff --git a/src/new-feature.ts b/src/new-feature.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new-feature.ts
+export function newFeature() {
+  return true;
+}`;

  const modifiedFileDiff = `diff --git a/src/auth/login.ts b/src/auth/login.ts
index abc1234..def5678 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -10,7 +10,9 @@
 export function login(user: string) {
-  return authenticate(user);
+  return authenticate(user, "default");
+  // Added default scope for backwards compat
 }`;

  const deletedFileDiff = `diff --git a/src/old-module.ts b/src/old-module.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old-module.ts
+++ /dev/null
-export function oldModule() {
-  return null;
-}`;

  const breakingChangeDiff = `diff --git a/src/api/public.ts b/src/api/public.ts
index abc1234..def5678 100644
--- a/src/api/public.ts
+++ b/src/api/public.ts
@@ -5,8 +5,6 @@
-export function publicApiV1() {
-  return legacy;
-}
+export function publicApiV2() {
+  return modern;
+}`;

  it("extracts changeIntents for new file", () => {
    const result = extractor.extract(newFileDiff);
    expect(result.changeIntents).toHaveLength(1);
    expect(result.changeIntents[0].file).toBe("src/new-feature.ts");
    expect(result.changeIntents[0].changeType).toBe("add");
  });

  it("extracts changeIntents for modified file", () => {
    const result = extractor.extract(modifiedFileDiff);
    expect(result.changeIntents).toHaveLength(1);
    expect(result.changeIntents[0].file).toBe("src/auth/login.ts");
    expect(result.changeIntents[0].changeType).toBe("modify");
  });

  it("extracts changeIntents for deleted file", () => {
    const result = extractor.extract(deletedFileDiff);
    expect(result.changeIntents).toHaveLength(1);
    expect(result.changeIntents[0].file).toBe("src/old-module.ts");
    expect(result.changeIntents[0].changeType).toBe("delete");
  });

  it("extracts impactedAreas from file paths", () => {
    const result = extractor.extract(modifiedFileDiff);
    expect(result.impactedAreas).toContain("auth");
  });

  it("detects breaking changes when exports are removed", () => {
    const result = extractor.extract(breakingChangeDiff);
    expect(result.breakingChanges).toBe(true);
  });

  it("does not flag breaking changes for normal modifications", () => {
    const result = extractor.extract(modifiedFileDiff);
    expect(result.breakingChanges).toBe(false);
  });

  it("uses commit message for intent when provided", () => {
    const result = extractor.extract(modifiedFileDiff, {
      commitMessage: "fix: handle default scope in login",
    });
    expect(result.changeIntents[0].intent).toContain("fix: handle default scope in login");
  });

  it("uses objective for intent when no commit message", () => {
    const result = extractor.extract(modifiedFileDiff, {
      objective: "Improve authentication security",
    });
    expect(result.changeIntents[0].intent).toContain("Improve authentication security");
  });

  it("handles empty diff gracefully", () => {
    const result = extractor.extract("");
    expect(result.changeIntents).toHaveLength(0);
    expect(result.impactedAreas).toHaveLength(0);
    expect(result.breakingChanges).toBe(false);
  });

  it("handles multiple files in one diff", () => {
    const multiDiff = `${newFileDiff}\n${modifiedFileDiff}`;
    const result = extractor.extract(multiDiff);
    expect(result.changeIntents).toHaveLength(2);
  });
});
