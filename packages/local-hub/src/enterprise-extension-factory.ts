import type { LicenseProvider, StorageAdapter, StorageConfig } from "@agentgitops/core";
import type { AgentGitOpsExtensions } from "./extension-registry.js";
import { CeLicenseProvider } from "./license-provider.js";
import { CeOrganizationPolicyProvider } from "./organization-policy-provider.js";
import {
  CeIdentityProvider,
  CeAuthorizationProvider,
  CeImmutableAuditSink,
  CeMultiRepoTaskOrchestrator,
  CeCrossRepoMergeOrchestrator,
  CeEnterpriseAgentOpsProvider,
  CeEnterpriseGitProvider,
  CeSecurityEvidenceProvider,
} from "./ce-enterprise-providers.js";
import { CeStorageAdapter, CeComplianceReportProvider } from "./ce-storage-adapter.js";

/**
 * EnterpriseExtensionFactory — EE 模块注入工厂
 *
 * 根据 license 和配置，将 EE 实现注入到 ExtensionRegistry。
 *
 * 注入逻辑：
 * 1. 检查 license：无 license 或 CE license → 使用 CE 默认实现
 * 2. 检查配置：有 EE 配置 → 使用 EE 实现
 * 3. 严格启动：显式配置的 EE 实现不可用时终止启动
 * 4. 显式降级：仅 allowCeFallback=true 时回退到 CE 默认实现
 *
 * 使用方式：
 *   const extensions = await createEnterpriseExtensions({
 *     license: "enterprise",
 *     storage: { type: "postgresql", url: "postgresql://..." },
 *     oidc: { issuer: "...", clientId: "..." },
 *   });
 *   const registry = createExtensionRegistry(extensions);
 */
export interface EnterpriseExtensionConfig {
  /** License 类型 */
  license?: "ce" | "team" | "enterprise" | "enterprise-plus";
  /** License key（EE 模式） */
  licenseKey?: string;
  /** 存储配置 */
  storage?: StorageConfig;
  /** OIDC 配置（EE 模式） */
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
  /** SAML 配置（EE 模式） */
  saml?: {
    entityId: string;
    assertionConsumerServiceUrl: string;
    idpMetadataUrl?: string;
    certificate?: string;
    organizationId?: string;
  };
  /** RBAC 配置（EE 模式） */
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
  /** SIEM 配置（EE 模式） */
  siem?: {
    siemWebhookUrl?: string;
    siemType?: "splunk" | "datadog" | "elastic" | "chronicle" | "generic";
    siemToken?: string;
    autoPush?: boolean;
  };
  /** 合规报告配置（EE 模式） */
  compliance?: {
    reportStorageDir?: string;
  };
  /** 是否强制使用 CE 默认实现（测试用） */
  forceCeDefaults?: boolean;
  /** Whether explicitly configured EE modules may degrade to CE implementations. */
  allowCeFallback?: boolean;
}

/**
 * 创建扩展（根据配置注入 CE 或 EE 实现）
 */
export async function createEnterpriseExtensions(
  config: EnterpriseExtensionConfig = {},
): Promise<AgentGitOpsExtensions> {
  // 如果强制 CE 或无 license，使用 CE 默认实现
  if (config.forceCeDefaults || !config.license || config.license === "ce") {
    return createCeDefaultExtensions(config);
  }

  // EE 模式：注入 EE 实现，失败时默认终止启动
  return createEeExtensions(config);
}

/**
 * 创建 CE 默认扩展
 */
function createCeDefaultExtensions(config: EnterpriseExtensionConfig): AgentGitOpsExtensions {
  return {
    licenseProvider: new CeLicenseProvider(),
    organizationPolicyProvider: new CeOrganizationPolicyProvider(),
    identityProvider: new CeIdentityProvider(),
    authorizationProvider: new CeAuthorizationProvider(),
    immutableAuditSink: new CeImmutableAuditSink(),
    multiRepoTaskOrchestrator: new CeMultiRepoTaskOrchestrator(),
    crossRepoMergeOrchestrator: new CeCrossRepoMergeOrchestrator(),
    enterpriseAgentOpsProvider: new CeEnterpriseAgentOpsProvider(),
    enterpriseGitProvider: new CeEnterpriseGitProvider(),
    securityEvidenceProvider: new CeSecurityEvidenceProvider(),
    storageAdapter: config.storage
      ? new CeStorageAdapter(config.storage)
      : new CeStorageAdapter({ type: "sqlite", url: ".agentgitops/db.sqlite" }),
    complianceReportProvider: new CeComplianceReportProvider(),
  };
}

/**
 * 创建 EE 扩展（注入 EE 实现，降级到 CE）
 */
async function createEeExtensions(
  config: EnterpriseExtensionConfig,
): Promise<AgentGitOpsExtensions> {
  const extensions: AgentGitOpsExtensions = {};

  // 1. License Provider（EE 模式使用真实 license 校验，这里简化为 CE）
  extensions.licenseProvider = new CeLicenseProvider();

  // 2. Organization Policy Provider
  extensions.organizationPolicyProvider = new CeOrganizationPolicyProvider();

  // 3. Storage Adapter（EE 使用 PostgreSQL）
  if (config.storage?.type === "postgresql") {
    try {
      const { PostgresStorageAdapter } = await import("./enterprise/postgres-storage-adapter.js");
      const pgAdapter = new PostgresStorageAdapter(config.storage);
      await pgAdapter.initialize();
      extensions.storageAdapter = pgAdapter;
    } catch (error) {
      if (!config.allowCeFallback) {
        throw new Error(
          `PostgreSQL storage initialization failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      extensions.storageAdapter = new CeStorageAdapter({
        type: "sqlite",
        url: ".agentgitops/db.sqlite",
      });
    }
  } else {
    extensions.storageAdapter = new CeStorageAdapter(
      config.storage ?? { type: "sqlite", url: ".agentgitops/db.sqlite" },
    );
  }

  // 4. Identity Provider（EE 使用 OIDC/SAML）
  if (config.oidc) {
    try {
      const { OidcIdentityProvider } = await import("./enterprise/oidc-identity-provider.js");
      extensions.identityProvider = new OidcIdentityProvider(config.oidc);
    } catch (error) {
      throwUnlessFallbackAllowed(config, "OIDC identity provider", error);
      extensions.identityProvider = new CeIdentityProvider();
    }
  } else if (config.saml) {
    try {
      const { SamlIdentityProvider } = await import("./enterprise/oidc-identity-provider.js");
      extensions.identityProvider = new SamlIdentityProvider(config.saml);
    } catch (error) {
      throwUnlessFallbackAllowed(config, "SAML identity provider", error);
      extensions.identityProvider = new CeIdentityProvider();
    }
  } else {
    extensions.identityProvider = new CeIdentityProvider();
  }

  // 5. Authorization Provider（EE 使用 RBAC）
  if (config.rbac) {
    try {
      const { RbacAuthorizationProvider } =
        await import("./enterprise/rbac-authorization-provider.js");
      extensions.authorizationProvider = new RbacAuthorizationProvider(config.rbac);
    } catch (error) {
      throwUnlessFallbackAllowed(config, "RBAC authorization provider", error);
      extensions.authorizationProvider = new CeAuthorizationProvider();
    }
  } else {
    extensions.authorizationProvider = new CeAuthorizationProvider();
  }

  // 6. Immutable Audit Sink（EE 使用 SIEM 哈希链）
  try {
    const { SiemAuditSink } = await import("./enterprise/siem-audit-sink.js");
    const siemConfig: Record<string, unknown> = {};
    if (config.siem) {
      siemConfig.siemWebhookUrl = config.siem.siemWebhookUrl;
      siemConfig.siemType = config.siem.siemType;
      siemConfig.siemToken = config.siem.siemToken;
      siemConfig.autoPush = config.siem.autoPush;
    }
    if (isQueryableStorageAdapter(extensions.storageAdapter)) {
      siemConfig.storageAdapter = extensions.storageAdapter;
    }
    extensions.immutableAuditSink = new SiemAuditSink(siemConfig);
  } catch (error) {
    throwUnlessFallbackAllowed(config, "SIEM audit sink", error);
    extensions.immutableAuditSink = new CeImmutableAuditSink();
  }

  // 7. Compliance Report Provider（EE 使用真实合规报告）
  try {
    const { EnterpriseComplianceReportProvider } =
      await import("./enterprise/compliance-report-provider.js");
    const complianceConfig: Record<string, unknown> = {};
    if (extensions.immutableAuditSink && "getEntries" in extensions.immutableAuditSink) {
      complianceConfig.auditSink = extensions.immutableAuditSink;
    }
    if (isQueryableStorageAdapter(extensions.storageAdapter)) {
      complianceConfig.storageAdapter = extensions.storageAdapter;
    }
    if (config.compliance?.reportStorageDir) {
      complianceConfig.reportStorageDir = config.compliance.reportStorageDir;
    }
    extensions.complianceReportProvider = new EnterpriseComplianceReportProvider(complianceConfig);
  } catch (error) {
    throwUnlessFallbackAllowed(config, "compliance report provider", error);
    extensions.complianceReportProvider = new CeComplianceReportProvider();
  }

  // 8-10. 其余端口暂用 CE 默认实现（可按需注入 EE）
  extensions.multiRepoTaskOrchestrator = new CeMultiRepoTaskOrchestrator();
  extensions.crossRepoMergeOrchestrator = new CeCrossRepoMergeOrchestrator();
  extensions.enterpriseAgentOpsProvider = new CeEnterpriseAgentOpsProvider();
  extensions.enterpriseGitProvider = new CeEnterpriseGitProvider();
  extensions.securityEvidenceProvider = new CeSecurityEvidenceProvider();

  return extensions;
}

function isQueryableStorageAdapter(
  storageAdapter: StorageAdapter | undefined,
): storageAdapter is StorageAdapter & { query: NonNullable<StorageAdapter["query"]> } {
  return typeof storageAdapter?.query === "function";
}

function throwUnlessFallbackAllowed(
  config: EnterpriseExtensionConfig,
  component: string,
  error: unknown,
): void {
  if (config.allowCeFallback) return;
  throw new Error(
    `${component} initialization failed: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}

/**
 * 检查 license 是否授权指定功能
 */
export async function checkLicenseFeature(
  licenseProvider: LicenseProvider,
  feature: string,
): Promise<boolean> {
  try {
    return await licenseProvider.hasFeature(feature);
  } catch {
    return false;
  }
}

/**
 * 获取扩展摘要（用于 API/CLI 查询）
 */
export function getExtensionSummary(extensions: AgentGitOpsExtensions): {
  isEnterprise: boolean;
  storageType: string;
  identityProviderType: string;
  authorizationProviderType: string;
  auditSinkType: string;
  complianceReportType: string;
  enabledFeatures: string[];
} {
  const isEnterprise = extensions.licenseProvider !== undefined;
  const storageType = extensions.storageAdapter?.getType() ?? "unknown";
  const identityProviderType = extensions.identityProvider?.constructor.name ?? "none";
  const authorizationProviderType = extensions.authorizationProvider?.constructor.name ?? "none";
  const auditSinkType = extensions.immutableAuditSink?.constructor.name ?? "none";
  const complianceReportType = extensions.complianceReportProvider?.constructor.name ?? "none";

  const enabledFeatures: string[] = [];
  if (extensions.storageAdapter?.getType() === "postgresql") enabledFeatures.push("postgresql");
  if (extensions.identityProvider && !extensions.identityProvider.constructor.name.startsWith("Ce"))
    enabledFeatures.push("sso");
  if (
    extensions.authorizationProvider &&
    !extensions.authorizationProvider.constructor.name.startsWith("Ce")
  )
    enabledFeatures.push("rbac");
  if (
    extensions.immutableAuditSink &&
    !extensions.immutableAuditSink.constructor.name.startsWith("Ce")
  )
    enabledFeatures.push("immutable-audit");
  if (
    extensions.complianceReportProvider &&
    !extensions.complianceReportProvider.constructor.name.startsWith("Ce")
  )
    enabledFeatures.push("compliance-report");

  return {
    isEnterprise,
    storageType,
    identityProviderType,
    authorizationProviderType,
    auditSinkType,
    complianceReportType,
    enabledFeatures,
  };
}
