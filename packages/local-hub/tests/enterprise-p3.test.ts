import { describe, it, expect } from "vitest";
import {
  ScimProvider,
  MultiTenantManager,
  ApprovalWorkflow,
  SchemaConflictDetector,
  CallChainConflictDetector,
  SkillPackFramework,
  PluginRegistry,
} from "../src/enterprise/index.js";

describe("P3-001: ScimProvider", () => {
  it("创建用户", async () => {
    const scim = new ScimProvider({ userStore: new Map(), groupStore: new Map() });
    const user = await scim.createUser({
      userName: "alice",
      displayName: "Alice",
      emails: [{ value: "alice@example.com", primary: true }],
      groups: ["developers"],
    });
    expect(user.userId).toBeTruthy();
    expect(user.username).toBe("alice");
    expect(user.roles).toContain("developer");
  });

  it("更新用户", async () => {
    const userStore = new Map();
    const scim = new ScimProvider({ userStore, groupStore: new Map() });
    const created = await scim.createUser({ userName: "bob", groups: ["viewers"] });
    const updated = await scim.updateUser(created.userId, {
      displayName: "Bob Smith",
      groups: ["admins"],
    });
    expect(updated?.displayName).toBe("Bob Smith");
    expect(updated?.roles).toContain("admin");
  });

  it("删除用户", async () => {
    const userStore = new Map();
    const scim = new ScimProvider({ userStore, groupStore: new Map() });
    const created = await scim.createUser({ userName: "charlie" });
    const deleted = await scim.deleteUser(created.userId);
    expect(deleted).toBe(true);
    expect(await scim.getUser(created.userId)).toBeNull();
  });

  it("组管理", async () => {
    const scim = new ScimProvider({ userStore: new Map(), groupStore: new Map() });
    const group = await scim.createGroup("Developers", ["user-1", "user-2"]);
    expect(group.members).toHaveLength(2);
    await scim.addGroupMembers(group.id, ["user-3"]);
    expect(group.members).toHaveLength(3);
    await scim.removeGroupMembers(group.id, ["user-1"]);
    expect(group.members).toHaveLength(2);
  });
});

describe("P3-002: MultiTenantManager", () => {
  it("创建租户和分配用户", () => {
    const mgr = new MultiTenantManager();
    mgr.createTenant("tenant-a", { name: "Company A" });
    mgr.assignUserToTenant("user-1", "tenant-a", ["developer"]);

    expect(mgr.checkAccess("user-1", "tenant-a")).toBe(true);
    expect(mgr.checkAccess("user-2", "tenant-a")).toBe(false);
    expect(mgr.getUserRoles("user-1", "tenant-a")).toEqual(["developer"]);
  });

  it("数据隔离检查", () => {
    const mgr = new MultiTenantManager();
    mgr.createTenant("tenant-a", { name: "Company A" });
    mgr.assignUserToTenant("user-1", "tenant-a", ["developer"]);
    mgr.addProjectToTenant("tenant-a", "project-1");

    const allowed = mgr.enforceIsolation("user-1", "tenant-a", "project-1");
    expect(allowed.allowed).toBe(true);

    const denied = mgr.enforceIsolation("user-1", "tenant-a", "project-2");
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain("project-2");
  });

  it("项目数量限制", () => {
    const mgr = new MultiTenantManager();
    mgr.createTenant("tenant-a", {
      name: "Company A",
      settings: { maxProjects: 1, maxUsers: 10, maxAgents: 5, storageLimitGb: 10 },
    });
    mgr.addProjectToTenant("tenant-a", "project-1");
    expect(() => mgr.addProjectToTenant("tenant-a", "project-2")).toThrow(/max projects/);
  });
});

describe("P3-003: ApprovalWorkflow", () => {
  it("请求审批并获得批准", () => {
    const workflow = new ApprovalWorkflow();
    // force_merge 默认需要 2 个批准，这里设置为 1 个
    workflow.setApprovalRule("force_merge", { requiredApprovals: 1, approvers: [], ttlHours: 24 });
    const req = workflow.requestApproval({
      type: "force_merge",
      requester: "alice",
      resource: "task-123",
      riskLevel: "high",
    });
    expect(req.status).toBe("pending");

    const approved = workflow.approve(req.requestId, "bob");
    expect(approved?.status).toBe("approved");
    expect(workflow.isApproved(req.requestId)).toBe(true);
  });

  it("需要多个批准", () => {
    const workflow = new ApprovalWorkflow();
    workflow.setApprovalRule("bulk_delete", { requiredApprovals: 2, approvers: [], ttlHours: 24 });

    const req = workflow.requestApproval({
      type: "bulk_delete",
      requester: "alice",
      resource: "tasks-batch",
      riskLevel: "critical",
    });

    const first = workflow.approve(req.requestId, "bob");
    expect(first?.status).toBe("pending");

    const second = workflow.approve(req.requestId, "charlie");
    expect(second?.status).toBe("approved");
  });

  it("拒绝审批", () => {
    const workflow = new ApprovalWorkflow();
    const req = workflow.requestApproval({
      type: "policy_override",
      requester: "alice",
      resource: "policy-1",
      riskLevel: "high",
    });

    const rejected = workflow.reject(req.requestId, "bob", "风险过高");
    expect(rejected?.status).toBe("rejected");
    expect(workflow.isApproved(req.requestId)).toBe(false);
  });

  it("列出待审批", () => {
    const workflow = new ApprovalWorkflow();
    workflow.requestApproval({
      type: "force_merge",
      requester: "alice",
      resource: "task-1",
      riskLevel: "high",
    });
    workflow.requestApproval({
      type: "config_change",
      requester: "bob",
      resource: "config-1",
      riskLevel: "medium",
    });

    const pending = workflow.listPending();
    expect(pending).toHaveLength(2);
  });
});

describe("P3-004: SchemaConflictDetector", () => {
  it("检测同一 migration 文件冲突", () => {
    const detector = new SchemaConflictDetector();
    const conflicts = detector.detect([
      {
        taskId: "task-1",
        migrations: [{ file: "001_add_users.sql", operations: ["CREATE TABLE users"] }],
      },
      {
        taskId: "task-2",
        migrations: [{ file: "001_add_users.sql", operations: ["CREATE TABLE users"] }],
      },
    ]);
    const sameFileConflicts = conflicts.filter((c) => c.type === "same_migration_file");
    expect(sameFileConflicts.length).toBeGreaterThan(0);
  });

  it("检测 DDL 冲突", () => {
    const detector = new SchemaConflictDetector();
    const conflicts = detector.detect([
      {
        taskId: "task-1",
        migrations: [{ file: "001.sql", operations: ["ALTER TABLE users ADD COLUMN name"] }],
      },
      {
        taskId: "task-2",
        migrations: [{ file: "002.sql", operations: ["ALTER TABLE users ADD COLUMN email"] }],
      },
    ]);
    const ddlConflicts = conflicts.filter(
      (c) => c.type === "ddl_conflict" || c.type === "table_overlap",
    );
    expect(ddlConflicts.length).toBeGreaterThan(0);
  });

  it("检测依赖缺失", () => {
    const detector = new SchemaConflictDetector();
    const conflicts = detector.detect([
      {
        taskId: "task-1",
        migrations: [
          {
            file: "002_add_posts.sql",
            operations: ["CREATE TABLE posts"],
            dependsOn: ["001_add_users.sql"],
          },
        ],
      },
    ]);
    const missingDeps = conflicts.filter((c) => c.type === "dependency_missing");
    expect(missingDeps.length).toBeGreaterThan(0);
  });
});

describe("P3-005: CallChainConflictDetector", () => {
  it("分析接口变更影响范围", () => {
    const detector = new CallChainConflictDetector();
    detector.buildGraph([
      { service: "auth-service", exports: ["login", "logout"], imports: [] },
      {
        service: "api-gateway",
        exports: [],
        imports: [{ service: "auth-service", functions: ["login"] }],
      },
      {
        service: "web-app",
        exports: [],
        imports: [{ service: "auth-service", functions: ["login", "logout"] }],
      },
    ]);

    const affected = detector.analyzeImpact("auth-service", "login");
    expect(affected).toContain("api-gateway");
    expect(affected).toContain("web-app");
  });

  it("检测接口破坏性变更", () => {
    const detector = new CallChainConflictDetector();
    detector.buildGraph([
      { service: "auth-service", exports: ["login"], imports: [] },
      {
        service: "api-gateway",
        exports: [],
        imports: [{ service: "auth-service", functions: ["login"] }],
      },
    ]);

    const conflicts = detector.detectConflicts(
      { service: "auth-service", modifiedFunctions: ["login"], removedFunctions: [] },
      { service: "api-gateway", modifiedFunctions: [], removedFunctions: [] },
    );
    const breakingConflicts = conflicts.filter((c) => c.type === "interface_breaking_change");
    expect(breakingConflicts.length).toBeGreaterThan(0);
  });

  it("检测函数被移除", () => {
    const detector = new CallChainConflictDetector();
    detector.buildGraph([
      { service: "user-service", exports: ["getUser"], imports: [] },
      {
        service: "api-gateway",
        exports: [],
        imports: [{ service: "user-service", functions: ["getUser"] }],
      },
    ]);

    const conflicts = detector.detectConflicts(
      { service: "user-service", modifiedFunctions: [], removedFunctions: ["getUser"] },
      { service: "api-gateway", modifiedFunctions: [], removedFunctions: [] },
    );
    const removedConflicts = conflicts.filter((c) => c.type === "function_removed");
    expect(removedConflicts.length).toBeGreaterThan(0);
  });
});

describe("P3-006: SkillPackFramework", () => {
  it("内置 3 个 Skill Pack", () => {
    const framework = new SkillPackFramework();
    const packs = framework.listPacks();
    expect(packs.length).toBeGreaterThanOrEqual(3);
    expect(packs.map((p) => p.id)).toContain("typescript-best-practices");
    expect(packs.map((p) => p.id)).toContain("security-review");
  });

  it("激活和检查文件", () => {
    const framework = new SkillPackFramework();
    framework.activate("security-review");

    const violations = framework.checkFile(
      "src/index.ts",
      `
      const password = "hardcoded-secret";
      eval("console.log('danger')");
    `,
    );

    expect(violations.length).toBeGreaterThan(0);
    const hasEvalViolation = violations.some((v) => v.ruleId === "no-eval");
    expect(hasEvalViolation).toBe(true);
  });

  it("停用 Pack 后不检查", () => {
    const framework = new SkillPackFramework();
    framework.activate("security-review");
    framework.deactivate("security-review");

    const violations = framework.checkFile("src/index.ts", 'eval("test")');
    expect(violations).toHaveLength(0);
  });
});

describe("P3-007: PluginRegistry", () => {
  it("注册和加载签名插件", () => {
    const registry = new PluginRegistry({
      trustedKeys: new Set(["key-1"]),
      currentVersion: "1.0.0",
    });

    const manifest = {
      pluginId: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "A test plugin",
      author: "test",
      entry: "./index.js",
      capabilities: ["custom-check"],
      agentgitopsVersionRange: "^1.0.0",
      signedByKey: "key-1",
    };

    // 计算签名
    const crypto = require("node:crypto") as {
      createHash: (alg: string) => {
        update: (data: string) => { digest: (enc: string) => string };
      };
    };
    const data = JSON.stringify({
      pluginId: manifest.pluginId,
      version: manifest.version,
      entry: manifest.entry,
      capabilities: manifest.capabilities,
    });
    const signature = crypto.createHash("sha256").update(`${data}:key-1`).digest("hex");

    const regResult = registry.registerPlugin(manifest, signature);
    expect(regResult.success).toBe(true);

    const loadResult = registry.loadPlugin("test-plugin", "1.0.0");
    expect(loadResult.success).toBe(true);
    expect(loadResult.manifest?.pluginId).toBe("test-plugin");
  });

  it("拒绝未签名插件（当不允许时）", () => {
    const registry = new PluginRegistry({
      trustedKeys: new Set(),
      allowUnsigned: false,
      currentVersion: "1.0.0",
    });

    const manifest = {
      pluginId: "unsigned-plugin",
      name: "Unsigned",
      version: "1.0.0",
      description: "",
      author: "",
      entry: "./index.js",
      capabilities: [],
      agentgitopsVersionRange: "^1.0.0",
    };

    const result = registry.registerPlugin(manifest);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not signed");
  });

  it("拒绝不可信签名密钥", () => {
    const registry = new PluginRegistry({
      trustedKeys: new Set(["trusted-key"]),
      currentVersion: "1.0.0",
    });

    const manifest = {
      pluginId: "bad-plugin",
      name: "Bad",
      version: "1.0.0",
      description: "",
      author: "",
      entry: "./index.js",
      capabilities: [],
      agentgitopsVersionRange: "^1.0.0",
      signedByKey: "untrusted-key",
    };

    const result = registry.registerPlugin(manifest, "fake-signature");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not in trusted keys");
  });

  it("版本兼容检查", () => {
    const registry = new PluginRegistry({
      trustedKeys: new Set(),
      allowUnsigned: true,
      currentVersion: "2.0.0",
    });

    const manifest = {
      pluginId: "incompatible",
      name: "Incompatible",
      version: "1.0.0",
      description: "",
      author: "",
      entry: "./index.js",
      capabilities: [],
      agentgitopsVersionRange: "^1.0.0",
    };

    const result = registry.registerPlugin(manifest);
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires agentgitops");
  });
});
