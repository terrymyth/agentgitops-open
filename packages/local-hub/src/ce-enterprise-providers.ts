import type {
  AuthorizationProvider,
  AuthorizationResult,
  AuditExportOptions,
  CrossRepoMergeBatch,
  CrossRepoMergeResult,
  EnterpriseAgentOpsProvider,
  EnterpriseGitProvider,
  EnterpriseGitProviderConfig,
  EnterpriseRole,
  EnterpriseUser,
  IdentityProvider,
  ImmutableAuditEntry,
  ImmutableAuditSink,
  MultiRepoTask,
  MultiRepoTaskOrchestrator,
  RoiMetrics,
  SecurityEvidenceProvider,
  SecurityScanResult,
  CrossRepoMergeOrchestrator,
} from "@agentgitops/core";

/**
 * CeIdentityProvider — CE 默认身份认证 Provider（P2-EE-004）
 *
 * CE 使用 local actor（process.env.USER），不进行真实身份认证。
 */
export class CeIdentityProvider implements IdentityProvider {
  authenticate(_token: string): EnterpriseUser | null {
    return this.getCurrentUser();
  }

  getCurrentUser(): EnterpriseUser | null {
    const username = process.env.USER ?? "local-user";
    return {
      userId: username,
      username,
      displayName: username,
      groups: [],
      roles: ["admin"],
    };
  }
}

/**
 * CeAuthorizationProvider — CE 默认授权 Provider（P2-EE-004）
 *
 * CE 使用本地 actor 权限模型，所有操作默认允许。
 */
export class CeAuthorizationProvider implements AuthorizationProvider {
  checkPermission(): AuthorizationResult {
    return { allowed: true };
  }

  getUserRoles(_userId: string): EnterpriseRole[] {
    return ["admin"];
  }
}

/**
 * CeImmutableAuditSink — CE 默认不可篡改审计 Sink（P2-EE-005）
 *
 * CE 使用本地 SQLite 审计，不实现哈希链和 SIEM 导出。
 */
export class CeImmutableAuditSink implements ImmutableAuditSink {
  appendImmutable(
    event: Omit<ImmutableAuditEntry, "previousHash" | "currentHash">,
  ): ImmutableAuditEntry {
    return {
      ...event,
      previousHash: "",
      currentHash: "",
    };
  }

  verifyChain(): { valid: boolean } {
    return { valid: true };
  }

  export(_options: AuditExportOptions): string {
    return "[]";
  }

  setSiemWebhook(_url: string): void {
    // CE 不支持 SIEM webhook
  }
}

/**
 * CeMultiRepoTaskOrchestrator — CE 默认多仓库任务编排器（P2-EE-006）
 *
 * CE 不支持多仓库协同任务。
 */
export class CeMultiRepoTaskOrchestrator implements MultiRepoTaskOrchestrator {
  createTask(): MultiRepoTask {
    throw new Error("Multi-repo task orchestration is not available in CE edition.");
  }

  getTask(): MultiRepoTask | null {
    return null;
  }

  listTasks(): MultiRepoTask[] {
    return [];
  }

  updateSubtaskStatus(): void {
    // CE 不支持
  }
}

/**
 * CeCrossRepoMergeOrchestrator — CE 默认跨仓库合并编排器（P2-EE-007）
 *
 * CE 使用单仓库 computeMergeOrder，不支持跨 repo 合并编排。
 */
export class CeCrossRepoMergeOrchestrator implements CrossRepoMergeOrchestrator {
  computeOrder(): CrossRepoMergeResult {
    return {
      batches: [],
      totalBatches: 0,
      hasBlockingDependencies: false,
      recommendation: "Cross-repo merge orchestration is not available in CE edition.",
    };
  }

  executeBatch(_batch: CrossRepoMergeBatch): { success: boolean; error?: string } {
    return {
      success: false,
      error: "Cross-repo merge execution is not available in CE edition.",
    };
  }
}

/**
 * CeEnterpriseAgentOpsProvider — CE 默认企业 AgentOps Provider（P2-EE-008）
 *
 * CE 使用本地快照聚合，不支持多团队 ROI 报表。
 */
export class CeEnterpriseAgentOpsProvider implements EnterpriseAgentOpsProvider {
  getRoiMetrics(): RoiMetrics {
    return {
      organizationId: "local",
      period: { start: "", end: "" },
      totalTasks: 0,
      successRate: 0,
      reworkRate: 0,
      averageMergeTimeHours: 0,
      averageReviewTimeHours: 0,
      estimatedCostSavings: 0,
      estimatedHoursSaved: 0,
      agentBreakdown: [],
    };
  }

  exportReport(): string {
    return "Enterprise AgentOps ROI report is not available in CE edition.";
  }
}

/**
 * CeEnterpriseGitProvider — CE 默认企业 Git Provider（P2-EE-009）
 *
 * CE 支持 GitHub.com/GitLab.com，不支持企业版 Git 平台。
 */
export class CeEnterpriseGitProvider implements EnterpriseGitProvider {
  initialize(_config: EnterpriseGitProviderConfig): void {
    // CE 不初始化企业 Git Provider
  }

  createOrUpdateReviewRequest(): Promise<{
    number: number;
    url: string;
    state: string;
    draft?: boolean;
  }> {
    return Promise.reject(
      new Error(
        "Enterprise Git Provider is not available in CE edition. Use GitHub.com or GitLab.com providers.",
      ),
    );
  }

  getCheckStatus(): Promise<{ status: string; conclusion?: string }> {
    return Promise.reject(new Error("Enterprise Git Provider is not available in CE edition."));
  }

  configureWebhook(): Promise<void> {
    return Promise.reject(new Error("Enterprise Git Provider is not available in CE edition."));
  }
}

/**
 * CeSecurityEvidenceProvider — CE 默认安全扫描 Provider（P2-EE-010）
 *
 * CE 保留 evidence schema（not_configured），不执行真实安全扫描。
 */
export class CeSecurityEvidenceProvider implements SecurityEvidenceProvider {
  scan(): SecurityScanResult[] {
    return [];
  }

  getLastResult(): SecurityScanResult | null {
    return null;
  }

  hasBlockingFindings(_results: SecurityScanResult[]): boolean {
    return false;
  }
}
