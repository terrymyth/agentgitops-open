import { describe, expect, it } from "vitest";
import { CeLicenseProvider } from "../src/license-provider.js";
import { CeModuleLoader } from "../src/enterprise-module-loader.js";
import { CeOrganizationPolicyProvider } from "../src/organization-policy-provider.js";

describe("CeLicenseProvider", () => {
  const provider = new CeLicenseProvider();

  it("returns valid ce edition", () => {
    const result = provider.validate();
    expect(result.valid).toBe(true);
    expect(result.edition).toBe("ce");
    expect(result.features).toEqual([]);
  });

  it("allows all features in CE", () => {
    expect(provider.hasFeature("any-feature")).toBe(true);
  });

  it("returns ce summary", () => {
    const summary = provider.getSummary();
    expect(summary.edition).toBe("ce");
    expect(summary.valid).toBe(true);
  });
});

describe("CeModuleLoader", () => {
  const loader = new CeModuleLoader();

  it("discovers no modules in CE", () => {
    expect(loader.discover()).toEqual([]);
  });

  it("refuses to load enterprise modules", () => {
    const result = loader.load({
      moduleId: "test-module",
      name: "Test Module",
      version: "1.0.0",
      agentgitopsVersionRange: ">=0.1.0",
      entry: "./test.js",
      capabilities: ["license-provider"],
    });
    expect(result.loaded).toBe(false);
    expect(result.error).toContain("not available in CE");
  });

  it("returns empty loaded list", () => {
    expect(loader.listLoaded()).toEqual([]);
  });
});

describe("CeOrganizationPolicyProvider", () => {
  const provider = new CeOrganizationPolicyProvider();

  it("returns null for organization config in CE", () => {
    expect(provider.getConfig("org-1")).toBeNull();
  });

  it("returns empty effective policy in CE", () => {
    const policy = provider.getEffectivePolicy("org-1");
    expect(policy).toEqual({});
  });

  it("returns empty history in CE", () => {
    expect(provider.getHistory("org-1")).toEqual([]);
  });
});
