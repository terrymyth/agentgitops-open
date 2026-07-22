import { describe, it, expect } from "vitest";
import {
  PolicyTemplateLibrary,
  PolicyVersionManager,
  TokenUsageAnalyzer,
  AgentVendorComparator,
  CodeownersParser,
} from "../src/enterprise/index.js";

describe("P2-001: PolicyTemplateLibrary", () => {
  it("内置 5 个行业模板", () => {
    const lib = new PolicyTemplateLibrary();
    const templates = lib.listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(5);
    expect(templates.map((t) => t.id)).toContain("financial");
    expect(templates.map((t) => t.id)).toContain("healthcare");
    expect(templates.map((t) => t.id)).toContain("general-enterprise");
  });

  it("金融模板有严格策略", () => {
    const lib = new PolicyTemplateLibrary();
    const policy = lib.applyTemplate("financial");
    expect(policy.protectedBranches).toContain("main");
    expect(policy.forbiddenPaths).toContain("secrets/**");
    expect(policy.mergeRules?.allowAutoMergeForLowRisk).toBe(false);
    expect(policy.requiredChecks?.length).toBeGreaterThanOrEqual(3);
  });

  it("应用模板时可覆盖字段", () => {
    const lib = new PolicyTemplateLibrary();
    const policy = lib.applyTemplate("general-enterprise", {
      protectedBranches: ["main", "develop"],
    });
    expect(policy.protectedBranches).toEqual(["main", "develop"]);
  });

  it("按行业筛选", () => {
    const lib = new PolicyTemplateLibrary();
    const financial = lib.getByIndustry("financial");
    expect(financial).toHaveLength(1);
    expect(financial[0].id).toBe("financial");
  });

  it("不存在的模板抛出错误", () => {
    const lib = new PolicyTemplateLibrary();
    expect(() => lib.applyTemplate("nonexistent")).toThrow(/not found/);
  });
});

describe("P2-002: PolicyVersionManager", () => {
  it("保存和获取版本", () => {
    const mgr = new PolicyVersionManager();
    const v1 = mgr.saveVersion("org-1", { protectedBranches: ["main"] }, "alice", "初始版本");
    expect(v1.versionId).toBeTruthy();
    expect(v1.previousVersionId).toBeUndefined();

    const v2 = mgr.saveVersion(
      "org-1",
      { protectedBranches: ["main", "develop"] },
      "bob",
      "添加 develop",
    );
    expect(v2.previousVersionId).toBe(v1.versionId);

    const history = mgr.getHistory("org-1");
    expect(history).toHaveLength(2);
  });

  it("获取当前版本", () => {
    const mgr = new PolicyVersionManager();
    mgr.saveVersion("org-1", { protectedBranches: ["main"] }, "alice");
    mgr.saveVersion("org-1", { protectedBranches: ["main", "develop"] }, "bob");

    const current = mgr.getCurrentVersion("org-1");
    expect(current?.policy.protectedBranches).toEqual(["main", "develop"]);
  });

  it("对比版本差异", () => {
    const mgr = new PolicyVersionManager();
    const v1 = mgr.saveVersion(
      "org-1",
      { protectedBranches: ["main"], forbiddenPaths: ["secrets/**"] },
      "alice",
    );
    const v2 = mgr.saveVersion(
      "org-1",
      { protectedBranches: ["main", "develop"], forbiddenPaths: ["secrets/**"] },
      "bob",
    );

    const diff = mgr.diff("org-1", v1.versionId, v2.versionId);
    expect(diff.changes.length).toBeGreaterThan(0);
    const branchChange = diff.changes.find((c) => c.fieldKey === "protectedBranches");
    expect(branchChange).toBeDefined();
  });

  it("回滚到历史版本", () => {
    const mgr = new PolicyVersionManager();
    const v1 = mgr.saveVersion("org-1", { protectedBranches: ["main"] }, "alice", "v1");
    mgr.saveVersion("org-1", { protectedBranches: ["main", "develop"] }, "bob", "v2");

    const rolled = mgr.rollback("org-1", v1.versionId, "alice");
    expect(rolled.policy.protectedBranches).toEqual(["main"]);
    expect(rolled.changeDescription).toContain("Rollback");
  });
});

describe("P2-003: TokenUsageAnalyzer", () => {
  it("记录和汇总 Token 使用", () => {
    const analyzer = new TokenUsageAnalyzer();
    analyzer.record({
      agentId: "claude-code",
      agentType: "claude",
      projectId: "p1",
      teamId: "t1",
      model: "claude-opus",
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0.015,
      duration: 30000,
    });
    analyzer.record({
      agentId: "codex",
      agentType: "openai",
      projectId: "p1",
      teamId: "t1",
      model: "gpt-4",
      inputTokens: 2000,
      outputTokens: 800,
      cost: 0.03,
      duration: 25000,
    });

    const summary = analyzer.getSummary();
    expect(summary.totalInputTokens).toBe(3000);
    expect(summary.totalOutputTokens).toBe(1300);
    expect(summary.totalCost).toBeCloseTo(0.045, 3);
    expect(summary.byAgent).toHaveLength(2);
    expect(summary.byProject).toHaveLength(1);
  });

  it("按 Agent 汇总", () => {
    const analyzer = new TokenUsageAnalyzer();
    analyzer.record({
      agentId: "claude-code",
      agentType: "claude",
      projectId: "p1",
      model: "claude-opus",
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0.015,
      duration: 30000,
    });
    analyzer.record({
      agentId: "claude-code",
      agentType: "claude",
      projectId: "p1",
      model: "claude-opus",
      inputTokens: 500,
      outputTokens: 200,
      cost: 0.008,
      duration: 15000,
    });

    const summary = analyzer.getSummary();
    expect(summary.byAgent).toHaveLength(1);
    expect(summary.byAgent[0].taskCount).toBe(2);
    expect(summary.byAgent[0].totalTokens).toBe(2200);
  });

  it("导出 CSV", () => {
    const analyzer = new TokenUsageAnalyzer();
    analyzer.record({
      agentId: "claude-code",
      agentType: "claude",
      projectId: "p1",
      model: "claude-opus",
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0.015,
      duration: 30000,
    });

    const csv = analyzer.exportCsv();
    expect(csv).toContain("recordId");
    expect(csv).toContain("claude-code");
    expect(csv.split("\n").length).toBe(2);
  });
});

describe("P2-004: AgentVendorComparator", () => {
  it("对比不同 Agent 供应商", () => {
    const analyzer = new TokenUsageAnalyzer();
    analyzer.record({
      agentId: "claude-code",
      agentType: "claude",
      projectId: "p1",
      model: "claude-opus",
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0.015,
      duration: 30000,
    });
    analyzer.record({
      agentId: "codex",
      agentType: "openai",
      projectId: "p1",
      model: "gpt-4",
      inputTokens: 2000,
      outputTokens: 800,
      cost: 0.03,
      duration: 25000,
    });

    const comparator = new AgentVendorComparator({
      tokenAnalyzer: analyzer,
      taskResults: [
        {
          agentId: "claude-code",
          agentType: "claude",
          success: true,
          reworked: false,
          mergeTimeHours: 2,
          hadConflict: false,
          duration: 30000,
        },
        {
          agentId: "codex",
          agentType: "openai",
          success: false,
          reworked: true,
          mergeTimeHours: 5,
          hadConflict: true,
          duration: 25000,
        },
      ],
    });

    const comparison = comparator.compare();
    expect(comparison.vendors).toHaveLength(2);
    expect(comparison.recommendation).toContain("推荐使用");
    // claude-code 成功率更高，应该排第一
    expect(comparison.vendors[0].agentId).toBe("claude-code");
    expect(comparison.vendors[0].successRate).toBe(1);
    expect(comparison.vendors[1].successRate).toBe(0);
  });
});

describe("P2-006: CodeownersParser", () => {
  it("解析 CODEOWNERS 文件", () => {
    const parser = new CodeownersParser();
    const content = `
# 注释
* @global-owner
src/auth/** @security-team @architect
db/migrations/** @db-team
*.md @docs-team
`;
    const rules = parser.parse(content);
    expect(rules).toHaveLength(4);
    expect(rules[0].pattern).toBe("*");
    expect(rules[0].owners).toEqual(["@global-owner"]);
    expect(rules[1].pattern).toBe("src/auth/**");
    expect(rules[1].owners).toEqual(["@security-team", "@architect"]);
  });

  it("匹配文件路径返回 owners", () => {
    const parser = new CodeownersParser();
    const rules = parser.parse(`
* @global-owner
src/auth/** @security-team
db/migrations/** @db-team
`);
    const owners = parser.matchOwners(rules, ["src/auth/login.ts", "db/migrations/001.sql"]);
    expect(owners).toContain("@security-team");
    expect(owners).toContain("@db-team");
  });

  it("后定义的规则优先级更高", () => {
    const parser = new CodeownersParser();
    const rules = parser.parse(`
src/** @team-a
src/auth/** @security-team
`);
    const owners = parser.matchOwners(rules, ["src/auth/login.ts"]);
    expect(owners).toContain("@security-team");
    expect(owners).not.toContain("@team-a");
  });
});
