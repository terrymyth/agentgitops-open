import { describe, it, expect } from "vitest";
import {
  PostgresStorageAdapter,
  OidcIdentityProvider,
  RbacAuthorizationProvider,
  SiemAuditSink,
  EnterpriseComplianceReportProvider,
} from "@agentgitops/local-hub";
import type { EnterpriseUser } from "@agentgitops/core";

/**
 * ENG-003: 端到端测试增强
 *
 * 覆盖 P1 EE 基础设施端口的集成场景：
 * 1. RBAC + OIDC 联动：OIDC 认证用户 → RBAC 权限检查
 * 2. SIEM 哈希链 + 合规报告联动：审计事件 → 哈希链 → 合规报告
 * 3. PostgreSQL 适配器降级：无 pg 模块时的错误处理
 * 4. 完整企业治理流程：认证 → 授权 → 审计 → 合规
 */

describe("ENG-003: EE 基础设施端到端集成", () => {
  describe("RBAC + OIDC 联动", () => {
    it("OIDC 认证用户后，RBAC 按角色授权", () => {
      const identityProvider = new OidcIdentityProvider({
        issuer: "https://login.microsoftonline.com/test/v2.0",
        clientId: "test-client",
        roleMapping: {
          developers: "developer",
          reviewers: "reviewer",
          admins: "admin",
        },
      });

      const authProvider = new RbacAuthorizationProvider({
        projectAssignments: {
          "project-a": { alice: ["reviewer"] },
        },
      });

      // 模拟 OIDC 认证后的用户
      const alice: EnterpriseUser = {
        userId: "alice",
        username: "alice",
        displayName: "Alice",
        email: "alice@example.com",
        groups: ["developers"],
        roles: ["developer"],
      };

      identityProvider.setCurrentUser(alice);

      // alice 全局是 developer，在 project-a 是 reviewer
      const currentUser = identityProvider.getCurrentUser();
      expect(currentUser).not.toBeNull();

      // developer 可以创建任务
      const createResult = authProvider.checkPermission({
        user: currentUser!,
        resource: "task",
        action: "create",
      });
      expect(createResult.allowed).toBe(true);

      // 在 project-a 中有 reviewer 角色，可以审批
      const approveResult = authProvider.checkPermission({
        user: currentUser!,
        resource: "task",
        action: "approve",
        projectId: "project-a",
      });
      expect(approveResult.allowed).toBe(true);

      // 在 project-b 中只有 developer 角色，不能审批
      const approveResultB = authProvider.checkPermission({
        user: currentUser!,
        resource: "task",
        action: "approve",
        projectId: "project-b",
      });
      expect(approveResultB.allowed).toBe(false);
    });
  });

  describe("SIEM 哈希链 + 合规报告联动", () => {
    it("审计事件写入哈希链后，合规报告可聚合", async () => {
      const auditSink = new SiemAuditSink();
      const complianceProvider = new EnterpriseComplianceReportProvider({
        auditSink: {
          getEntries: () => auditSink.getEntries(),
        },
      });

      // 写入审计事件
      auditSink.appendImmutable({
        eventId: "evt-1",
        eventType: "policy.update",
        actorId: "admin",
        actorType: "user",
        projectId: "project-a",
        payload: { action: "high_risk_paths_updated" },
        timestamp: "2026-07-12T10:00:00Z",
      });

      auditSink.appendImmutable({
        eventId: "evt-2",
        eventType: "user.role.assign",
        actorId: "admin",
        actorType: "user",
        projectId: "project-a",
        payload: { user: "alice", role: "reviewer" },
        timestamp: "2026-07-12T10:05:00Z",
      });

      auditSink.appendImmutable({
        eventId: "evt-3",
        eventType: "verification.failed",
        actorId: "agent-1",
        actorType: "agent",
        projectId: "project-a",
        payload: { check: "lint", error: "syntax error" },
        timestamp: "2026-07-12T10:10:00Z",
      });

      // 验证哈希链完整
      const chainResult = auditSink.verifyChain();
      expect(chainResult.valid).toBe(true);

      // 生成 SOC2 合规报告
      const report = await complianceProvider.generate({
        format: "json",
        standard: "soc2",
        startDate: "2026-07-12T00:00:00Z",
        endDate: "2026-07-12T23:59:59Z",
        includeAuditEvents: true,
      });

      expect(report.summary.totalAuditEvents).toBe(3);
      expect(report.summary.totalPolicyChanges).toBe(1);
      expect(report.summary.totalAccessChanges).toBe(1);
      expect(report.summary.failedVerifications).toBe(1);
    });
  });

  describe("PostgreSQL 适配器降级", () => {
    it("连接失败时给出明确错误并释放连接池", async () => {
      const adapter = new PostgresStorageAdapter({
        type: "postgresql",
        url: "postgresql://127.0.0.1:1/test",
        timeoutMs: 50,
      });

      await expect(adapter.initialize()).rejects.toMatchObject({
        message: expect.stringMatching(/PostgreSQL adapter initialization failed/),
      });
      expect(adapter.isConnected()).toBe(false);
      await expect(adapter.healthCheck()).resolves.toEqual({
        healthy: false,
        error: "Pool not initialized",
      });
    });

    it("类型检查正确", () => {
      const adapter = new PostgresStorageAdapter({
        type: "postgresql",
        url: "postgresql://localhost/test",
      });

      expect(adapter.getType()).toBe("postgresql");
      expect(adapter.getVersion()).toBe("1.0.0");
      expect(adapter.isConnected()).toBe(false);
    });

    it("非 postgresql 类型抛出错误", () => {
      expect(
        () =>
          new PostgresStorageAdapter({
            type: "sqlite",
            url: "test.db",
          }),
      ).toThrow(/postgresql/);
    });
  });

  describe("完整企业治理流程", () => {
    it("认证 → 授权 → 审计 → 合规 完整闭环", async () => {
      // 1. 认证
      const identityProvider = new OidcIdentityProvider({
        issuer: "https://login.microsoftonline.com/test/v2.0",
        clientId: "test-client",
      });

      const admin: EnterpriseUser = {
        userId: "admin-1",
        username: "admin",
        displayName: "Admin",
        groups: ["admins"],
        roles: ["admin"],
      };
      identityProvider.setCurrentUser(admin);

      // 2. 授权
      const authProvider = new RbacAuthorizationProvider();
      const permResult = authProvider.checkPermission({
        user: admin,
        resource: "policy",
        action: "update",
      });
      expect(permResult.allowed).toBe(true);

      // 3. 审计
      const auditSink = new SiemAuditSink();
      const auditEntry = auditSink.appendImmutable({
        eventId: "evt-gov-1",
        eventType: "policy.update",
        actorId: admin.userId,
        actorType: "user",
        projectId: "project-a",
        payload: { action: "policy_updated", allowed: permResult.allowed },
        timestamp: new Date().toISOString(),
      });

      expect(auditEntry.currentHash).toBeTruthy();
      expect(auditEntry.previousHash).toBe("");

      // 4. 合规
      const complianceProvider = new EnterpriseComplianceReportProvider({
        auditSink: {
          getEntries: () => auditSink.getEntries(),
        },
      });

      const report = await complianceProvider.generate({
        format: "json",
        standard: "iso27001",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      });

      expect(report.summary.totalAuditEvents).toBe(1);
      expect(report.summary.totalPolicyChanges).toBe(1);

      // 验证链完整
      expect(auditSink.verifyChain().valid).toBe(true);
    });
  });

  describe("SIEM 多格式导出", () => {
    it("同一审计事件可导出为多种格式", async () => {
      const auditSink = new SiemAuditSink();

      auditSink.appendImmutable({
        eventId: "evt-export-1",
        eventType: "task.merge",
        actorId: "bob",
        actorType: "user",
        projectId: "project-a",
        payload: { taskId: "task-001" },
        timestamp: "2026-07-12T10:00:00Z",
      });

      // JSON 格式
      const jsonExport = await auditSink.export({ format: "json" });
      const jsonParsed = JSON.parse(jsonExport) as unknown[];
      expect(jsonParsed).toHaveLength(1);

      // CSV 格式
      const csvExport = await auditSink.export({ format: "csv" });
      const csvLines = csvExport.split("\n");
      expect(csvLines.length).toBe(2); // header + 1 row
      expect(csvExport).toContain("evt-export-1");

      // SIEM-JSON 格式（每行一个事件）
      const siemExport = await auditSink.export({ format: "siem-json" });
      const siemLines = siemExport.trim().split("\n");
      expect(siemLines).toHaveLength(1);
      const siemParsed = JSON.parse(siemLines[0]) as { event: { eventId: string } };
      expect(siemParsed.event.eventId).toBe("evt-export-1");
    });
  });

  describe("RBAC 权限矩阵完整性", () => {
    it("五角色权限层级正确", () => {
      const provider = new RbacAuthorizationProvider();

      const roles: EnterpriseUser["roles"] = ["viewer", "developer", "reviewer", "owner", "admin"];
      const users = roles.map((role, i) => ({
        userId: `user-${role}`,
        username: role,
        displayName: role,
        groups: [],
        roles: [role],
      })) as EnterpriseUser[];

      // viewer: 只能读
      expect(
        provider.checkPermission({ user: users[0], resource: "task", action: "read" }).allowed,
      ).toBe(true);
      expect(
        provider.checkPermission({ user: users[0], resource: "task", action: "create" }).allowed,
      ).toBe(false);

      // developer: 可以创建但不能审批
      expect(
        provider.checkPermission({ user: users[1], resource: "task", action: "create" }).allowed,
      ).toBe(true);
      expect(
        provider.checkPermission({ user: users[1], resource: "task", action: "approve" }).allowed,
      ).toBe(false);

      // reviewer: 可以审批但不能删除
      expect(
        provider.checkPermission({ user: users[2], resource: "task", action: "approve" }).allowed,
      ).toBe(true);
      expect(
        provider.checkPermission({ user: users[2], resource: "task", action: "delete" }).allowed,
      ).toBe(false);

      // owner: 可以删除
      expect(
        provider.checkPermission({ user: users[3], resource: "task", action: "delete" }).allowed,
      ).toBe(true);

      // admin: 可以做任何事
      expect(
        provider.checkPermission({ user: users[4], resource: "anything", action: "whatever" })
          .allowed,
      ).toBe(true);
    });
  });
});
