/**
 * Enterprise Edition 实现模块（P1 剩余 EE 基础设施）
 *
 * 本目录包含 EE 版本的具体实现，通过接口注入到 ExtensionRegistry。
 * CE 版本使用 ce-*.ts 中的默认实现。
 *
 * 模块清单：
 * - PostgresStorageAdapter（P1-001）：PostgreSQL 存储适配器
 * - OidcIdentityProvider / SamlIdentityProvider（P1-003）：SSO/OIDC/SAML 认证
 * - RbacAuthorizationProvider（P1-004）：RBAC 权限控制
 * - SiemAuditSink（P1-005）：SIEM 集成不可篡改审计
 * - EnterpriseComplianceReportProvider（P1-006）：合规报告导出
 *
 * Open Core 边界：
 * - CE 定义接口（packages/core/src/extensions.ts）
 * - CE 提供默认实现（ce-storage-adapter.ts, ce-enterprise-providers.ts）
 * - EE 提供增强实现（本目录）
 * - Server 通过 ExtensionRegistry 注入，不直接 import enterprise 包
 */

export { PostgresStorageAdapter } from "./postgres-storage-adapter.js";
export type { PostgresStorageAdapter as PostgresStorageAdapterType } from "./postgres-storage-adapter.js";

export { OidcIdentityProvider, SamlIdentityProvider } from "./oidc-identity-provider.js";
export type { OidcConfig } from "./oidc-identity-provider.js";

export { RbacAuthorizationProvider } from "./rbac-authorization-provider.js";
export type { RbacConfig } from "./rbac-authorization-provider.js";

export { SiemAuditSink } from "./siem-audit-sink.js";
export type { SiemConfig } from "./siem-audit-sink.js";

export { EnterpriseComplianceReportProvider } from "./compliance-report-provider.js";
export type { ComplianceReportConfig } from "./compliance-report-provider.js";

// P2 EE 治理 + 运营 + 集成
export { PolicyTemplateLibrary, PolicyVersionManager } from "./policy-templates.js";
export type {
  PolicyTemplate,
  PolicyVersion,
  PolicyDiffResult,
  PolicyDiffChange,
} from "./policy-templates.js";

export { TokenUsageAnalyzer, AgentVendorComparator } from "./token-usage-analyzer.js";
export type {
  TokenUsageRecord,
  TokenUsageSummary,
  TokenUsageFilter,
  AgentVendorComparison,
} from "./token-usage-analyzer.js";

export { GiteaProvider, CodeownersParser } from "./gitea-codeowners.js";
export type { GiteaConfig, CodeownersRule } from "./gitea-codeowners.js";

export { JiraLinearSync, ImNotifier } from "./jira-linear-im-sync.js";
export type {
  JiraLinearConfig,
  ExternalIssue,
  ImConfig,
  ImNotification,
} from "./jira-linear-im-sync.js";

// P3 EE 高级能力 + 生态
export { ScimProvider, MultiTenantManager, ApprovalWorkflow } from "./scim-multitenant-approval.js";
export type {
  ScimConfig,
  ScimGroup,
  ScimUser,
  Tenant,
  ApprovalRequest,
} from "./scim-multitenant-approval.js";

export {
  SchemaConflictDetector,
  CallChainConflictDetector,
  SkillPackFramework,
  PluginRegistry,
} from "./schema-callchain-skillpack-plugin.js";
export type {
  MigrationFile,
  SchemaConflict,
  SchemaConflictInput,
  ServiceNode,
  CallChainConflict,
  SkillPack,
  SkillRule,
  SkillViolation,
  PluginManifest,
  PluginRegistryConfig,
} from "./schema-callchain-skillpack-plugin.js";
