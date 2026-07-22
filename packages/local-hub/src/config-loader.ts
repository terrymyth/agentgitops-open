import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import {
  CONFIG_FILENAME,
  CONFIG_DIR,
  CONFIG_VERSION,
  DEFAULT_WORKTREE_ROOT,
  runCrossPlatformCommand,
} from "@agentgitops/core";
import type { RiskLevel, TaskStatus } from "@agentgitops/core";
import type { StorageConfig } from "@agentgitops/core";

export interface PolicyConfig {
  branch?: { protected?: string[] };
  paths?: { high_risk?: string[]; forbidden?: string[]; forbidden_for_agents?: string[] };
  commands?: {
    /** 允许执行的命令或 glob；为空则不限制 allowlist */
    allowed?: string[];
    /** 禁止 Agent/Verification 执行的命令或 glob */
    forbidden?: string[];
  };
  approval?: {
    high_risk_paths_require_review?: boolean;
    required_reviewers?: Record<string, string[]>;
  };
  checks?: {
    required?: { name: string; command: string }[];
    github?: {
      enabled?: boolean;
      require_success?: boolean;
      ref?: "target_branch" | "base_branch";
    };
  };
  merge?: {
    allow_auto_merge_for_low_risk?: boolean;
    block_merge_if_unverified_items_exist?: boolean;
    block_merge_if_conflict_exists?: boolean;
  };
  limits?: {
    max_changed_files?: number;
    max_insertions?: number;
    max_deletions?: number;
  };
}

export interface TaskTemplateConfig {
  objective?: string;
  background?: string;
  agent?: string;
  base_branch?: string;
  allowed_paths?: string[];
  forbidden_paths?: string[];
  required_checks?: string[];
  risk_level?: RiskLevel;
  risk_domains?: string[];
  reviewers?: string[];
}

export interface AgentgitopsConfig {
  version: number;
  project: {
    name: string;
    default_branch: string;
    worktree_root: string;
  };
  git: {
    provider: string;
    remote: string;
  };
  agents: Record<
    string,
    {
      type: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
      enabled?: boolean;
    }
  >;
  organization?: {
    name?: string;
    policies?: PolicyConfig;
  };
  policies?: PolicyConfig;
  workspace?: {
    archive_statuses?: TaskStatus[];
    cleanup_after_days?: number;
    env?: Record<string, string>;
  };
  task_templates?: Record<string, TaskTemplateConfig>;
  ui?: { port?: number };
  security?: {
    web?: {
      require_actor?: boolean;
      owners?: string[];
      reviewers?: string[];
    };
  };
  extensions?: {
    /**
     * Enables configured extension discovery. AgentGitOps CE records metadata only;
     * enterprise/runtime loaders may attach implementations through ExtensionRegistry.
     */
    enabled?: boolean;
    modules?: {
      name: string;
      package?: string;
      enabled?: boolean;
    }[];
  };
  enterprise?: EnterpriseRuntimeConfig;
  team?: {
    sync?: TeamSyncConfig;
  };
}

export interface EnterpriseRuntimeConfig {
  /**
   * Enables runtime EE/Team extension resolution. When false, startup forces CE
   * defaults even if module metadata is present.
   */
  enabled?: boolean;
  license?: "ce" | "team" | "enterprise" | "enterprise-plus";
  /** Optional direct license key; prefer licenseKeyEnv for committed configs. */
  licenseKey?: string;
  /** Environment variable name containing the license key. */
  licenseKeyEnv?: string;
  storage?: StorageConfig;
  oidc?: {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    jwksUri?: string;
    audience?: string;
    userInfoEndpoint?: string;
    introspectionEndpoint?: string;
    useIntrospection?: boolean;
    roleMapping?: Record<string, "viewer" | "developer" | "reviewer" | "owner" | "admin">;
    organizationId?: string;
  };
  saml?: {
    entityId: string;
    assertionConsumerServiceUrl: string;
    idpMetadataUrl?: string;
    certificate?: string;
    organizationId?: string;
  };
  rbac?: {
    projectAssignments?: Record<
      string,
      Record<string, Array<"viewer" | "developer" | "reviewer" | "owner" | "admin">>
    >;
    globalAssignments?: Record<
      string,
      Array<"viewer" | "developer" | "reviewer" | "owner" | "admin">
    >;
    superAdmins?: string[];
  };
  siem?: {
    siemWebhookUrl?: string;
    siemType?: "splunk" | "datadog" | "elastic" | "chronicle" | "generic";
    siemToken?: string;
    autoPush?: boolean;
  };
  compliance?: {
    reportStorageDir?: string;
  };
  /** Allow an explicitly configured EE module to fall back to its CE implementation. Defaults to false. */
  allowCeFallback?: boolean;
  forceCeDefaults?: boolean;
}

/**
 * Team Sync 同步配置
 *
 * 控制哪些内容走网络同步，支持多机协同时精细控制同步范围。
 * 默认安全：敏感内容（Agent 执行策略、失败原因等）默认不同步。
 */
export interface TeamSyncConfig {
  // 基础协同（默认开）
  tasks?: boolean;
  changedFiles?: boolean;
  riskLevel?: boolean;
  verification?: boolean;
  conflicts?: boolean;
  // 敏感内容（默认关）
  agentExecution?: boolean;
  failureReason?: boolean;
  filesRead?: boolean;
  tokenUsage?: boolean;
  // 可选内容
  agentNotes?: boolean;
  reviewContext?: boolean;
  handoff?: boolean;
  // 同步模式
  mode?: "manual" | "auto";
  intervalSeconds?: number;
  // git-native 专用配置（syncMode === "git-native" 时生效）
  gitNative?: GitNativeSyncConfig;
}

/**
 * Git-Native 同步配置
 *
 * 控制 git-native 模式下事件通过 Git 仓库文件同步的行为。
 */
export interface GitNativeSyncConfig {
  /** task 事件产生时自动导出到 outbox 目录（默认 true） */
  autoExport?: boolean;
  /** sync pull 时自动导入 outbox 中的新事件（默认 true） */
  autoImportOnPull?: boolean;
  /** 导出后清理已 pushed 的事件文件，避免 outbox 膨胀（默认 true） */
  cleanupExported?: boolean;
}

/** 获取 git-native 同步配置的默认值 */
export function defaultGitNativeSyncConfig(): GitNativeSyncConfig {
  return {
    autoExport: true,
    autoImportOnPull: true,
    cleanupExported: true,
  };
}

/** 获取同步配置的默认值 */
export function defaultTeamSyncConfig(): TeamSyncConfig {
  return {
    tasks: true,
    changedFiles: true,
    riskLevel: true,
    verification: true,
    conflicts: true,
    agentExecution: false,
    failureReason: false,
    filesRead: false,
    tokenUsage: false,
    agentNotes: false,
    reviewContext: false,
    handoff: false,
    mode: "manual",
    intervalSeconds: 60,
    gitNative: defaultGitNativeSyncConfig(),
  };
}

export interface AgentRegistration {
  name: string;
  type: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

/**
 * ConfigLoader - 加载、校验、生成 .agentgitops.yml
 */
export class ConfigLoader {
  /**
   * 生成默认配置
   */
  static generateDefault(projectName: string): AgentgitopsConfig {
    return {
      version: CONFIG_VERSION,
      project: {
        name: projectName,
        default_branch: "main",
        worktree_root: DEFAULT_WORKTREE_ROOT,
      },
      git: {
        provider: "github",
        remote: "origin",
      },
      agents: {
        generic: {
          type: "generic-cli",
          command: "echo",
          args: ["{{task_objective}}"],
          enabled: true,
        },
      },
      policies: {
        branch: {
          protected: ["main"],
        },
      },
      workspace: {
        archive_statuses: ["merged", "canceled"],
        cleanup_after_days: 14,
        env: {},
      },
      task_templates: {},
      ui: {
        port: 4789,
      },
      security: {
        web: {
          require_actor: true,
          owners: [process.env.USER ?? "local-user"],
          reviewers: [],
        },
      },
      extensions: {
        enabled: false,
        modules: [],
      },
      team: {
        sync: defaultTeamSyncConfig(),
      },
    };
  }

  /**
   * 初始化项目配置
   */
  static async init(
    projectPath: string,
    projectName: string,
    options?: { force?: boolean },
  ): Promise<string> {
    const configPath = path.join(projectPath, CONFIG_FILENAME);
    const configDir = path.join(projectPath, CONFIG_DIR);

    // 检查是否已存在
    if (!options?.force) {
      try {
        await fs.access(configPath);
        throw new Error(`Config already exists at ${configPath}. Use --force to overwrite.`);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("already exists")) {
          throw err;
        }
        // 文件不存在，继续
      }
    }

    // 生成配置
    const config = ConfigLoader.generateDefault(projectName);
    const yamlContent = stringify(config);

    // 写入配置文件
    await fs.writeFile(configPath, yamlContent, "utf-8");

    // 创建目录结构
    await fs.mkdir(path.join(configDir, "tasks"), { recursive: true });
    await fs.mkdir(path.join(configDir, "agents"), { recursive: true });
    await fs.mkdir(path.join(configDir, "packages"), { recursive: true });
    await fs.mkdir(path.join(configDir, "logs"), { recursive: true });

    // 问题 6 修复：自动在 .gitignore 中排除 agentgitops 运行时数据
    await ConfigLoader.ensureGitignore(projectPath);

    return configPath;
  }

  /**
   * 确保 .gitignore 中包含 agentgitops 运行时数据排除规则
   */
  static async ensureGitignore(projectPath: string): Promise<void> {
    const gitignorePath = path.join(projectPath, ".gitignore");
    const agentgitopsIgnore = `# agentgitops runtime data
.agentgitops/db.sqlite
.agentgitops/db.sqlite-journal
.agentgitops/logs/
.agentgitops/sync/applied.json
.agentgitops-worktrees/`;

    let content = "";
    try {
      content = await fs.readFile(gitignorePath, "utf-8");
    } catch {
      // .gitignore 不存在
    }

    // 如果已经包含 agentgitops 排除规则，跳过
    if (content.includes(".agentgitops/db.sqlite")) return;

    // 追加排除规则
    const newContent =
      content.length > 0
        ? `${content.trimEnd()}\n\n${agentgitopsIgnore}\n`
        : `${agentgitopsIgnore}\n`;
    await fs.writeFile(gitignorePath, newContent, "utf-8");
  }

  /**
   * 加载配置
   */
  static async load(projectPath: string): Promise<AgentgitopsConfig> {
    const configPath = path.join(projectPath, CONFIG_FILENAME);

    let content: string;
    try {
      content = await fs.readFile(configPath, "utf-8");
    } catch {
      throw new Error(`Config not found at ${configPath}. Run 'agentgitops init' first.`);
    }

    const config = ConfigLoader.withEffectivePolicies(parse(content) as AgentgitopsConfig);
    ConfigLoader.validate(config);
    return config;
  }

  /**
   * 保存配置
   */
  static async save(projectPath: string, config: AgentgitopsConfig): Promise<string> {
    ConfigLoader.validate(config);
    const configPath = path.join(projectPath, CONFIG_FILENAME);
    await fs.writeFile(configPath, stringify(config), "utf-8");
    return configPath;
  }

  /**
   * 注册或更新 Agent
   */
  static async registerAgent(
    projectPath: string,
    registration: AgentRegistration,
  ): Promise<AgentgitopsConfig> {
    if (!registration.name.trim()) {
      throw new Error("Agent name is required");
    }
    if (!registration.command.trim()) {
      throw new Error("Agent command is required");
    }

    const config = await ConfigLoader.load(projectPath);
    config.agents[registration.name] = {
      type: registration.type,
      command: registration.command,
      args: registration.args,
      env: registration.env,
      enabled: registration.enabled ?? true,
    };
    await ConfigLoader.save(projectPath, config);
    return config;
  }

  /**
   * 校验配置
   */
  static validate(config: AgentgitopsConfig): void {
    if (!config.version) {
      throw new Error("Config validation failed: 'version' is required");
    }
    if (!config.project?.name) {
      throw new Error("Config validation failed: 'project.name' is required");
    }
    if (!config.git?.provider) {
      throw new Error("Config validation failed: 'git.provider' is required");
    }
    for (const status of config.workspace?.archive_statuses ?? []) {
      if (
        ![
          "created",
          "workspace_created",
          "running",
          "testing",
          "packaging",
          "reviewing",
          "blocked",
          "merged",
          "failed",
          "canceled",
        ].includes(status)
      ) {
        throw new Error(
          `Config validation failed: invalid workspace.archive_statuses value '${status}'`,
        );
      }
    }
    if (
      config.workspace?.cleanup_after_days !== undefined &&
      (!Number.isInteger(config.workspace.cleanup_after_days) ||
        config.workspace.cleanup_after_days < 0)
    ) {
      throw new Error(
        "Config validation failed: 'workspace.cleanup_after_days' must be a non-negative integer",
      );
    }
    for (const [name, template] of Object.entries(config.task_templates ?? {})) {
      if (!name.trim()) {
        throw new Error("Config validation failed: task template name cannot be empty");
      }
      if (
        template.risk_level !== undefined &&
        !["low", "medium", "high", "critical"].includes(template.risk_level)
      ) {
        throw new Error(
          `Config validation failed: invalid task template risk_level '${template.risk_level}'`,
        );
      }
    }
    const extensionNames = new Set<string>();
    for (const extension of config.extensions?.modules ?? []) {
      if (!extension.name?.trim()) {
        throw new Error("Config validation failed: 'extensions.modules.name' is required");
      }
      if (extension.package !== undefined && !extension.package.trim()) {
        throw new Error("Config validation failed: 'extensions.modules.package' cannot be empty");
      }
      if (extensionNames.has(extension.name)) {
        throw new Error(`Config validation failed: duplicate extension module '${extension.name}'`);
      }
      extensionNames.add(extension.name);
    }
    ConfigLoader.validateEnterpriseConfig(config.enterprise);
  }

  private static validateEnterpriseConfig(config: EnterpriseRuntimeConfig | undefined): void {
    if (!config) return;
    if (
      config.license !== undefined &&
      !["ce", "team", "enterprise", "enterprise-plus"].includes(config.license)
    ) {
      throw new Error(`Config validation failed: invalid enterprise.license '${config.license}'`);
    }
    if (config.licenseKeyEnv !== undefined && !config.licenseKeyEnv.trim()) {
      throw new Error("Config validation failed: 'enterprise.licenseKeyEnv' cannot be empty");
    }
    if (config.storage) {
      if (!["sqlite", "postgresql"].includes(config.storage.type)) {
        throw new Error(
          `Config validation failed: invalid enterprise.storage.type '${config.storage.type}'`,
        );
      }
      if (!config.storage.url?.trim()) {
        throw new Error("Config validation failed: 'enterprise.storage.url' is required");
      }
      if (
        config.storage.poolSize !== undefined &&
        (!Number.isInteger(config.storage.poolSize) || config.storage.poolSize <= 0)
      ) {
        throw new Error(
          "Config validation failed: 'enterprise.storage.poolSize' must be a positive integer",
        );
      }
      if (
        config.storage.timeoutMs !== undefined &&
        (!Number.isInteger(config.storage.timeoutMs) || config.storage.timeoutMs <= 0)
      ) {
        throw new Error(
          "Config validation failed: 'enterprise.storage.timeoutMs' must be a positive integer",
        );
      }
    }
    if (config.oidc) {
      if (!config.oidc.issuer.trim() || !config.oidc.clientId.trim()) {
        throw new Error(
          "Config validation failed: 'enterprise.oidc.issuer' and 'enterprise.oidc.clientId' are required",
        );
      }
      if (config.oidc.useIntrospection) {
        if (!config.oidc.introspectionEndpoint?.trim()) {
          throw new Error(
            "Config validation failed: 'enterprise.oidc.introspectionEndpoint' is required when introspection is enabled",
          );
        }
      } else if (!config.oidc.jwksUri?.trim()) {
        throw new Error(
          "Config validation failed: 'enterprise.oidc.jwksUri' is required for signed JWT validation",
        );
      }
    }
    if (
      config.saml &&
      (!config.saml.entityId.trim() || !config.saml.assertionConsumerServiceUrl.trim())
    ) {
      throw new Error(
        "Config validation failed: 'enterprise.saml.entityId' and 'enterprise.saml.assertionConsumerServiceUrl' are required",
      );
    }
  }

  static withEffectivePolicies(config: AgentgitopsConfig): AgentgitopsConfig {
    return {
      ...config,
      policies: mergePolicyConfigs(config.organization?.policies, config.policies),
    };
  }

  /**
   * 检查环境
   */
  static async doctor(projectPath: string): Promise<DoctorResult[]> {
    const results: DoctorResult[] = [];

    // 检查配置文件
    try {
      const config = await ConfigLoader.load(projectPath);
      results.push({ name: "config", status: "ok", detail: `${CONFIG_FILENAME} (valid)` });

      // 检查 agents
      const agentNames = Object.keys(config.agents);
      for (const name of agentNames) {
        const agent = config.agents[name];
        try {
          const result = await runCrossPlatformCommand(agent.command, ["--version"]);
          if (result.exitCode === 0) {
            results.push({ name: `agent:${name}`, status: "ok", detail: agent.command });
          } else {
            results.push({
              name: `agent:${name}`,
              status: "fail",
              detail: `command not found: ${agent.command}`,
            });
          }
        } catch {
          results.push({
            name: `agent:${name}`,
            status: "fail",
            detail: `command not found: ${agent.command}`,
          });
        }
      }

      results.push(...(await ConfigLoader.checkProviderEnvironment(config)));
    } catch (err) {
      results.push({
        name: "config",
        status: "fail",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // 检查 git
    try {
      const result = await runCrossPlatformCommand("git", ["--version"]);
      if (result.exitCode === 0) {
        results.push({ name: "git", status: "ok", detail: result.stdout.trim() });
      } else {
        results.push({ name: "git", status: "fail", detail: "git not found" });
      }
    } catch {
      results.push({ name: "git", status: "fail", detail: "git not found" });
    }

    // 检查 .agentgitops 目录
    try {
      await fs.access(path.join(projectPath, CONFIG_DIR));
      results.push({ name: "storage", status: "ok", detail: `${CONFIG_DIR}/ writable` });
    } catch {
      results.push({ name: "storage", status: "fail", detail: `${CONFIG_DIR}/ not found` });
    }

    return results;
  }

  private static async checkProviderEnvironment(
    config: AgentgitopsConfig,
  ): Promise<DoctorResult[]> {
    if (config.git.provider === "github") {
      const hasGitHubToken =
        process.env.GITHUB_TOKEN ||
        process.env.GH_TOKEN ||
        (await ConfigLoader.hasGitHubCliToken());
      return [
        {
          name: "github:token",
          status: hasGitHubToken ? "ok" : "fail",
          detail: hasGitHubToken
            ? "GitHub token available via env or gh auth"
            : "set GITHUB_TOKEN/GH_TOKEN or run 'gh auth login'",
        },
        {
          name: "github:webhook-secret",
          status:
            process.env.AGENTGITOPS_GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET
              ? "ok"
              : "fail",
          detail:
            process.env.AGENTGITOPS_GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET
              ? "webhook secret configured"
              : "set AGENTGITOPS_GITHUB_WEBHOOK_SECRET or GITHUB_WEBHOOK_SECRET",
        },
      ];
    }

    if (config.git.provider === "gitlab") {
      return [
        {
          name: "gitlab:token",
          status: process.env.GITLAB_TOKEN ? "ok" : "fail",
          detail: process.env.GITLAB_TOKEN
            ? "GITLAB_TOKEN configured"
            : "set GITLAB_TOKEN for MR creation",
        },
      ];
    }

    return [];
  }

  private static async hasGitHubCliToken(): Promise<boolean> {
    try {
      const result = await runCrossPlatformCommand("gh", ["auth", "token"]);
      return result.exitCode === 0 && result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
}

export function resolveTaskTemplate(
  config: AgentgitopsConfig,
  templateName?: string,
): TaskTemplateConfig | undefined {
  if (!templateName) return undefined;
  const template = config.task_templates?.[templateName];
  if (!template) {
    throw new Error(`Task template not found: ${templateName}`);
  }
  return template;
}

export function mergePolicyConfigs(
  base: PolicyConfig | undefined,
  override: PolicyConfig | undefined,
): PolicyConfig | undefined {
  if (!base && !override) return undefined;
  return {
    branch: {
      protected: mergeList(base?.branch?.protected, override?.branch?.protected),
    },
    paths: {
      high_risk: mergeList(base?.paths?.high_risk, override?.paths?.high_risk),
      forbidden: mergeList(base?.paths?.forbidden, override?.paths?.forbidden),
      forbidden_for_agents: mergeList(
        base?.paths?.forbidden_for_agents,
        override?.paths?.forbidden_for_agents,
      ),
    },
    commands: {
      allowed: mergeList(base?.commands?.allowed, override?.commands?.allowed),
      forbidden: mergeList(base?.commands?.forbidden, override?.commands?.forbidden),
    },
    approval: {
      high_risk_paths_require_review:
        override?.approval?.high_risk_paths_require_review ??
        base?.approval?.high_risk_paths_require_review,
      required_reviewers: mergeReviewerMap(
        base?.approval?.required_reviewers,
        override?.approval?.required_reviewers,
      ),
    },
    checks: {
      required: mergeChecks(base?.checks?.required, override?.checks?.required),
      github: {
        ...base?.checks?.github,
        ...override?.checks?.github,
      },
    },
    merge: {
      ...base?.merge,
      ...override?.merge,
    },
    limits: {
      ...base?.limits,
      ...override?.limits,
    },
  };
}

function mergeList<T>(base: T[] | undefined, override: T[] | undefined): T[] | undefined {
  const values = [...(base ?? []), ...(override ?? [])];
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function mergeChecks(
  base: { name: string; command: string }[] | undefined,
  override: { name: string; command: string }[] | undefined,
): { name: string; command: string }[] | undefined {
  const byName = new Map<string, { name: string; command: string }>();
  for (const check of [...(base ?? []), ...(override ?? [])]) byName.set(check.name, check);
  return byName.size > 0 ? [...byName.values()] : undefined;
}

function mergeReviewerMap(
  base: Record<string, string[]> | undefined,
  override: Record<string, string[]> | undefined,
): Record<string, string[]> | undefined {
  const result: Record<string, string[]> = {};
  for (const [pattern, reviewers] of Object.entries(base ?? {})) result[pattern] = reviewers;
  for (const [pattern, reviewers] of Object.entries(override ?? {})) {
    result[pattern] = mergeList(result[pattern], reviewers) ?? [];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export interface DoctorResult {
  name: string;
  status: "ok" | "fail";
  detail: string;
}
