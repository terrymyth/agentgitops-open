import type { AuditEvent } from "./models/audit-event.js";
import type {
  ChangePackage,
  ChangePackageConflict,
  PolicyViolation,
} from "./models/change-package.js";
import type { TaskContract } from "./models/task.js";

export interface AuditSink {
  append(event: AuditEvent): Promise<void> | void;
  list(filters?: {
    taskId?: string;
    eventType?: string;
    limit?: number;
  }): Promise<AuditEvent[]> | AuditEvent[];
}

export interface PolicyProvider {
  evaluate(input: {
    task: TaskContract;
    changedFiles: string[];
    targetBranch: string;
    insertions: number;
    deletions: number;
    checksPassed: boolean;
    unverifiedItems: string[];
    hasConflict: boolean;
  }): Promise<PolicyProviderResult> | PolicyProviderResult;
}

export interface PolicyProviderResult {
  allowed: boolean;
  violations: PolicyViolation[];
  riskLevel: TaskContract["riskLevel"];
  requiresApproval: boolean;
  requiredReviewers: string[];
  canAutoMerge?: boolean;
  highRiskFilesTouched?: boolean;
  forbiddenFilesTouched?: boolean;
}

export interface ConflictDetector {
  detect(
    current: ChangePackage,
    candidates: ChangePackage[],
  ): Promise<ChangePackageConflict[]> | ChangePackageConflict[];
}

export interface GitReviewProvider {
  createOrUpdateReviewRequest(params: {
    repo: string;
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
    draft?: boolean;
  }): Promise<{ number: number; url: string; state: string; draft?: boolean }>;
}

export interface MetricsSink {
  record(snapshot: {
    id: string;
    projectId: string;
    metrics: unknown;
    createdAt: string;
  }): Promise<void> | void;
}

// ===== P2 企业版扩展端口 =====

/**
 * License 校验结果
 */
export interface LicenseValidationResult {
  valid: boolean;
  /** License 类型：ce（开源版）、team、enterprise、enterprise-plus */
  edition: "ce" | "team" | "enterprise" | "enterprise-plus";
  /** 到期时间（ISO 8601） */
  expiresAt?: string;
  /** 授权的功能 flag 列表 */
  features: string[];
  /** 校验失败原因 */
  error?: string;
  /** License 持有者（组织名） */
  organization?: string;
  /** 授权 seat 数 */
  seatCount?: number;
}

/**
 * LicenseProvider — 企业 License 校验扩展端口（P2-EE-001）
 *
 * CE 提供默认实现（始终返回 ce edition，valid=true）；
 * EE 通过注入 LicenseProvider 实现真实 license 校验。
 *
 * Server 启动时注入；无 license 时 EE 模块不加载；
 * license 状态可通过 API/CLI 查询；所有 license 失败写入 audit。
 */
export interface LicenseProvider {
  /** 校验当前 license 状态 */
  validate(): Promise<LicenseValidationResult> | LicenseValidationResult;
  /** 检查指定功能是否授权 */
  hasFeature(feature: string): Promise<boolean> | boolean;
  /** 获取 license 摘要（不泄露密钥） */
  getSummary(): Promise<LicenseSummary> | LicenseSummary;
}

export interface LicenseSummary {
  edition: string;
  valid: boolean;
  expiresAt?: string;
  features: string[];
  organization?: string;
  seatCount?: number;
}

/**
 * 企业模块清单（P2-EE-002）
 *
 * 描述企业插件/模块的元数据，用于加载前的版本兼容、签名校验和审计。
 */
export interface EnterpriseModuleManifest {
  /** 模块唯一标识 */
  moduleId: string;
  /** 模块名称 */
  name: string;
  /** 模块版本（semver） */
  version: string;
  /** 兼容的 agentgitops 版本范围（semver range） */
  agentgitopsVersionRange: string;
  /** 模块入口（相对路径或包名） */
  entry: string;
  /** 模块提供的扩展能力 */
  capabilities: EnterpriseModuleCapability[];
  /** 模块签名（用于校验完整性） */
  signature?: string;
  /** 签名算法 */
  signatureAlgorithm?: "sha256" | "sha512";
  /** 所需的 license edition */
  requiredEdition?: string[];
  /** 所需的功能 flag */
  requiredFeatures?: string[];
  /** 模块作者 */
  author?: string;
  /** 模块描述 */
  description?: string;
}

/**
 * 企业模块能力类型
 */
export type EnterpriseModuleCapability =
  | "license-provider"
  | "identity-provider"
  | "policy-provider"
  | "audit-sink"
  | "metrics-sink"
  | "conflict-detector"
  | "git-review-provider"
  | "security-evidence-provider";

/**
 * 企业模块加载结果
 */
export interface EnterpriseModuleLoadResult {
  moduleId: string;
  loaded: boolean;
  capabilities: EnterpriseModuleCapability[];
  error?: string;
  /** 加载耗时（毫秒） */
  durationMs: number;
}

/**
 * EnterpriseModuleLoader — 企业模块加载协议（P2-EE-002）
 *
 * CE 保留元数据发现能力；EE loader 单独实现动态 import 与签名校验。
 *
 * 加载流程：
 * 1. 从配置发现模块清单
 * 2. 校验签名和版本兼容性
 * 3. 校验 license 是否授权所需 edition/features
 * 4. 动态 import 模块入口
 * 5. 注册模块能力到 ExtensionRegistry
 * 6. 记录加载审计事件
 */
export interface EnterpriseModuleLoader {
  /** 发现配置的模块清单 */
  discover(): Promise<EnterpriseModuleManifest[]> | EnterpriseModuleManifest[];
  /** 加载指定模块 */
  load(
    manifest: EnterpriseModuleManifest,
  ): Promise<EnterpriseModuleLoadResult> | EnterpriseModuleLoadResult;
  /** 卸载指定模块 */
  unload(moduleId: string): Promise<boolean> | boolean;
  /** 列出已加载的模块 */
  listLoaded(): Promise<EnterpriseModuleLoadResult[]> | EnterpriseModuleLoadResult[];
}

/**
 * 组织级策略配置（P2-EE-003）
 *
 * 支持组织/团队/项目三层策略继承：
 * - 组织级默认策略 → 团队级覆盖 → 项目级覆盖
 * - 项目策略继承组织默认值，可局部覆盖
 * - 策略变更可审计、可回滚
 */
export interface OrganizationPolicyConfig {
  /** 组织 ID */
  organizationId: string;
  /** 组织名称 */
  name: string;
  /** 组织级默认策略 */
  defaultPolicy: PolicyInheritanceLayer;
  /** 团队级策略覆盖 */
  teamOverrides?: Record<string, PolicyInheritanceLayer>;
  /** 项目级策略覆盖 */
  projectOverrides?: Record<string, PolicyInheritanceLayer>;
  /** 策略版本（用于审计和回滚） */
  version: string;
  /** 最后更新时间 */
  updatedAt: string;
}

/**
 * 策略继承层
 *
 * 每层可定义策略，下层继承上层默认值并可局部覆盖。
 */
export interface PolicyInheritanceLayer {
  /** 受保护分支 */
  protectedBranches?: string[];
  /** 禁止修改的路径 */
  forbiddenPaths?: string[];
  /** Agent 禁止修改的路径 */
  forbiddenForAgentsPaths?: string[];
  /** 高风险路径 */
  highRiskPaths?: string[];
  /** 禁止执行的命令 */
  forbiddenCommands?: string[];
  /** 必须的 Reviewer */
  requiredReviewers?: Record<string, string[]>;
  /** 必须的检查 */
  requiredChecks?: { name: string; command: string }[];
  /** 合并规则 */
  mergeRules?: {
    allowAutoMergeForLowRisk?: boolean;
    blockMergeIfUnverifiedItemsExist?: boolean;
    blockMergeIfConflictExists?: boolean;
  };
  /** 变更规模限制 */
  limits?: {
    maxChangedFiles?: number;
    maxInsertions?: number;
    maxDeletions?: number;
  };
}

/**
 * OrganizationPolicyProvider — 组织级策略中心扩展端口（P2-EE-003）
 *
 * CE 保持项目级策略；EE 通过注入 OrganizationPolicyProvider 实现组织策略继承。
 * 复用已有 `mergePolicyConfigs` 进行策略合并。
 */
export interface OrganizationPolicyProvider {
  /** 获取组织策略配置 */
  getConfig(
    organizationId: string,
  ): Promise<OrganizationPolicyConfig | null> | OrganizationPolicyConfig | null;
  /** 获取指定项目的有效策略（合并组织→团队→项目三层） */
  getEffectivePolicy(
    organizationId: string,
    teamId?: string,
    projectId?: string,
  ): Promise<PolicyInheritanceLayer> | PolicyInheritanceLayer;
  /** 更新组织策略 */
  updateConfig(config: OrganizationPolicyConfig): Promise<void> | void;
  /** 获取策略变更历史 */
  getHistory(
    organizationId: string,
  ): Promise<OrganizationPolicyConfig[]> | OrganizationPolicyConfig[];
}

// ===== P2-EE-004: RBAC 与 SSO =====

/**
 * 用户身份信息
 */
export interface EnterpriseUser {
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  groups: string[];
  roles: EnterpriseRole[];
  organizationId?: string;
}

/**
 * 企业角色
 */
export type EnterpriseRole = "viewer" | "developer" | "reviewer" | "owner" | "admin";

/**
 * 权限检查结果
 */
export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  requiredRole?: EnterpriseRole;
}

/**
 * IdentityProvider — 企业身份认证扩展端口（P2-EE-004）
 *
 * CE 使用 local actor（process.env.USER）；EE 通过注入 IdentityProvider 实现 OIDC/SAML。
 */
export interface IdentityProvider {
  /** 认证当前请求的用户 */
  authenticate(token: string): Promise<EnterpriseUser | null> | EnterpriseUser | null;
  /** 获取当前用户 */
  getCurrentUser(): Promise<EnterpriseUser | null> | EnterpriseUser | null;
}

/**
 * AuthorizationProvider — 企业授权扩展端口（P2-EE-004）
 *
 * CE 使用本地 actor 权限模型；EE 通过注入 AuthorizationProvider 实现 RBAC。
 */
export interface AuthorizationProvider {
  /** 检查用户是否有权限执行操作 */
  checkPermission(input: {
    user: EnterpriseUser;
    resource: string;
    action: string;
    projectId?: string;
  }): Promise<AuthorizationResult> | AuthorizationResult;
  /** 获取用户角色 */
  getUserRoles(userId: string): Promise<EnterpriseRole[]> | EnterpriseRole[];
}

// ===== P2-EE-005: 不可篡改审计 =====

/**
 * 不可篡改审计事件（含哈希链）
 */
export interface ImmutableAuditEntry {
  eventId: string;
  previousHash: string;
  currentHash: string;
  eventType: string;
  actorId: string;
  actorType: string;
  projectId: string;
  taskId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
  /** 签名（用于验证完整性） */
  signature?: string;
}

/**
 * 审计导出格式
 */
export type AuditExportFormat = "json" | "csv" | "siem-json";

/**
 * 审计导出选项
 */
export interface AuditExportOptions {
  format: AuditExportFormat;
  actorId?: string;
  eventType?: string;
  startTime?: string;
  endTime?: string;
  projectId?: string;
  limit?: number;
}

/**
 * ImmutableAuditSink — 不可篡改审计扩展端口（P2-EE-005）
 *
 * CE 使用本地 SQLite 审计；EE 通过注入 ImmutableAuditSink 实现哈希链、WORM 存储和 SIEM 导出。
 */
export interface ImmutableAuditSink {
  /** 追加不可篡改审计事件（自动计算哈希链） */
  appendImmutable(
    event: Omit<ImmutableAuditEntry, "previousHash" | "currentHash">,
  ): Promise<ImmutableAuditEntry> | ImmutableAuditEntry;
  /** 验证审计链完整性 */
  verifyChain():
    | Promise<{ valid: boolean; brokenAt?: string; error?: string }>
    | { valid: boolean; brokenAt?: string; error?: string };
  /** 导出审计事件 */
  export(options: AuditExportOptions): Promise<string> | string;
  /** 设置 SIEM webhook */
  setSiemWebhook(url: string): void;
}

// ===== P2-EE-006: 多仓库协同任务 =====

/**
 * 多仓库任务
 */
export interface MultiRepoTask {
  taskId: string;
  title: string;
  objective: string;
  organizationId: string;
  /** 子任务列表（每个子任务关联一个 repo） */
  subtasks: MultiRepoSubtask[];
  status: "planning" | "in_progress" | "reviewing" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
}

/**
 * 多仓库子任务
 */
export interface MultiRepoSubtask {
  subtaskId: string;
  parentTaskId: string;
  repoUrl: string;
  branch: string;
  agentId: string;
  status: string;
  changePackageId?: string;
  /** 依赖的其他子任务（需先完成） */
  dependsOn?: string[];
}

/**
 * MultiRepoTaskOrchestrator — 多仓库协同任务扩展端口（P2-EE-006）
 *
 * CE 不支持多仓库；EE 通过注入实现跨 repo 任务编排。
 */
export interface MultiRepoTaskOrchestrator {
  /** 创建多仓库任务 */
  createTask(
    input: Omit<MultiRepoTask, "taskId" | "createdAt" | "updatedAt" | "status">,
  ): Promise<MultiRepoTask> | MultiRepoTask;
  /** 获取多仓库任务 */
  getTask(taskId: string): Promise<MultiRepoTask | null> | MultiRepoTask | null;
  /** 列出多仓库任务 */
  listTasks(organizationId: string): Promise<MultiRepoTask[]> | MultiRepoTask[];
  /** 更新子任务状态 */
  updateSubtaskStatus(taskId: string, subtaskId: string, status: string): Promise<void> | void;
}

// ===== P2-EE-007: 跨仓库 Merge Orchestrator =====

/**
 * 跨仓库合并批次
 */
export interface CrossRepoMergeBatch {
  batch: number;
  repos: Array<{
    repoUrl: string;
    taskId: string;
    branch: string;
  }>;
  canParallel: boolean;
  blockedReason?: string;
  rollbackSuggestion?: string;
}

/**
 * 跨仓库合并结果
 */
export interface CrossRepoMergeResult {
  batches: CrossRepoMergeBatch[];
  totalBatches: number;
  hasBlockingDependencies: boolean;
  recommendation: string;
}

/**
 * CrossRepoMergeOrchestrator — 跨仓库合并编排扩展端口（P2-EE-007）
 *
 * CE 使用单仓库 computeMergeOrder；EE 扩展为跨 repo 依赖图。
 */
export interface CrossRepoMergeOrchestrator {
  /** 计算跨仓库合并顺序 */
  computeOrder(tasks: MultiRepoTask[]): Promise<CrossRepoMergeResult> | CrossRepoMergeResult;
  /** 执行合并批次 */
  executeBatch(
    batch: CrossRepoMergeBatch,
  ): Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string };
}

// ===== P2-EE-008: 企业 AgentOps ROI =====

/**
 * ROI 指标
 */
export interface RoiMetrics {
  organizationId: string;
  period: { start: string; end: string };
  totalTasks: number;
  successRate: number;
  reworkRate: number;
  averageMergeTimeHours: number;
  averageReviewTimeHours: number;
  estimatedCostSavings: number;
  estimatedHoursSaved: number;
  agentBreakdown: Array<{
    agentId: string;
    taskCount: number;
    successRate: number;
    averageDuration: number;
  }>;
}

/**
 * EnterpriseAgentOpsProvider — 企业 AgentOps ROI 扩展端口（P2-EE-008）
 *
 * CE 使用本地快照聚合；EE 通过注入实现多团队 ROI 报表。
 */
export interface EnterpriseAgentOpsProvider {
  /** 获取 ROI 指标 */
  getRoiMetrics(input: {
    organizationId: string;
    teamId?: string;
    projectId?: string;
    startDate: string;
    endDate: string;
  }): Promise<RoiMetrics> | RoiMetrics;
  /** 导出 ROI 报表 */
  exportReport(input: {
    organizationId: string;
    format: "csv" | "pdf" | "json";
    startDate: string;
    endDate: string;
  }): Promise<string> | string;
}

// ===== P2-EE-009: 企业 Git 集成 =====

/**
 * 企业 Git Provider 配置
 */
export interface EnterpriseGitProviderConfig {
  provider: "github-enterprise" | "gitlab-self-managed" | "gerrit";
  host: string;
  /** 是否使用内网 CA */
  internalCa?: boolean;
  /** 代理配置 */
  proxy?: string;
  /** 细粒度 token */
  token?: string;
  /** API 版本 */
  apiVersion?: string;
}

/**
 * EnterpriseGitProvider — 企业 Git 集成扩展端口（P2-EE-009）
 *
 * CE 支持 GitHub.com/GitLab.com；EE 通过注入支持企业版 Git 平台。
 */
export interface EnterpriseGitProvider {
  /** 初始化企业 Git Provider */
  initialize(config: EnterpriseGitProviderConfig): Promise<void> | void;
  /** 创建/更新 PR/MR/Change */
  createOrUpdateReviewRequest(params: {
    repo: string;
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
    draft?: boolean;
  }): Promise<{ number: number; url: string; state: string; draft?: boolean }>;
  /** 获取 CI 状态 */
  getCheckStatus(repo: string, ref: string): Promise<{ status: string; conclusion?: string }>;
  /** 配置 Webhook */
  configureWebhook(repo: string, webhookUrl: string, secret: string): Promise<void> | void;
}

// ===== P2-EE-010: 企业安全扫描插件 =====

/**
 * 安全扫描结果
 */
export interface SecurityScanResult {
  scanId: string;
  scanType: "sast" | "secret" | "dependency" | "license";
  status: "passed" | "failed" | "warning";
  findings: SecurityFinding[];
  scannedAt: string;
  duration: number;
}

/**
 * 安全发现
 */
export interface SecurityFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  rule: string;
  message: string;
  file?: string;
  line?: number;
  /** 是否阻断合并 */
  blocking: boolean;
}

/**
 * SecurityEvidenceProvider — 企业安全扫描插件扩展端口（P2-EE-010）
 *
 * CE 保留 evidence schema（not_configured）；EE 通过注入实现真实安全扫描。
 */
export interface SecurityEvidenceProvider {
  /** 执行安全扫描 */
  scan(input: {
    repoPath: string;
    changedFiles: string[];
    scanTypes: SecurityScanResult["scanType"][];
  }): Promise<SecurityScanResult[]> | SecurityScanResult[];
  /** 获取上次扫描结果 */
  getLastResult(scanId: string): Promise<SecurityScanResult | null> | SecurityScanResult | null;
  /** 检查是否有阻断性发现 */
  hasBlockingFindings(results: SecurityScanResult[]): boolean;
}

// ===== P1-001: StorageAdapter（EE 存储层）=====

/**
 * 存储适配器端口（P1-001）
 *
 * CE 使用 SQLite（node:sqlite）；EE 通过注入 PostgreSQL 适配器实现企业级存储。
 * 支持从 SQLite 迁移到 PostgreSQL。
 */
export interface StorageAdapter {
  /** 初始化存储（创建表、索引等） */
  initialize(): Promise<void> | void;
  /** 关闭连接 */
  close(): Promise<void> | void;
  /** 健康检查 */
  healthCheck():
    | Promise<{ healthy: boolean; latencyMs?: number; error?: string }>
    | { healthy: boolean; latencyMs?: number; error?: string };
  /** 获取存储类型 */
  getType(): "sqlite" | "postgresql" | "mysql" | "custom";
  /** 获取存储版本 */
  getVersion(): string;
  /** 可选原始查询接口，供 EE 审计/合规模块在持久化存储上复用 */
  query?(text: string, params?: unknown[]): Promise<unknown[]> | unknown[];
}

/**
 * 存储配置
 */
export interface StorageConfig {
  type: "sqlite" | "postgresql";
  /** SQLite 文件路径或 PostgreSQL 连接字符串 */
  url: string;
  /** 连接池大小（PostgreSQL） */
  poolSize?: number;
  /** 连接超时（毫秒） */
  timeoutMs?: number;
  /** 是否启用 SSL（PostgreSQL） */
  ssl?: boolean;
}

// ===== P1-006: 合规报告导出 =====

/**
 * 合规报告格式
 */
export type ComplianceReportFormat = "json" | "csv" | "pdf";

/**
 * 合规报告类型
 */
export type ComplianceStandard = "soc2" | "iso27001" | "gdpr" | "custom";

/**
 * 合规报告选项
 */
export interface ComplianceReportOptions {
  format: ComplianceReportFormat;
  standard: ComplianceStandard;
  startDate: string;
  endDate: string;
  projectId?: string;
  includeAuditEvents?: boolean;
  includePolicyChanges?: boolean;
  includeAccessChanges?: boolean;
}

/**
 * 合规报告结果
 */
export interface ComplianceReportResult {
  reportId: string;
  standard: ComplianceStandard;
  format: ComplianceReportFormat;
  generatedAt: string;
  period: { start: string; end: string };
  summary: {
    totalAuditEvents: number;
    totalPolicyChanges: number;
    totalAccessChanges: number;
    highRiskActions: number;
    failedVerifications: number;
  };
  data: unknown;
  downloadUrl?: string;
}

/**
 * ComplianceReportProvider — 合规报告导出端口（P1-006）
 *
 * CE 不生成合规报告；EE 通过注入实现 SOC2/ISO27001/GDPR 报告。
 */
export interface ComplianceReportProvider {
  /** 生成合规报告 */
  generate(
    options: ComplianceReportOptions,
  ): Promise<ComplianceReportResult> | ComplianceReportResult;
  /** 获取已生成的报告列表 */
  listReports(): Promise<ComplianceReportResult[]> | ComplianceReportResult[];
  /** 下载报告 */
  download(
    reportId: string,
  ):
    | Promise<{ data: string; format: ComplianceReportFormat }>
    | { data: string; format: ComplianceReportFormat };
}
