import { describe, expect, it } from "vitest";
import { redactContextFeedText } from "../src/context-feed-privacy-filter.js";

describe("ContextFeedPrivacyFilter", () => {
  it("redacts common credentials from context feed text", () => {
    const githubTokenFixture = ["ghp", "123456789012345678901234567890123456"].join("_");
    const awsKeyFixture = ["AKIA", "1234567890ABCDEF"].join("");
    const privateKeyFixture = [
      "-----BEGIN " + "PRIVATE KEY-----",
      "abc",
      "-----END " + "PRIVATE KEY-----",
    ].join("\n");
    const result = redactContextFeedText(
      [
        "password=super-secret",
        "token=plain-token",
        githubTokenFixture,
        awsKeyFixture,
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue",
        privateKeyFixture,
      ].join("\n"),
    );

    expect(result.text).toContain("password=[REDACTED:password]");
    expect(result.text).toContain("token=[REDACTED:token]");
    expect(result.text).toContain("[REDACTED:github_token]");
    expect(result.text).toContain("[REDACTED:aws_access_key]");
    expect(result.text).toContain("[REDACTED:jwt]");
    expect(result.text).toContain("[REDACTED:private_key]");
    expect(result.text).not.toContain("super-secret");
    expect(result.text).not.toContain("plain-token");
    expect(result.redactions.map((redaction) => redaction.kind)).toEqual(
      expect.arrayContaining([
        "password",
        "token",
        "github_token",
        "aws_access_key",
        "jwt",
        "private_key",
      ]),
    );
  });

  it("preserves normal engineering context", () => {
    const result = redactContextFeedText(
      "Changed packages/local-hub/src/team-sync-store.ts and ran pnpm test.",
    );
    expect(result.text).toBe(
      "Changed packages/local-hub/src/team-sync-store.ts and ran pnpm test.",
    );
    expect(result.redactions).toEqual([]);
  });
});
