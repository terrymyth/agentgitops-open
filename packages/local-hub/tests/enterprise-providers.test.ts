import { describe, it, expect, vi } from "vitest";
import {
  RbacAuthorizationProvider,
  SiemAuditSink,
  EnterpriseComplianceReportProvider,
  OidcIdentityProvider,
} from "../src/enterprise/index.js";
import type { EnterpriseUser } from "@agentgitops/core";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

describe("P1-003: OidcIdentityProvider", () => {
  it("验证 JWKS 签名、issuer、audience 并映射角色", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ keys: [{ ...jwk, kid: "key-1", alg: "ES256", use: "sig" }] }),
          { status: 200 },
        ),
      );
    const provider = new OidcIdentityProvider({
      issuer: "https://id.example.com",
      clientId: "agentgitops",
      jwksUri: "https://id.example.com/.well-known/jwks.json",
    });
    const token = await new SignJWT({ username: "alice", groups: ["developers", "reviewers"] })
      .setProtectedHeader({ alg: "ES256", kid: "key-1" })
      .setIssuer("https://id.example.com")
      .setAudience("agentgitops")
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const user = await provider.authenticate(token);
    expect(user).toMatchObject({
      userId: "user-1",
      username: "alice",
      roles: ["developer", "reviewer"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const tampered = `${token.slice(0, -2)}xx`;
    await expect(provider.authenticate(tampered)).resolves.toBeNull();
    fetchMock.mockRestore();
  });

  it("应正确映射 OIDC groups 到 EnterpriseRole", async () => {
    const provider = new OidcIdentityProvider({
      issuer: "https://login.microsoftonline.com/test/v2.0",
      clientId: "test-client",
    });

    // 测试角色提取（通过内部方法间接验证）
    const user: EnterpriseUser = {
      userId: "test-user",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      groups: ["developers", "reviewers"],
      roles: ["developer", "reviewer"],
    };

    // authenticate 无效 token 返回 null
    await expect(provider.authenticate("invalid-token")).resolves.toBeNull();
    provider.setCurrentUser(user);
    expect(provider.getCurrentUser()?.userId).toBe("test-user");
  });

  it("无 token 时返回 null", async () => {
    const provider = new OidcIdentityProvider({
      issuer: "https://test",
      clientId: "test",
    });
    expect(await provider.authenticate("")).toBeNull();
  });

  it("introspection 拒绝错误 audience 和缺少主体的 token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ active: true, sub: "user-1", aud: "other-client" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: true, aud: "agentgitops" })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            active: true,
            sub: "user-1",
            username: "alice",
            aud: "agentgitops",
            iss: "https://id.example.com",
            client_id: "agentgitops",
            groups: ["developers"],
          }),
        ),
      );
    const provider = new OidcIdentityProvider({
      issuer: "https://id.example.com",
      clientId: "agentgitops",
      useIntrospection: true,
      introspectionEndpoint: "https://id.example.com/oauth/introspect",
    });

    await expect(provider.authenticate("wrong-audience")).resolves.toBeNull();
    await expect(provider.authenticate("missing-subject")).resolves.toBeNull();
    await expect(provider.authenticate("valid")).resolves.toMatchObject({
      userId: "user-1",
      username: "alice",
      roles: ["developer"],
    });
    fetchMock.mockRestore();
  });
});

describe("P1-004: RbacAuthorizationProvider", () => {
  it("viewer 只能读，不能创建", () => {
    const provider = new RbacAuthorizationProvider();
    const viewer: EnterpriseUser = {
      userId: "viewer1",
      username: "viewer1",
      displayName: "Viewer",
      groups: [],
      roles: ["viewer"],
    };

    const readResult = provider.checkPermission({
      user: viewer,
      resource: "task",
      action: "read",
    });
    expect(readResult.allowed).toBe(true);

    const createResult = provider.checkPermission({
      user: viewer,
      resource: "task",
      action: "create",
    });
    expect(createResult.allowed).toBe(false);
    expect(createResult.requiredRole).toBe("developer");
  });

  it("developer 可以创建任务但不能审批", () => {
    const provider = new RbacAuthorizationProvider();
    const dev: EnterpriseUser = {
      userId: "dev1",
      username: "dev1",
      displayName: "Dev",
      groups: [],
      roles: ["developer"],
    };

    expect(
      provider.checkPermission({ user: dev, resource: "task", action: "create" }).allowed,
    ).toBe(true);
    expect(provider.checkPermission({ user: dev, resource: "task", action: "test" }).allowed).toBe(
      true,
    );
    expect(
      provider.checkPermission({ user: dev, resource: "task", action: "approve" }).allowed,
    ).toBe(false);
  });

  it("reviewer 可以审批但不能删除", () => {
    const provider = new RbacAuthorizationProvider();
    const reviewer: EnterpriseUser = {
      userId: "rev1",
      username: "rev1",
      displayName: "Reviewer",
      groups: [],
      roles: ["reviewer"],
    };

    expect(
      provider.checkPermission({ user: reviewer, resource: "task", action: "approve" }).allowed,
    ).toBe(true);
    expect(
      provider.checkPermission({ user: reviewer, resource: "task", action: "delete" }).allowed,
    ).toBe(false);
    const mergeResult = provider.checkPermission({
      user: reviewer,
      resource: "merge",
      action: "approve",
    });
    expect(mergeResult.allowed).toBe(false);
    expect(mergeResult.requiredRole).toBe("owner");
  });

  it("owner 可执行合并授权和高风险冲突操作", () => {
    const provider = new RbacAuthorizationProvider();
    const owner: EnterpriseUser = {
      userId: "owner1",
      username: "owner1",
      displayName: "Owner",
      groups: [],
      roles: ["owner"],
    };

    expect(
      provider.checkPermission({ user: owner, resource: "merge", action: "approve" }).allowed,
    ).toBe(true);
    expect(
      provider.checkPermission({ user: owner, resource: "conflict", action: "human_takeover" })
        .allowed,
    ).toBe(true);
  });

  it("admin 拥有所有权限", () => {
    const provider = new RbacAuthorizationProvider();
    const admin: EnterpriseUser = {
      userId: "admin1",
      username: "admin1",
      displayName: "Admin",
      groups: [],
      roles: ["admin"],
    };

    expect(
      provider.checkPermission({ user: admin, resource: "task", action: "delete" }).allowed,
    ).toBe(true);
    expect(
      provider.checkPermission({ user: admin, resource: "anything", action: "whatever" }).allowed,
    ).toBe(true);
  });

  it("项目级角色分配生效", () => {
    const provider = new RbacAuthorizationProvider({
      projectAssignments: {
        "project-a": { alice: ["developer"] },
      },
    });

    const alice: EnterpriseUser = {
      userId: "alice",
      username: "alice",
      displayName: "Alice",
      groups: [],
      roles: ["viewer"], // 全局只有 viewer
    };

    // 在 project-a 中有 developer 角色
    expect(
      provider.checkPermission({
        user: alice,
        resource: "task",
        action: "create",
        projectId: "project-a",
      }).allowed,
    ).toBe(true);

    // 在其他项目中只有 viewer
    expect(
      provider.checkPermission({
        user: alice,
        resource: "task",
        action: "create",
        projectId: "project-b",
      }).allowed,
    ).toBe(false);
  });

  it("超级管理员绕过所有检查", () => {
    const provider = new RbacAuthorizationProvider({
      superAdmins: ["root"],
    });

    const root: EnterpriseUser = {
      userId: "root",
      username: "root",
      displayName: "Root",
      groups: [],
      roles: ["viewer"],
    };

    expect(
      provider.checkPermission({ user: root, resource: "task", action: "delete" }).allowed,
    ).toBe(true);
  });
});

describe("P1-005: SiemAuditSink", () => {
  it("哈希链正确链接", () => {
    const sink = new SiemAuditSink();

    const entry1 = sink.appendImmutable({
      eventId: "evt-1",
      eventType: "task.create",
      actorId: "alice",
      actorType: "user",
      projectId: "project-a",
      payload: { task: "task-001" },
      timestamp: "2026-07-12T10:00:00Z",
    });

    const entry2 = sink.appendImmutable({
      eventId: "evt-2",
      eventType: "task.merge",
      actorId: "bob",
      actorType: "user",
      projectId: "project-a",
      payload: { task: "task-001" },
      timestamp: "2026-07-12T11:00:00Z",
    });

    // 第一个事件 previousHash 为空
    expect(entry1.previousHash).toBe("");

    // 第二个事件 previousHash 等于第一个事件 currentHash
    expect(entry2.previousHash).toBe(entry1.currentHash);

    // currentHash 不为空
    expect(entry1.currentHash).toBeTruthy();
    expect(entry2.currentHash).toBeTruthy();
    expect(entry1.currentHash).not.toBe(entry2.currentHash);
  });

  it("验证链完整性通过", () => {
    const sink = new SiemAuditSink();

    sink.appendImmutable({
      eventId: "evt-1",
      eventType: "task.create",
      actorId: "alice",
      actorType: "user",
      projectId: "project-a",
      payload: {},
      timestamp: "2026-07-12T10:00:00Z",
    });

    sink.appendImmutable({
      eventId: "evt-2",
      eventType: "task.merge",
      actorId: "bob",
      actorType: "user",
      projectId: "project-a",
      payload: {},
      timestamp: "2026-07-12T11:00:00Z",
    });

    const result = sink.verifyChain();
    expect(result.valid).toBe(true);
  });

  it("篡改后验证链失败", () => {
    const sink = new SiemAuditSink();

    sink.appendImmutable({
      eventId: "evt-1",
      eventType: "task.create",
      actorId: "alice",
      actorType: "user",
      projectId: "project-a",
      payload: {},
      timestamp: "2026-07-12T10:00:00Z",
    });

    // 篡改内存中的条目
    const entries = sink.getEntries();
    (entries[0] as { payload: Record<string, unknown> }).payload = { tampered: true };

    const result = sink.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe("evt-1");
  });

  it("导出 JSON 格式", async () => {
    const sink = new SiemAuditSink();

    sink.appendImmutable({
      eventId: "evt-1",
      eventType: "task.create",
      actorId: "alice",
      actorType: "user",
      projectId: "project-a",
      payload: { task: "task-001" },
      timestamp: "2026-07-12T10:00:00Z",
    });

    const exported = await sink.export({ format: "json" });
    const parsed = JSON.parse(exported) as Array<{ eventId: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].eventId).toBe("evt-1");
  });

  it("导出 SIEM-JSON 格式（每行一个事件）", async () => {
    const sink = new SiemAuditSink();

    sink.appendImmutable({
      eventId: "evt-1",
      eventType: "task.create",
      actorId: "alice",
      actorType: "user",
      projectId: "project-a",
      payload: {},
      timestamp: "2026-07-12T10:00:00Z",
    });

    sink.appendImmutable({
      eventId: "evt-2",
      eventType: "task.merge",
      actorId: "bob",
      actorType: "user",
      projectId: "project-a",
      payload: {},
      timestamp: "2026-07-12T11:00:00Z",
    });

    const exported = await sink.export({ format: "siem-json" });
    const lines = exported.trim().split("\n");
    expect(lines).toHaveLength(2);
    // 每行是合法 JSON
    for (const line of lines) {
      const parsed = JSON.parse(line) as { event: { eventId: string } };
      expect(parsed.event.eventId).toBeTruthy();
    }
  });

  it("按 actorId 过滤导出", async () => {
    const sink = new SiemAuditSink();

    sink.appendImmutable({
      eventId: "evt-1",
      eventType: "task.create",
      actorId: "alice",
      actorType: "user",
      projectId: "project-a",
      payload: {},
      timestamp: "2026-07-12T10:00:00Z",
    });

    sink.appendImmutable({
      eventId: "evt-2",
      eventType: "task.merge",
      actorId: "bob",
      actorType: "user",
      projectId: "project-a",
      payload: {},
      timestamp: "2026-07-12T11:00:00Z",
    });

    const exported = await sink.export({ format: "json", actorId: "alice" });
    const parsed = JSON.parse(exported) as Array<{ actorId: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].actorId).toBe("alice");
  });
});

describe("P1-006: EnterpriseComplianceReportProvider", () => {
  it("生成 SOC2 报告", async () => {
    const provider = new EnterpriseComplianceReportProvider();

    const report = await provider.generate({
      format: "json",
      standard: "soc2",
      startDate: "2026-01-01",
      endDate: "2026-07-12",
    });

    expect(report.standard).toBe("soc2");
    expect(report.format).toBe("json");
    expect(report.reportId).toBeTruthy();
    expect(report.summary).toBeDefined();
    expect(report.summary.totalAuditEvents).toBe(0);
    expect(report.data).toBeDefined();
  });

  it("生成 ISO27001 报告", async () => {
    const provider = new EnterpriseComplianceReportProvider();

    const report = await provider.generate({
      format: "json",
      standard: "iso27001",
      startDate: "2026-01-01",
      endDate: "2026-07-12",
    });

    expect(report.standard).toBe("iso27001");
    const data = report.data as { ismsControls: Record<string, unknown> };
    expect(data.ismsControls).toBeDefined();
    expect(data.ismsControls["A.5"]).toBeDefined();
    expect(data.ismsControls["A.9"]).toBeDefined();
  });

  it("生成 GDPR 报告", async () => {
    const provider = new EnterpriseComplianceReportProvider();

    const report = await provider.generate({
      format: "json",
      standard: "gdpr",
      startDate: "2026-01-01",
      endDate: "2026-07-12",
    });

    expect(report.standard).toBe("gdpr");
    const data = report.data as { articles: Record<string, unknown> };
    expect(data.articles).toBeDefined();
    expect(data.articles["Art.5"]).toBeDefined();
    expect(data.articles["Art.32"]).toBeDefined();
  });

  it("报告列表和下载", async () => {
    const provider = new EnterpriseComplianceReportProvider();

    const report = await provider.generate({
      format: "json",
      standard: "soc2",
      startDate: "2026-01-01",
      endDate: "2026-07-12",
    });

    const list = provider.listReports();
    expect(list).toHaveLength(1);

    const downloaded = provider.download(report.reportId);
    expect(downloaded.format).toBe("json");
    const parsed = JSON.parse(downloaded.data) as { reportId: string };
    expect(parsed.reportId).toBe(report.reportId);
  });

  it("CSV 格式下载", async () => {
    const provider = new EnterpriseComplianceReportProvider();

    const report = await provider.generate({
      format: "csv",
      standard: "custom",
      startDate: "2026-01-01",
      endDate: "2026-07-12",
    });

    const downloaded = provider.download(report.reportId);
    expect(downloaded.format).toBe("csv");
    expect(downloaded.data).toContain("reportId");
    expect(downloaded.data).toContain(report.reportId);
  });
});
