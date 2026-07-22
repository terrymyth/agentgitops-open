import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import {
  ConfigLoader,
  mergePolicyConfigs,
  createExtensionRegistryFromConfig,
  listConfiguredExtensionModules,
  resolveTaskTemplate,
} from "../src/index.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agops-cfg-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("ConfigLoader", () => {
  it("should generate default config", () => {
    const config = ConfigLoader.generateDefault("my-project");
    expect(config.version).toBe(1);
    expect(config.project.name).toBe("my-project");
    expect(config.project.default_branch).toBe("main");
    expect(config.git.provider).toBe("github");
    expect(config.team?.sync).toMatchObject({
      tasks: true,
      agentExecution: false,
      mode: "manual",
      intervalSeconds: 60,
    });
  });

  it("should init project and create files", async () => {
    const configPath = await ConfigLoader.init(tmpDir, "test-project");
    expect(configPath).toContain(".agentgitops.yml");

    // 配置文件存在
    const stat = await fs.stat(configPath);
    expect(stat.isFile()).toBe(true);

    // 目录结构存在
    await fs.access(path.join(tmpDir, ".agentgitops", "tasks"));
    await fs.access(path.join(tmpDir, ".agentgitops", "logs"));
  });

  it("should load and validate config", async () => {
    await ConfigLoader.init(tmpDir, "test-project");
    const config = await ConfigLoader.load(tmpDir);
    expect(config.project.name).toBe("test-project");
    expect(config.version).toBe(1);
  });

  it("should throw if config not found", async () => {
    await expect(ConfigLoader.load(tmpDir)).rejects.toThrow("Config not found");
  });

  it("should throw if config already exists without force", async () => {
    await ConfigLoader.init(tmpDir, "test-project");
    await expect(ConfigLoader.init(tmpDir, "test-project")).rejects.toThrow("already exists");
  });

  it("should overwrite with force", async () => {
    await ConfigLoader.init(tmpDir, "test-project");
    const configPath = await ConfigLoader.init(tmpDir, "new-name", { force: true });
    const config = await ConfigLoader.load(tmpDir);
    expect(config.project.name).toBe("new-name");
  });

  it("should register an agent into config", async () => {
    await ConfigLoader.init(tmpDir, "test-project");
    await ConfigLoader.registerAgent(tmpDir, {
      name: "codex",
      type: "generic-cli",
      command: "codex",
      args: ["run", "{{task_prompt_file}}"],
      env: { CODEX_HOME: ".codex" },
    });

    const config = await ConfigLoader.load(tmpDir);
    expect(config.agents.codex.command).toBe("codex");
    expect(config.agents.codex.args).toEqual(["run", "{{task_prompt_file}}"]);
    expect(config.agents.codex.env).toEqual({ CODEX_HOME: ".codex" });
  });

  it("should validate config", () => {
    expect(() => ConfigLoader.validate({} as never)).toThrow("version");
    expect(() => ConfigLoader.validate({ version: 1 } as never)).toThrow("project.name");
  });

  it("discovers configured extension modules without loading code", () => {
    const config = ConfigLoader.generateDefault("my-project");
    config.extensions = {
      enabled: true,
      modules: [
        { name: "enterprise-audit", package: "@agentgitops/ee-audit" },
        { name: "disabled-policy", package: "@agentgitops/ee-policy", enabled: false },
      ],
    };

    expect(listConfiguredExtensionModules(config)).toEqual([
      { name: "enterprise-audit", package: "@agentgitops/ee-audit", enabled: true },
      { name: "disabled-policy", package: "@agentgitops/ee-policy", enabled: false },
    ]);
    expect(createExtensionRegistryFromConfig(config).listConfiguredModules()).toEqual(
      listConfiguredExtensionModules(config),
    );
  });

  it("rejects invalid extension module configuration", () => {
    const config = ConfigLoader.generateDefault("my-project");
    config.extensions = { enabled: true, modules: [{ name: "audit" }, { name: "audit" }] };

    expect(() => ConfigLoader.validate(config)).toThrow("duplicate extension module");
  });

  it("requires a JWKS endpoint for OIDC JWT validation", () => {
    const config = ConfigLoader.generateDefault("my-project");
    config.enterprise = {
      enabled: true,
      license: "enterprise",
      oidc: { issuer: "https://idp.example.test", clientId: "agentgitops" },
    };

    expect(() => ConfigLoader.validate(config)).toThrow("enterprise.oidc.jwksUri");

    config.enterprise.oidc!.jwksUri = "https://idp.example.test/.well-known/jwks.json";
    expect(() => ConfigLoader.validate(config)).not.toThrow();
  });

  it("requires an introspection endpoint when OIDC introspection is enabled", () => {
    const config = ConfigLoader.generateDefault("my-project");
    config.enterprise = {
      enabled: true,
      license: "enterprise",
      oidc: {
        issuer: "https://idp.example.test",
        clientId: "agentgitops",
        useIntrospection: true,
      },
    };

    expect(() => ConfigLoader.validate(config)).toThrow("enterprise.oidc.introspectionEndpoint");

    config.enterprise.oidc!.introspectionEndpoint = "https://idp.example.test/oauth/introspect";
    expect(() => ConfigLoader.validate(config)).not.toThrow();
  });

  it("merges organization policies before project policies", () => {
    const config = ConfigLoader.generateDefault("my-project");
    config.organization = {
      policies: {
        branch: { protected: ["main", "release/*"] },
        paths: { forbidden: ["secrets/**"], high_risk: ["billing/**"] },
        approval: { required_reviewers: { "billing/**": ["@finance"] } },
        checks: { required: [{ name: "org-lint", command: "pnpm lint" }] },
      },
    };
    config.policies = mergePolicyConfigs(config.organization.policies, {
      branch: { protected: ["main", "hotfix/*"] },
      paths: { forbidden: ["*.pem"] },
      approval: { required_reviewers: { "billing/**": ["@security"] } },
      checks: { required: [{ name: "project-test", command: "pnpm test" }] },
    });

    expect(config.policies?.branch?.protected).toEqual(["main", "release/*", "hotfix/*"]);
    expect(config.policies?.paths?.forbidden).toEqual(["secrets/**", "*.pem"]);
    expect(config.policies?.approval?.required_reviewers?.["billing/**"]).toEqual([
      "@finance",
      "@security",
    ]);
    expect(config.policies?.checks?.required?.map((check) => check.name)).toEqual([
      "org-lint",
      "project-test",
    ]);
  });

  it("resolves task templates from config", () => {
    const config = ConfigLoader.generateDefault("my-project");
    config.task_templates = {
      frontend: {
        agent: "codex",
        allowed_paths: ["apps/web/**"],
        required_checks: ["pnpm --filter @agentgitops/web test"],
        risk_level: "medium",
      },
    };

    expect(resolveTaskTemplate(config, "frontend")).toMatchObject({
      agent: "codex",
      allowed_paths: ["apps/web/**"],
      risk_level: "medium",
    });
    expect(() => resolveTaskTemplate(config, "missing")).toThrow("Task template not found");
  });
});
