import type {
  AuditSink,
  AuthorizationProvider,
  ConflictDetector,
  EnterpriseAgentOpsProvider,
  EnterpriseGitProvider,
  GitReviewProvider,
  IdentityProvider,
  ImmutableAuditSink,
  LicenseProvider,
  MetricsSink,
  MultiRepoTaskOrchestrator,
  OrganizationPolicyProvider,
  PolicyProvider,
  SecurityEvidenceProvider,
  StorageAdapter,
  ComplianceReportProvider,
  CrossRepoMergeOrchestrator,
} from "@agentgitops/core";
import type { AgentgitopsConfig } from "./config-loader.js";

export interface AgentGitOpsExtensions {
  auditSink?: AuditSink;
  policyProvider?: PolicyProvider;
  conflictDetector?: ConflictDetector;
  gitReviewProvider?: GitReviewProvider;
  metricsSink?: MetricsSink;
  // EE 扩展端口
  licenseProvider?: LicenseProvider;
  organizationPolicyProvider?: OrganizationPolicyProvider;
  identityProvider?: IdentityProvider;
  authorizationProvider?: AuthorizationProvider;
  immutableAuditSink?: ImmutableAuditSink;
  multiRepoTaskOrchestrator?: MultiRepoTaskOrchestrator;
  crossRepoMergeOrchestrator?: CrossRepoMergeOrchestrator;
  enterpriseAgentOpsProvider?: EnterpriseAgentOpsProvider;
  enterpriseGitProvider?: EnterpriseGitProvider;
  securityEvidenceProvider?: SecurityEvidenceProvider;
  storageAdapter?: StorageAdapter;
  complianceReportProvider?: ComplianceReportProvider;
}

export interface ConfiguredExtensionModule {
  name: string;
  package?: string;
  enabled: boolean;
}

export class ExtensionRegistry {
  constructor(
    private readonly extensions: AgentGitOpsExtensions = {},
    private readonly configuredModules: ConfiguredExtensionModule[] = [],
  ) {}

  get auditSink(): AuditSink | undefined {
    return this.extensions.auditSink;
  }

  get policyProvider(): PolicyProvider | undefined {
    return this.extensions.policyProvider;
  }

  get conflictDetector(): ConflictDetector | undefined {
    return this.extensions.conflictDetector;
  }

  get gitReviewProvider(): GitReviewProvider | undefined {
    return this.extensions.gitReviewProvider;
  }

  get metricsSink(): MetricsSink | undefined {
    return this.extensions.metricsSink;
  }

  // EE 扩展端口 getter
  get licenseProvider(): LicenseProvider | undefined {
    return this.extensions.licenseProvider;
  }

  get organizationPolicyProvider(): OrganizationPolicyProvider | undefined {
    return this.extensions.organizationPolicyProvider;
  }

  get identityProvider(): IdentityProvider | undefined {
    return this.extensions.identityProvider;
  }

  get authorizationProvider(): AuthorizationProvider | undefined {
    return this.extensions.authorizationProvider;
  }

  get immutableAuditSink(): ImmutableAuditSink | undefined {
    return this.extensions.immutableAuditSink;
  }

  get multiRepoTaskOrchestrator(): MultiRepoTaskOrchestrator | undefined {
    return this.extensions.multiRepoTaskOrchestrator;
  }

  get crossRepoMergeOrchestrator(): CrossRepoMergeOrchestrator | undefined {
    return this.extensions.crossRepoMergeOrchestrator;
  }

  get enterpriseAgentOpsProvider(): EnterpriseAgentOpsProvider | undefined {
    return this.extensions.enterpriseAgentOpsProvider;
  }

  get enterpriseGitProvider(): EnterpriseGitProvider | undefined {
    return this.extensions.enterpriseGitProvider;
  }

  get securityEvidenceProvider(): SecurityEvidenceProvider | undefined {
    return this.extensions.securityEvidenceProvider;
  }

  get storageAdapter(): StorageAdapter | undefined {
    return this.extensions.storageAdapter;
  }

  get complianceReportProvider(): ComplianceReportProvider | undefined {
    return this.extensions.complianceReportProvider;
  }

  /** 是否启用了企业版能力 */
  get isEnterpriseEnabled(): boolean {
    return this.extensions.licenseProvider !== undefined;
  }

  with(overrides: AgentGitOpsExtensions): ExtensionRegistry {
    return new ExtensionRegistry({ ...this.extensions, ...overrides }, this.configuredModules);
  }

  listConfiguredModules(): ConfiguredExtensionModule[] {
    return this.configuredModules.map((module) => ({ ...module }));
  }
}

export function createExtensionRegistry(
  extensions: AgentGitOpsExtensions = {},
  configuredModules: ConfiguredExtensionModule[] = [],
): ExtensionRegistry {
  return new ExtensionRegistry(extensions, configuredModules);
}

export function createExtensionRegistryFromConfig(
  config: AgentgitopsConfig,
  extensions: AgentGitOpsExtensions = {},
): ExtensionRegistry {
  return createExtensionRegistry(extensions, listConfiguredExtensionModules(config));
}

export function listConfiguredExtensionModules(
  config: AgentgitopsConfig,
): ConfiguredExtensionModule[] {
  const registryEnabled = config.extensions?.enabled === true;
  return (config.extensions?.modules ?? []).map((module) => ({
    name: module.name,
    package: module.package,
    enabled: registryEnabled && module.enabled !== false,
  }));
}
