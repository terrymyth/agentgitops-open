import type {
  StorageAdapter,
  StorageConfig,
  ComplianceReportProvider,
  ComplianceReportOptions,
  ComplianceReportResult,
} from "@agentgitops/core";

/**
 * CeStorageAdapter — CE 默认存储适配器（P1-001）
 *
 * CE 使用 SQLite（node:sqlite），不切换到 PostgreSQL。
 * EE 通过注入 PostgreSQL 适配器替换此实现。
 */
export class CeStorageAdapter implements StorageAdapter {
  constructor(_config: StorageConfig) {}

  initialize(): void {
    // CE SQLite 在 LocalDb 中自动初始化，无需额外操作
  }

  close(): void {
    // CE SQLite 连接由 LocalDb 管理
  }

  healthCheck(): { healthy: boolean; latencyMs: number } {
    return { healthy: true, latencyMs: 0 };
  }

  getType(): "sqlite" {
    return "sqlite";
  }

  getVersion(): string {
    return "1.0.0";
  }
}

/**
 * CeComplianceReportProvider — CE 默认合规报告 Provider（P1-006）
 *
 * CE 不生成合规报告，返回空结果。
 * EE 通过注入实现 SOC2/ISO27001/GDPR 报告。
 */
export class CeComplianceReportProvider implements ComplianceReportProvider {
  generate(_options: ComplianceReportOptions): ComplianceReportResult {
    return {
      reportId: "ce-not-supported",
      standard: "custom",
      format: "json",
      generatedAt: new Date().toISOString(),
      period: { start: "", end: "" },
      summary: {
        totalAuditEvents: 0,
        totalPolicyChanges: 0,
        totalAccessChanges: 0,
        highRiskActions: 0,
        failedVerifications: 0,
      },
      data: {
        message:
          "Compliance reports are not available in CE edition. Upgrade to Enterprise Edition for SOC2/ISO27001/GDPR reports.",
      },
    };
  }

  listReports(): ComplianceReportResult[] {
    return [];
  }

  download(): { data: string; format: "json" } {
    return { data: JSON.stringify({ message: "Not available in CE" }), format: "json" };
  }
}
