export { ProjectRegistry } from "./project-registry.js";
export type { ProjectEntry, ProjectRegistryData } from "./project-registry.js";
export { getRegistryFilePath } from "./project-registry.js";
export { HandoffDocumentStore, generateHandoffDocId } from "./handoff-document-store.js";
export { HandoffDocumentGenerator } from "./handoff-document-generator.js";
export { CeStorageAdapter, CeComplianceReportProvider } from "./ce-storage-adapter.js";
export { ConfigLoader } from "./config-loader.js";
export {
  defaultTeamSyncConfig,
  defaultGitNativeSyncConfig,
  mergePolicyConfigs,
  resolveTaskTemplate,
} from "./config-loader.js";
export type {
  AgentgitopsConfig,
  AgentRegistration,
  DoctorResult,
  EnterpriseRuntimeConfig,
  GitNativeSyncConfig,
  PolicyConfig,
  TaskTemplateConfig,
  TeamSyncConfig,
} from "./config-loader.js";
export {
  execShell,
  execCommand,
  crossPlatformWriteFileCommand,
  isWindows,
  defaultShell,
} from "./cross-platform-shell.js";
export type { ShellExecOptions, ShellExecResult } from "./cross-platform-shell.js";
export { TaskManager } from "./task-manager.js";
export type {
  TaskCreateParams,
  TaskSnapshotDrift,
  TaskSnapshotDriftReason,
  TaskSnapshotReconcileOptions,
  TaskSnapshotReconcileResult,
} from "./task-manager.js";
export { GenericCliAdapter } from "./generic-cli-adapter.js";
export type { AdapterRunParams, AdapterRunResult } from "./generic-cli-adapter.js";
export { buildAgentEnvironment } from "./generic-cli-adapter.js";
export { ClaudeCodeAdapter } from "./claude-code-adapter.js";
export type { ClaudeCodeStats } from "./claude-code-adapter.js";
export { CodexAdapter } from "./codex-adapter.js";
export type { CodexStats } from "./codex-adapter.js";
export { GenericAgentAdapter, OpenCodeAdapter, createAgentAdapter } from "./agent-adapters.js";
export type { AgentAdapter } from "./agent-adapters.js";
export {
  ExtensionRegistry,
  createExtensionRegistry,
  createExtensionRegistryFromConfig,
  listConfiguredExtensionModules,
} from "./extension-registry.js";
export type { AgentGitOpsExtensions, ConfiguredExtensionModule } from "./extension-registry.js";
export { WorkspaceManager } from "./workspace-manager.js";
export { buildWorkspaceEnvironment } from "./workspace-manager.js";
export type { WorkspaceSweepOptions, WorkspaceSweepResult } from "./workspace-manager.js";
export { TraceCollector } from "./trace-collector.js";
export { ExecutionSummaryExtractor } from "./execution-summary-extractor.js";
export { ChangeIntentsExtractor } from "./change-intents-extractor.js";
export { ChangePackageGenerator } from "./change-package-generator.js";
export { LocalDb } from "./local-db.js";
export type { WorkflowJobStatus } from "./local-db.js";
export { TeamSyncStore } from "./team-sync-store.js";
export type { TeamSyncStatusSummary } from "./team-sync-store.js";
export { AutoSyncManager } from "./auto-sync-manager.js";
export type { AutoSyncState } from "./auto-sync-manager.js";
export { HandoffNoteGenerator } from "./handoff-note-generator.js";
export { BranchOwnershipManager } from "./branch-ownership-manager.js";
export { CeLicenseProvider } from "./license-provider.js";
export { CeModuleLoader } from "./enterprise-module-loader.js";
export { CeOrganizationPolicyProvider } from "./organization-policy-provider.js";
export {
  CeIdentityProvider,
  CeAuthorizationProvider,
  CeImmutableAuditSink,
  CeMultiRepoTaskOrchestrator,
  CeCrossRepoMergeOrchestrator,
  CeEnterpriseAgentOpsProvider,
  CeEnterpriseGitProvider,
  CeSecurityEvidenceProvider,
} from "./ce-enterprise-providers.js";
export { AiReviewSummaryGenerator } from "./ai-review-summary-generator.js";
export type { AiReviewSummary } from "./ai-review-summary-generator.js";
export {
  SemanticConflictDetector,
  PredictiveAgentOps,
  HashChainAuditSink,
  SecurityScanSuite,
  SmartMergeScheduler,
  CrossTaskEvidenceAggregator,
} from "./l3-advanced-capabilities.js";
export type {
  SemanticConflict,
  PredictiveInsight,
  SecurityScanResult,
  SecurityFinding,
  SmartMergeSuggestion,
  CrossTaskEvidenceSummary,
} from "./l3-advanced-capabilities.js";
export { RelayClient } from "./relay-client.js";
export type {
  RelayClientOptions,
  RelayPushResult,
  RelayPullResult,
  RelayTeamStatus,
} from "./relay-client.js";
export { GitNativeSyncExporter } from "./git-native-sync-exporter.js";
export type { SyncManifest } from "./git-native-sync-exporter.js";
export { resolveGitNativeConfig } from "./git-native-sync-exporter.js";
export { GitNativeSyncImporter } from "./git-native-sync-importer.js";
export type { GitNativeSyncImportResult } from "./git-native-sync-importer.js";
export { TeamSyncEventProducer } from "./team-sync-event-producer.js";
export { TeamSyncEventApplier } from "./team-sync-event-applier.js";
export type { TeamSyncEventApplyResult } from "./team-sync-event-applier.js";
export { ContextFeedBuilder, formatAgentContextFeed } from "./context-feed-builder.js";
export type { ContextFeedBuildInput, ContextFeedFormat } from "./context-feed-builder.js";
export { TeamSyncPullRequestContextBuilder } from "./team-sync-pr-context-builder.js";
export { HandoffPackageBuilder, formatHandoffMarkdown } from "./handoff-package-builder.js";
export type {
  BuiltHandoffPackage,
  HandoffBuildInput,
  WrittenHandoffPackage,
} from "./handoff-package-builder.js";
export { ConflictGraphBuilder } from "./conflict-graph-builder.js";
export type { ConflictGraphBuildResult } from "./conflict-graph-builder.js";
export { ContextFeedPrivacyFilter, redactContextFeedText } from "./context-feed-privacy-filter.js";
export type { ContextFeedPrivacyFilterResult } from "./context-feed-privacy-filter.js";
export { LocalProjectRepository } from "./local-project-repository.js";
export type { WorkflowJob } from "./local-project-repository.js";
export { WorkflowJobRunner, WorkflowJobExecutionError } from "./workflow-job-runner.js";
export type { WorkflowJobRunInput, WorkflowJobRunResult } from "./workflow-job-runner.js";
export { TaskCloseoutChecker } from "./task-closeout-checker.js";
export type {
  TaskCloseoutCheck,
  TaskCloseoutCheckOptions,
  TaskCloseoutCheckStatus,
  TaskCloseoutMode,
  TaskCloseoutRecord,
  TaskCloseoutRecordWriteResult,
  TaskCloseoutReport,
} from "./task-closeout-checker.js";
export { PolicyEngine, matchGlob } from "./policy-engine.js";
export type { PathRisk, PolicyEvaluationInput, PolicyEvaluationResult } from "./policy-engine.js";
export { parseVerificationLog } from "./lint-log-parser.js";
export {
  VerificationGate,
  collectRequiredChecks,
  summarizeVerificationOutput,
} from "./verification-gate.js";
export type {
  CommandRequiredCheck,
  GitHubChecksRequiredCheck,
  RequiredCheck,
} from "./verification-gate.js";
export { VerificationStore } from "./verification-store.js";
export { ReviewStore } from "./review-store.js";
export type { SubmitReviewInput } from "./review-store.js";
export { ConflictDetector } from "./conflict-detector.js";
export { ConflictResolver, formatConflictAction } from "./conflict-resolver.js";
export type { ConflictAction, ConflictResolutionResult } from "./conflict-resolver.js";
export { computeMergeOrder } from "./merge-order-advisor.js";
export type {
  MergeOrderGroup,
  MergeOrderConflict,
  MergeOrderResult,
} from "./merge-order-advisor.js";
export { MergeGate } from "./merge-gate.js";
export type { MergeGateInput, MergeGateResult } from "./merge-gate.js";

// EE 扩展工厂 + Agent Adapter 插件化注册
export {
  createEnterpriseExtensions,
  checkLicenseFeature,
  getExtensionSummary,
} from "./enterprise-extension-factory.js";
export type { EnterpriseExtensionConfig } from "./enterprise-extension-factory.js";
export {
  createRuntimeExtensionRegistry,
  resolveEnterpriseExtensionConfig,
} from "./enterprise-runtime-config.js";
export type { EnterpriseRuntimeResolution } from "./enterprise-runtime-config.js";
export {
  AgentAdapterRegistry,
  getGlobalAdapterRegistry,
  registerGlobalAdapter,
  createRegisteredAdapter,
} from "./agent-adapter-registry.js";
export type { AdapterFactory, AdapterConfig, RegisteredAdapter } from "./agent-adapter-registry.js";

// ===== Enterprise Edition 实现（P1 剩余 EE 基础设施）=====
export {
  PostgresStorageAdapter,
  OidcIdentityProvider,
  SamlIdentityProvider,
  RbacAuthorizationProvider,
  SiemAuditSink,
  EnterpriseComplianceReportProvider,
} from "./enterprise/index.js";
export type {
  OidcConfig,
  RbacConfig,
  SiemConfig,
  ComplianceReportConfig,
} from "./enterprise/index.js";
