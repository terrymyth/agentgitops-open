import { describe, it, expect } from "vitest";
import {
  AgentAdapterRegistry,
  ConfigLoader,
  createRuntimeExtensionRegistry,
  getGlobalAdapterRegistry,
  createEnterpriseExtensions,
  getExtensionSummary,
  resolveEnterpriseExtensionConfig,
} from "../src/index.js";

describe("P0: EE 模块注入集成", () => {
  it("CE 模式使用 CE 默认实现", async () => {
    const extensions = await createEnterpriseExtensions({ license: "ce" });
    expect(extensions.licenseProvider).toBeDefined();
    expect(extensions.identityProvider).toBeDefined();
    expect(extensions.authorizationProvider).toBeDefined();
    expect(extensions.storageAdapter).toBeDefined();

    const summary = getExtensionSummary(extensions);
    expect(summary.storageType).toBe("sqlite");
    expect(summary.identityProviderType).toBe("CeIdentityProvider");
  });

  it("EE 模式注入 EE 实现", async () => {
    const extensions = await createEnterpriseExtensions({
      license: "enterprise",
      oidc: {
        issuer: "https://test",
        clientId: "test",
        jwksUri: "https://test/.well-known/jwks.json",
      },
      rbac: { superAdmins: ["admin"] },
    });

    expect(extensions.licenseProvider).toBeDefined();
    // OIDC 应注入成功
    expect(extensions.identityProvider?.constructor.name).toBe("OidcIdentityProvider");
    // RBAC 应注入成功
    expect(extensions.authorizationProvider?.constructor.name).toBe("RbacAuthorizationProvider");
    // SIEM 应注入成功
    expect(extensions.immutableAuditSink?.constructor.name).toBe("SiemAuditSink");
    // 合规报告应注入成功
    expect(extensions.complianceReportProvider?.constructor.name).toBe(
      "EnterpriseComplianceReportProvider",
    );
  });

  it("getExtensionSummary 返回正确摘要", async () => {
    const extensions = await createEnterpriseExtensions({
      license: "enterprise",
      oidc: {
        issuer: "https://test",
        clientId: "test",
        jwksUri: "https://test/.well-known/jwks.json",
      },
      rbac: {},
    });

    const summary = getExtensionSummary(extensions);
    expect(summary.isEnterprise).toBe(true);
    expect(summary.enabledFeatures).toContain("sso");
    expect(summary.enabledFeatures).toContain("rbac");
    expect(summary.enabledFeatures).toContain("immutable-audit");
    expect(summary.enabledFeatures).toContain("compliance-report");
  });

  it("无 license 时使用 CE 默认", async () => {
    const extensions = await createEnterpriseExtensions({});
    const summary = getExtensionSummary(extensions);
    expect(summary.storageType).toBe("sqlite");
    expect(summary.identityProviderType).toBe("CeIdentityProvider");
  });

  it("从配置解析 EE 运行时扩展", async () => {
    const config = ConfigLoader.generateDefault("runtime-ee");
    config.enterprise = {
      enabled: true,
      license: "enterprise",
      oidc: {
        issuer: "https://idp.example.test",
        clientId: "agentgitops",
        jwksUri: "https://idp.example.test/.well-known/jwks.json",
      },
      rbac: { superAdmins: ["owner@example.test"] },
    };

    const registry = await createRuntimeExtensionRegistry(config, {});
    expect(registry.identityProvider?.constructor.name).toBe("OidcIdentityProvider");
    expect(registry.authorizationProvider?.constructor.name).toBe("RbacAuthorizationProvider");
    expect(registry.immutableAuditSink?.constructor.name).toBe("SiemAuditSink");
    expect(registry.complianceReportProvider?.constructor.name).toBe(
      "EnterpriseComplianceReportProvider",
    );
  });

  it("PostgreSQL 配置失败时默认拒绝启动", async () => {
    await expect(
      createEnterpriseExtensions({
        license: "enterprise",
        storage: {
          type: "postgresql",
          url: "postgresql://127.0.0.1:1/agentgitops",
          timeoutMs: 50,
        },
      }),
    ).rejects.toThrow(/PostgreSQL storage initialization failed/);
  });

  it("仅在显式允许时将 PostgreSQL 降级为 SQLite", async () => {
    const extensions = await createEnterpriseExtensions({
      license: "enterprise",
      allowCeFallback: true,
      storage: {
        type: "postgresql",
        url: "postgresql://127.0.0.1:1/agentgitops",
        timeoutMs: 50,
      },
    });

    expect(extensions.storageAdapter?.getType()).toBe("sqlite");
  });

  it("环境变量优先覆盖 EE license/storage 解析", () => {
    const config = ConfigLoader.generateDefault("runtime-env");
    config.enterprise = {
      enabled: true,
      license: "team",
      storage: { type: "sqlite", url: ".agentgitops/db.sqlite" },
    };

    const resolution = resolveEnterpriseExtensionConfig(config, {
      AGENTGITOPS_EDITION: "enterprise-plus",
      AGENTGITOPS_STORAGE_TYPE: "postgresql",
      AGENTGITOPS_DATABASE_URL: "postgresql://example/agentgitops",
      AGENTGITOPS_STORAGE_POOL_SIZE: "7",
      AGENTGITOPS_STORAGE_SSL: "true",
    });

    expect(resolution.extensionConfig.license).toBe("enterprise-plus");
    expect(resolution.sources.license).toBe("env");
    expect(resolution.extensionConfig.storage).toEqual({
      type: "postgresql",
      url: "postgresql://example/agentgitops",
      poolSize: 7,
      timeoutMs: undefined,
      ssl: true,
    });
    expect(resolution.sources.storage).toBe("env");
  });
});

describe("P1: Agent Adapter 插件化注册", () => {
  it("内置 4 个适配器", () => {
    const registry = new AgentAdapterRegistry();
    const types = registry.listTypes();
    expect(types).toContain("generic-cli");
    expect(types).toContain("claude-code");
    expect(types).toContain("codex");
    expect(types).toContain("opencode");
  });

  it("创建内置适配器", () => {
    const registry = new AgentAdapterRegistry();
    const adapter = registry.create("claude-code", { type: "claude-code" });
    expect(adapter).toBeDefined();
    expect(adapter.type).toBe("claude-code");
  });

  it("注册自定义适配器", () => {
    const registry = new AgentAdapterRegistry();
    // 使用内置的 generic-cli 作为自定义注册的模拟
    registry.register(
      "my-custom-agent",
      { create: () => new (require("../src/agent-adapters.js").GenericAgentAdapter)() },
      "自定义适配器",
    );

    expect(registry.has("my-custom-agent")).toBe(true);
    const info = registry.getAdapterInfo("my-custom-agent");
    expect(info?.description).toBe("自定义适配器");
    expect(info?.builtIn).toBe(false);
  });

  it("不能覆盖内置适配器", () => {
    const registry = new AgentAdapterRegistry();
    expect(() =>
      registry.register("claude-code", {
        create: () => new (require("../src/agent-adapters.js").ClaudeCodeAgentAdapter)(),
      }),
    ).toThrow(/Cannot override built-in/);
  });

  it("注销自定义适配器", () => {
    const registry = new AgentAdapterRegistry();
    registry.register("custom", {
      create: () => new (require("../src/agent-adapters.js").GenericAgentAdapter)(),
    });
    expect(registry.has("custom")).toBe(true);

    const unregistered = registry.unregister("custom");
    expect(unregistered).toBe(true);
    expect(registry.has("custom")).toBe(false);
  });

  it("不能注销内置适配器", () => {
    const registry = new AgentAdapterRegistry();
    expect(registry.unregister("claude-code")).toBe(false);
  });

  it("列出适配器含描述", () => {
    const registry = new AgentAdapterRegistry();
    const adapters = registry.listAdapters();
    const claude = adapters.find((a) => a.type === "claude-code");
    expect(claude?.description).toContain("Claude Code");
    expect(claude?.builtIn).toBe(true);
  });

  it("全局注册表单例", () => {
    const r1 = getGlobalAdapterRegistry();
    const r2 = getGlobalAdapterRegistry();
    expect(r1).toBe(r2);
  });
});
